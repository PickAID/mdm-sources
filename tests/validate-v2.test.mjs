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

async function writeV2Fixture(root, manifest, options = {}) {
  const packageRoot = join(root, "packages/docs/core/required-v2");
  await mkdir(join(packageRoot, "payload"), { recursive: true });
  await mkdir(join(root, "registry/packages"), { recursive: true });
  if (options.writePayload !== false) {
    await writeFile(join(packageRoot, "payload/core-docs.json"), "{}\n");
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
