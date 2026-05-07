import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  buildReleaseCatalog,
  updateReleaseCatalog
} from "../tools/update-release-catalog.mjs";

const catalogPath = "packages/minecraft/releases/catalog/payload/release-catalog.json";

test("minecraft release catalog covers all currently synced official releases", async () => {
  const catalog = JSON.parse(await readFile(catalogPath, "utf-8"));

  assert.equal(catalog.source.kind, "mojang_version_manifest_v2");
  assert.equal(catalog.releaseCount, catalog.releases.length);
  assert.ok(catalog.releaseCount >= 101);
  assert.equal(catalog.releases[0].id, catalog.latest.release);
  assert.ok(catalog.releases.some((release) => release.id === "1.0"));
  assert.ok(catalog.releases.every((release) => release.metadataUrl.startsWith("https://piston-meta.mojang.com/")));
  assert.match(catalog.localGenerationPolicy.vanillaSource, /Do not commit Minecraft source/);
  assert.deepEqual(catalog.currentSeedProfiles.sources, [
    "1.18.2",
    "1.20.1",
    "1.21.1"
  ]);
});

test("updateReleaseCatalog writes compact release catalog JSON from a manifest fixture", async () => {
  const root = await mkdtemp(join(tmpdir(), "mdm-release-catalog-"));
  const manifestPath = join(root, "version_manifest_v2.json");
  const outPath = join(root, "release-catalog.json");
  const fixture = {
    latest: { release: "1.1", snapshot: "1.2-snapshot" },
    versions: [
      release("1.1"),
      { id: "1.2-snapshot", type: "snapshot" },
      release("1.0")
    ]
  };

  await writeFile(manifestPath, JSON.stringify(fixture));

  const result = await updateReleaseCatalog({
    inputPath: manifestPath,
    outPath,
    generatedAt: "2026-05-06T00:00:00.000Z"
  });
  const written = await readFile(outPath, "utf-8");

  assert.equal(result.catalog.releaseCount, 2);
  assert.equal(result.catalog.releases[0].id, "1.1");
  assert.ok(written.includes('"releaseCount": 2'));
  assert.ok(written.split("\n").length < 20);
});

test("buildReleaseCatalog rejects manifests without releases", () => {
  assert.throws(
    () => buildReleaseCatalog({ latest: {}, versions: [{ type: "snapshot" }] }),
    /contains no release versions/
  );
});

function release(id) {
  return {
    id,
    type: "release",
    url: `https://piston-meta.mojang.com/v1/packages/${id}/${id}.json`,
    releaseTime: "2026-05-06T00:00:00+00:00",
    sha1: "abc123",
    complianceLevel: 1
  };
}
