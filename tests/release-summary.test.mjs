import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { buildLocalRelease } from "../tools/build-local-release.mjs";
import { listReleaseArtifacts } from "../tools/list-release-artifacts.mjs";

test("buildLocalRelease writes a release summary with provenance and distributions", async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), "mdm-sources-summary-"));
  const outDir = await mkdtemp(join(tmpdir(), "mdm-summary-out-"));

  await writeFixtureRepository(repoRoot);
  const result = await buildLocalRelease({
    root: repoRoot,
    outDir,
    builtAt: "2026-05-07T00:00:00.000Z",
    source: {
      repository: "PickAID/mdm-sources",
      ref: "mdm-resources-v0.1.0",
      revision: "abc123"
    }
  });

  const summary = JSON.parse(await readFile(result.summaryPath, "utf-8"));

  assert.equal(summary.schemaVersion, 1);
  assert.deepEqual(summary.source, {
    repository: "PickAID/mdm-sources",
    ref: "mdm-resources-v0.1.0",
    revision: "abc123"
  });
  assert.equal(summary.manifest.packageCount, 1);
  assert.match(summary.manifest.sha256, /^[a-f0-9]{64}$/);
  assert.equal(summary.totals.artifactCount, 1);
  assert.equal(summary.totals.sizeBytes, result.artifacts[0].sizeBytes);
  assert.deepEqual(summary.distributions.releaseChannels, { required: 1 });
  assert.deepEqual(summary.distributions.artifactTypes, { docs: 1 });
  assert.deepEqual(summary.artifacts, [
    {
      packageId: "core-docs-required",
      artifactName: "core-docs-required-0.1.0.mdm-resource.json",
      sha256: result.artifacts[0].sha256,
      sizeBytes: result.artifacts[0].sizeBytes
    }
  ]);
});

test("listReleaseArtifacts includes release summary when it exists", async () => {
  const root = await mkdtemp(join(tmpdir(), "mdm-summary-artifacts-"));
  const manifestPath = join(root, "mdm-release-manifest.json");
  const summaryPath = join(root, "mdm-release-summary.json");

  await writeFile(
    manifestPath,
    JSON.stringify({
      schemaVersion: 1,
      packages: [{ packageId: "docs-json", artifactName: "docs-json-0.1.0.mdm-resource.json" }]
    })
  );
  await writeFile(summaryPath, "{}\n");

  assert.deepEqual(await listReleaseArtifacts(manifestPath), [
    manifestPath,
    summaryPath,
    join(root, "docs-json-0.1.0.mdm-resource.json")
  ]);
});

async function writeFixtureRepository(root) {
  await mkdir(join(root, "packages/core/docs/required/payload"), {
    recursive: true
  });
  await mkdir(join(root, "registry/packages"), { recursive: true });
  await writeFile(
    join(root, "packages/core/docs/required/package.json"),
    JSON.stringify({
      schemaVersion: 1,
      id: "core-docs-required",
      namespace: "core",
      version: "0.1.0",
      artifactType: "docs",
      variant: "required",
      required: true,
      format: "json",
      payloadRoot: "payload"
    })
  );
  await writeFile(
    join(root, "packages/core/docs/required/payload/core-docs.json"),
    "{}\n"
  );
  await writeFile(
    join(root, "registry/index.json"),
    JSON.stringify({
      schemaVersion: 1,
      packages: [
        {
          id: "core-docs-required",
          manifestPath: "registry/packages/core-docs-required.json",
          currentRelease: null
        }
      ]
    })
  );
  await writeFile(
    join(root, "registry/packages/core-docs-required.json"),
    JSON.stringify({ id: "core-docs-required", currentRelease: null })
  );
}
