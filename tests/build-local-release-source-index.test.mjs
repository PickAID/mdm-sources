import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { buildLocalRelease } from "../tools/build-local-release.mjs";
import { verifyReleaseInstall } from "../tools/verify-release-install.mjs";
import { verifyReleaseSchema } from "../tools/verify-release-schema.mjs";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite");

test("buildLocalRelease materializes source_index_sqlite packages as source indexes", async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), "mdm-source-index-repo-"));
  const outDir = await mkdtemp(join(tmpdir(), "mdm-source-index-out-"));

  await writeSourceIndexFixtureRepository(repoRoot);
  const result = await buildLocalRelease({
    root: repoRoot,
    outDir,
    builtAt: "2026-05-07T00:00:00.000Z"
  });

  assert.equal(result.artifacts[0].artifactName, "minecraft-1.20.1-source-index-0.1.0.sqlite");
  assertSourceIndexSqlite(result.artifacts[0].artifactPath);

  const releaseManifest = JSON.parse(
    await readFile(join(outDir, "mdm-release-manifest.json"), "utf-8")
  );
  assert.equal(releaseManifest.packages[0].artifactType, "source_index");
  assert.equal(releaseManifest.packages[0].artifactKind, "source_index");
  assert.equal(releaseManifest.packages[0].queryAdapter, "source_index_sqlite");
  assert.deepEqual(releaseManifest.packages[0].metadata.sqlite.requiredTables, [
    "files",
    "java_symbols",
    "java_members",
    "fts_files",
    "source_chunks",
    "fts_chunks"
  ]);

  const verified = await verifyReleaseInstall({ manifest: result.manifestPath });
  const schema = await verifyReleaseSchema({ manifestPath: result.manifestPath });

  assert.deepEqual(schema.errors, []);
  assert.equal(verified.verifiedCount, 1);
});

function assertSourceIndexSqlite(artifactPath) {
  const database = new DatabaseSync(artifactPath);
  try {
    const row = database.prepare("SELECT path, kind, package_id FROM files").get();
    assert.equal(row.path, "net/minecraft/world/item/ItemStack.java");
    assert.equal(row.kind, "java");
    assert.equal(row.package_id, "minecraft-1.20.1-source-index");

    const symbol = database
      .prepare("SELECT simple_name, qualified_name FROM java_symbols ORDER BY simple_name")
      .all();
    assert.deepEqual(symbol.map((entry) => entry.simple_name), [
      "ItemStack",
      "ItemStackComponent"
    ]);
    assert.equal(symbol[0].qualified_name, "net.minecraft.world.item.ItemStack");

    const member = database
      .prepare("SELECT owner_qualified_name, member_name, member_kind FROM java_members ORDER BY member_name")
      .all();
    assert.deepEqual(member.map((entry) => entry.member_name), ["copy", "isEmpty"]);
    assert.equal(member[0].owner_qualified_name, "net.minecraft.world.item.ItemStack");
    assert.equal(member[0].member_kind, "method");

    const ftsRows = database
      .prepare("SELECT path, chunk_id FROM fts_chunks WHERE fts_chunks MATCH ?")
      .all('"durability"');
    assert.deepEqual(ftsRows.map((entry) => ({ ...entry })), [
      {
        path: "net/minecraft/world/item/ItemStack.java",
        chunk_id: "durability-rules"
      }
    ]);
  } finally {
    database.close();
  }
}

async function writeSourceIndexFixtureRepository(root) {
  await mkdir(join(root, "packages/source-index/vanilla/1.20.1/payload"), {
    recursive: true
  });
  await mkdir(join(root, "registry/packages"), { recursive: true });
  await writeFile(
    join(root, "packages/source-index/vanilla/1.20.1/package.json"),
    JSON.stringify(sourceIndexPackageManifest(), null, 2)
  );
  await writeFile(
    join(root, "packages/source-index/vanilla/1.20.1/payload/source-index.json"),
    JSON.stringify(sourceIndexPayload(), null, 2)
  );
  await writeFile(
    join(root, "registry/index.json"),
    JSON.stringify({
      schemaVersion: 1,
      packages: [
        {
          id: "minecraft-1.20.1-source-index",
          manifestPath: "registry/packages/minecraft-1.20.1-source-index.json",
          currentRelease: null
        }
      ]
    })
  );
  await writeFile(
    join(root, "registry/packages/minecraft-1.20.1-source-index.json"),
    JSON.stringify({
      id: "minecraft-1.20.1-source-index",
      sourcePath: "packages/source-index/vanilla/1.20.1/package.json",
      currentRelease: null
    })
  );
}

function sourceIndexPackageManifest() {
  return {
    identity: {
      schemaVersion: 2,
      packageId: "minecraft-1.20.1-source-index",
      packageVersion: "0.1.0",
      namespace: "minecraft",
      displayName: "Minecraft 1.20.1 Source Index",
      description: "Tiny source index fixture without source bytes."
    },
    target: {
      minecraftVersions: ["1.20.1"],
      loaders: ["vanilla"],
      mappings: ["mojmap"]
    },
    artifact: {
      kind: "source_index",
      format: "sqlite",
      schemaId: "mdm.source.index.sqlite",
      schemaVersion: 1,
      entrypoint: "payload/source-index.json"
    },
    capabilities: ["source_lookup", "source_chunk_search"],
    policy: {
      privacy: "public_release",
      lifecycle: ["downloadable"],
      canCommitToRepository: true,
      canUploadToPublicRelease: true,
      requiresUserConsent: false
    },
    query: {
      adapter: "source_index_sqlite",
      capabilities: ["source_lookup", "source_chunk_search"],
      defaultLimit: 8,
      maxLimit: 50,
      preferredFallbacks: []
    },
    release: { channel: "sources", family: "vanilla-source-index" }
  };
}

function sourceIndexPayload() {
  return {
    files: [
      {
        id: "itemstack",
        minecraftVersion: "1.20.1",
        loader: "vanilla",
        mappings: "mojmap",
        className: "net.minecraft.world.item.ItemStack",
        packageName: "net.minecraft.world.item",
        sourcePath: "net/minecraft/world/item/ItemStack.java",
        sha256: "0".repeat(64),
        summary: "ItemStack source metadata only; no source bytes.",
        javaMembers: [
          {
            memberName: "copy",
            memberKind: "method",
            signature: "copy()",
            returnType: "ItemStack",
            startLine: 10,
            endLine: 12
          }
        ]
      }
    ],
    javaSymbols: [
      {
        path: "net/minecraft/world/item/ItemStack.java",
        qualifiedName: "net.minecraft.world.item.ItemStackComponent"
      }
    ],
    javaMembers: [
      {
        path: "net/minecraft/world/item/ItemStack.java",
        ownerSimpleName: "ItemStack",
        ownerQualifiedName: "net.minecraft.world.item.ItemStack",
        memberName: "isEmpty",
        memberKind: "method",
        signature: "isEmpty()",
        returnType: "boolean",
        startLine: 20,
        endLine: 22
      }
    ],
    sourceChunks: [
      {
        path: "net/minecraft/world/item/ItemStack.java",
        chunkId: "durability-rules",
        chunkType: "code_window",
        startLine: 30,
        endLine: 34,
        content: "Durability and component merge rules for ItemStack metadata."
      }
    ]
  };
}
