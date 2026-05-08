import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { buildLocalRelease } from "../tools/build-local-release.mjs";

test("buildLocalRelease can bundle selected release channels", async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), "mdm-sources-release-bundles-"));
  const outDir = await mkdtemp(join(tmpdir(), "mdm-release-out-bundles-"));

  await writeBundleFixtureRepository(repoRoot);

  const result = await buildLocalRelease({
    root: repoRoot,
    outDir,
    builtAt: "2026-05-08T00:00:00.000Z",
    bundleChannels: ["datapack"]
  });

  assert.deepEqual(
    result.artifacts.map((artifact) => artifact.artifactName).sort(),
    [
      "core-docs-required-v2-0.2.0.mdm-resource.json",
      "datapack.mdm-bundle.json",
      "minecraft-1.20.1-yarn-mapping-profile-0.1.0.mdm-resource.json"
    ]
  );
  assert.equal(result.bundles.length, 1);
  assert.equal(result.bundles[0].artifactName, "datapack.mdm-bundle.json");

  const releaseManifest = JSON.parse(
    await readFile(join(outDir, "mdm-release-manifest.json"), "utf-8")
  );
  const datapackEntry = releaseManifest.packages.find((entry) => {
    return entry.packageId === "minecraft-1.20.1-vanilla-datapack-profile";
  });

  assert.equal(datapackEntry.artifactName, undefined);
  assert.deepEqual(datapackEntry.bundleRef, {
    bundleName: "datapack.mdm-bundle",
    memberName: "minecraft-1.20.1-vanilla-datapack-profile-0.1.0.mdm-resource.json",
    sha256: datapackEntry.sha256,
    sizeBytes: datapackEntry.sizeBytes
  });
  assert.deepEqual(releaseManifest.bundles.map((bundle) => bundle.bundleName), [
    "datapack.mdm-bundle"
  ]);
  await assert.rejects(
    stat(join(outDir, "minecraft-1.20.1-vanilla-datapack-profile-0.1.0.mdm-resource.json"))
  );
});

test("buildLocalRelease does not write registry release metadata for bundle builds", async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), "mdm-sources-release-bundle-no-registry-"));
  const outDir = await mkdtemp(join(tmpdir(), "mdm-release-out-bundle-no-registry-"));

  await writeBundleFixtureRepository(repoRoot);

  await buildLocalRelease({
    root: repoRoot,
    outDir,
    builtAt: "2026-05-08T00:00:00.000Z",
    bundleChannels: ["datapack"]
  });

  const detail = JSON.parse(
    await readFile(
      join(
        repoRoot,
        "registry/packages/minecraft-1.20.1-vanilla-datapack-profile.json"
      ),
      "utf-8"
    )
  );

  assert.equal(detail.currentRelease, null);
});

async function writeBundleFixtureRepository(root) {
  await mkdir(join(root, "registry/packages"), { recursive: true });
  await writeFixturePackage(root, {
    path: "packages/docs/core/required-v2",
    packageId: "core-docs-required-v2",
    kind: "docs_bundle",
    entrypoint: "payload/core-docs.json",
    channel: "required",
    family: "core-docs"
  });
  await writeFixturePackage(root, {
    path: "packages/datapack/vanilla/1.20.1",
    packageId: "minecraft-1.20.1-vanilla-datapack-profile",
    kind: "datapack_bundle",
    entrypoint: "payload/datapack-profile.json",
    channel: "datapack",
    family: "vanilla-datapack"
  });
  await writeFixturePackage(root, {
    path: "packages/mappings/vanilla/1.20.1-yarn-profile",
    packageId: "minecraft-1.20.1-yarn-mapping-profile",
    kind: "mapping_bundle",
    entrypoint: "payload/mapping-profile.json",
    channel: "mappings",
    family: "vanilla-mappings"
  });

  const ids = [
    "core-docs-required-v2",
    "minecraft-1.20.1-vanilla-datapack-profile",
    "minecraft-1.20.1-yarn-mapping-profile"
  ];
  await writeFile(
    join(root, "registry/index.json"),
    JSON.stringify({
      schemaVersion: 1,
      packages: ids.map((id) => ({
        id,
        manifestPath: `registry/packages/${id}.json`,
        currentRelease: null
      }))
    })
  );
  for (const id of ids) {
    await writeFile(
      join(root, `registry/packages/${id}.json`),
      JSON.stringify({ schemaVersion: 1, id, currentRelease: null })
    );
  }
}

async function writeFixturePackage(root, input) {
  const packageRoot = join(root, input.path);
  await mkdir(join(packageRoot, "payload"), { recursive: true });
  await writeFile(
    join(packageRoot, input.entrypoint),
    "{}\n"
  );
  await writeFile(
    join(packageRoot, "package.json"),
    JSON.stringify(v2Package(input), null, 2)
  );
}

function v2Package(input) {
  return {
    identity: {
      schemaVersion: 2,
      packageId: input.packageId,
      packageVersion: input.channel === "required" ? "0.2.0" : "0.1.0",
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
    capabilities: ["docs_search"],
    policy: {
      privacy: "public_release",
      lifecycle: ["downloadable"],
      canCommitToRepository: true,
      canUploadToPublicRelease: true,
      requiresUserConsent: false
    },
    query: {
      adapter: input.channel === "mappings" ? "mapping_index" : "archive_content",
      capabilities: ["docs_search"],
      defaultLimit: 8,
      maxLimit: 50,
      preferredFallbacks: []
    },
    release: { channel: input.channel, family: input.family }
  };
}
