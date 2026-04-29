import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { validateRepository } from "../tools/validate.mjs";

test("validateRepository accepts a minimal required core docs package", async () => {
  const root = await mkdtemp(join(tmpdir(), "mdm-sources-"));
  await mkdir(join(root, "packages/core/docs/required/payload"), {
    recursive: true
  });
  await mkdir(join(root, "registry/packages"), { recursive: true });
  await writeFile(
    join(root, "packages/core/docs/required/payload/core-docs.json"),
    "{}\n"
  );
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
    join(root, "registry/index.json"),
    JSON.stringify(
      {
        schemaVersion: 1,
        packages: [
          {
            id: "core-docs-required",
            manifestPath: "registry/packages/core-docs-required.json",
            required: true,
            format: "json"
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

  const result = await validateRepository(root);

  assert.deepEqual(result.errors, []);
  assert.equal(result.packageCount, 1);
});
