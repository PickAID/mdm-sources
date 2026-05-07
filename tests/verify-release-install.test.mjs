import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { buildLocalRelease } from "../tools/build-local-release.mjs";
import { verifyReleaseInstall } from "../tools/verify-release-install.mjs";

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
