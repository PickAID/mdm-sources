import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { buildLocalRelease } from "../tools/build-local-release.mjs";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite");

test("buildLocalRelease materializes v2 sqlite docs packages as real databases", async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), "mdm-sources-release-sqlite-"));
  const outDir = await mkdtemp(join(tmpdir(), "mdm-release-out-sqlite-"));

  await writeSqliteDocsFixtureRepository(repoRoot);

  const result = await buildLocalRelease({
    root: repoRoot,
    outDir,
    builtAt: "2026-05-06T00:00:00.000Z"
  });

  assert.equal(result.artifacts.length, 1);
  assert.equal(result.artifacts[0].packageId, "core-docs-search-sqlite");
  assert.equal(
    result.artifacts[0].artifactName,
    "core-docs-search-sqlite-0.1.0.sqlite"
  );

  assertSqliteArtifact(result.artifacts[0].artifactPath);

  const releaseManifest = JSON.parse(
    await readFile(join(outDir, "mdm-release-manifest.json"), "utf-8")
  );
  assert.equal(releaseManifest.packages[0].format, "sqlite");
  assert.equal(releaseManifest.packages[0].artifactType, "docs");
  assert.equal(releaseManifest.packages[0].artifactName, result.artifacts[0].artifactName);
  assert.deepEqual(releaseManifest.packages[0].metadata, sqliteMetadata());

  const registryDetail = JSON.parse(
    await readFile(
      join(repoRoot, "registry/packages/core-docs-search-sqlite.json"),
      "utf-8"
    )
  );
  assert.deepEqual(registryDetail.metadata, sqliteMetadata());
});

function assertSqliteArtifact(artifactPath) {
  const database = new DatabaseSync(artifactPath);
  try {
    assert.equal(database.prepare("PRAGMA user_version").get().user_version, 3);

    const tables = database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((row) => row.name);
    assert.ok(tables.includes("docs_entries"));
    assert.ok(tables.includes("docs_entries_fts"));

    const row = database
      .prepare(
        "SELECT entry_id, package_id, title, search_terms, code_symbols, metadata FROM docs_entries"
      )
      .get();
    assert.equal(row.entry_id, "kubejs-native-events");
    assert.equal(row.package_id, "core-docs-search-sqlite");
    assert.equal(row.title, "KubeJS Native Event Routing");
    assert.deepEqual(JSON.parse(row.search_terms), ["KubeJS", "NativeEvents"]);
    assert.deepEqual(JSON.parse(row.code_symbols), ["NativeEvents", "ForgeEvents"]);
    assert.deepEqual(JSON.parse(row.metadata), {
      schemaSymbol: {
        identifier: "dev.latvian.mods.kubejs.event.EventHandler",
        kind: "class"
      },
      upstreamPath: "probe/generated/kubejs/events.d.ts",
      contentHash: "sha256:test"
    });

    const ftsRows = database
      .prepare("SELECT entry_id FROM docs_entries_fts WHERE docs_entries_fts MATCH ?")
      .all('"NativeEvents"');
    assert.deepEqual(ftsRows.map((row) => row.entry_id), ["kubejs-native-events"]);
  } finally {
    database.close();
  }
}

async function writeSqliteDocsFixtureRepository(root) {
  await mkdir(join(root, "packages/docs/core/search-sqlite/payload"), {
    recursive: true
  });
  await mkdir(join(root, "registry/packages"), { recursive: true });
  await writeFile(
    join(root, "packages/docs/core/search-sqlite/package.json"),
    JSON.stringify(sqlitePackageManifest(), null, 2)
  );
  await writeFile(
    join(root, "packages/docs/core/search-sqlite/payload/docs-search.json"),
    JSON.stringify(sqliteDocsPayload(), null, 2)
  );
  await writeFile(
    join(root, "registry/index.json"),
    JSON.stringify(
      {
        schemaVersion: 1,
        packages: [
          {
            id: "core-docs-search-sqlite",
            manifestPath: "registry/packages/core-docs-search-sqlite.json",
            required: false,
            format: "sqlite",
            currentRelease: null
          }
        ]
      },
      null,
      2
    )
  );
  await writeFile(
    join(root, "registry/packages/core-docs-search-sqlite.json"),
    JSON.stringify(
      {
        schemaVersion: 1,
        id: "core-docs-search-sqlite",
        sourcePath: "packages/docs/core/search-sqlite/package.json",
        currentRelease: null
      },
      null,
      2
    )
  );
}

function sqlitePackageManifest() {
  return {
    identity: {
      schemaVersion: 2,
      packageId: "core-docs-search-sqlite",
      packageVersion: "0.1.0",
      namespace: "core",
      displayName: "Core Docs Search SQLite",
      description: "Searchable curated docs SQLite package."
    },
    target: { minecraftVersions: ["1.20.1"], loaders: ["kubejs"] },
    artifact: {
      kind: "docs_bundle",
      format: "sqlite",
      schemaId: "mdm.docs.sqlite",
      schemaVersion: 3,
      entrypoint: "payload/docs-search.json"
    },
    capabilities: ["docs_search", "docs_direct_read"],
    policy: {
      privacy: "public_release",
      lifecycle: ["downloadable"],
      canCommitToRepository: true,
      canUploadToPublicRelease: true,
      requiresUserConsent: false
    },
    query: {
      adapter: "sqlite_docs",
      capabilities: ["docs_search", "docs_direct_read"],
      defaultLimit: 8,
      maxLimit: 50,
      preferredFallbacks: []
    },
    release: { channel: "docs", family: "core-docs" }
  };
}

function sqliteMetadata() {
  return {
    storageKind: "sqlite_bundle",
    installTier: "optional_dataset",
    commitPolicy: "repository_manifest",
    sqlite: {
      databaseName: "core-docs-search-sqlite.sqlite",
      minUserVersion: 3,
      requiredTables: ["docs_entries", "docs_entries_fts"]
    }
  };
}

function sqliteDocsPayload() {
  return {
    entries: [
      {
        id: "kubejs-native-events",
        title: "KubeJS Native Event Routing",
        kind: "concept",
        summary: "Use NativeEvents for platform events when ProbeJS exposes them.",
        searchTerms: ["KubeJS", "NativeEvents"],
        scriptScopes: ["server_scripts"],
        addonNames: ["KubeJS"],
        eventNames: ["NativeEvents"],
        codeSymbols: ["NativeEvents", "ForgeEvents"],
        metadata: {
          schemaSymbol: {
            identifier: "dev.latvian.mods.kubejs.event.EventHandler",
            kind: "class"
          },
          upstreamPath: "probe/generated/kubejs/events.d.ts",
          contentHash: "sha256:test"
        }
      }
    ]
  };
}
