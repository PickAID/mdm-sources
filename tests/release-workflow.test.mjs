import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("release workflow publishes local release artifacts to GitHub Releases", async () => {
  const workflow = await readFile(".github/workflows/release.yml", "utf-8");

  assert.match(workflow, /node tools\/validate\.mjs/);
  assert.match(
    workflow,
    /node tools\/build-local-release\.mjs --out release-out --no-registry-update/
  );
  assert.match(workflow, /release-out\/mdm-release-manifest\.json/);
  assert.match(workflow, /release-out\/mdm-release-summary\.json/);
  assert.match(workflow, /node tools\/verify-release-install\.mjs release-out\/mdm-release-manifest\.json/);
  assert.match(workflow, /node tools\/list-release-artifacts\.mjs/);
  assert.match(workflow, /gh release (create|upload)/);
  assert.doesNotMatch(workflow, /release-out\/\*/);
  assert.match(workflow, /release-artifacts\.txt/);
});
