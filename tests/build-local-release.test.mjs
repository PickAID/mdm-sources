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

test("buildLocalRelease can select release channels without building everything", async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), "mdm-sources-release-channels-"));
  const outDir = await mkdtemp(join(tmpdir(), "mdm-release-out-channels-"));

  await writeMultiChannelFixtureRepository(repoRoot);

  const result = await buildLocalRelease({
    root: repoRoot,
    outDir,
    builtAt: "2026-05-06T00:00:00.000Z",
    releaseChannels: ["required", "datapack"]
  });

  assert.deepEqual(
    result.artifacts.map((artifact) => artifact.packageId).sort(),
    ["core-docs-required-v2", "minecraft-1.20.1-vanilla-datapack-profile"]
  );

  const releaseManifest = JSON.parse(
    await readFile(join(outDir, "mdm-release-manifest.json"), "utf-8")
  );

  assert.deepEqual(
    releaseManifest.packages.map((entry) => entry.releaseChannel).sort(),
    ["datapack", "required"]
  );
  await assert.rejects(
    stat(join(outDir, "minecraft-1.20.1-yarn-mapping-profile-0.1.0.mdm-resource.json"))
  );
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

async function writeMultiChannelFixtureRepository(root) {
  await writeV2FixtureRepository(root);
  await mkdir(join(root, "packages/datapack/vanilla/1.20.1/payload"), {
    recursive: true
  });
  await mkdir(join(root, "packages/mappings/vanilla/1.20.1-yarn-profile/payload"), {
    recursive: true
  });

  await writeFile(
    join(root, "packages/datapack/vanilla/1.20.1/package.json"),
    JSON.stringify(
      v2Package({
        packageId: "minecraft-1.20.1-vanilla-datapack-profile",
        packageVersion: "0.1.0",
        kind: "datapack_bundle",
        entrypoint: "payload/datapack-profile.json",
        capabilities: ["resource_location_lookup", "datapack_trace"],
        channel: "datapack",
        family: "vanilla-datapack"
      }),
      null,
      2
    )
  );
  await writeFile(
    join(root, "packages/datapack/vanilla/1.20.1/payload/datapack-profile.json"),
    "{}\n"
  );
  await writeFile(
    join(root, "packages/mappings/vanilla/1.20.1-yarn-profile/package.json"),
    JSON.stringify(
      v2Package({
        packageId: "minecraft-1.20.1-yarn-mapping-profile",
        packageVersion: "0.1.0",
        kind: "mapping_bundle",
        entrypoint: "payload/mapping-profile.json",
        capabilities: ["mapping_lookup", "mapping_explain"],
        channel: "mappings",
        family: "vanilla-mappings"
      }),
      null,
      2
    )
  );
  await writeFile(
    join(root, "packages/mappings/vanilla/1.20.1-yarn-profile/payload/mapping-profile.json"),
    "{}\n"
  );

  const registry = JSON.parse(await readFile(join(root, "registry/index.json"), "utf-8"));
  registry.packages.push(
    registryEntry("minecraft-1.20.1-vanilla-datapack-profile"),
    registryEntry("minecraft-1.20.1-yarn-mapping-profile")
  );
  await writeFile(join(root, "registry/index.json"), JSON.stringify(registry, null, 2));
  await writeFile(
    join(root, "registry/packages/minecraft-1.20.1-vanilla-datapack-profile.json"),
    JSON.stringify(
      {
        schemaVersion: 1,
        id: "minecraft-1.20.1-vanilla-datapack-profile",
        sourcePath: "packages/datapack/vanilla/1.20.1/package.json",
        currentRelease: null
      },
      null,
      2
    )
  );
  await writeFile(
    join(root, "registry/packages/minecraft-1.20.1-yarn-mapping-profile.json"),
    JSON.stringify(
      {
        schemaVersion: 1,
        id: "minecraft-1.20.1-yarn-mapping-profile",
        sourcePath: "packages/mappings/vanilla/1.20.1-yarn-profile/package.json",
        currentRelease: null
      },
      null,
      2
    )
  );
}

function v2Package(input) {
  return {
    identity: {
      schemaVersion: 2,
      packageId: input.packageId,
      packageVersion: input.packageVersion,
      namespace: "minecraft",
      displayName: input.packageId,
      description: input.packageId
    },
    target: { minecraftVersions: ["1.20.1"], loaders: ["vanilla"] },
    artifact: {
      kind: input.kind,
      format: "json",
      schemaId: `mdm.${input.channel}.json`,
      schemaVersion: 1,
      entrypoint: input.entrypoint
    },
    capabilities: input.capabilities,
    policy: {
      privacy: "public_release",
      lifecycle: ["downloadable"],
      canCommitToRepository: true,
      canUploadToPublicRelease: true,
      requiresUserConsent: false
    },
    query: {
      adapter: input.channel === "mappings" ? "mapping_index" : "archive_content",
      capabilities: input.capabilities,
      defaultLimit: 8,
      maxLimit: 50,
      preferredFallbacks: []
    },
    release: { channel: input.channel, family: input.family }
  };
}

function registryEntry(id) {
  return {
    id,
    manifestPath: `registry/packages/${id}.json`,
    required: false,
    format: "json",
    currentRelease: null
  };
}
