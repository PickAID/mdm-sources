import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

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
});
