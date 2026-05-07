import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

export function writeSqliteSourceIndexDatabase(input) {
  const { DatabaseSync } = require("node:sqlite");
  const database = new DatabaseSync(input.databasePath);
  try {
    database.exec(schemaSql(input.userVersion));
    database.prepare("INSERT INTO meta(key, value) VALUES (?, ?)").run(
      "package_id",
      input.packageId
    );

    const insertFile = database.prepare([
      "INSERT INTO files",
      "(path, kind, size_bytes, sha256, package_id)",
      "VALUES (?, ?, ?, ?, ?)"
    ].join(" "));
    const insertFileText = database.prepare(
      "INSERT INTO fts_files(path, content) VALUES (?, ?)"
    );
    const insertSymbol = database.prepare([
      "INSERT INTO java_symbols",
      "(path, package_name, simple_name, qualified_name)",
      "VALUES (?, ?, ?, ?)"
    ].join(" "));
    const insertMember = database.prepare([
      "INSERT INTO java_members",
      "(path, package_name, owner_simple_name, owner_qualified_name,",
      "member_name, member_kind, signature, return_type, start_line, end_line)",
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ].join(" "));
    const insertChunk = database.prepare([
      "INSERT INTO source_chunks",
      "(path, chunk_id, chunk_type, start_line, end_line, token_count, content)",
      "VALUES (?, ?, ?, ?, ?, ?, ?)"
    ].join(" "));
    const insertChunkText = database.prepare([
      "INSERT INTO fts_chunks",
      "(path, chunk_id, content)",
      "VALUES (?, ?, ?)"
    ].join(" "));

    const files = input.files.map(normalizeSourceFile);
    const symbols = [
      ...files.map(fileSymbol),
      ...(input.javaSymbols ?? []).map(normalizeJavaSymbol)
    ];
    const members = [
      ...files.flatMap((file) => file.members),
      ...(input.javaMembers ?? []).map((member) => normalizeJavaMember(member))
    ];
    const chunks = [
      ...files.map(fileSummaryChunk),
      ...(input.sourceChunks ?? []).map(normalizeSourceChunk)
    ];

    database.exec("BEGIN");
    for (const entry of files) {
      insertFile.run(
        entry.sourcePath,
        "java",
        entry.sizeBytes,
        entry.sha256,
        input.packageId
      );
      insertFileText.run(entry.sourcePath, entry.searchText);
    }
    for (const symbol of symbols) {
      insertSymbol.run(
        symbol.path,
        symbol.packageName,
        symbol.simpleName,
        symbol.qualifiedName
      );
    }
    for (const chunk of chunks) {
      insertChunk.run(
        chunk.path,
        chunk.chunkId,
        chunk.chunkType,
        chunk.startLine,
        chunk.endLine,
        chunk.tokenCount,
        chunk.content
      );
      insertChunkText.run(
        chunk.path,
        chunk.chunkId,
        chunk.content
      );
    }
    for (const member of members) {
      insertMember.run(
        member.path,
        member.packageName,
        member.ownerSimpleName,
        member.ownerQualifiedName,
        member.memberName,
        member.memberKind,
        member.signature,
        member.returnType,
        member.startLine,
        member.endLine
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
    "PRAGMA foreign_keys = ON;",
    "CREATE TABLE meta (",
    "key TEXT PRIMARY KEY,",
    "value TEXT NOT NULL",
    ")",
    ";",
    "CREATE TABLE files (",
    "path TEXT PRIMARY KEY,",
    "kind TEXT NOT NULL,",
    "size_bytes INTEGER NOT NULL,",
    "sha256 TEXT NOT NULL,",
    "package_id TEXT",
    ")",
    ";",
    "CREATE TABLE java_symbols (",
    "path TEXT NOT NULL,",
    "package_name TEXT,",
    "simple_name TEXT NOT NULL,",
    "qualified_name TEXT NOT NULL,",
    "FOREIGN KEY(path) REFERENCES files(path) ON DELETE CASCADE",
    ")",
    ";",
    "CREATE INDEX idx_java_symbols_simple_name ON java_symbols(simple_name)",
    ";",
    "CREATE TABLE java_members (",
    "path TEXT NOT NULL,",
    "package_name TEXT,",
    "owner_simple_name TEXT NOT NULL,",
    "owner_qualified_name TEXT NOT NULL,",
    "member_name TEXT NOT NULL,",
    "member_kind TEXT NOT NULL,",
    "signature TEXT,",
    "return_type TEXT,",
    "start_line INTEGER NOT NULL,",
    "end_line INTEGER NOT NULL,",
    "FOREIGN KEY(path) REFERENCES files(path) ON DELETE CASCADE",
    ")",
    ";",
    "CREATE INDEX idx_java_members_member_name ON java_members(member_name)",
    ";",
    "CREATE INDEX idx_java_members_member_kind ON java_members(member_name, member_kind)",
    ";",
    "CREATE INDEX idx_java_members_owner_member ON java_members(owner_qualified_name, member_name)",
    ";",
    "CREATE INDEX idx_java_members_owner_member_kind ON java_members(owner_qualified_name, member_name, member_kind)",
    ";",
    "CREATE VIRTUAL TABLE fts_files USING fts5(path UNINDEXED, content)",
    ";",
    "CREATE TABLE source_chunks (",
    "path TEXT NOT NULL,",
    "chunk_id TEXT NOT NULL,",
    "chunk_type TEXT NOT NULL,",
    "start_line INTEGER NOT NULL,",
    "end_line INTEGER NOT NULL,",
    "token_count INTEGER NOT NULL,",
    "content TEXT NOT NULL,",
    "PRIMARY KEY(path, chunk_id),",
    "FOREIGN KEY(path) REFERENCES files(path) ON DELETE CASCADE",
    ")",
    ";",
    "CREATE VIRTUAL TABLE fts_chunks USING fts5(path UNINDEXED, chunk_id UNINDEXED, content)"
  ].join(" ");
}

function normalizeSourceFile(entry) {
  const className = requireString(entry.className, "source file className");
  const packageName = requireString(entry.packageName, "source file packageName");
  const summary = typeof entry.summary === "string" ? entry.summary : "";
  const sourcePath = requireString(entry.sourcePath ?? entry.path, "source file sourcePath");
  const simpleName = className.split(".").at(-1) ?? className;
  return {
    id: entry.id ?? className,
    minecraftVersion: requireString(entry.minecraftVersion, "source file minecraftVersion"),
    loader: requireString(entry.loader, "source file loader"),
    mappings: requireString(entry.mappings, "source file mappings"),
    className,
    packageName,
    simpleName,
    sourcePath,
    sha256: requireString(entry.sha256, "source file sha256"),
    summary,
    searchText: [
      className,
      packageName,
      sourcePath,
      summary
    ].join("\n"),
    sizeBytes: Buffer.byteLength(summary, "utf8"),
    members: Array.isArray(entry.javaMembers)
      ? entry.javaMembers.map((member) => normalizeJavaMember(member, {
        path: sourcePath,
        packageName,
        ownerSimpleName: simpleName,
        ownerQualifiedName: className
      }))
      : []
  };
}

function fileSymbol(file) {
  return {
    path: file.sourcePath,
    packageName: file.packageName,
    simpleName: file.simpleName,
    qualifiedName: file.className
  };
}

function fileSummaryChunk(file) {
  return {
    path: file.sourcePath,
    chunkId: "metadata-summary",
    chunkType: "file_head",
    startLine: 1,
    endLine: Math.max(1, file.summary.split(/\r?\n/u).length),
    tokenCount: countTokens(file.summary),
    content: file.summary
  };
}

function normalizeJavaSymbol(symbol) {
  const qualifiedName = requireString(symbol.qualifiedName, "source java symbol qualifiedName");
  return {
    path: requireString(symbol.path ?? symbol.sourcePath, "source java symbol path"),
    packageName: optionalString(symbol.packageName) ?? packageNameFromQualifiedName(qualifiedName) ?? null,
    simpleName: optionalString(symbol.simpleName) ?? simpleNameFromQualifiedName(qualifiedName),
    qualifiedName
  };
}

function normalizeJavaMember(member, defaults = {}) {
  const memberName = requireString(member.memberName, "source java member memberName");
  const memberKind = requireMemberKind(member.memberKind);
  return {
    path: requireString(member.path ?? member.sourcePath ?? defaults.path, "source java member path"),
    packageName: optionalString(member.packageName) ?? defaults.packageName ?? null,
    ownerSimpleName: requireString(
      member.ownerSimpleName ?? defaults.ownerSimpleName,
      "source java member ownerSimpleName"
    ),
    ownerQualifiedName: requireString(
      member.ownerQualifiedName ?? defaults.ownerQualifiedName,
      "source java member ownerQualifiedName"
    ),
    memberName,
    memberKind,
    signature: optionalString(member.signature) ?? memberName,
    returnType: optionalString(member.returnType) ?? null,
    startLine: optionalPositiveInteger(member.startLine) ?? 1,
    endLine: optionalPositiveInteger(member.endLine) ?? optionalPositiveInteger(member.startLine) ?? 1
  };
}

function normalizeSourceChunk(chunk) {
  const content = requireString(chunk.content, "source chunk content");
  return {
    path: requireString(chunk.path ?? chunk.sourcePath, "source chunk path"),
    chunkId: requireString(chunk.chunkId, "source chunk chunkId"),
    chunkType: optionalString(chunk.chunkType) ?? "code_window",
    startLine: optionalPositiveInteger(chunk.startLine) ?? 1,
    endLine: optionalPositiveInteger(chunk.endLine) ?? optionalPositiveInteger(chunk.startLine) ?? 1,
    tokenCount: optionalPositiveInteger(chunk.tokenCount) ?? countTokens(content),
    content
  };
}

function requireString(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value;
}

function optionalString(value) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function requireMemberKind(value) {
  if (value === "field" || value === "constructor" || value === "method") {
    return value;
  }
  throw new Error("source java member memberKind must be field, constructor, or method.");
}

function optionalPositiveInteger(value) {
  return Number.isInteger(value) && value > 0 ? value : undefined;
}

function simpleNameFromQualifiedName(qualifiedName) {
  return qualifiedName.split(".").at(-1) ?? qualifiedName;
}

function packageNameFromQualifiedName(qualifiedName) {
  const parts = qualifiedName.split(".");
  return parts.length > 1 ? parts.slice(0, -1).join(".") : undefined;
}

function countTokens(text) {
  return Math.max(1, text.split(/\s+/u).filter(Boolean).length);
}

function rollback(database) {
  try {
    database.exec("ROLLBACK");
  } catch {
    // Preserve the original build error.
  }
}
