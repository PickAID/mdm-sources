import { createHash } from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  stat,
  writeFile
} from "node:fs/promises";
import { dirname, isAbsolute, join, normalize, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export async function buildLocalRelease(input = {}) {
  const root = normalize(resolve(input.root ?? process.cwd()));
  const outDir = normalize(resolve(input.outDir ?? join(root, "release-out")));
  const packageFiles = await findPackageFiles(join(root, "packages"));
  const artifacts = [];
  const releasePackages = [];
  const generatedAt = input.builtAt ?? new Date().toISOString();

  await mkdir(outDir, { recursive: true });

  for (const packageFile of packageFiles) {
    const manifest = JSON.parse(await readFile(packageFile, "utf-8"));
    const packageInfo = normalizePackageManifest(manifest);
    const payloadRoot = resolveInside(root, dirname(packageFile), packageInfo.payloadRoot);
    if (!payloadRoot) {
      throw new Error(`Package ${packageInfo.id} payloadRoot escapes repository.`);
    }

    const payload = await readPayloadFiles(root, payloadRoot);
    const artifactName = `${packageInfo.id}-${packageInfo.version}.mdm-resource.json`;
    const artifactPath = join(outDir, artifactName);
    const artifactBody = stableJson({
      schemaVersion: packageInfo.schemaVersion,
      package: manifest,
      payload
    });
    const sha256 = createHash("sha256").update(artifactBody).digest("hex");
    const sizeBytes = Buffer.byteLength(artifactBody);

    await writeFile(artifactPath, artifactBody);
    await updateRegistryRelease(root, packageInfo, {
      artifactName,
      sha256,
      sizeBytes,
      builtAt: generatedAt
    });

    artifacts.push({
      packageId: packageInfo.id,
      artifactName,
      artifactPath,
      sha256,
      sizeBytes
    });
    releasePackages.push({
      packageId: packageInfo.id,
      version: packageInfo.version,
      namespace: packageInfo.namespace,
      artifactType: packageInfo.artifactType,
      variant: packageInfo.variant,
      required: packageInfo.required,
      format: packageInfo.format,
      releaseChannel: packageInfo.releaseChannel,
      releaseFamily: packageInfo.releaseFamily,
      capabilities: packageInfo.capabilities,
      artifactName,
      sha256,
      sizeBytes
    });
  }

  const manifestPath = join(outDir, "mdm-release-manifest.json");
  await writeFile(
    manifestPath,
    stableJson(buildReleaseManifest(releasePackages, generatedAt))
  );

  return { artifacts, manifestPath };
}

function normalizePackageManifest(manifest) {
  if (manifest?.identity?.schemaVersion === 2) {
    return {
      schemaVersion: 2,
      id: manifest.identity.packageId,
      version: manifest.identity.packageVersion,
      namespace: manifest.identity.namespace,
      artifactType: mapV2ArtifactType(manifest.artifact.kind),
      variant: manifest.release.channel,
      required: manifest.release.channel === "required",
      format: manifest.artifact.format,
      payloadRoot: ".",
      releaseChannel: manifest.release.channel,
      releaseFamily: manifest.release.family,
      capabilities: manifest.capabilities
    };
  }

  return {
    schemaVersion: 1,
    id: manifest.id,
    version: manifest.version,
    namespace: manifest.namespace,
    artifactType: manifest.artifactType,
    variant: manifest.variant,
    required: manifest.required,
    format: manifest.format,
    payloadRoot: manifest.payloadRoot,
    releaseChannel: manifest.required ? "required" : "docs",
    releaseFamily: manifest.namespace,
    capabilities: manifest.capabilities ?? []
  };
}

function mapV2ArtifactType(kind) {
  if (kind === "datapack_bundle") {
    return "datapack";
  }
  if (kind === "resourcepack_bundle") {
    return "resourcepack";
  }
  if (kind === "mapping_bundle") {
    return "mappings";
  }
  if (kind === "embedding_bundle") {
    return "accelerator";
  }

  return "docs";
}

function buildReleaseManifest(packages, generatedAt) {
  return {
    schemaVersion: 1,
    generatedAt,
    packages
  };
}

async function updateRegistryRelease(root, manifest, currentRelease) {
  const registryPath = join(root, "registry", "index.json");
  const registry = JSON.parse(await readFile(registryPath, "utf-8"));
  const entry = registry.packages.find((item) => item.id === manifest.id);
  if (!entry) {
    throw new Error(`Registry entry missing for ${manifest.id}.`);
  }

  const detailPath = resolveRepoPath(root, entry.manifestPath);
  if (!detailPath) {
    throw new Error(`Registry detail path escapes repository for ${manifest.id}.`);
  }
  const detail = JSON.parse(await readFile(detailPath, "utf-8"));

  entry.currentRelease = currentRelease;
  detail.currentRelease = currentRelease;

  await writeJson(registryPath, registry);
  await writeJson(detailPath, detail);
}

async function readPayloadFiles(root, payloadRoot) {
  const files = [];
  await collectFiles(payloadRoot, files);
  const result = {};

  for (const filePath of files.sort()) {
    const rel = relative(payloadRoot, filePath).replaceAll("\\", "/");
    const repoRel = relative(root, filePath).replaceAll("\\", "/");
    result[rel] = {
      repoPath: repoRel,
      content: await readFile(filePath, "utf-8")
    };
  }

  return result;
}

async function collectFiles(directory, files) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      await collectFiles(entryPath, files);
    } else if (entry.isFile()) {
      files.push(entryPath);
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

function resolveInside(root, base, path) {
  const resolved = normalize(resolve(base, path));
  return isWithin(root, resolved) ? resolved : undefined;
}

function resolveRepoPath(root, path) {
  if (isAbsolute(path)) {
    return undefined;
  }
  const resolved = normalize(resolve(root, path));
  return isWithin(root, resolved) ? resolved : undefined;
}

function isWithin(parentPath, childPath) {
  const rel = relative(parentPath, childPath);
  return rel.length === 0 || (!rel.startsWith("..") && !isAbsolute(rel));
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

function stableJson(value) {
  return `${JSON.stringify(sortJson(value), null, 2)}\n`;
}

function sortJson(value) {
  if (Array.isArray(value)) {
    return value.map(sortJson);
  }
  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, sortJson(nested)])
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const outIndex = process.argv.indexOf("--out");
  const outDir = outIndex >= 0 ? process.argv[outIndex + 1] : undefined;
  const result = await buildLocalRelease({ root: process.cwd(), outDir });
  const stats = await Promise.all(
    result.artifacts.map(async (artifact) => ({
      ...artifact,
      sizeBytes: (await stat(artifact.artifactPath)).size
    }))
  );

  console.log(JSON.stringify({ artifacts: stats }, null, 2));
}
