import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("release workflow publishes local release artifacts to GitHub Releases", async () => {
  const workflow = await readFile(".github/workflows/release.yml", "utf-8");

  assert.match(workflow, /node tools\/validate\.mjs/);
  assert.match(
    workflow,
    /node tools\/write-release-acceptance-report\.mjs --out release-out/
  );
  assert.match(workflow, /release-out\/mdm-release-manifest\.json/);
  assert.match(workflow, /release-out\/mdm-release-summary\.json/);
  assert.match(workflow, /release-out\/mdm-release-acceptance-report\.json/);
  assert.match(workflow, /release-out\/mdm-release-acceptance-report\.md/);
  assert.match(
    workflow,
    /node tools\/list-release-artifacts\.mjs release-out\/mdm-release-manifest\.json > release-artifacts\.txt/
  );
  assert.match(workflow, /node tools\/write-release-notes\.mjs --out release-out --tag "\$RELEASE_TAG"/);
  assert.match(workflow, /gh release edit "\$RELEASE_TAG" --notes-file release-out\/mdm-release-notes\.md/);
  assert.match(workflow, /--notes-file release-out\/mdm-release-notes\.md/);
  assert.match(workflow, /gh release (create|upload)/);
  assert.doesNotMatch(workflow, /release-out\/\*/);
  assert.match(workflow, /release-artifacts\.txt/);
  assert.doesNotMatch(publishStep(workflow), /mdm-release-acceptance-report\.(json|md)/);
  assert.doesNotMatch(publishStep(workflow), /mdm-release-notes\.md"\]/);
});

function publishStep(workflow) {
  return workflow.slice(workflow.indexOf("- name: Publish GitHub Release"));
}
