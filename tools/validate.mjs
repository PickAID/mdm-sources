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
