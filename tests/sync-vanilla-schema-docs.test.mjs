import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import { syncVanillaSchemaDocs } from "../tools/sync-vanilla-schema-docs.mjs";
import { validateRepository } from "../tools/validate.mjs";

const execFileAsync = promisify(execFile);

test("syncVanillaSchemaDocs generates one compact vanilla-schema-docs package", async () => {
  const root = await mkdtemp(join(tmpdir(), "mdm-vanilla-schema-docs-root-"));
  const vanillaMcdocRoot = await mkdtemp(join(tmpdir(), "mdm-vanilla-mcdoc-"));
  const misodeRoot = await mkdtemp(join(tmpdir(), "mdm-misode-"));

  await writeUpstreamFixtures({ vanillaMcdocRoot, misodeRoot });

  const result = await syncVanillaSchemaDocs({
    root,
    vanillaMcdocRoot,
    misodeRoot
  });
  const validation = await validateRepository(root);

  assert.deepEqual(result.packages, [
    {
      packageId: "vanilla-schema-docs",
      packagePath: "packages/docs/vanilla-schema-docs/package.json",
      payloadPath: "packages/docs/vanilla-schema-docs/payload/explanations.json"
    }
  ]);
  assert.equal(validation.errors.length, 0);

  const packageJson = JSON.parse(
    await readFile(join(root, "packages/docs/vanilla-schema-docs/package.json"), "utf-8")
  );
  const payloadText = await readFile(
    join(root, "packages/docs/vanilla-schema-docs/payload/explanations.json"),
    "utf-8"
  );
  const payload = JSON.parse(payloadText);
  const registry = JSON.parse(await readFile(join(root, "registry/index.json"), "utf-8"));

  assert.equal(packageJson.identity.packageId, "vanilla-schema-docs");
  assert.equal(packageJson.query.adapter, "json_docs");
  assert.deepEqual(packageJson.capabilities, [
    "docs_search",
    "docs_direct_read",
    "schema_reference",
    "mcdoc_reference",
    "datapack_trace",
    "resourcepack_trace"
  ]);
  assert.equal(payloadText.split("\n").length - 1, 1);
  assert.equal((await stat(join(root, "packages/docs/vanilla-schema-docs/payload/explanations.json"))).size < 512 * 1024, true);
  assert.equal(payload.entries.length, 6);
  assert.equal(payload.attribution.length, 2);
  assert.equal(payload.entries.some((entry) => entry.title === "undefined sources"), false);
  assert.equal(payload.entries.some((entry) => entry.path === "vanilla-mcdoc:java/data/recipe.mcdoc" && entry.preview), true);
  assert.equal(payload.entries.some((entry) => entry.path === "vanilla-mcdoc:java/assets/model.mcdoc" && entry.preview), true);
  assert.equal(payload.entries.some((entry) => String(entry.path).startsWith("misode:") && entry.preview && entry.contentHash), true);
  assert.deepEqual(registry.packages.map((entry) => entry.id), ["vanilla-schema-docs"]);
});

test("syncVanillaSchemaDocs rejects partial kind generation for the single package", async () => {
  const root = await mkdtemp(join(tmpdir(), "mdm-vanilla-schema-docs-kind-"));
  const vanillaMcdocRoot = await mkdtemp(join(tmpdir(), "mdm-vanilla-mcdoc-"));
  const misodeRoot = await mkdtemp(join(tmpdir(), "mdm-misode-"));

  await writeUpstreamFixtures({ vanillaMcdocRoot, misodeRoot });

  await assert.rejects(
    syncVanillaSchemaDocs({
      root,
      vanillaMcdocRoot,
      misodeRoot,
      kind: "datapack"
    }),
    /single package/u
  );
});

async function writeUpstreamFixtures({ vanillaMcdocRoot, misodeRoot }) {
  await mkdir(join(vanillaMcdocRoot, "java/data"), { recursive: true });
  await mkdir(join(vanillaMcdocRoot, "java/assets"), { recursive: true });
  await mkdir(join(misodeRoot, "src/app/components/generator"), { recursive: true });

  await writeFile(join(vanillaMcdocRoot, "java/data/recipe.mcdoc"), [
    "dispatch minecraft:resource[recipe] to struct Recipe {",
    "\ttype: string,",
    "}"
  ].join("\n"));
  await writeFile(join(vanillaMcdocRoot, "java/assets/model.mcdoc"), [
    "dispatch minecraft:resource[model] to struct Model {",
    "\tparent?: string,",
    "}"
  ].join("\n"));
  await writeFile(join(misodeRoot, "src/app/components/generator/SchemaGenerator.tsx"), [
    "export interface SchemaGeneratorProps { id: string }",
    "export function SchemaGenerator(props: SchemaGeneratorProps) {",
    "\treturn props.id",
    "}"
  ].join("\n"));

  await commitFixtureRepo(vanillaMcdocRoot);
  await commitFixtureRepo(misodeRoot);
}

async function commitFixtureRepo(root) {
  await execFileAsync("git", ["init"], { cwd: root });
  await execFileAsync("git", ["add", "."], { cwd: root });
  await execFileAsync(
    "git",
    [
      "-c",
      "user.name=MDM Test",
      "-c",
      "user.email=mdm-test@example.invalid",
      "commit",
      "-m",
      "fixture"
    ],
    { cwd: root }
  );
}
