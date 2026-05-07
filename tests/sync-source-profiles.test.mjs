import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { syncSourceProfiles } from "../tools/sync-source-profiles.mjs";

test("syncSourceProfiles generates source packages from catalog seed versions", async () => {
  const root = await mkdtemp(join(tmpdir(), "mdm-sync-source-profiles-"));
  await writeCatalog(root, ["1.7.10", "1.12.2", "26.1"]);

  const result = await syncSourceProfiles({ root });

  assert.deepEqual(result.generatedVersions, ["1.7.10", "1.12.2", "26.1"]);
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
    assert.equal(profile.distributionPolicy.localGenerationOnly, true);
    assert.equal(profile.distributionPolicy.bundlesMinecraftSource, false);
  }
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
