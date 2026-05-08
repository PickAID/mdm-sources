import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { listReleaseArtifacts } from "../tools/list-release-artifacts.mjs";

test("listReleaseArtifacts returns manifest and manifest-declared artifacts only", async () => {
  const root = await mkdtemp(join(tmpdir(), "mdm-release-artifacts-"));
  const manifestPath = join(root, "mdm-release-manifest.json");

  await mkdir(root, { recursive: true });
  await writeFile(
    manifestPath,
    JSON.stringify(
      {
        schemaVersion: 1,
        generatedAt: "2026-05-07T00:00:00.000Z",
        packages: [
          {
            packageId: "docs-json",
            artifactName: "docs-json-0.1.0.mdm-resource.json"
          },
          {
            packageId: "docs-sqlite",
            artifactName: "docs-sqlite-0.1.0.sqlite"
          }
        ]
      },
      null,
      2
    )
  );

  assert.deepEqual(await listReleaseArtifacts(manifestPath), [
    manifestPath,
    join(root, "docs-json-0.1.0.mdm-resource.json"),
    join(root, "docs-sqlite-0.1.0.sqlite")
  ]);
});

test("listReleaseArtifacts lists bundle assets instead of bundled members", async () => {
  const root = await mkdtemp(join(tmpdir(), "mdm-release-bundle-artifacts-"));
  const manifestPath = join(root, "mdm-release-manifest.json");

  await writeFile(
    manifestPath,
    JSON.stringify(
      {
        schemaVersion: 1,
        generatedAt: "2026-05-08T00:00:00.000Z",
        packages: [
          {
            packageId: "datapack-profile",
            bundleRef: {
              bundleName: "datapack.mdm-bundle",
              memberName: "datapack-profile-0.1.0.mdm-resource.json"
            }
          },
          {
            packageId: "required-docs",
            artifactName: "required-docs-0.1.0.mdm-resource.json"
          }
        ],
        bundles: [
          {
            bundleName: "datapack.mdm-bundle",
            artifactName: "datapack.mdm-bundle.json"
          }
        ]
      },
      null,
      2
    )
  );

  assert.deepEqual(await listReleaseArtifacts(manifestPath), [
    manifestPath,
    join(root, "required-docs-0.1.0.mdm-resource.json"),
    join(root, "datapack.mdm-bundle.json")
  ]);
});
