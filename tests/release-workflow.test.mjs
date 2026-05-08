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
  assert.match(
    workflow,
    /node tools\/upload-github-release\.mjs --repo "\$GITHUB_REPOSITORY" --tag "\$RELEASE_TAG" --manifest release-out\/mdm-release-manifest\.json --notes release-out\/mdm-release-notes\.md --clobber/
  );
  assert.match(workflow, /GITHUB_TOKEN: \$\{\{ github\.token \}\}/);
  assert.match(workflow, /- name: Verify published release/);
  assert.ok(
    workflow.indexOf("- name: Verify published release") >
      workflow.indexOf("- name: Publish GitHub Release")
  );
  assert.match(
    workflow,
    /MANIFEST_URL="https:\/\/github\.com\/\$GITHUB_REPOSITORY\/releases\/download\/\$RELEASE_TAG\/mdm-release-manifest\.json"/
  );
  assert.match(workflow, /node tools\/verify-live-release\.mjs "\$MANIFEST_URL"/);
  assert.match(workflow, /for attempt in 1 2 3 4/);
  assert.match(workflow, /Published release verification failed after 4 attempts/);
  assert.doesNotMatch(workflow, /release-out\/\*/);
  assert.match(workflow, /release-artifacts\.txt/);
  assert.doesNotMatch(publishStep(workflow), /mdm-release-acceptance-report\.(json|md)/);
  assert.doesNotMatch(workflow, /gh release/);
});

function publishStep(workflow) {
  return workflow.slice(workflow.indexOf("- name: Publish GitHub Release"));
}
