import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { writeSqliteDocsDatabase } from "../tools/sqlite-docs-artifact.mjs";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite");

test("writeSqliteDocsDatabase stores optional entry metadata without requiring it", async () => {
  const root = await mkdtemp(join(tmpdir(), "mdm-sqlite-docs-metadata-"));
  const databasePath = join(root, "docs.sqlite");

  writeSqliteDocsDatabase({
    databasePath,
    packageId: "vanilla-schema-docs",
    userVersion: 3,
    entries: [
      {
        id: "with-metadata",
        title: "With Metadata",
        summary: "Entry with schema evidence.",
        metadata: { upstreamPath: "mcdoc/example.mcdoc" }
      },
      {
        id: "without-metadata",
        title: "Without Metadata",
        summary: "Entry without schema evidence."
      }
    ]
  });

  const database = new DatabaseSync(databasePath);
  try {
    const rows = database
      .prepare("SELECT entry_id, metadata FROM docs_entries ORDER BY entry_id")
      .all()
      .map((row) => ({ entry_id: row.entry_id, metadata: row.metadata }));

    assert.deepEqual(rows, [
      {
        entry_id: "with-metadata",
        metadata: JSON.stringify({ upstreamPath: "mcdoc/example.mcdoc" })
      },
      {
        entry_id: "without-metadata",
        metadata: null
      }
    ]);
  } finally {
    database.close();
  }
});

test("writeSqliteDocsDatabase promotes top-level schema evidence into metadata", async () => {
  const root = await mkdtemp(join(tmpdir(), "mdm-sqlite-docs-schema-evidence-"));
  const databasePath = join(root, "docs.sqlite");

  writeSqliteDocsDatabase({
    databasePath,
    packageId: "vanilla-schema-docs",
    userVersion: 3,
    entries: [
      {
        id: "recipe-schema",
        title: "Recipe Schema",
        summary: "Entry with top-level schema evidence.",
        schemaSymbol: { identifier: "java/data/recipe", kind: "struct" },
        schemaDefinitionOutlines: [{ kind: "dispatch", name: "minecraft:resource[recipe]" }],
        upstreamPath: "java/data/recipe.mcdoc",
        contentHash: "sha256:test",
        metadata: { explicit: true }
      }
    ]
  });

  const database = new DatabaseSync(databasePath);
  try {
    const row = database
      .prepare("SELECT metadata FROM docs_entries WHERE entry_id = ?")
      .get("recipe-schema");

    assert.deepEqual(JSON.parse(row.metadata), {
      explicit: true,
      schemaDefinitionOutlines: [
        { kind: "dispatch", name: "minecraft:resource[recipe]" }
      ],
      schemaSymbol: { identifier: "java/data/recipe", kind: "struct" },
      upstreamPath: "java/data/recipe.mcdoc",
      contentHash: "sha256:test"
    });
  } finally {
    database.close();
  }
});

test("writeSqliteDocsDatabase rejects non-object entry metadata", async () => {
  const root = await mkdtemp(join(tmpdir(), "mdm-sqlite-docs-bad-metadata-"));
  const databasePath = join(root, "docs.sqlite");

  assert.throws(
    () =>
      writeSqliteDocsDatabase({
        databasePath,
        packageId: "vanilla-schema-docs",
        userVersion: 3,
        entries: [
          {
            id: "bad-metadata",
            title: "Bad Metadata",
            summary: "Entry with invalid metadata.",
            metadata: ["not", "object"]
          }
        ]
      }),
    /docs sqlite entry metadata must be an object/
  );
});
