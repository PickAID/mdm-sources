import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import { syncMisodeGeneratorCatalog } from "../tools/misode-generator-catalog.mjs";
import { validateRepository } from "../tools/validate.mjs";

const execFileAsync = promisify(execFile);

test("syncMisodeGeneratorCatalog writes searchable path and version rules", async () => {
  const root = await mkdtemp(join(tmpdir(), "mdm-misode-catalog-root-"));
  const misodeRoot = await mkdtemp(join(tmpdir(), "mdm-misode-catalog-upstream-"));
  await writeMisodeFixture(misodeRoot);

  const result = await syncMisodeGeneratorCatalog({ root, misodeRoot });
  const validation = await validateRepository(root);
  const packageJson = JSON.parse(
    await readFile(join(root, "packages/docs/misode-generator-catalog/package.json"), "utf-8")
  );
  const payload = JSON.parse(
    await readFile(
      join(root, "packages/docs/misode-generator-catalog/payload/generator-catalog.json"),
      "utf-8"
    )
  );

  assert.deepEqual(result.packages, [
    {
      packageId: "misode-generator-catalog",
      packagePath: "packages/docs/misode-generator-catalog/package.json",
      payloadPath: "packages/docs/misode-generator-catalog/payload/generator-catalog.json"
    }
  ]);
  assert.equal(packageJson.identity.packageId, "misode-generator-catalog");
  assert.equal(packageJson.query.adapter, "json_docs");
  assert.deepEqual(validation.errors, []);
  assert.equal(payload.catalog.generatorCount, 4);
  assert.deepEqual(generator(payload, "recipe").pathRule, {
    kind: "namespaced_file",
    root: "data",
    path: "recipe",
    extension: ".json",
    legacyPluralBefore: "1.21",
    legacyPathBefore121: "recipes"
  });
  assert.deepEqual(generator(payload, "recipe").allowedVersionIds, ["1.20.1", "1.21"]);
  assert.deepEqual(generator(payload, "model").pathRule, {
    kind: "namespaced_file",
    root: "assets",
    path: "models",
    extension: ".json"
  });
  assert.deepEqual(generator(payload, "pack_mcmeta").pathRule, {
    kind: "root_file",
    path: "pack.mcmeta",
    extension: ".mcmeta"
  });
  assert.deepEqual(generator(payload, "text_component").pathRule, {
    kind: "no_path"
  });
});

function generator(payload, id) {
  return payload.entries.find((entry) => entry.id === `misode-generator-catalog-${slug(id)}`)
    .metadata.generator;
}

function slug(value) {
  return value.replace(/[^a-z0-9]+/giu, "-").replace(/^-|-$/gu, "").toLowerCase();
}

async function writeMisodeFixture(root) {
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(
    join(root, "src/config.json"),
    JSON.stringify({
      versions: [
        { id: "1.20.1", ref: "1.20.1", name: "1.20.1", pack_format: 15 },
        { id: "1.21", ref: "1.21", name: "1.21", pack_format: 48 }
      ],
      generators: [
        { id: "recipe", url: "recipe" },
        { id: "model", url: "assets/model", path: "models", tags: ["assets"] },
        { id: "pack_mcmeta", url: "pack-mcmeta" },
        { id: "text_component", url: "text-component", noPath: true }
      ]
    })
  );
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
