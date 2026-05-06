import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

export function writeSqliteDocsDatabase(input) {
  const { DatabaseSync } = require("node:sqlite");
  const database = new DatabaseSync(input.databasePath);
  try {
    database.exec(schemaSql(input.userVersion));

    const insertEntry = database.prepare([
      "INSERT INTO docs_entries",
      "(entry_id, package_id, kind, title, path, headings, summary, search_terms,",
      "script_scopes, addon_names, event_names, code_symbols)",
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ].join(" "));
    const insertFts = database.prepare([
      "INSERT INTO docs_entries_fts",
      "(entry_id, title, path, summary, search_terms, script_scopes,",
      "addon_names, event_names, code_symbols)",
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ].join(" "));

    database.exec("BEGIN");
    for (const entry of input.entries.map(normalizeDocsEntry)) {
      insertDocsEntry({ database, insertEntry, insertFts, packageId: input.packageId, entry });
    }
    database.exec("COMMIT");
  } catch (error) {
    rollback(database);
    throw error;
  } finally {
    database.close();
  }
}

function schemaSql(userVersion) {
  return [
    `PRAGMA user_version = ${userVersion};`,
    "CREATE TABLE docs_entries (",
    "entry_id TEXT PRIMARY KEY,",
    "package_id TEXT NOT NULL,",
    "kind TEXT NOT NULL,",
    "title TEXT NOT NULL,",
    "path TEXT NOT NULL,",
    "headings TEXT NOT NULL,",
    "summary TEXT NOT NULL,",
    "search_terms TEXT NOT NULL,",
    "script_scopes TEXT NOT NULL,",
    "addon_names TEXT NOT NULL,",
    "event_names TEXT NOT NULL,",
    "code_symbols TEXT NOT NULL",
    ")",
    ";",
    "CREATE VIRTUAL TABLE docs_entries_fts USING fts5(",
    "entry_id UNINDEXED, title, path, summary, search_terms,",
    "script_scopes, addon_names, event_names, code_symbols",
    ")"
  ].join(" ");
}

function insertDocsEntry(input) {
  const path = input.entry.path ?? `${input.packageId}#${input.entry.id}`;
  const searchTerms = input.entry.searchTerms.length > 0
    ? input.entry.searchTerms
    : [input.entry.id, input.entry.title, input.entry.summary];

  input.insertEntry.run(
    input.entry.id,
    input.packageId,
    input.entry.kind,
    input.entry.title,
    path,
    JSON.stringify(input.entry.headings),
    input.entry.summary,
    JSON.stringify(searchTerms),
    JSON.stringify(input.entry.scriptScopes),
    JSON.stringify(input.entry.addonNames),
    JSON.stringify(input.entry.eventNames),
    JSON.stringify(input.entry.codeSymbols)
  );
  input.insertFts.run(
    input.entry.id,
    input.entry.title,
    path,
    input.entry.summary,
    searchTerms.join(" "),
    input.entry.scriptScopes.join(" "),
    input.entry.addonNames.join(" "),
    input.entry.eventNames.join(" "),
    input.entry.codeSymbols.join(" ")
  );
}

function normalizeDocsEntry(entry) {
  return {
    id: requireString(entry.id, "docs entry id"),
    kind: typeof entry.kind === "string" ? entry.kind : "concept",
    title: requireString(entry.title, "docs entry title"),
    path: typeof entry.path === "string" ? entry.path : undefined,
    headings: stringArray(entry.headings),
    summary: requireString(entry.summary, "docs entry summary"),
    searchTerms: stringArray(entry.searchTerms),
    scriptScopes: stringArray(entry.scriptScopes),
    addonNames: stringArray(entry.addonNames),
    eventNames: stringArray(entry.eventNames),
    codeSymbols: stringArray(entry.codeSymbols)
  };
}

function stringArray(value) {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new Error("docs sqlite entry array fields must contain only strings.");
  }

  return value;
}

function requireString(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }

  return value;
}

function rollback(database) {
  try {
    database.exec("ROLLBACK");
  } catch {
    // Preserve the original build error.
  }
}
