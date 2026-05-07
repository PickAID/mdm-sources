import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { buildLocalRelease } from "../tools/build-local-release.mjs";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

test("buildLocalRelease publishes public source profile packages through sources channel", async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), "mdm-sources-release-source-"));
  const outDir = await mkdtemp(join(tmpdir(), "mdm-release-out-source-"));

  await writeSourceProfileFixture(repoRoot);

  const result = await buildLocalRelease({
    root: repoRoot,
    outDir,
    builtAt: "2026-05-07T00:00:00.000Z",
    releaseChannels: ["sources"]
  });

  assert.deepEqual(result.artifacts.map((artifact) => artifact.packageId), [
    "minecraft-1.20.1-vanilla-source-profile"
  ]);

  const releaseManifest = JSON.parse(
    await readFile(join(outDir, "mdm-release-manifest.json"), "utf-8")
  );
  assert.equal(releaseManifest.packages.length, 1);
  assert.equal(releaseManifest.packages[0].releaseChannel, "sources");
  assert.equal(releaseManifest.packages[0].releaseFamily, "vanilla-sources");
  assert.equal(releaseManifest.packages[0].artifactType, "docs");
  assert.deepEqual(releaseManifest.packages[0].capabilities, [
    "source_lookup",
    "source_chunk_search"
  ]);

  const artifactName =
    "minecraft-1.20.1-vanilla-source-profile-0.1.0.mdm-resource.json";
  await assert.doesNotReject(() => stat(join(outDir, artifactName)));
  const artifact = JSON.parse(await readFile(join(outDir, artifactName), "utf-8"));
  const profile = JSON.parse(
    artifact.payload["payload/source-profile.json"].content
  );

  assert.equal(profile.distributionPolicy.bundlesMinecraftSource, false);
  assert.equal(profile.localGeneration.confirmationRequired, true);
});

test("repository sources channel contains the vanilla source acquisition profile", async () => {
  const outDir = await mkdtemp(join(tmpdir(), "mdm-release-out-real-sources-"));

  const result = await buildLocalRelease({
    root: repoRoot,
    outDir,
    builtAt: "2026-05-07T00:00:00.000Z",
    releaseChannels: ["sources"],
    writeRegistry: false
  });

  assert.deepEqual(result.artifacts.map((artifact) => artifact.packageId), [
    "minecraft-1.18.2-vanilla-source-profile",
    "minecraft-1.20.1-vanilla-source-profile",
    "minecraft-1.21.1-vanilla-source-profile"
  ]);

  const releaseManifest = JSON.parse(
    await readFile(join(outDir, "mdm-release-manifest.json"), "utf-8")
  );
  assert.deepEqual(
    releaseManifest.packages.map((entry) => entry.releaseChannel),
    ["sources", "sources", "sources"]
  );
  assert.deepEqual(
    releaseManifest.packages.map((entry) => entry.releaseFamily),
    ["vanilla-sources", "vanilla-sources", "vanilla-sources"]
  );

  for (const entry of releaseManifest.packages) {
    assert.deepEqual(entry.capabilities, [
      "source_lookup",
      "source_chunk_search"
    ]);
    const artifact = JSON.parse(
      await readFile(join(outDir, entry.artifactName), "utf-8")
    );
    const profile = JSON.parse(
      artifact.payload["payload/source-profile.json"].content
    );

    assert.equal(profile.distributionPolicy.bundlesMinecraftSource, false);
    assert.equal(profile.distributionPolicy.bundlesRemappedSource, false);
    assert.equal(profile.distributionPolicy.localGenerationOnly, true);
    assert.equal(profile.localGeneration.confirmationRequired, true);
  }
});

async function writeSourceProfileFixture(root) {
  await mkdir(join(root, "packages/sources/vanilla/1.20.1/payload"), {
    recursive: true
  });
  await mkdir(join(root, "registry/packages"), { recursive: true });
  await writeJson(join(root, "packages/sources/vanilla/1.20.1/package.json"), {
    identity: {
      schemaVersion: 2,
      packageId: "minecraft-1.20.1-vanilla-source-profile",
      packageVersion: "0.1.0",
      namespace: "minecraft",
      displayName: "Minecraft 1.20.1 Vanilla Source Profile",
      description:
        "Legal source acquisition profile; does not include Minecraft source."
    },
    target: {
      minecraftVersions: ["1.20.1"],
      loaders: ["vanilla"],
      mappings: ["official", "mojmap"]
    },
    artifact: {
      kind: "docs_bundle",
      format: "json",
      schemaId: "mdm.sources.profile.json",
      schemaVersion: 1,
      entrypoint: "payload/source-profile.json"
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
      adapter: "json_docs",
      capabilities: ["source_lookup", "source_chunk_search"],
      defaultLimit: 8,
      maxLimit: 50,
      preferredFallbacks: ["source_index_sqlite"]
    },
    release: {
      channel: "sources",
      family: "vanilla-sources"
    }
  });
  await writeJson(
    join(root, "packages/sources/vanilla/1.20.1/payload/source-profile.json"),
    {
      minecraftVersion: "1.20.1",
      distributionPolicy: {
        bundlesMinecraftSource: false
      },
      localGeneration: {
        confirmationRequired: true
      }
    }
  );
  await writeJson(join(root, "registry/index.json"), {
    schemaVersion: 1,
    packages: [
      {
        id: "minecraft-1.20.1-vanilla-source-profile",
        manifestPath:
          "registry/packages/minecraft-1.20.1-vanilla-source-profile.json",
        required: false,
        format: "json",
        currentRelease: null
      }
    ]
  });
  await writeJson(
    join(root, "registry/packages/minecraft-1.20.1-vanilla-source-profile.json"),
    {
      schemaVersion: 1,
      id: "minecraft-1.20.1-vanilla-source-profile",
      sourcePath: "packages/sources/vanilla/1.20.1/package.json",
      currentRelease: null
    }
  );
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}
