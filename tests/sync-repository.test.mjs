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
  assert.deepEqual(result.registry.packageIds, [
    "minecraft-1.7.10-vanilla-source-profile",
    "minecraft-26.1-vanilla-source-profile"
  ]);
  assert.equal(validation.packageCount, 2);
  assert.deepEqual(validation.errors, []);

  const registry = JSON.parse(
    await readFile(join(root, "registry/index.json"), "utf-8")
  );
  assert.deepEqual(
    registry.packages.map((entry) => entry.manifestPath),
    [
      "registry/packages/minecraft-1.7.10-vanilla-source-profile.json",
      "registry/packages/minecraft-26.1-vanilla-source-profile.json"
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
      currentSeedProfiles: {
        sources: versions
      }
    }, null, 2)}\n`
  );
}
