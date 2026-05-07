import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { validateRepository } from "../tools/validate.mjs";

test("validateRepository accepts public package v2 manifests", async () => {
  const root = await mkdtemp(join(tmpdir(), "mdm-sources-v2-"));
  await writeV2Fixture(root, validV2Package());

  const result = await validateRepository(root);

  assert.deepEqual(result.errors, []);
  assert.equal(result.packageCount, 1);
});

test("validateRepository rejects private package v2 manifests in public repo", async () => {
  const root = await mkdtemp(join(tmpdir(), "mdm-sources-v2-private-"));
  await writeV2Fixture(root, {
    ...validV2Package(),
    policy: {
      privacy: "user_private",
      lifecycle: ["generated_on_demand", "evictable"],
      canCommitToRepository: false,
      canUploadToPublicRelease: false,
      requiresUserConsent: true
    }
  });

  const result = await validateRepository(root);

  assert.match(result.errors.join("\n"), /v2 public package privacy must be public_release/);
});

test("validateRepository rejects v2 query capabilities outside package capabilities", async () => {
  const root = await mkdtemp(join(tmpdir(), "mdm-sources-v2-query-"));
  await writeV2Fixture(root, {
    ...validV2Package(),
    query: {
      ...validV2Package().query,
      capabilities: ["docs_search", "source_lookup"]
    }
  });

  const result = await validateRepository(root);

  assert.match(result.errors.join("\n"), /query capability source_lookup is not declared/);
});

test("validateRepository rejects missing v2 artifact entrypoints", async () => {
  const root = await mkdtemp(join(tmpdir(), "mdm-sources-v2-entrypoint-"));
  await writeV2Fixture(root, validV2Package(), { writePayload: false });

  const result = await validateRepository(root);

  assert.match(result.errors.join("\n"), /artifact entrypoint is missing/);
});

test("validateRepository rejects v2 manifests without target metadata", async () => {
  const root = await mkdtemp(join(tmpdir(), "mdm-sources-v2-target-"));
  const { target: _target, ...manifest } = validV2Package();
  await writeV2Fixture(root, manifest);

  const result = await validateRepository(root);

  assert.match(result.errors.join("\n"), /target must be object/);
});

test("validateRepository accepts sqlite docs packages with sqlite_docs adapter", async () => {
  const root = await mkdtemp(join(tmpdir(), "mdm-sources-v2-sqlite-docs-"));
  await writeV2Fixture(root, {
    ...validV2Package(),
    artifact: {
      kind: "docs_bundle",
      format: "sqlite",
      schemaId: "mdm.docs.sqlite",
      schemaVersion: 1,
      entrypoint: "payload/core-docs.json"
    },
    query: {
      ...validV2Package().query,
      adapter: "sqlite_docs"
    }
  });

  const result = await validateRepository(root);

  assert.deepEqual(result.errors, []);
});

test("validateRepository rejects sqlite docs packages without sqlite_docs adapter", async () => {
  const root = await mkdtemp(join(tmpdir(), "mdm-sources-v2-sqlite-mismatch-"));
  await writeV2Fixture(root, {
    ...validV2Package(),
    artifact: {
      kind: "docs_bundle",
      format: "sqlite",
      schemaId: "mdm.docs.sqlite",
      schemaVersion: 1,
      entrypoint: "payload/core-docs.json"
    }
  });

  const result = await validateRepository(root);

  assert.match(
    result.errors.join("\n"),
    /sqlite docs packages must use sqlite_docs adapter/
  );
});

test("validateRepository accepts sqlite source index packages", async () => {
  const root = await mkdtemp(join(tmpdir(), "mdm-sources-v2-source-index-"));
  await writeV2Fixture(root, validSourceIndexPackage());

  const result = await validateRepository(root);

  assert.deepEqual(result.errors, []);
});

test("validateRepository rejects source index java members without a path", async () => {
  const root = await mkdtemp(join(tmpdir(), "mdm-sources-v2-source-index-member-path-"));
  await writeV2Fixture(root, validSourceIndexPackage(), {
    payload: {
      javaMembers: [
        {
          ownerSimpleName: "ItemStack",
          ownerQualifiedName: "net.minecraft.world.item.ItemStack",
          memberName: "copy",
          memberKind: "method"
        }
      ]
    }
  });

  const result = await validateRepository(root);

  assert.match(
    result.errors.join("\n"),
    /source java member path must be a non-empty string/
  );
});

test("validateRepository rejects source index java members with invalid kinds", async () => {
  const root = await mkdtemp(join(tmpdir(), "mdm-sources-v2-source-index-member-kind-"));
  await writeV2Fixture(root, validSourceIndexPackage(), {
    payload: {
      javaMembers: [
        {
          path: "net/minecraft/world/item/ItemStack.java",
          ownerSimpleName: "ItemStack",
          ownerQualifiedName: "net.minecraft.world.item.ItemStack",
          memberName: "copy",
          memberKind: "function"
        }
      ]
    }
  });

  const result = await validateRepository(root);

  assert.match(
    result.errors.join("\n"),
    /source java member memberKind must be field, constructor, or method/
  );
});

test("validateRepository rejects source index chunks without content or chunk ids", async () => {
  const root = await mkdtemp(join(tmpdir(), "mdm-sources-v2-source-index-chunk-"));
  await writeV2Fixture(root, validSourceIndexPackage(), {
    payload: {
      sourceChunks: [
        {
          path: "net/minecraft/world/item/ItemStack.java",
          chunkId: "durability-rules"
        },
        {
          path: "net/minecraft/world/item/ItemStack.java",
          content: "Durability metadata."
        }
      ]
    }
  });

  const result = await validateRepository(root);

  assert.match(result.errors.join("\n"), /source chunk content must be a non-empty string/);
  assert.match(result.errors.join("\n"), /source chunk chunkId must be a non-empty string/);
});

test("validateRepository rejects source_index_sqlite without sqlite source_index", async () => {
  const root = await mkdtemp(join(tmpdir(), "mdm-sources-v2-source-index-mismatch-"));
  await writeV2Fixture(root, {
    ...validV2Package(),
    query: {
      ...validV2Package().query,
      adapter: "source_index_sqlite"
    }
  });

  const result = await validateRepository(root);

  assert.match(
    result.errors.join("\n"),
    /source_index_sqlite adapter requires sqlite source_index artifact/
  );
});

async function writeV2Fixture(root, manifest, options = {}) {
  const packageRoot = join(root, "packages/docs/core/required-v2");
  await mkdir(join(packageRoot, "payload"), { recursive: true });
  await mkdir(join(root, "registry/packages"), { recursive: true });
  if (options.writePayload !== false) {
    await writeFile(
      join(packageRoot, "payload/core-docs.json"),
      JSON.stringify(options.payload ?? {}, null, 2)
    );
  }
  await writeFile(
    join(packageRoot, "package.json"),
    JSON.stringify(manifest, null, 2)
  );
  await writeFile(
    join(root, "registry/index.json"),
    JSON.stringify(
      {
        schemaVersion: 1,
        packages: [
          {
            id: manifest.identity.packageId,
            manifestPath: `registry/packages/${manifest.identity.packageId}.json`,
            required: true,
            format: manifest.artifact.format
          }
        ]
      },
      null,
      2
    )
  );
  await writeFile(
    join(root, "registry/packages", `${manifest.identity.packageId}.json`),
    JSON.stringify(
      {
        schemaVersion: 1,
        id: manifest.identity.packageId,
        sourcePath: "packages/docs/core/required-v2/package.json",
        currentRelease: null
      },
      null,
      2
    )
  );
}

function validV2Package() {
  return {
    identity: {
      schemaVersion: 2,
      packageId: "core-docs-required-v2",
      packageVersion: "0.2.0",
      namespace: "core",
      displayName: "Core Docs Required v2",
      description: "Compact public guidance package."
    },
    target: {
      minecraftVersions: ["1.20.1"],
      loaders: ["vanilla"]
    },
    artifact: {
      kind: "docs_bundle",
      format: "json",
      schemaId: "mdm.docs.json",
      schemaVersion: 1,
      entrypoint: "payload/core-docs.json"
    },
    capabilities: ["docs_search", "docs_direct_read"],
    policy: {
      privacy: "public_release",
      lifecycle: ["downloadable", "pinned"],
      canCommitToRepository: true,
      canUploadToPublicRelease: true,
      requiresUserConsent: false
    },
    query: {
      adapter: "json_docs",
      capabilities: ["docs_search", "docs_direct_read"],
      defaultLimit: 8,
      maxLimit: 50,
      preferredFallbacks: []
    },
    release: {
      channel: "required",
      family: "core-docs"
    }
  };
}

function validSourceIndexPackage() {
  return {
    ...validV2Package(),
    artifact: {
      kind: "source_index",
      format: "sqlite",
      schemaId: "mdm.source.index.sqlite",
      schemaVersion: 1,
      entrypoint: "payload/core-docs.json"
    },
    capabilities: ["source_lookup", "source_chunk_search"],
    query: {
      ...validV2Package().query,
      adapter: "source_index_sqlite",
      capabilities: ["source_lookup", "source_chunk_search"]
    },
    release: {
      channel: "sources",
      family: "vanilla-source-index"
    }
  };
}
