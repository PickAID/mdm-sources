import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import { buildLocalRelease } from "../tools/build-local-release.mjs";
import { syncLoaderDocs } from "../tools/sync-loader-docs.mjs";
import { validateRepository } from "../tools/validate.mjs";

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite");

test("syncLoaderDocs writes searchable NeoForge, Forge, news, and primer docs", async () => {
  const root = await mkdtemp(join(tmpdir(), "mdm-loader-docs-root-"));
  const outDir = await mkdtemp(join(tmpdir(), "mdm-loader-docs-release-"));
  const neoforgeDocsRoot = await mkdtemp(join(tmpdir(), "mdm-neoforge-docs-fixture-"));
  const neoforgeWebsitesRoot = await mkdtemp(join(tmpdir(), "mdm-neoforge-websites-fixture-"));
  const forgeDocsRoot = await mkdtemp(join(tmpdir(), "mdm-forge-docs-fixture-"));
  await writeNeoForgeDocsFixture(neoforgeDocsRoot);
  await writeNeoForgeWebsitesFixture(neoforgeWebsitesRoot);
  await writeForgeDocsFixture(forgeDocsRoot);

  const result = await syncLoaderDocs({
    root,
    neoforgeDocsRoot,
    neoforgeWebsitesRoot,
    forgeDocsRoots: [{ branch: "1.21.x", root: forgeDocsRoot }],
    gistData: championPrimerFixture()
  });
  const validation = await validateRepository(root);
  const packageJson = JSON.parse(
    await readFile(join(root, "packages/docs/loader-docs/package.json"), "utf-8")
  );
  const payload = JSON.parse(
    await readFile(join(root, "packages/docs/loader-docs/payload/loader-docs.json"), "utf-8")
  );

  assert.deepEqual(result.packages, [
    {
      packageId: "minecraft-loader-docs",
      packagePath: "packages/docs/loader-docs/package.json",
      payloadPath: "packages/docs/loader-docs/payload/loader-docs.json"
    }
  ]);
  assert.deepEqual(validation.errors, []);
  assert.equal(packageJson.identity.packageId, "minecraft-loader-docs");
  assert.equal(packageJson.release.family, "minecraft-loader-docs");
  assert.deepEqual(packageJson.target.loaders, ["forge", "neoforge"]);

  assert.deepEqual(
    payload.upstreams.map((upstream) => upstream.name),
    [
      "neoforged/Documentation",
      "neoforged/websites",
      "MinecraftForge/Documentation:1.21.x",
      "ChampionAsh5357 gist c21724bafbc630da2ed8899fe0c1d226"
    ]
  );
  assert.equal(payload.entries.length, 6);
  assert.ok(entry(payload, "minecraft-loader-docs-overview"));
  assert.equal(
    entry(payload, "minecraft-loader-docs-neoforge-docs-docs-concepts-registries-md")
      .metadata.publicUrl,
    "https://docs.neoforged.net/docs/concepts/registries/"
  );
  assert.equal(
    entry(payload, "minecraft-loader-docs-neoforge-docs-versioned-docs-version-1-21-11-concepts-events-md")
      .metadata.publicUrl,
    "https://docs.neoforged.net/docs/1.21.11/concepts/events/"
  );
  assert.equal(
    entry(payload, "minecraft-loader-docs-neoforge-news-content-news-26-1release-md")
      .metadata.publicUrl,
    "https://neoforged.net/news/26.1release/"
  );
  assert.equal(
    entry(payload, "minecraft-loader-docs-champion-primer-c21724bafbc630da2ed8899fe0c1d226-1192-1193-primer-md")
      .metadata.gistId,
    "c21724bafbc630da2ed8899fe0c1d226"
  );

  const release = await buildLocalRelease({
    root,
    outDir,
    releaseChannels: ["docs"],
    builtAt: "2026-05-13T00:00:00.000Z"
  });
  const artifact = release.artifacts.find(
    (candidate) => candidate.packageId === "minecraft-loader-docs"
  );
  assert.ok(artifact);
  assert.equal(artifact.artifactName, "minecraft-loader-docs-0.1.0.sqlite");
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
    assert.ok(rows.every((row) => row.package_id === "minecraft-loader-docs"));
    assert.ok(rows.some((row) => row.path === "neoforged/Documentation:docs/concepts/registries.md"));
    assert.ok(rows.some((row) => row.path === "neoforged/websites:content/news/26.1release.md"));
    assert.ok(rows.some((row) => row.path === "MinecraftForge/Documentation:1.21.x:docs/concepts/registries.md"));
    assert.ok(rows.some((row) => row.path.startsWith("gist:ChampionAsh5357/")));
    assert.ok(
      JSON.parse(
        rows.find((row) => row.entry_id.includes("champion-primer")).metadata
      ).upstreamUrl.includes("gist.githubusercontent.com")
    );
  } finally {
    database.close();
  }
}

async function writeNeoForgeDocsFixture(root) {
  await mkdir(join(root, "docs", "concepts"), { recursive: true });
  await mkdir(join(root, "versioned_docs", "version-1.21.11", "concepts"), { recursive: true });
  await writeFile(
    join(root, "docs", "concepts", "registries.md"),
    [
      "---",
      "title: Registries",
      "summary: NeoForge registry docs.",
      "---",
      "# Registries",
      "",
      "Use `DeferredRegister` and `RegisterEvent` for registry entries."
    ].join("\n")
  );
  await writeFile(
    join(root, "versioned_docs", "version-1.21.11", "concepts", "events.md"),
    [
      "---",
      "title: Events",
      "---",
      "# Events",
      "",
      "NeoForge event bus behavior for versioned docs."
    ].join("\n")
  );
  await commitFixture(root);
}

async function writeNeoForgeWebsitesFixture(root) {
  await mkdir(join(root, "content", "news"), { recursive: true });
  await writeFile(
    join(root, "content", "news", "26.1release.md"),
    [
      "---",
      "title: \"NeoForge for Minecraft 26.1\"",
      "date: 2026-03-24T22:15:00+01:00",
      "summary: \"All you need to know about NeoForge for Minecraft 26.1.\"",
      "---",
      "# NeoForge for Minecraft 26.1",
      "",
      "Minecraft 26.1 requires Java 25 and updated ModDevGradle."
    ].join("\n")
  );
  await commitFixture(root);
}

async function writeForgeDocsFixture(root) {
  await mkdir(join(root, "docs", "concepts"), { recursive: true });
  await writeFile(
    join(root, "docs", "concepts", "registries.md"),
    [
      "Registries",
      "==========",
      "",
      "Forge registry docs cover `DeferredRegister` and `RegistryObject`."
    ].join("\n")
  );
  await commitFixture(root);
}

function championPrimerFixture() {
  return [
    {
      id: "c21724bafbc630da2ed8899fe0c1d226",
      description: "Minecraft 1.19.2 -> 1.19.3 Mod Migration Primer",
      htmlUrl: "https://gist.github.com/ChampionAsh5357/c21724bafbc630da2ed8899fe0c1d226",
      historyVersion: "fixture-history",
      files: [
        {
          name: "1192-1193-primer.md",
          rawUrl:
            "https://gist.githubusercontent.com/ChampionAsh5357/c21724bafbc630da2ed8899fe0c1d226/raw/1192-1193-primer.md",
          content: [
            "# Minecraft 1.19.2 -> 1.19.3 Mod Migration Primer",
            "",
            "This primer explains porting changes for Forge and NeoForge mods.",
            "",
            "## Registries",
            "",
            "`ResourceLocation` parsing changed."
          ].join("\n")
        },
        {
          name: "notice.md",
          rawUrl:
            "https://gist.githubusercontent.com/ChampionAsh5357/c21724bafbc630da2ed8899fe0c1d226/raw/notice.md",
          content: "Notice text"
        }
      ]
    }
  ];
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
