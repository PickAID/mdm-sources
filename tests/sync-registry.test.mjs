import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { syncRegistry } from "../tools/sync-registry.mjs";

test("syncRegistry scans packages and preserves existing release metadata", async () => {
  const root = await mkdtemp(join(tmpdir(), "mdm-sync-registry-"));
  await writePackage(root, "packages/sources/vanilla/1.7.10/package.json", {
    packageId: "minecraft-1.7.10-vanilla-source-profile",
    format: "json",
    channel: "sources"
  });
  await writePackage(root, "packages/docs/search/core-sqlite/package.json", {
    packageId: "core-docs-search-sqlite",
    format: "sqlite",
    channel: "docs"
  });
  await mkdir(join(root, "registry/packages"), { recursive: true });
  await writeFile(
    join(root, "registry/packages/core-docs-search-sqlite.json"),
    `${JSON.stringify({
      schemaVersion: 1,
      id: "core-docs-search-sqlite",
      sourcePath: "packages/docs/search/core-sqlite/package.json",
      currentRelease: {
        artifactName: "core-docs-search-sqlite-0.1.0.sqlite",
        sha256: "abc123",
        sizeBytes: 32,
        builtAt: "2026-05-07T00:00:00.000Z"
      }
    }, null, 2)}\n`
  );

  const result = await syncRegistry({ root });

  assert.deepEqual(result.packageIds, [
    "core-docs-search-sqlite",
    "minecraft-1.7.10-vanilla-source-profile"
  ]);

  const registry = JSON.parse(
    await readFile(join(root, "registry/index.json"), "utf-8")
  );
  assert.deepEqual(
    registry.packages.map((entry) => entry.id),
    result.packageIds
  );
  assert.equal(registry.packages[0].format, "sqlite");
  assert.equal(registry.packages[0].currentRelease.sha256, "abc123");

  const sourceDetail = JSON.parse(
    await readFile(
      join(root, "registry/packages/minecraft-1.7.10-vanilla-source-profile.json"),
      "utf-8"
    )
  );
  assert.equal(
    sourceDetail.sourcePath,
    "packages/sources/vanilla/1.7.10/package.json"
  );
});

async function writePackage(root, path, input) {
  await mkdir(join(root, path, ".."), { recursive: true });
  await writeFile(
    join(root, path),
    `${JSON.stringify({
      identity: {
        schemaVersion: 2,
        packageId: input.packageId,
        packageVersion: "0.1.0",
        namespace: "minecraft",
        displayName: input.packageId,
        description: input.packageId
      },
      target: {},
      artifact: {
        kind: "docs_bundle",
        format: input.format,
        schemaId: "test.schema.json",
        schemaVersion: 1,
        entrypoint: "payload/doc.json"
      },
      capabilities: ["docs_lookup"],
      policy: {
        privacy: "public_release",
        lifecycle: ["downloadable"],
        canCommitToRepository: true,
        canUploadToPublicRelease: true
      },
      query: {
        adapter: input.format === "sqlite" ? "sqlite_docs" : "json_docs",
        capabilities: ["docs_lookup"],
        defaultLimit: 8,
        maxLimit: 50
      },
      release: {
        channel: input.channel,
        family: input.channel
      }
    }, null, 2)}\n`
  );
}
