import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { buildLocalRelease } from "../tools/build-local-release.mjs";

test("buildLocalRelease writes artifacts and updates registry release metadata", async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), "mdm-sources-release-"));
  const outDir = await mkdtemp(join(tmpdir(), "mdm-release-out-"));

  await writeFixtureRepository(repoRoot);

  const result = await buildLocalRelease({
    root: repoRoot,
    outDir,
    builtAt: "2026-04-29T00:00:00.000Z"
  });

  assert.equal(result.artifacts.length, 1);
  assert.equal(result.artifacts[0].packageId, "core-docs-required");
  assert.match(result.artifacts[0].sha256, /^[a-f0-9]{64}$/);
  await assert.doesNotReject(() => stat(result.artifacts[0].artifactPath));

  const registry = JSON.parse(
    await readFile(join(repoRoot, "registry/index.json"), "utf-8")
  );
  const detail = JSON.parse(
    await readFile(
      join(repoRoot, "registry/packages/core-docs-required.json"),
      "utf-8"
    )
  );

  assert.equal(registry.packages[0].currentRelease.sha256, result.artifacts[0].sha256);
  assert.equal(detail.currentRelease.sha256, result.artifacts[0].sha256);
  assert.equal(
    detail.currentRelease.artifactName,
    "core-docs-required-0.1.0.mdm-resource.json"
  );
});

async function writeFixtureRepository(root) {
  await mkdir(join(root, "packages/core/docs/required/payload"), {
    recursive: true
  });
  await mkdir(join(root, "registry/packages"), { recursive: true });
  await writeFile(
    join(root, "packages/core/docs/required/package.json"),
    JSON.stringify(
      {
        schemaVersion: 1,
        id: "core-docs-required",
        namespace: "core",
        version: "0.1.0",
        artifactType: "docs",
        variant: "required",
        required: true,
        format: "json",
        payloadRoot: "payload",
        description: "Required core docs package"
      },
      null,
      2
    )
  );
  await writeFile(
    join(root, "packages/core/docs/required/payload/core-docs.json"),
    "{}\n"
  );
  await writeFile(
    join(root, "registry/index.json"),
    JSON.stringify(
      {
        schemaVersion: 1,
        packages: [
          {
            id: "core-docs-required",
            manifestPath: "registry/packages/core-docs-required.json",
            required: true,
            format: "json",
            currentRelease: null
          }
        ]
      },
      null,
      2
    )
  );
  await writeFile(
    join(root, "registry/packages/core-docs-required.json"),
    JSON.stringify(
      {
        schemaVersion: 1,
        id: "core-docs-required",
        sourcePath: "packages/core/docs/required/package.json",
        currentRelease: null
      },
      null,
      2
    )
  );
}
