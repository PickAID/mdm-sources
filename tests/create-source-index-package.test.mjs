import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { buildLocalRelease } from "../tools/build-local-release.mjs";
import { createSourceIndexPackage } from "../tools/create-source-index-package.mjs";
import { validateRepository } from "../tools/validate.mjs";
import { verifyReleaseInstall } from "../tools/verify-release-install.mjs";

test("createSourceIndexPackage creates a validated source_index_sqlite package", async () => {
  const root = await mkdtemp(join(tmpdir(), "mdm-create-source-index-"));
  const outDir = await mkdtemp(join(tmpdir(), "mdm-create-source-index-out-"));
  const payloadPath = join(root, "allowed-source-index.json");
  await writeFile(payloadPath, `${JSON.stringify(sourceIndexPayload(), null, 2)}\n`);

  const created = await createSourceIndexPackage({
    root,
    payloadJson: payloadPath,
    minecraftVersion: "1.20.1",
    loader: "neoforge",
    mappings: "mojmap",
    packageId: "minecraft-1.20.1-neoforge-source-index",
    version: "0.2.0",
    outRoot: "packages/source-index/neoforge/1.20.1"
  });
  const validation = await validateRepository(root);
  const release = await buildLocalRelease({
    root,
    outDir,
    builtAt: "2026-05-08T00:00:00.000Z",
    writeRegistry: false
  });
  const manifest = JSON.parse(
    await readFile(join(outDir, "mdm-release-manifest.json"), "utf-8")
  );
  const install = await verifyReleaseInstall({ manifest: release.manifestPath });

  assert.equal(created.packageId, "minecraft-1.20.1-neoforge-source-index");
  assert.equal(created.registryPackageCount, 1);
  assert.deepEqual(validation.errors, []);
  assert.equal(validation.packageCount, 1);
  assert.equal(release.artifacts[0].artifactName, "minecraft-1.20.1-neoforge-source-index-0.2.0.sqlite");
  assert.deepEqual(manifest.packages.map((entry) => ({
    packageId: entry.packageId,
    artifactType: entry.artifactType,
    artifactKind: entry.artifactKind,
    queryAdapter: entry.queryAdapter,
    releaseFamily: entry.releaseFamily
  })), [
    {
      packageId: "minecraft-1.20.1-neoforge-source-index",
      artifactType: "source_index",
      artifactKind: "source_index",
      queryAdapter: "source_index_sqlite",
      releaseFamily: "loader-source-index"
    }
  ]);
  assert.equal(install.verifiedCount, 1);
});

test("createSourceIndexPackage rejects payload target mismatches", async () => {
  const root = await mkdtemp(join(tmpdir(), "mdm-create-source-index-mismatch-"));
  const payloadPath = join(root, "allowed-source-index.json");
  await writeFile(payloadPath, `${JSON.stringify({
    files: [{ ...sourceIndexPayload().files[0], loader: "forge" }]
  }, null, 2)}\n`);

  await assert.rejects(
    createSourceIndexPackage({
      root,
      payloadJson: payloadPath,
      minecraftVersion: "1.20.1",
      loader: "neoforge",
      mappings: "mojmap"
    }),
    /Payload files must match/
  );
});

function sourceIndexPayload() {
  return {
    files: [
      {
        minecraftVersion: "1.20.1",
        loader: "neoforge",
        mappings: "mojmap",
        className: "net.minecraft.world.item.ItemStack",
        packageName: "net.minecraft.world.item",
        sourcePath: "net/minecraft/world/item/ItemStack.java",
        sha256: "0".repeat(64),
        summary: "Allowed local source-index metadata for ItemStack.",
        javaMembers: [
          {
            memberName: "copy",
            memberKind: "method",
            signature: "copy()",
            returnType: "ItemStack",
            startLine: 3,
            endLine: 5
          }
        ]
      }
    ],
    sourceChunks: [
      {
        path: "net/minecraft/world/item/ItemStack.java",
        chunkId: "copy-method",
        chunkType: "code_window",
        startLine: 3,
        endLine: 5,
        content: "public ItemStack copy() { return this; }"
      }
    ]
  };
}
