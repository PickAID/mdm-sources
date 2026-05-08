import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { writeReleaseAcceptanceReport } from "../tools/write-release-acceptance-report.mjs";

test("writeReleaseAcceptanceReport builds and verifies a local release", async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), "mdm-acceptance-repo-"));
  const outDir = await mkdtemp(join(tmpdir(), "mdm-acceptance-out-"));
  await writeFixtureRepository(repoRoot);

  const result = await writeReleaseAcceptanceReport({
    root: repoRoot,
    outDir,
    builtAt: "2026-05-08T00:00:00.000Z"
  });

  assert.equal(result.report.status, "passed");
  assert.equal(result.report.release.packageCount, 1);
  assert.equal(result.report.release.packageArtifactCount, 1);
  assert.equal(result.report.release.artifactCount, 3);
  assert.equal(result.report.checks.repository.errorCount, 0);
  assert.equal(result.report.checks.schema.errorCount, 0);
  assert.equal(result.report.checks.install.verifiedCount, 1);
  assert.deepEqual(
    result.report.artifacts.map((artifact) => artifact.name),
    [
      "mdm-release-manifest.json",
      "mdm-release-summary.json",
      "core-docs-required-v2-0.2.0.mdm-resource.json"
    ]
  );

  const json = JSON.parse(await readFile(result.reportPath, "utf-8"));
  const markdown = await readFile(result.markdownPath, "utf-8");
  assert.equal(json.status, "passed");
  assert.match(markdown, /Install verified packages: 1\/1/);
});

test("writeReleaseAcceptanceReport can verify bundled release artifacts", async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), "mdm-acceptance-bundle-repo-"));
  const outDir = await mkdtemp(join(tmpdir(), "mdm-acceptance-bundle-out-"));
  await writeFixtureRepository(repoRoot);

  const result = await writeReleaseAcceptanceReport({
    root: repoRoot,
    outDir,
    builtAt: "2026-05-08T00:00:00.000Z",
    bundleChannels: ["required"]
  });

  assert.equal(result.report.status, "passed");
  assert.equal(result.report.release.packageCount, 1);
  assert.equal(result.report.release.packageArtifactCount, 1);
  assert.equal(result.report.release.artifactCount, 3);
  assert.deepEqual(
    result.report.artifacts.map((artifact) => artifact.name),
    [
      "mdm-release-manifest.json",
      "mdm-release-summary.json",
      "required.mdm-bundle.json"
    ]
  );
});

async function writeFixtureRepository(root) {
  await mkdir(join(root, "packages/docs/core/required-v2/payload"), {
    recursive: true
  });
  await mkdir(join(root, "registry/packages"), { recursive: true });
  await writeFile(
    join(root, "packages/docs/core/required-v2/package.json"),
    JSON.stringify(
      {
        identity: {
          schemaVersion: 2,
          packageId: "core-docs-required-v2",
          packageVersion: "0.2.0",
          namespace: "core",
          displayName: "Core Docs Required v2",
          description: "Required compact docs package"
        },
        target: { minecraftVersions: ["1.20.1"], loaders: ["vanilla"] },
        artifact: {
          kind: "docs_bundle",
          format: "json",
          schemaId: "mdm.docs.bundle",
          schemaVersion: 1,
          entrypoint: "payload/core-docs.json"
        },
        policy: {
          privacy: "public_release",
          canCommitToRepository: true,
          canUploadToPublicRelease: true
        },
        capabilities: ["docs_search"],
        query: {
          adapter: "json_docs",
          capabilities: ["docs_search"],
          defaultLimit: 5,
          maxLimit: 20
        },
        release: { channel: "required", family: "core-docs" }
      },
      null,
      2
    )
  );
  await writeFile(
    join(root, "packages/docs/core/required-v2/payload/core-docs.json"),
    "{}\n"
  );
  await writeFile(
    join(root, "registry/index.json"),
    JSON.stringify(
      {
        schemaVersion: 1,
        packages: [
          {
            id: "core-docs-required-v2",
            manifestPath: "registry/packages/core-docs-required-v2.json",
            currentRelease: null
          }
        ]
      },
      null,
      2
    )
  );
  await writeFile(
    join(root, "registry/packages/core-docs-required-v2.json"),
    JSON.stringify(
      {
        schemaVersion: 1,
        id: "core-docs-required-v2",
        sourcePath: "packages/docs/core/required-v2/package.json",
        currentRelease: null
      },
      null,
      2
    )
  );
}
