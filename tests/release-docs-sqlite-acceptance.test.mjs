import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { buildLocalRelease } from "../tools/build-local-release.mjs";
import { verifyReleaseInstall } from "../tools/verify-release-install.mjs";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite");

test("docs channel release builds installable sqlite docs with metadata column", async () => {
  const outDir = await mkdtemp(join(tmpdir(), "mdm-docs-sqlite-acceptance-"));
  const release = await buildLocalRelease({
    root: process.cwd(),
    outDir,
    releaseChannels: ["docs"],
    writeRegistry: false,
    builtAt: "2026-05-10T00:00:00.000Z"
  });

  const sqliteArtifact = release.artifacts.find((artifact) => {
    return artifact.artifactName === "core-docs-search-sqlite-0.1.0.sqlite";
  });
  assert.ok(sqliteArtifact, "core docs sqlite artifact must be built");
  assert.ok(hasColumn(sqliteArtifact.artifactPath, "docs_entries", "metadata"));
  assertDocsSqliteArtifact(release, "vanilla-schema-docs-0.1.0.sqlite", {
    query: "recipe",
    metadataKey: "schemaSymbol"
  });
  assertDocsSqliteArtifact(release, "misode-generator-catalog-0.1.0.sqlite", {
    query: "recipe",
    metadataKey: "generator"
  });

  const install = await verifyReleaseInstall({ manifest: release.manifestPath });
  assert.ok(
    install.packages.some((entry) => {
      return entry.packageId === "core-docs-search-sqlite" &&
        entry.format === "sqlite";
    })
  );
});

function assertDocsSqliteArtifact(release, artifactName, input) {
  const artifact = release.artifacts.find((candidate) => {
    return candidate.artifactName === artifactName;
  });
  assert.ok(artifact, `${artifactName} must be built`);
  assert.ok(hasColumn(artifact.artifactPath, "docs_entries", "metadata"));
  assert.ok(
    findMetadataBySearchTerm(artifact.artifactPath, input.query, input.metadataKey),
    `${artifactName} must preserve ${input.metadataKey} metadata`
  );
}

test("docs channel bundle keeps sqlite docs metadata column installable", async () => {
  const outDir = await mkdtemp(join(tmpdir(), "mdm-docs-sqlite-bundle-"));
  const release = await buildLocalRelease({
    root: process.cwd(),
    outDir,
    bundleChannels: ["docs"],
    writeRegistry: false,
    builtAt: "2026-05-10T00:00:00.000Z"
  });

  assert.ok(
    release.bundles.some((bundle) => bundle.bundleName === "docs.mdm-bundle")
  );
  const install = await verifyReleaseInstall({ manifest: release.manifestPath });
  assert.ok(
    install.packages.some((entry) => {
      return entry.packageId === "core-docs-search-sqlite" &&
        entry.bundleName === "docs.mdm-bundle";
    })
  );
});

function hasColumn(databasePath, tableName, columnName) {
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    return database
      .prepare(`PRAGMA table_info(${tableName})`)
      .all()
      .some((row) => row.name === columnName);
  } finally {
    database.close();
  }
}

function findMetadataBySearchTerm(databasePath, query, metadataKey) {
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    return database
      .prepare(
        "SELECT metadata FROM docs_entries WHERE search_terms LIKE ? AND metadata IS NOT NULL"
      )
      .all(`%${query}%`)
      .some((row) => {
        return Object.hasOwn(JSON.parse(row.metadata), metadataKey);
      });
  } finally {
    database.close();
  }
}
