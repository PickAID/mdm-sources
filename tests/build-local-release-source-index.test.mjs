import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { buildLocalRelease } from "../tools/build-local-release.mjs";
import { verifyReleaseInstall } from "../tools/verify-release-install.mjs";
import { verifyReleaseSchema } from "../tools/verify-release-schema.mjs";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite");

test("buildLocalRelease materializes source_index_sqlite packages as source indexes", async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), "mdm-source-index-repo-"));
  const outDir = await mkdtemp(join(tmpdir(), "mdm-source-index-out-"));

  await writeSourceIndexFixtureRepository(repoRoot);
  const result = await buildLocalRelease({
    root: repoRoot,
    outDir,
    builtAt: "2026-05-07T00:00:00.000Z"
  });

  assert.equal(result.artifacts[0].artifactName, "minecraft-1.20.1-source-index-0.1.0.sqlite");
  assertSourceIndexSqlite(result.artifacts[0].artifactPath);

  const releaseManifest = JSON.parse(
    await readFile(join(outDir, "mdm-release-manifest.json"), "utf-8")
  );
  assert.equal(releaseManifest.packages[0].artifactType, "source_index");
  assert.equal(releaseManifest.packages[0].artifactKind, "source_index");
  assert.equal(releaseManifest.packages[0].queryAdapter, "source_index_sqlite");
  assert.deepEqual(releaseManifest.packages[0].metadata.sqlite.requiredTables, [
    "source_files",
    "source_files_fts"
  ]);

  const verified = await verifyReleaseInstall({ manifest: result.manifestPath });
  const schema = await verifyReleaseSchema({ manifestPath: result.manifestPath });

  assert.deepEqual(schema.errors, []);
  assert.equal(verified.verifiedCount, 1);
});

function assertSourceIndexSqlite(artifactPath) {
  const database = new DatabaseSync(artifactPath);
  try {
    const row = database.prepare("SELECT class_name, source_path FROM source_files").get();
    assert.equal(row.class_name, "net.minecraft.world.item.ItemStack");
    assert.equal(row.source_path, "net/minecraft/world/item/ItemStack.java");
    const ftsRows = database
      .prepare("SELECT file_id FROM source_files_fts WHERE source_files_fts MATCH ?")
      .all('"ItemStack"');
    assert.deepEqual(ftsRows.map((entry) => entry.file_id), ["itemstack"]);
  } finally {
    database.close();
  }
}

async function writeSourceIndexFixtureRepository(root) {
  await mkdir(join(root, "packages/source-index/vanilla/1.20.1/payload"), {
    recursive: true
  });
  await mkdir(join(root, "registry/packages"), { recursive: true });
  await writeFile(
    join(root, "packages/source-index/vanilla/1.20.1/package.json"),
    JSON.stringify(sourceIndexPackageManifest(), null, 2)
  );
  await writeFile(
    join(root, "packages/source-index/vanilla/1.20.1/payload/source-index.json"),
    JSON.stringify(sourceIndexPayload(), null, 2)
  );
  await writeFile(
    join(root, "registry/index.json"),
    JSON.stringify({
      schemaVersion: 1,
      packages: [
        {
          id: "minecraft-1.20.1-source-index",
          manifestPath: "registry/packages/minecraft-1.20.1-source-index.json",
          currentRelease: null
        }
      ]
    })
  );
  await writeFile(
    join(root, "registry/packages/minecraft-1.20.1-source-index.json"),
    JSON.stringify({
      id: "minecraft-1.20.1-source-index",
      sourcePath: "packages/source-index/vanilla/1.20.1/package.json",
      currentRelease: null
    })
  );
}

function sourceIndexPackageManifest() {
  return {
    identity: {
      schemaVersion: 2,
      packageId: "minecraft-1.20.1-source-index",
      packageVersion: "0.1.0",
      namespace: "minecraft",
      displayName: "Minecraft 1.20.1 Source Index",
      description: "Tiny source index fixture without source bytes."
    },
    target: {
      minecraftVersions: ["1.20.1"],
      loaders: ["vanilla"],
      mappings: ["mojmap"]
    },
    artifact: {
      kind: "source_index",
      format: "sqlite",
      schemaId: "mdm.source.index.sqlite",
      schemaVersion: 1,
      entrypoint: "payload/source-index.json"
    },
    capabilities: ["source_lookup", "source_chunk_search"],
    policy: {
      privacy: "public_release",
      lifecycle: ["downloadable"],
      canCommitToRepository: true,
      canUploadToPublicRelease: true,
      requiresUserConsent: false
    },
    query: {
      adapter: "source_index_sqlite",
      capabilities: ["source_lookup", "source_chunk_search"],
      defaultLimit: 8,
      maxLimit: 50,
      preferredFallbacks: []
    },
    release: { channel: "sources", family: "vanilla-source-index" }
  };
}

function sourceIndexPayload() {
  return {
    files: [
      {
        id: "itemstack",
        minecraftVersion: "1.20.1",
        loader: "vanilla",
        mappings: "mojmap",
        className: "net.minecraft.world.item.ItemStack",
        packageName: "net.minecraft.world.item",
        sourcePath: "net/minecraft/world/item/ItemStack.java",
        sha256: "0".repeat(64),
        summary: "Item stack source metadata only; no source bytes."
      }
    ]
  };
}
