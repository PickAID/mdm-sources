import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { syncSourceProfiles } from "../tools/sync-source-profiles.mjs";

test("syncSourceProfiles generates source packages from every catalog release", async () => {
  const root = await mkdtemp(join(tmpdir(), "mdm-sync-source-profiles-"));
  await writeCatalog(root);

  const result = await syncSourceProfiles({ root });

  assert.deepEqual(result.generatedVersions, [
    "26.1",
    "1.14.4",
    "1.7.10"
  ]);
  assert.deepEqual(result.loaderProfiles.generatedPackageIds, [
    "minecraft-1.7.10-forge-source-profile",
    "minecraft-1.14.4-fabric-source-profile",
    "minecraft-26.1-neoforge-source-profile",
    "minecraft-26.1-fabric-source-profile"
  ]);
  for (const version of result.generatedVersions) {
    const packageJson = JSON.parse(
      await readFile(
        join(root, "packages/sources/vanilla", version, "package.json"),
        "utf-8"
      )
    );
    const profile = JSON.parse(
      await readFile(
        join(root, "packages/sources/vanilla", version, "payload/source-profile.json"),
        "utf-8"
      )
    );

    assert.equal(packageJson.identity.packageId, `minecraft-${version}-vanilla-source-profile`);
    assert.equal(packageJson.release.channel, "sources");
    assert.equal(packageJson.artifact.kind, "docs_bundle");
    assert.equal(packageJson.query.adapter, "json_docs");
    assert.equal(profile.minecraftVersion, version);
    assert.equal(Object.hasOwn(profile, "loader"), false);
    assert.equal(profile.distributionPolicy.localGenerationOnly, true);
    assert.equal(profile.distributionPolicy.bundlesMinecraftSource, false);
    assert.equal(
      Object.hasOwn(profile.distributionPolicy, "bundlesLoaderSource"),
      false
    );
    assert.deepEqual(profile.localGeneration.targets, [
      {
        packageId: `minecraft-${version}-source-pack-named`,
        namespace: "minecraft",
        artifactType: "source-pack",
        variant: "named",
        cacheScope: "runtime-private"
      }
    ]);
  }

  const neoforgePackage = JSON.parse(
    await readFile(
      join(root, "packages/sources/loaders/neoforge/26.1/package.json"),
      "utf-8"
    )
  );
  const neoforgeProfile = JSON.parse(
    await readFile(
      join(root, "packages/sources/loaders/neoforge/26.1/payload/source-profile.json"),
      "utf-8"
    )
  );

  assert.equal(neoforgePackage.identity.packageId, "minecraft-26.1-neoforge-source-profile");
  assert.deepEqual(neoforgePackage.target.loaders, ["neoforge"]);
  assert.deepEqual(neoforgePackage.target.mappings, ["official", "mojmap", "parchment"]);
  assert.equal(neoforgePackage.release.family, "loader-sources");
  assert.equal(neoforgeProfile.loader, "neoforge");
  assert.equal(neoforgeProfile.distributionPolicy.bundlesMinecraftSource, false);
  assert.equal(neoforgeProfile.distributionPolicy.bundlesLoaderSource, false);
  assert.equal(neoforgeProfile.localGeneration.confirmationRequired, true);
});

async function writeCatalog(root) {
  await mkdir(join(root, "packages/minecraft/releases/catalog/payload"), {
    recursive: true
  });
  await writeFile(
    join(root, "packages/minecraft/releases/catalog/payload/release-catalog.json"),
    `${JSON.stringify({
      schemaVersion: 1,
      releases: [
        { id: "26.1" },
        { id: "1.14.4" },
        { id: "1.7.10" }
      ]
    }, null, 2)}\n`
  );
}
