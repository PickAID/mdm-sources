import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { buildLocalRelease } from "../tools/build-local-release.mjs";
import { listReleaseArtifacts } from "../tools/list-release-artifacts.mjs";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite");

test("release artifacts stay split by package type instead of one mixed artifact", async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), "mdm-artifact-split-repo-"));
  const outDir = await mkdtemp(join(tmpdir(), "mdm-artifact-split-out-"));

  await writeSplitFixtureRepository(repoRoot);
  const result = await buildLocalRelease({
    root: repoRoot,
    outDir,
    builtAt: "2026-05-08T00:00:00.000Z",
    writeRegistry: false
  });

  const releaseManifest = JSON.parse(
    await readFile(join(outDir, "mdm-release-manifest.json"), "utf-8")
  );
  const entries = releaseManifest.packages.toSorted((a, b) =>
    a.packageId.localeCompare(b.packageId)
  );

  assert.deepEqual(
    entries.map((entry) => ({
      packageId: entry.packageId,
      artifactType: entry.artifactType,
      artifactKind: entry.artifactKind,
      format: entry.format,
      artifactName: entry.artifactName
    })),
    [
      {
        packageId: "core-docs-search-sqlite",
        artifactType: "docs",
        artifactKind: "docs_bundle",
        format: "sqlite",
        artifactName: "core-docs-search-sqlite-0.1.0.sqlite"
      },
      {
        packageId: "minecraft-1.20.1-source-index",
        artifactType: "source_index",
        artifactKind: "source_index",
        format: "sqlite",
        artifactName: "minecraft-1.20.1-source-index-0.1.0.sqlite"
      },
      {
        packageId: "minecraft-1.20.1-vanilla-datapack-profile",
        artifactType: "datapack",
        artifactKind: "datapack_bundle",
        format: "json",
        artifactName:
          "minecraft-1.20.1-vanilla-datapack-profile-0.1.0.mdm-resource.json"
      },
      {
        packageId: "minecraft-1.20.1-vanilla-resourcepack-profile",
        artifactType: "resourcepack",
        artifactKind: "resourcepack_bundle",
        format: "json",
        artifactName:
          "minecraft-1.20.1-vanilla-resourcepack-profile-0.1.0.mdm-resource.json"
      }
    ]
  );

  assert.equal(new Set(entries.map((entry) => entry.artifactName)).size, 4);
  assert.deepEqual(
    result.artifacts.map((artifact) => artifact.artifactName).sort(),
    entries.map((entry) => entry.artifactName).sort()
  );
  assert.deepEqual(
    (await listReleaseArtifacts(join(outDir, "mdm-release-manifest.json")))
      .map((path) => path.replace(`${outDir}/`, ""))
      .sort(),
    [
      "core-docs-search-sqlite-0.1.0.sqlite",
      "mdm-release-manifest.json",
      "mdm-release-summary.json",
      "minecraft-1.20.1-source-index-0.1.0.sqlite",
      "minecraft-1.20.1-vanilla-datapack-profile-0.1.0.mdm-resource.json",
      "minecraft-1.20.1-vanilla-resourcepack-profile-0.1.0.mdm-resource.json"
    ]
  );

  const datapackArtifact = JSON.parse(
    await readFile(
      join(outDir, "minecraft-1.20.1-vanilla-datapack-profile-0.1.0.mdm-resource.json"),
      "utf-8"
    )
  );
  const resourcepackArtifact = JSON.parse(
    await readFile(
      join(outDir, "minecraft-1.20.1-vanilla-resourcepack-profile-0.1.0.mdm-resource.json"),
      "utf-8"
    )
  );
  assert.deepEqual(Object.keys(datapackArtifact.payload), [
    "package.json",
    "payload/datapack-profile.json"
  ]);
  assert.deepEqual(Object.keys(resourcepackArtifact.payload), [
    "package.json",
    "payload/resourcepack-profile.json"
  ]);
  assert.equal(
    Object.hasOwn(datapackArtifact.payload, "payload/resourcepack-profile.json"),
    false
  );
  assert.equal(
    Object.hasOwn(resourcepackArtifact.payload, "payload/datapack-profile.json"),
    false
  );

  const docsTables = sqliteTables(join(outDir, "core-docs-search-sqlite-0.1.0.sqlite"));
  assert.ok(docsTables.includes("docs_entries"));
  assert.ok(docsTables.includes("docs_entries_fts"));
  assert.equal(docsTables.includes("files"), false);
  assert.equal(docsTables.includes("source_chunks"), false);

  const sourceIndexTables = sqliteTables(
    join(outDir, "minecraft-1.20.1-source-index-0.1.0.sqlite")
  );
  assert.ok(sourceIndexTables.includes("files"));
  assert.ok(sourceIndexTables.includes("java_symbols"));
  assert.ok(sourceIndexTables.includes("source_chunks"));
  assert.equal(sourceIndexTables.includes("docs_entries"), false);
});

function sqliteTables(databasePath) {
  const database = new DatabaseSync(databasePath);
  try {
    return database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((row) => row.name);
  } finally {
    database.close();
  }
}

async function writeSplitFixtureRepository(root) {
  await mkdir(join(root, "registry/packages"), { recursive: true });
  await writeJson(join(root, "registry/index.json"), {
    schemaVersion: 1,
    packages: [
      registryEntry("minecraft-1.20.1-vanilla-datapack-profile"),
      registryEntry("minecraft-1.20.1-vanilla-resourcepack-profile"),
      registryEntry("core-docs-search-sqlite"),
      registryEntry("minecraft-1.20.1-source-index")
    ]
  });

  await writeJsonPackage(root, "packages/datapack/vanilla/1.20.1", {
    packageId: "minecraft-1.20.1-vanilla-datapack-profile",
    kind: "datapack_bundle",
    format: "json",
    schemaId: "mdm.datapack.profile.json",
    entrypoint: "payload/datapack-profile.json",
    channel: "datapack",
    family: "vanilla-datapack",
    capabilities: ["resource_location_lookup", "datapack_trace"],
    queryAdapter: "archive_content"
  }, {
    "payload/datapack-profile.json": { profileKind: "datapack" }
  });

  await writeJsonPackage(root, "packages/resourcepack/vanilla/1.20.1", {
    packageId: "minecraft-1.20.1-vanilla-resourcepack-profile",
    kind: "resourcepack_bundle",
    format: "json",
    schemaId: "mdm.resourcepack.profile.json",
    entrypoint: "payload/resourcepack-profile.json",
    channel: "resourcepack",
    family: "vanilla-resourcepack",
    capabilities: ["asset_lookup", "resourcepack_trace"],
    queryAdapter: "archive_content"
  }, {
    "payload/resourcepack-profile.json": { profileKind: "resourcepack" }
  });

  await writeJsonPackage(root, "packages/docs/core/search-sqlite", {
    packageId: "core-docs-search-sqlite",
    kind: "docs_bundle",
    format: "sqlite",
    schemaId: "mdm.docs.sqlite",
    schemaVersion: 3,
    entrypoint: "payload/docs-search.json",
    channel: "docs",
    family: "core-docs",
    capabilities: ["docs_search", "docs_direct_read"],
    queryAdapter: "sqlite_docs"
  }, {
    "payload/docs-search.json": {
      entries: [
        {
          id: "datapack-doc",
          title: "Datapack Docs",
          kind: "concept",
          summary: "Curated docs row.",
          searchTerms: ["datapack"],
          scriptScopes: [],
          addonNames: [],
          eventNames: [],
          codeSymbols: []
        }
      ]
    }
  });

  await writeJsonPackage(root, "packages/source-index/vanilla/1.20.1", {
    packageId: "minecraft-1.20.1-source-index",
    kind: "source_index",
    format: "sqlite",
    schemaId: "mdm.source.index.sqlite",
    entrypoint: "payload/source-index.json",
    channel: "sources",
    family: "vanilla-source-index",
    capabilities: ["source_lookup", "source_chunk_search"],
    queryAdapter: "source_index_sqlite"
  }, {
    "payload/source-index.json": {
      files: [
        {
          minecraftVersion: "1.20.1",
          loader: "vanilla",
          mappings: "mojmap",
          className: "net.minecraft.world.item.ItemStack",
          packageName: "net.minecraft.world.item",
          sourcePath: "net/minecraft/world/item/ItemStack.java",
          sha256: "0".repeat(64),
          summary: "Source metadata only."
        }
      ],
      javaSymbols: [],
      javaMembers: [],
      sourceChunks: []
    }
  });
}

async function writeJsonPackage(root, packageRoot, options, payloads) {
  await mkdir(join(root, packageRoot), { recursive: true });
  for (const payloadPath of Object.keys(payloads)) {
    await mkdir(join(root, packageRoot, "payload"), { recursive: true });
    await writeJson(join(root, packageRoot, payloadPath), payloads[payloadPath]);
  }

  await writeJson(join(root, packageRoot, "package.json"), packageManifest(options));
  await writeJson(join(root, `registry/packages/${options.packageId}.json`), {
    schemaVersion: 1,
    id: options.packageId,
    sourcePath: `${packageRoot}/package.json`,
    currentRelease: null
  });
}

function packageManifest(options) {
  return {
    identity: {
      schemaVersion: 2,
      packageId: options.packageId,
      packageVersion: "0.1.0",
      namespace: options.packageId.startsWith("core-") ? "core" : "minecraft",
      displayName: options.packageId,
      description: options.packageId
    },
    target: { minecraftVersions: ["1.20.1"], loaders: ["vanilla"] },
    artifact: {
      kind: options.kind,
      format: options.format,
      schemaId: options.schemaId,
      schemaVersion: options.schemaVersion ?? 1,
      entrypoint: options.entrypoint
    },
    capabilities: options.capabilities,
    policy: {
      privacy: "public_release",
      lifecycle: ["downloadable"],
      canCommitToRepository: true,
      canUploadToPublicRelease: true,
      requiresUserConsent: false
    },
    query: {
      adapter: options.queryAdapter,
      capabilities: options.capabilities,
      defaultLimit: 8,
      maxLimit: 50,
      preferredFallbacks: []
    },
    release: { channel: options.channel, family: options.family }
  };
}

function registryEntry(id) {
  return {
    id,
    manifestPath: `registry/packages/${id}.json`,
    currentRelease: null
  };
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}
