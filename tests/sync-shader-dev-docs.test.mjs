import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import { buildLocalRelease } from "../tools/build-local-release.mjs";
import { syncShaderDevDocs } from "../tools/sync-shader-dev-docs.mjs";
import { validateRepository } from "../tools/validate.mjs";

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite");

test("syncShaderDevDocs writes searchable MiniMax shader-dev docs", async () => {
  const root = await mkdtemp(join(tmpdir(), "mdm-shader-docs-root-"));
  const outDir = await mkdtemp(join(tmpdir(), "mdm-shader-docs-release-"));
  const skillsRoot = await mkdtemp(join(tmpdir(), "mdm-minimax-skills-fixture-"));
  await writeShaderDevFixture(skillsRoot);

  const result = await syncShaderDevDocs({
    root,
    skillsRoot
  });
  const validation = await validateRepository(root);
  const packageJson = JSON.parse(
    await readFile(join(root, "packages/docs/shader-dev/package.json"), "utf-8")
  );
  const payload = JSON.parse(
    await readFile(join(root, "packages/docs/shader-dev/payload/shader-dev-docs.json"), "utf-8")
  );

  assert.deepEqual(result.packages, [
    {
      packageId: "shader-dev-docs",
      packagePath: "packages/docs/shader-dev/package.json",
      payloadPath: "packages/docs/shader-dev/payload/shader-dev-docs.json"
    }
  ]);
  assert.deepEqual(validation.errors, []);
  assert.equal(packageJson.identity.packageId, "shader-dev-docs");
  assert.equal(packageJson.artifact.format, "sqlite");
  assert.equal(packageJson.query.adapter, "sqlite_docs");
  assert.equal(packageJson.release.family, "shader-dev-docs");
  assert.deepEqual(
    packageJson.capabilities,
    ["docs_search", "docs_direct_read", "shader_reference", "glsl_reference"]
  );

  assert.deepEqual(
    payload.upstreams.map((upstream) => upstream.name),
    ["MiniMax-AI/skills:shader-dev"]
  );
  assert.equal(payload.entries.length, 4);
  assert.ok(entry(payload, "shader-dev-docs-overview"));
  assert.equal(
    entry(payload, "shader-dev-docs-skill-md").metadata.upstreamPath,
    "skills/shader-dev/SKILL.md"
  );
  assert.equal(
    entry(payload, "shader-dev-docs-techniques-ray-marching-md").metadata.upstreamUrl,
    "https://github.com/MiniMax-AI/skills/blob/main/skills/shader-dev/techniques/ray-marching.md"
  );
  assert.equal(
    entry(payload, "shader-dev-docs-reference-ray-marching-md").metadata.upstreamPath,
    "skills/shader-dev/reference/ray-marching.md"
  );
  assert.ok(
    entry(payload, "shader-dev-docs-techniques-ray-marching-md")
      .searchTerms.includes("ray marching")
  );

  const release = await buildLocalRelease({
    root,
    outDir,
    releaseChannels: ["docs"],
    builtAt: "2026-05-13T00:00:00.000Z"
  });
  const artifact = release.artifacts.find(
    (candidate) => candidate.packageId === "shader-dev-docs"
  );
  assert.ok(artifact);
  assert.equal(artifact.artifactName, "shader-dev-docs-0.1.0.sqlite");
  assertSqliteDocsArtifact(artifact.artifactPath);
});

function entry(payload, id) {
  return payload.entries.find((candidate) => candidate.id === id);
}

function assertSqliteDocsArtifact(path) {
  const database = new DatabaseSync(path);
  try {
    assert.equal(database.prepare("PRAGMA user_version").get().user_version, 3);
    const rows = database
      .prepare("SELECT entry_id, package_id, path, metadata FROM docs_entries ORDER BY entry_id")
      .all();
    assert.ok(rows.every((row) => row.package_id === "shader-dev-docs"));
    assert.ok(
      rows.some((row) => row.path === "MiniMax-AI/skills:skills/shader-dev/SKILL.md")
    );
    assert.ok(
      rows.some((row) => row.path === "MiniMax-AI/skills:skills/shader-dev/techniques/ray-marching.md")
    );
    assert.ok(
      JSON.parse(
        rows.find((row) => row.entry_id === "shader-dev-docs-techniques-ray-marching-md")
          .metadata
      ).preview.includes("Sphere tracing")
    );
    const searchHits = database
      .prepare(
        "SELECT entry_id FROM docs_entries_fts WHERE docs_entries_fts MATCH ? ORDER BY rank LIMIT 5"
      )
      .all("ray marching SDF");
    assert.ok(
      searchHits.some((row) => row.entry_id === "shader-dev-docs-techniques-ray-marching-md")
    );
  } finally {
    database.close();
  }
}

async function writeShaderDevFixture(root) {
  const skillRoot = join(root, "skills", "shader-dev");
  await mkdir(join(skillRoot, "techniques"), { recursive: true });
  await mkdir(join(skillRoot, "reference"), { recursive: true });
  await writeFile(
    join(skillRoot, "SKILL.md"),
    [
      "---",
      "name: shader-dev",
      "description: Comprehensive GLSL shader techniques.",
      "---",
      "# Shader Craft",
      "",
      "Use [ray-marching](techniques/ray-marching.md) for SDF scenes.",
      "",
      "## Technique Routing Table",
      "",
      "| User wants | Primary technique |",
      "|---|---|",
      "| 3D objects | [ray-marching](techniques/ray-marching.md) |"
    ].join("\n")
  );
  await writeFile(
    join(skillRoot, "techniques", "ray-marching.md"),
    [
      "# Ray Marching",
      "",
      "Sphere tracing with signed distance functions for GLSL shaders.",
      "",
      "## Core Principles",
      "",
      "Ray marching advances by the SDF value and estimates normals for lighting.",
      "",
      "`map(vec3 p)` returns distance to the closest surface."
    ].join("\n")
  );
  await writeFile(
    join(skillRoot, "reference", "ray-marching.md"),
    [
      "# Ray Marching Reference",
      "",
      "Detailed SDF derivations for ray marching, surface normals, and soft shadows."
    ].join("\n")
  );
  await commitFixture(root);
}

async function commitFixture(root) {
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
