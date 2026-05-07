import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { validateJsonSchemaSubset } from "./json-schema-subset.mjs";

const schemaRoot = dirname(dirname(fileURLToPath(import.meta.url)));

export async function validateSourceIndexPayload(repoPath, entrypoint, errors) {
  const payload = await readJson(entrypoint, errors);
  if (!payload || !isRecord(payload)) {
    errors.push(`${repoPath} source index payload must be object`);
    return;
  }
  const schema = await readJson(
    join(schemaRoot, "schema/source-index-payload.schema.json"),
    errors
  );
  if (schema) {
    errors.push(
      ...validateJsonSchemaSubset(schema, payload, {
        path: `${repoPath} source index payload`
      })
    );
  }

  const files = optionalArray(payload.files, `${repoPath} source files`, errors);
  const javaSymbols = optionalArray(payload.javaSymbols, `${repoPath} source java symbols`, errors);
  const javaMembers = optionalArray(payload.javaMembers, `${repoPath} source java members`, errors);
  const sourceChunks = optionalArray(payload.sourceChunks, `${repoPath} source chunks`, errors);

  for (const file of files) {
    validateSourceFile(repoPath, file, errors);
  }
  for (const symbol of javaSymbols) {
    validateJavaSymbol(repoPath, symbol, errors);
  }
  for (const member of javaMembers) {
    validateJavaMember(repoPath, member, errors);
  }
  for (const chunk of sourceChunks) {
    validateSourceChunk(repoPath, chunk, errors);
  }
}

function validateSourceFile(repoPath, file, errors) {
  if (!isRecord(file)) {
    errors.push(`${repoPath} source file must be object`);
    return;
  }
  requireNonEmptyString(file.className, `${repoPath} source file className`, errors);
  requireNonEmptyString(file.packageName, `${repoPath} source file packageName`, errors);
  requireNonEmptyString(
    file.sourcePath ?? file.path,
    `${repoPath} source file sourcePath`,
    errors
  );
  requireNonEmptyString(file.minecraftVersion, `${repoPath} source file minecraftVersion`, errors);
  requireNonEmptyString(file.loader, `${repoPath} source file loader`, errors);
  requireNonEmptyString(file.mappings, `${repoPath} source file mappings`, errors);
  requireNonEmptyString(file.sha256, `${repoPath} source file sha256`, errors);

  const members = optionalArray(file.javaMembers, `${repoPath} source file javaMembers`, errors);
  for (const member of members) {
    validateJavaMember(repoPath, member, errors, {
      path: file.sourcePath ?? file.path,
      packageName: file.packageName,
      ownerSimpleName: simpleNameFromQualifiedName(file.className),
      ownerQualifiedName: file.className
    });
  }
}

function validateJavaSymbol(repoPath, symbol, errors) {
  if (!isRecord(symbol)) {
    errors.push(`${repoPath} source java symbol must be object`);
    return;
  }
  requireNonEmptyString(
    symbol.path ?? symbol.sourcePath,
    `${repoPath} source java symbol path`,
    errors
  );
  requireNonEmptyString(symbol.qualifiedName, `${repoPath} source java symbol qualifiedName`, errors);
}

function validateJavaMember(repoPath, member, errors, defaults = {}) {
  if (!isRecord(member)) {
    errors.push(`${repoPath} source java member must be object`);
    return;
  }
  requireNonEmptyString(
    member.path ?? member.sourcePath ?? defaults.path,
    `${repoPath} source java member path`,
    errors
  );
  requireNonEmptyString(
    member.ownerSimpleName ?? defaults.ownerSimpleName,
    `${repoPath} source java member ownerSimpleName`,
    errors
  );
  requireNonEmptyString(
    member.ownerQualifiedName ?? defaults.ownerQualifiedName,
    `${repoPath} source java member ownerQualifiedName`,
    errors
  );
  requireNonEmptyString(member.memberName, `${repoPath} source java member memberName`, errors);
  if (!["field", "constructor", "method"].includes(member.memberKind)) {
    errors.push(
      `${repoPath} source java member memberKind must be field, constructor, or method.`
    );
  }
}

function validateSourceChunk(repoPath, chunk, errors) {
  if (!isRecord(chunk)) {
    errors.push(`${repoPath} source chunk must be object`);
    return;
  }
  requireNonEmptyString(
    chunk.path ?? chunk.sourcePath,
    `${repoPath} source chunk path`,
    errors
  );
  requireNonEmptyString(chunk.chunkId, `${repoPath} source chunk chunkId`, errors);
  requireNonEmptyString(chunk.content, `${repoPath} source chunk content`, errors);
}

async function readJson(path, errors) {
  try {
    return JSON.parse(await readFile(path, "utf-8"));
  } catch (error) {
    errors.push(`${path} cannot be read as JSON: ${error.message}`);
    return undefined;
  }
}

function requireNonEmptyString(value, path, errors) {
  if (typeof value !== "string" || value.length === 0) {
    errors.push(`${path} must be a non-empty string`);
  }
}

function optionalArray(value, path, errors) {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    errors.push(`${path} must be an array`);
    return [];
  }
  return value;
}

function isRecord(value) {
  return typeof value === "object" && value !== null;
}

function simpleNameFromQualifiedName(value) {
  return typeof value === "string" ? value.split(".").at(-1) : undefined;
}
