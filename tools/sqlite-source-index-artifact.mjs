import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

export function writeSqliteSourceIndexDatabase(input) {
  const { DatabaseSync } = require("node:sqlite");
  const database = new DatabaseSync(input.databasePath);
  try {
    database.exec(schemaSql(input.userVersion));

    const insertFile = database.prepare([
      "INSERT INTO source_files",
      "(file_id, package_id, minecraft_version, loader, mappings, class_name,",
      "package_name, source_path, sha256, summary)",
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ].join(" "));
    const insertFts = database.prepare([
      "INSERT INTO source_files_fts",
      "(file_id, class_name, package_name, source_path, summary)",
      "VALUES (?, ?, ?, ?, ?)"
    ].join(" "));

    database.exec("BEGIN");
    for (const entry of input.files.map(normalizeSourceFile)) {
      insertFile.run(
        entry.id,
        input.packageId,
        entry.minecraftVersion,
        entry.loader,
        entry.mappings,
        entry.className,
        entry.packageName,
        entry.sourcePath,
        entry.sha256,
        entry.summary
      );
      insertFts.run(
        entry.id,
        entry.className,
        entry.packageName,
        entry.sourcePath,
        entry.summary
      );
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
    "CREATE TABLE source_files (",
    "file_id TEXT PRIMARY KEY,",
    "package_id TEXT NOT NULL,",
    "minecraft_version TEXT NOT NULL,",
    "loader TEXT NOT NULL,",
    "mappings TEXT NOT NULL,",
    "class_name TEXT NOT NULL,",
    "package_name TEXT NOT NULL,",
    "source_path TEXT NOT NULL,",
    "sha256 TEXT NOT NULL,",
    "summary TEXT NOT NULL",
    ")",
    ";",
    "CREATE VIRTUAL TABLE source_files_fts USING fts5(",
    "file_id UNINDEXED, class_name, package_name, source_path, summary",
    ")"
  ].join(" ");
}

function normalizeSourceFile(entry) {
  const className = requireString(entry.className, "source file className");
  return {
    id: entry.id ?? className,
    minecraftVersion: requireString(entry.minecraftVersion, "source file minecraftVersion"),
    loader: requireString(entry.loader, "source file loader"),
    mappings: requireString(entry.mappings, "source file mappings"),
    className,
    packageName: requireString(entry.packageName, "source file packageName"),
    sourcePath: requireString(entry.sourcePath, "source file sourcePath"),
    sha256: requireString(entry.sha256, "source file sha256"),
    summary: typeof entry.summary === "string" ? entry.summary : ""
  };
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
