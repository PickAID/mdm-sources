import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { syncRepository } from "../tools/sync-repository.mjs";
import { validateRepository } from "../tools/validate.mjs";

test("syncRepository generates source profiles and registry before validation", async () => {
  const root = await mkdtemp(join(tmpdir(), "mdm-sync-repository-"));
  await writeCatalog(root, ["1.7.10", "26.1"]);

  const result = await syncRepository({ root });
  const validation = await validateRepository(root);

  assert.deepEqual(result.sourceProfiles.generatedVersions, ["1.7.10", "26.1"]);
  assert.deepEqual(result.datapackProfiles.generatedVersions, ["1.7.10", "26.1"]);
  assert.deepEqual(result.resourcepackProfiles.generatedVersions, ["1.7.10", "26.1"]);
  assert.deepEqual(result.mappingProfiles.generatedVersions, ["1.7.10", "26.1"]);
  assert.deepEqual(result.registry.packageIds, [
    "minecraft-1.7.10-vanilla-datapack-profile",
    "minecraft-1.7.10-vanilla-resourcepack-profile",
    "minecraft-1.7.10-vanilla-source-profile",
    "minecraft-1.7.10-yarn-mapping-profile",
    "minecraft-26.1-vanilla-datapack-profile",
    "minecraft-26.1-vanilla-resourcepack-profile",
    "minecraft-26.1-vanilla-source-profile",
    "minecraft-26.1-yarn-mapping-profile"
  ]);
  assert.equal(validation.packageCount, 8);
  assert.deepEqual(validation.errors, []);

  const datapackProfile = JSON.parse(
    await readFile(
      join(root, "packages/datapack/vanilla/26.1/payload/datapack-profile.json"),
      "utf-8"
    )
  );
  const resourcepackProfile = JSON.parse(
    await readFile(
      join(root, "packages/resourcepack/vanilla/26.1/payload/resourcepack-profile.json"),
      "utf-8"
    )
  );
  assert.equal(datapackProfile.minecraftVersion, "26.1");
  assert.equal(datapackProfile.packMcmeta.packFormatSource, "runtime_resolved");
  assert.equal(resourcepackProfile.minecraftVersion, "26.1");
  assert.equal(resourcepackProfile.packMcmeta.packFormatSource, "runtime_resolved");
  const mappingProfile = JSON.parse(
    await readFile(
      join(root, "packages/mappings/vanilla/26.1-yarn-profile/payload/mapping-profile.json"),
      "utf-8"
    )
  );
  assert.equal(mappingProfile.minecraftVersion, "26.1");
  assert.equal(mappingProfile.profileKind, "mapping");
  assert.equal(mappingProfile.lookupPolicy.bundlesGeneratedMappings, false);

  const registry = JSON.parse(
    await readFile(join(root, "registry/index.json"), "utf-8")
  );
  assert.deepEqual(
    registry.packages.map((entry) => entry.manifestPath),
    [
      "registry/packages/minecraft-1.7.10-vanilla-datapack-profile.json",
      "registry/packages/minecraft-1.7.10-vanilla-resourcepack-profile.json",
      "registry/packages/minecraft-1.7.10-vanilla-source-profile.json",
      "registry/packages/minecraft-1.7.10-yarn-mapping-profile.json",
      "registry/packages/minecraft-26.1-vanilla-datapack-profile.json",
      "registry/packages/minecraft-26.1-vanilla-resourcepack-profile.json",
      "registry/packages/minecraft-26.1-vanilla-source-profile.json",
      "registry/packages/minecraft-26.1-yarn-mapping-profile.json"
    ]
  );
});

async function writeCatalog(root, versions) {
  await mkdir(join(root, "packages/minecraft/releases/catalog/payload"), {
    recursive: true
  });
  await writeFile(
    join(root, "packages/minecraft/releases/catalog/payload/release-catalog.json"),
    `${JSON.stringify({
      schemaVersion: 1,
      releases: versions.map((id) => ({ id }))
    }, null, 2)}\n`
  );
}
