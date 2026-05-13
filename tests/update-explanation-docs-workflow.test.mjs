import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("update explanation docs workflow refreshes generated docs packages", async () => {
  const workflow = await readFile(
    ".github/workflows/update-explanation-docs.yml",
    "utf-8"
  );

  assert.match(workflow, /schedule:/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /concurrency:/);
  assert.match(workflow, /group: update-generated-docs/);
  assert.match(workflow, /node tools\/sync-vanilla-schema-docs\.mjs/);
  assert.match(workflow, /node tools\/misode-generator-catalog\.mjs/);
  assert.match(workflow, /node tools\/sync-version-change-docs\.mjs/);
  assert.match(workflow, /node tools\/sync-loader-docs\.mjs/);
  assert.match(workflow, /node tools\/validate\.mjs/);
  assert.match(
    workflow,
    /node tools\/build-local-release\.mjs --out release-out --no-registry-update --channel docs/
  );
  assert.match(workflow, /git diff --quiet/);
  assert.match(workflow, /github-actions\[bot\]/);
  assert.match(workflow, /chore: update generated docs packages/);
  assert.match(workflow, /git push/);
  assert.doesNotMatch(workflow, /create-pull-request/);
  assert.doesNotMatch(workflow, /automation\/update-vanilla-schema-docs/);
  assert.match(workflow, /vanilla-schema-docs/);
  assert.match(workflow, /misode-generator-catalog/);
  assert.match(workflow, /minecraft-version-changes/);
  assert.match(workflow, /minecraft-loader-docs/);
  assert.ok(
    workflow.indexOf("node tools/misode-generator-catalog.mjs") >
      workflow.indexOf("node tools/sync-vanilla-schema-docs.mjs")
  );
  assert.ok(
    workflow.indexOf("node tools/sync-version-change-docs.mjs") >
      workflow.indexOf("node tools/misode-generator-catalog.mjs")
  );
  assert.ok(
    workflow.indexOf("node tools/sync-loader-docs.mjs") >
      workflow.indexOf("node tools/sync-version-change-docs.mjs")
  );
});
