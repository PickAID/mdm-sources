import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import { buildLocalRelease } from "../tools/build-local-release.mjs";
import { syncVersionChangeDocs } from "../tools/sync-version-change-docs.mjs";
import { validateRepository } from "../tools/validate.mjs";

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite");

test("syncVersionChangeDocs writes searchable NeoForged and misode version-change docs", async () => {
  const root = await mkdtemp(join(tmpdir(), "mdm-version-docs-root-"));
  const outDir = await mkdtemp(join(tmpdir(), "mdm-version-docs-release-"));
  const neoforgedRoot = await mkdtemp(join(tmpdir(), "mdm-neoforged-fixture-"));
  const misodeRoot = await mkdtemp(join(tmpdir(), "mdm-misode-changes-fixture-"));
  await writeNeoForgedFixture(neoforgedRoot);
  await writeMisodeTechnicalChangesFixture(misodeRoot);

  const result = await syncVersionChangeDocs({
    root,
    neoforgedRoot,
    misodeRoot,
    versions: ["26.1"]
  });
  const validation = await validateRepository(root);
  const packageJson = JSON.parse(
    await readFile(
      join(root, "packages/docs/version-changes/26.1/package.json"),
      "utf-8"
    )
  );
  const payload = JSON.parse(
    await readFile(
      join(root, "packages/docs/version-changes/26.1/payload/version-changes.json"),
      "utf-8"
    )
  );

  assert.deepEqual(result.packages, [
    {
      packageId: "minecraft-26.1-version-changes",
      packagePath: "packages/docs/version-changes/26.1/package.json",
      payloadPath: "packages/docs/version-changes/26.1/payload/version-changes.json"
    }
  ]);
  assert.deepEqual(validation.errors, []);
  assert.equal(packageJson.identity.packageId, "minecraft-26.1-version-changes");
  assert.equal(packageJson.artifact.format, "sqlite");
  assert.equal(packageJson.query.adapter, "sqlite_docs");
  assert.deepEqual(packageJson.target.minecraftVersions, ["26.1"]);
  assert.equal(packageJson.release.family, "minecraft-version-changes");

  assert.deepEqual(
    payload.upstreams.map((upstream) => upstream.name),
    ["neoforged/.github", "misode/technical-changes"]
  );
  assert.equal(payload.entries.length, 4);
  assert.deepEqual(entry(payload, "minecraft-26.1-version-changes-overview").metadata.sourcePatterns, [
    "neoforged/.github:primers/<version>/index.md",
    "misode/technical-changes:<version>/*.md"
  ]);
  assert.equal(
    entry(payload, "minecraft-26.1-neoforged-primer").metadata.upstreamPath,
    "primers/26.1/index.md"
  );
  assert.equal(
    entry(payload, "minecraft-26.1-misode-26.1-snapshot-1").metadata.upstreamPath,
    "26.1/26.1-snapshot-1.md"
  );
  assert.equal(
    entry(payload, "minecraft-26.1-misode-26.1-pre-1").metadata.changelogPageUrl,
    "https://misode.github.io/versions/?id=26.1&tab=changelog"
  );

  const release = await buildLocalRelease({
    root,
    outDir,
    releaseChannels: ["docs"],
    builtAt: "2026-05-13T00:00:00.000Z"
  });
  const artifact = release.artifacts.find(
    (candidate) => candidate.packageId === "minecraft-26.1-version-changes"
  );
  assert.ok(artifact);
  assert.equal(artifact.artifactName, "minecraft-26.1-version-changes-0.1.0.sqlite");
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
    assert.deepEqual(
      rows.map((row) => row.entry_id),
      [
        "minecraft-26.1-misode-26.1-pre-1",
        "minecraft-26.1-misode-26.1-snapshot-1",
        "minecraft-26.1-neoforged-primer",
        "minecraft-26.1-version-changes-overview"
      ]
    );
    assert.ok(rows.every((row) => row.package_id === "minecraft-26.1-version-changes"));
    assert.ok(
      rows.some((row) => row.path === "neoforged/.github:primers/26.1/index.md")
    );
    assert.ok(
      rows.some((row) => row.path === "misode/technical-changes:26.1/26.1-snapshot-1.md")
    );
    assert.ok(
      JSON.parse(
        rows.find((row) => row.entry_id === "minecraft-26.1-misode-26.1-snapshot-1")
          .metadata
      ).upstreamUrl.endsWith("/26.1/26.1-snapshot-1.md")
    );
  } finally {
    database.close();
  }
}

async function writeNeoForgedFixture(root) {
  await mkdir(join(root, "primers", "26.1"), { recursive: true });
  await writeFile(
    join(root, "primers", "26.1", "index.md"),
    [
      "# NeoForged 26.1 Primer",
      "",
      "This primer covers loader-side migration details for Minecraft 26.1.",
      "",
      "## Registries",
      "",
      "Registry bootstrap behavior changed for mod initialization."
    ].join("\n")
  );
  await commitFixture(root);
}

async function writeMisodeTechnicalChangesFixture(root) {
  await mkdir(join(root, "26.1"), { recursive: true });
  await writeFile(
    join(root, "26.1", "26.1-snapshot-1.md"),
    [
      "# 26.1 Snapshot 1",
      "",
      "Data pack and resource pack formats changed in this snapshot.",
      "",
      "## pack_format",
      "",
      "The pack format increased for experimental resources."
    ].join("\n")
  );
  await writeFile(
    join(root, "26.1", "26.1-pre-1.md"),
    [
      "# 26.1 Pre-release 1",
      "",
      "Final technical changelog notes for vanilla formats."
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
