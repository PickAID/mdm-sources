import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { buildLocalRelease } from "../tools/build-local-release.mjs";
import { verifyReleaseInstall } from "../tools/verify-release-install.mjs";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite");

test("verifyReleaseInstall validates local manifest artifacts and sqlite tables", async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), "mdm-verify-repo-"));
  const outDir = await mkdtemp(join(tmpdir(), "mdm-verify-out-"));

  await writeSqliteDocsFixtureRepository(repoRoot);
  const release = await buildLocalRelease({
    root: repoRoot,
    outDir,
    builtAt: "2026-05-07T00:00:00.000Z"
  });

  const result = await verifyReleaseInstall({ manifest: release.manifestPath });

  assert.equal(result.packageCount, 1);
  assert.equal(result.verifiedCount, 1);
  assert.equal(result.packages[0].packageId, "core-docs-search-sqlite");
  assert.equal(result.packages[0].format, "sqlite");
  assert.equal(result.totalSizeBytes, release.artifacts[0].sizeBytes);
});

test("verifyReleaseInstall resolves HTTP artifacts relative to manifestUrl", async () => {
  const manifestUrl = "https://example.invalid/releases/download/v1/mdm-release-manifest.json";
  const artifactBody = Buffer.from("{}\n");
  const manifestBody = JSON.stringify({
    schemaVersion: 1,
    packages: [
      {
        packageId: "docs-json",
        artifactName: "docs-json-0.1.0.mdm-resource.json",
        format: "json",
        sha256: "ca3d163bab055381827226140568f3bef7eaac187cebd76878e0b63e9e442356",
        sizeBytes: artifactBody.length
      }
    ]
  });
  const requested = [];

  const result = await verifyReleaseInstall({
    manifest: manifestUrl,
    fetcher: async (url) => {
      requested.push(url);
      return {
        ok: true,
        status: 200,
        arrayBuffer: async () => {
          return url === manifestUrl ? Buffer.from(manifestBody) : artifactBody;
        }
      };
    }
  });

  assert.deepEqual(requested, [
    manifestUrl,
    "https://example.invalid/releases/download/v1/docs-json-0.1.0.mdm-resource.json"
  ]);
  assert.equal(result.verifiedCount, 1);
});

test("verifyReleaseInstall rejects artifact checksum mismatches", async () => {
  const root = await mkdtemp(join(tmpdir(), "mdm-verify-mismatch-"));
  const manifestPath = join(root, "mdm-release-manifest.json");
  await writeFile(join(root, "bad.json"), "{}\n");
  await writeFile(
    manifestPath,
    JSON.stringify({
      schemaVersion: 1,
      packages: [
        {
          packageId: "bad",
          artifactName: "bad.json",
          sha256: "0".repeat(64),
          sizeBytes: 3
        }
      ]
    })
  );

  await assert.rejects(
    verifyReleaseInstall({ manifest: manifestPath }),
    /sha256 mismatch/
  );
});

test("verifyReleaseInstall rejects empty source index sqlite artifacts", async () => {
  const root = await mkdtemp(join(tmpdir(), "mdm-verify-empty-source-index-"));
  const artifactName = "minecraft-1.20.1-source-index-0.1.0.sqlite";
  const artifactPath = join(root, artifactName);
  writeEmptySourceIndexSqlite(artifactPath);
  const bytes = await readFile(artifactPath);
  await writeFile(
    join(root, "mdm-release-manifest.json"),
    JSON.stringify({
      schemaVersion: 1,
      packages: [
        {
          packageId: "minecraft-1.20.1-source-index",
          artifactName,
          format: "sqlite",
          queryAdapter: "source_index_sqlite",
          sha256: sha256(bytes),
          sizeBytes: bytes.length
        }
      ]
    })
  );

  await assert.rejects(
    verifyReleaseInstall({ manifest: join(root, "mdm-release-manifest.json") }),
    /source index sqlite must contain indexed files and chunks/
  );
});

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
    JSON.stringify({
      schemaVersion: 1,
      packages: [
        {
          id: "core-docs-search-sqlite",
          manifestPath: "registry/packages/core-docs-search-sqlite.json",
          currentRelease: null
        }
      ]
    })
  );
  await writeFile(
    join(root, "registry/packages/core-docs-search-sqlite.json"),
    JSON.stringify({ id: "core-docs-search-sqlite", currentRelease: null })
  );
}

function sqlitePackageManifest() {
  return {
    identity: {
      schemaVersion: 2,
      packageId: "core-docs-search-sqlite",
      packageVersion: "0.1.0",
      namespace: "core"
    },
    target: { minecraftVersions: ["1.20.1"], loaders: ["kubejs"] },
    artifact: {
      kind: "docs_bundle",
      format: "sqlite",
      schemaId: "mdm.docs.sqlite",
      schemaVersion: 3,
      entrypoint: "payload/docs-search.json"
    },
    capabilities: ["docs_search"],
    policy: {
      privacy: "public_release",
      lifecycle: ["downloadable"],
      canCommitToRepository: true,
      canUploadToPublicRelease: true,
      requiresUserConsent: false
    },
    query: { adapter: "sqlite_docs", capabilities: ["docs_search"] },
    release: { channel: "docs", family: "core-docs" }
  };
}

function sqliteDocsPayload() {
  return {
    entries: [
      {
        id: "kubejs-native-events",
        title: "KubeJS Native Event Routing",
        summary: "Use NativeEvents when ProbeJS exposes native events."
      }
    ]
  };
}

function writeEmptySourceIndexSqlite(path) {
  const database = new DatabaseSync(path);
  try {
    database.exec([
      "CREATE TABLE files(path TEXT PRIMARY KEY, kind TEXT, size_bytes INTEGER, sha256 TEXT, package_id TEXT);",
      "CREATE TABLE java_symbols(path TEXT, package_name TEXT, simple_name TEXT, qualified_name TEXT);",
      "CREATE TABLE java_members(path TEXT, package_name TEXT, owner_simple_name TEXT, owner_qualified_name TEXT, member_name TEXT, member_kind TEXT, signature TEXT, return_type TEXT, start_line INTEGER, end_line INTEGER);",
      "CREATE VIRTUAL TABLE fts_files USING fts5(path UNINDEXED, content);",
      "CREATE TABLE source_chunks(path TEXT, chunk_id TEXT, chunk_type TEXT, start_line INTEGER, end_line INTEGER, token_count INTEGER, content TEXT, PRIMARY KEY(path, chunk_id));",
      "CREATE VIRTUAL TABLE fts_chunks USING fts5(path UNINDEXED, chunk_id UNINDEXED, content);"
    ].join(" "));
  } finally {
    database.close();
  }
}

function sha256(body) {
  return createHash("sha256").update(body).digest("hex");
}
