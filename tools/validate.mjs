import { readdir, readFile, stat } from "node:fs/promises";
import { isAbsolute, join, normalize, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REQUIRED_PACKAGE_FIELDS = [
  "schemaVersion",
  "id",
  "namespace",
  "version",
  "artifactType",
  "variant",
  "required",
  "format",
  "payloadRoot",
  "description"
];

export async function validateRepository(root = process.cwd()) {
  const repoRoot = normalize(resolve(root));
  const errors = [];
  const packageFiles = await findPackageFiles(join(repoRoot, "packages"));

  for (const packageFile of packageFiles) {
    await validatePackageFile(repoRoot, packageFile, errors);
  }

  await validateRegistry(repoRoot, errors);

  return {
    packageCount: packageFiles.length,
    errors
  };
}

async function validatePackageFile(repoRoot, packageFile, errors) {
  const manifest = await readJson(packageFile, errors);
  if (!manifest) {
    return;
  }

  if (isV2PackageManifest(manifest)) {
    await validatePackageFileV2(repoRoot, packageFile, manifest, errors);
    return;
  }

  for (const field of REQUIRED_PACKAGE_FIELDS) {
    if (!(field in manifest)) {
      errors.push(`${toRepoPath(repoRoot, packageFile)} missing ${field}`);
    }
  }

  if (manifest.schemaVersion !== 1) {
    errors.push(`${toRepoPath(repoRoot, packageFile)} has unsupported schemaVersion`);
  }
  if (typeof manifest.id !== "string" || manifest.id.length === 0) {
    errors.push(`${toRepoPath(repoRoot, packageFile)} id must be a non-empty string`);
  }
  if (typeof manifest.required !== "boolean") {
    errors.push(`${toRepoPath(repoRoot, packageFile)} required must be boolean`);
  }
  if (typeof manifest.payloadRoot !== "string") {
    errors.push(`${toRepoPath(repoRoot, packageFile)} payloadRoot must be string`);
    return;
  }

  const payloadRoot = resolveInside(repoRoot, packageFile, manifest.payloadRoot);
  if (!payloadRoot || !(await pathIsDirectory(payloadRoot))) {
    errors.push(`${toRepoPath(repoRoot, packageFile)} payloadRoot is missing`);
  }
}

async function validatePackageFileV2(repoRoot, packageFile, manifest, errors) {
  const repoPath = toRepoPath(repoRoot, packageFile);
  const identity = requireRecordField(manifest, "identity", repoPath, errors);
  const target = requireRecordField(manifest, "target", repoPath, errors);
  const artifact = requireRecordField(manifest, "artifact", repoPath, errors);
  const policy = requireRecordField(manifest, "policy", repoPath, errors);
  const query = requireRecordField(manifest, "query", repoPath, errors);
  const release = requireRecordField(manifest, "release", repoPath, errors);

  if (!identity || !target || !artifact || !policy || !query || !release) {
    return;
  }
  if (identity.schemaVersion !== 2) {
    errors.push(`${repoPath} identity.schemaVersion must be 2`);
  }
  requireNonEmptyString(identity.packageId, `${repoPath} identity.packageId`, errors);
  requireNonEmptyString(identity.packageVersion, `${repoPath} identity.packageVersion`, errors);
  requireNonEmptyString(identity.namespace, `${repoPath} identity.namespace`, errors);
  requireNonEmptyString(identity.displayName, `${repoPath} identity.displayName`, errors);
  requireNonEmptyString(identity.description, `${repoPath} identity.description`, errors);
  validateOptionalStringArray(target.minecraftVersions, `${repoPath} target.minecraftVersions`, errors);
  validateOptionalStringArray(target.loaders, `${repoPath} target.loaders`, errors);
  validateOptionalStringArray(target.mappings, `${repoPath} target.mappings`, errors);
  requireAllowed(
    artifact.kind,
    [
      "docs_bundle",
      "source_tree",
      "source_index",
      "mapping_bundle",
      "datapack_bundle",
      "resourcepack_bundle",
      "probejs_snapshot",
      "mod_archive_index",
      "embedding_bundle"
    ],
    `${repoPath} artifact.kind`,
    errors
  );
  requireAllowed(
    artifact.format,
    ["json", "jsonl", "sqlite", "zip", "directory", "tar.zst"],
    `${repoPath} artifact.format`,
    errors
  );
  requireNonEmptyString(artifact.schemaId, `${repoPath} artifact.schemaId`, errors);
  if (typeof artifact.schemaVersion !== "number") {
    errors.push(`${repoPath} artifact.schemaVersion must be number`);
  }
  requireNonEmptyString(artifact.entrypoint, `${repoPath} artifact.entrypoint`, errors);
  if (typeof artifact.entrypoint === "string") {
    const entrypoint = resolveInside(repoRoot, packageFile, artifact.entrypoint);
    if (!entrypoint || !(await pathExists(entrypoint))) {
      errors.push(`${repoPath} artifact entrypoint is missing`);
    }
  }
  if (policy.privacy !== "public_release") {
    errors.push(`${repoPath} v2 public package privacy must be public_release`);
  }
  if (policy.canCommitToRepository !== true) {
    errors.push(`${repoPath} v2 public package canCommitToRepository must be true`);
  }
  if (policy.canUploadToPublicRelease !== true) {
    errors.push(`${repoPath} v2 public package canUploadToPublicRelease must be true`);
  }
  validateStringArray(manifest.capabilities, `${repoPath} capabilities`, errors);
  validateStringArray(query.capabilities, `${repoPath} query.capabilities`, errors);
  if (Array.isArray(manifest.capabilities) && Array.isArray(query.capabilities)) {
    for (const capability of query.capabilities) {
      if (!manifest.capabilities.includes(capability)) {
        errors.push(`${repoPath} query capability ${capability} is not declared`);
      }
    }
  }
  requireAllowed(
    query.adapter,
    [
      "json_docs",
      "sqlite_docs",
      "source_index_sqlite",
      "source_tree",
      "mapping_index",
      "archive_content",
      "embedding_index"
    ],
    `${repoPath} query.adapter`,
    errors
  );
  validateArtifactQueryPair(repoPath, artifact, query, errors);
  if (typeof query.defaultLimit !== "number" || typeof query.maxLimit !== "number") {
    errors.push(`${repoPath} query limits must be numbers`);
  } else if (query.defaultLimit > query.maxLimit) {
    errors.push(`${repoPath} query.defaultLimit must be <= query.maxLimit`);
  }
  requireAllowed(
    release.channel,
    ["required", "docs", "sources", "mappings", "datapack", "resourcepack", "accelerators"],
    `${repoPath} release.channel`,
    errors
  );
  requireNonEmptyString(release.family, `${repoPath} release.family`, errors);
}

function validateArtifactQueryPair(repoPath, artifact, query, errors) {
  if (
    artifact.kind === "docs_bundle" &&
    artifact.format === "sqlite" &&
    query.adapter !== "sqlite_docs"
  ) {
    errors.push(`${repoPath} sqlite docs packages must use sqlite_docs adapter`);
  }
  if (
    artifact.kind === "docs_bundle" &&
    artifact.format !== "sqlite" &&
    query.adapter === "sqlite_docs"
  ) {
    errors.push(`${repoPath} sqlite_docs adapter requires sqlite docs artifact`);
  }
}

async function validateRegistry(repoRoot, errors) {
  const registryPath = join(repoRoot, "registry", "index.json");
  const registry = await readJson(registryPath, errors);
  if (!registry) {
    errors.push("registry/index.json is missing");
    return;
  }
  if (!Array.isArray(registry.packages)) {
    errors.push("registry/index.json packages must be an array");
    return;
  }

  for (const entry of registry.packages) {
    if (!isRecord(entry)) {
      errors.push("registry package entry must be an object");
      continue;
    }
    const manifestPath = entry.manifestPath;
    if (typeof manifestPath !== "string") {
      errors.push(`registry package ${String(entry.id)} missing manifestPath`);
      continue;
    }

    const detailPath = resolveRepoPath(repoRoot, manifestPath);
    if (!detailPath || !(await pathIsFile(detailPath))) {
      errors.push(`registry package ${String(entry.id)} detail file is missing`);
      continue;
    }

    const detail = await readJson(detailPath, errors);
    if (!detail) {
      continue;
    }
    if (detail.id !== entry.id) {
      errors.push(`registry package ${String(entry.id)} detail id mismatch`);
    }
    if (typeof detail.sourcePath !== "string") {
      errors.push(`registry package ${String(entry.id)} detail missing sourcePath`);
      continue;
    }

    const sourcePath = resolveRepoPath(repoRoot, detail.sourcePath);
    if (!sourcePath || !(await pathIsFile(sourcePath))) {
      errors.push(`registry package ${String(entry.id)} source file is missing`);
    }
  }
}

async function findPackageFiles(root) {
  const files = [];
  await walk(root, files);
  return files.filter((filePath) => filePath.endsWith("/package.json")).sort();
}

async function walk(directory, files) {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      await walk(entryPath, files);
    } else if (entry.isFile()) {
      files.push(entryPath);
    }
  }
}

async function readJson(path, errors) {
  try {
    return JSON.parse(await readFile(path, "utf-8"));
  } catch (error) {
    errors.push(`${path} cannot be read as JSON: ${error.message}`);
    return undefined;
  }
}

function resolveInside(repoRoot, baseFile, relativePath) {
  const baseDir = baseFile.endsWith("/") ? baseFile : join(baseFile, "..");
  const resolved = normalize(resolve(baseDir, relativePath));
  return isWithin(repoRoot, resolved) ? resolved : undefined;
}

function resolveRepoPath(repoRoot, relativePath) {
  if (isAbsolute(relativePath)) {
    return undefined;
  }

  const resolved = normalize(resolve(repoRoot, relativePath));
  return isWithin(repoRoot, resolved) ? resolved : undefined;
}

function isWithin(parentPath, childPath) {
  const rel = relative(parentPath, childPath);
  return rel.length === 0 || (!rel.startsWith("..") && !isAbsolute(rel));
}

async function pathExists(path) {
  return stat(path)
    .then(() => true)
    .catch(() => false);
}

async function pathIsDirectory(path) {
  return stat(path)
    .then((details) => details.isDirectory())
    .catch(() => false);
}

async function pathIsFile(path) {
  return stat(path)
    .then((details) => details.isFile())
    .catch(() => false);
}

function toRepoPath(repoRoot, path) {
  return relative(repoRoot, path).replaceAll("\\", "/");
}

function isRecord(value) {
  return typeof value === "object" && value !== null;
}

function isV2PackageManifest(value) {
  return isRecord(value) && isRecord(value.identity) && value.identity.schemaVersion === 2;
}

function requireRecordField(record, field, path, errors) {
  const value = record[field];
  if (!isRecord(value)) {
    errors.push(`${path} ${field} must be object`);
    return undefined;
  }

  return value;
}

function requireNonEmptyString(value, path, errors) {
  if (typeof value !== "string" || value.length === 0) {
    errors.push(`${path} must be a non-empty string`);
  }
}

function requireAllowed(value, allowed, path, errors) {
  if (typeof value !== "string" || !allowed.includes(value)) {
    errors.push(`${path} must be one of ${allowed.join(", ")}`);
  }
}

function validateStringArray(value, path, errors) {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    errors.push(`${path} must be an array of strings`);
  }
}

function validateOptionalStringArray(value, path, errors) {
  if (value !== undefined) {
    validateStringArray(value, path, errors);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await validateRepository(process.cwd());
  for (const error of result.errors) {
    console.error(error);
  }
  console.log(
    JSON.stringify(
      {
        packageCount: result.packageCount,
        errorCount: result.errors.length
      },
      null,
      2
    )
  );
  process.exitCode = result.errors.length === 0 ? 0 : 1;
}
