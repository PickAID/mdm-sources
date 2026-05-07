import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { buildLocalRelease } from "../tools/build-local-release.mjs";
import { validateJsonSchemaSubset } from "../tools/json-schema-subset.mjs";
import { verifyReleaseSchema } from "../tools/verify-release-schema.mjs";

test("release schema files are valid JSON contracts", async () => {
  const manifestSchema = await readSchema("release-manifest.schema.json");
  const summarySchema = await readSchema("release-summary.schema.json");
  const sourceIndexSchema = await readSchema("source-index-payload.schema.json");

  assert.equal(manifestSchema.title, "MDM Release Manifest");
  assert.deepEqual(manifestSchema.required, ["schemaVersion", "generatedAt", "packages"]);
  assert.equal(
    manifestSchema.properties.packages.items.properties.artifactName.pattern,
    "^[^/\\\\]+$"
  );
  assert.equal(summarySchema.title, "MDM Release Summary");
  assert.equal(summarySchema.properties.manifest.properties.name.const, "mdm-release-manifest.json");
  assert.equal(sourceIndexSchema.title, "MDM Source Index Payload");
  assert.deepEqual(Object.keys(sourceIndexSchema.properties), [
    "files",
    "javaSymbols",
    "javaMembers",
    "sourceChunks"
  ]);
  assert.deepEqual(sourceIndexSchema.$defs.javaMember.properties.memberKind.enum, [
    "field",
    "constructor",
    "method"
  ]);
  assert.ok(sourceIndexSchema.$defs.sourceChunk.anyOf);
});

test("generated release manifest and summary satisfy the schema-level contract", async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), "mdm-schema-repo-"));
  const outDir = await mkdtemp(join(tmpdir(), "mdm-schema-out-"));

  await writeFixtureRepository(repoRoot);
  const release = await buildLocalRelease({
    root: repoRoot,
    outDir,
    builtAt: "2026-05-07T00:00:00.000Z"
  });

  const manifest = JSON.parse(await readFile(release.manifestPath, "utf-8"));
  const summary = JSON.parse(await readFile(release.summaryPath, "utf-8"));

  assert.deepEqual(
    validateJsonSchemaSubset(await readSchema("release-manifest.schema.json"), manifest, {
      path: "manifest"
    }),
    []
  );
  assert.deepEqual(
    validateJsonSchemaSubset(await readSchema("release-summary.schema.json"), summary, {
      path: "summary"
    }),
    []
  );

  const result = await verifyReleaseSchema({ manifestPath: release.manifestPath });
  assert.deepEqual(result.errors, []);
  assert.equal(result.packageCount, 1);
});

test("release schema verifier rejects malformed release output", async () => {
  const root = await mkdtemp(join(tmpdir(), "mdm-schema-bad-"));
  await writeFile(
    join(root, "mdm-release-manifest.json"),
    JSON.stringify({
      schemaVersion: 1,
      generatedAt: "2026-05-07T00:00:00.000Z",
      packages: [
        {
          packageId: "bad",
          version: "0.1.0",
          namespace: "core",
          artifactType: "docs",
          variant: "docs",
          required: false,
          format: "json",
          releaseChannel: "docs",
          releaseFamily: "core-docs",
          capabilities: [],
          artifactName: "nested/bad.json",
          sizeBytes: 1
        }
      ]
    })
  );
  await writeFile(
    join(root, "mdm-release-summary.json"),
    JSON.stringify({
      schemaVersion: 1,
      generatedAt: "2026-05-07T00:00:00.000Z",
      source: { repository: null, ref: null, revision: null },
      manifest: {
        name: "mdm-release-manifest.json",
        sha256: "0".repeat(64),
        packageCount: 2
      },
      totals: { artifactCount: 1, sizeBytes: 1 },
      distributions: {
        releaseChannels: { docs: 1 },
        releaseFamilies: { "core-docs": 1 },
        artifactTypes: { docs: 1 },
        formats: { json: 1 }
      },
      artifacts: []
    })
  );

  const result = await verifyReleaseSchema({
    manifestPath: join(root, "mdm-release-manifest.json")
  });

  assert.match(result.errors.join("\n"), /manifest.packages\[0\].sha256 is required/);
  assert.match(result.errors.join("\n"), /manifest.packages\[0\].artifactName must match/);
  assert.match(result.errors.join("\n"), /summary.manifest.packageCount must equal/);
});

async function readSchema(name) {
  return JSON.parse(await readFile(join("schema", name), "utf-8"));
}

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
      payloadRoot: "payload",
      description: "Required core docs package"
    })
  );
  await writeFile(join(root, "packages/core/docs/required/payload/core-docs.json"), "{}\n");
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
