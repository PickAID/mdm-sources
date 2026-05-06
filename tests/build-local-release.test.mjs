import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { buildLocalRelease } from "../tools/build-local-release.mjs";

test("buildLocalRelease writes artifacts and updates registry release metadata", async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), "mdm-sources-release-"));
  const outDir = await mkdtemp(join(tmpdir(), "mdm-release-out-"));

  await writeFixtureRepository(repoRoot);

  const result = await buildLocalRelease({
    root: repoRoot,
    outDir,
    builtAt: "2026-04-29T00:00:00.000Z"
  });

  assert.equal(result.artifacts.length, 1);
  assert.equal(result.artifacts[0].packageId, "core-docs-required");
  assert.match(result.artifacts[0].sha256, /^[a-f0-9]{64}$/);
  await assert.doesNotReject(() => stat(result.artifacts[0].artifactPath));

  const registry = JSON.parse(
    await readFile(join(repoRoot, "registry/index.json"), "utf-8")
  );
  const detail = JSON.parse(
    await readFile(
      join(repoRoot, "registry/packages/core-docs-required.json"),
      "utf-8"
    )
  );

  assert.equal(registry.packages[0].currentRelease.sha256, result.artifacts[0].sha256);
  assert.equal(detail.currentRelease.sha256, result.artifacts[0].sha256);
  assert.equal(
    detail.currentRelease.artifactName,
    "core-docs-required-0.1.0.mdm-resource.json"
  );

  const releaseManifest = JSON.parse(
    await readFile(join(outDir, "mdm-release-manifest.json"), "utf-8")
  );
  assert.deepEqual(releaseManifest, {
    schemaVersion: 1,
    generatedAt: "2026-04-29T00:00:00.000Z",
    packages: [
      {
        packageId: "core-docs-required",
        version: "0.1.0",
        namespace: "core",
        artifactType: "docs",
        variant: "required",
        required: true,
        format: "json",
        releaseChannel: "required",
        releaseFamily: "core",
        capabilities: [],
        artifactName: "core-docs-required-0.1.0.mdm-resource.json",
        sha256: result.artifacts[0].sha256,
        sizeBytes: detail.currentRelease.sizeBytes
      }
    ]
  });
});

test("buildLocalRelease writes v2 package release summaries with channel metadata", async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), "mdm-sources-release-v2-"));
  const outDir = await mkdtemp(join(tmpdir(), "mdm-release-out-v2-"));

  await writeV2FixtureRepository(repoRoot);

  const result = await buildLocalRelease({
    root: repoRoot,
    outDir,
    builtAt: "2026-05-06T00:00:00.000Z"
  });

  assert.equal(result.artifacts[0].packageId, "core-docs-required-v2");

  const releaseManifest = JSON.parse(
    await readFile(join(outDir, "mdm-release-manifest.json"), "utf-8")
  );

  assert.equal(releaseManifest.schemaVersion, 1);
  assert.equal(releaseManifest.packages[0].version, "0.2.0");
  assert.equal(releaseManifest.packages[0].releaseChannel, "required");
  assert.equal(releaseManifest.packages[0].releaseFamily, "core-docs");
  assert.deepEqual(releaseManifest.packages[0].capabilities, [
    "docs_search",
    "docs_direct_read"
  ]);
  assert.equal(
    releaseManifest.packages[0].artifactName,
    "core-docs-required-v2-0.2.0.mdm-resource.json"
  );

  const artifact = JSON.parse(
    await readFile(join(outDir, releaseManifest.packages[0].artifactName), "utf-8")
  );

  assert.ok(artifact.payload["payload/core-docs.json"]);
});

async function writeFixtureRepository(root) {
  await mkdir(join(root, "packages/core/docs/required/payload"), {
    recursive: true
  });
  await mkdir(join(root, "registry/packages"), { recursive: true });
  await writeFile(
    join(root, "packages/core/docs/required/package.json"),
    JSON.stringify(
      {
        schemaVersion: 1,
        id: "core-docs-required",
        namespace: "core",
        version: "0.1.0",
        artifactType: "docs",
        variant: "required",
        required: true,
        format: "json",
        payloadRoot: "payload",
        description: "Required core docs package"
      },
      null,
      2
    )
  );
  await writeFile(
    join(root, "packages/core/docs/required/payload/core-docs.json"),
    "{}\n"
  );
  await writeFile(
    join(root, "registry/index.json"),
    JSON.stringify(
      {
        schemaVersion: 1,
        packages: [
          {
            id: "core-docs-required",
            manifestPath: "registry/packages/core-docs-required.json",
            required: true,
            format: "json",
            currentRelease: null
          }
        ]
      },
      null,
      2
    )
  );
  await writeFile(
    join(root, "registry/packages/core-docs-required.json"),
    JSON.stringify(
      {
        schemaVersion: 1,
        id: "core-docs-required",
        sourcePath: "packages/core/docs/required/package.json",
        currentRelease: null
      },
      null,
      2
    )
  );
}

async function writeV2FixtureRepository(root) {
  await mkdir(join(root, "packages/docs/core/required-v2/payload"), {
    recursive: true
  });
  await mkdir(join(root, "registry/packages"), { recursive: true });
  await writeFile(
    join(root, "packages/docs/core/required-v2/package.json"),
    JSON.stringify(
      {
        identity: {
          schemaVersion: 2,
          packageId: "core-docs-required-v2",
          packageVersion: "0.2.0",
          namespace: "core",
          displayName: "Core Docs Required v2",
          description: "Required compact docs package"
        },
        target: { minecraftVersions: ["1.20.1"], loaders: ["vanilla"] },
        artifact: {
          kind: "docs_bundle",
          format: "json",
          schemaId: "mdm.docs.json",
          schemaVersion: 1,
          entrypoint: "payload/core-docs.json"
        },
        capabilities: ["docs_search", "docs_direct_read"],
        policy: {
          privacy: "public_release",
          lifecycle: ["downloadable", "pinned"],
          canCommitToRepository: true,
          canUploadToPublicRelease: true,
          requiresUserConsent: false
        },
        query: {
          adapter: "json_docs",
          capabilities: ["docs_search", "docs_direct_read"],
          defaultLimit: 8,
          maxLimit: 50,
          preferredFallbacks: []
        },
        release: { channel: "required", family: "core-docs" }
      },
      null,
      2
    )
  );
  await writeFile(
    join(root, "packages/docs/core/required-v2/payload/core-docs.json"),
    "{}\n"
  );
  await writeFile(
    join(root, "registry/index.json"),
    JSON.stringify(
      {
        schemaVersion: 1,
        packages: [
          {
            id: "core-docs-required-v2",
            manifestPath: "registry/packages/core-docs-required-v2.json",
            required: true,
            format: "json",
            currentRelease: null
          }
        ]
      },
      null,
      2
    )
  );
  await writeFile(
    join(root, "registry/packages/core-docs-required-v2.json"),
    JSON.stringify(
      {
        schemaVersion: 1,
        id: "core-docs-required-v2",
        sourcePath: "packages/docs/core/required-v2/package.json",
        currentRelease: null
      },
      null,
      2
    )
  );
}
