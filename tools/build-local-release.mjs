import { createHash } from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  stat,
  rm,
  writeFile
} from "node:fs/promises";
import { dirname, isAbsolute, join, normalize, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { writeReleaseSummary } from "./release-summary.mjs";
import { writeSqliteDocsDatabase } from "./sqlite-docs-artifact.mjs";
import { writeSqliteSourceIndexDatabase } from "./sqlite-source-index-artifact.mjs";

export async function buildLocalRelease(input = {}) {
  const root = normalize(resolve(input.root ?? process.cwd()));
  const outDir = normalize(resolve(input.outDir ?? join(root, "release-out")));
  const packageFiles = await findPackageFiles(join(root, "packages"));
  const releaseChannels = normalizeReleaseChannels(input.releaseChannels);
  const writeRegistry = input.writeRegistry !== false;
  const artifacts = [];
  const releasePackages = [];
  const generatedAt = input.builtAt ?? new Date().toISOString();

  await resetOutputDirectory(root, outDir);
  await mkdir(outDir, { recursive: true });

  for (const packageFile of packageFiles) {
    const manifest = JSON.parse(await readFile(packageFile, "utf-8"));
    const packageInfo = normalizePackageManifest(manifest);
    if (releaseChannels && !releaseChannels.has(packageInfo.releaseChannel)) {
      continue;
    }

    const payloadRoot = resolveInside(root, dirname(packageFile), packageInfo.payloadRoot);
    if (!payloadRoot) {
      throw new Error(`Package ${packageInfo.id} payloadRoot escapes repository.`);
    }

    const artifact = await buildPackageArtifact({
      root,
      outDir,
      packageFile,
      packageInfo,
      manifest,
      payloadRoot
    });
    if (writeRegistry) {
      await updateRegistryRelease(root, packageInfo, {
        artifactName: artifact.artifactName,
        sha256: artifact.sha256,
        sizeBytes: artifact.sizeBytes,
        builtAt: generatedAt
      });
    }

    artifacts.push({
      packageId: packageInfo.id,
      artifactName: artifact.artifactName,
      artifactPath: artifact.artifactPath,
      sha256: artifact.sha256,
      sizeBytes: artifact.sizeBytes
    });
    releasePackages.push({
      packageId: packageInfo.id,
      version: packageInfo.version,
      namespace: packageInfo.namespace,
      artifactType: packageInfo.artifactType,
      ...(packageInfo.artifactKind ? { artifactKind: packageInfo.artifactKind } : {}),
      ...(packageInfo.queryAdapter ? { queryAdapter: packageInfo.queryAdapter } : {}),
      variant: packageInfo.variant,
      required: packageInfo.required,
      format: packageInfo.format,
      releaseChannel: packageInfo.releaseChannel,
      releaseFamily: packageInfo.releaseFamily,
      capabilities: packageInfo.capabilities,
      ...(packageInfo.metadata ? { metadata: packageInfo.metadata } : {}),
      artifactName: artifact.artifactName,
      sha256: artifact.sha256,
      sizeBytes: artifact.sizeBytes
    });
  }

  const manifestPath = join(outDir, "mdm-release-manifest.json");
  await writeFile(
    manifestPath,
    stableJson(buildReleaseManifest(releasePackages, generatedAt))
  );
  const summary = await writeReleaseSummary({
    outDir,
    manifestPath,
    artifacts,
    source: input.source
  });

  return { artifacts, manifestPath, summaryPath: summary.summaryPath };
}

async function resetOutputDirectory(root, outDir) {
  if (outDir === root) {
    throw new Error("Release output directory must not be the repository root.");
  }

  const parent = dirname(outDir);
  if (parent === outDir) {
    throw new Error("Release output directory must not be a filesystem root.");
  }

  await rm(outDir, { recursive: true, force: true });
}

async function buildPackageArtifact(input) {
  if (
    input.packageInfo.schemaVersion === 2 &&
    input.packageInfo.format === "sqlite" &&
    input.manifest.query?.adapter === "sqlite_docs"
  ) {
    return buildSqliteDocsArtifact(input);
  }
  if (
    input.packageInfo.schemaVersion === 2 &&
    input.packageInfo.format === "sqlite" &&
    input.manifest.query?.adapter === "source_index_sqlite"
  ) {
    return buildSqliteSourceIndexArtifact(input);
  }

  const payload = await readPayloadFiles(input.root, input.payloadRoot);
  const artifactName = `${input.packageInfo.id}-${input.packageInfo.version}.mdm-resource.json`;
  const artifactPath = join(input.outDir, artifactName);
  const artifactBody = stableJson({
    schemaVersion: input.packageInfo.schemaVersion,
    package: input.manifest,
    payload
  });

  await writeFile(artifactPath, artifactBody);
  return buildArtifactResult(artifactName, artifactPath, Buffer.from(artifactBody));
}

async function buildSqliteDocsArtifact(input) {
  const artifactName = `${input.packageInfo.id}-${input.packageInfo.version}.sqlite`;
  const artifactPath = join(input.outDir, artifactName);
  const entrypointPath = resolveInside(
    input.root,
    dirname(input.packageFile),
    input.manifest.artifact.entrypoint
  );
  if (!entrypointPath) {
    throw new Error(`Package ${input.packageInfo.id} sqlite entrypoint escapes repository.`);
  }

  const content = JSON.parse(await readFile(entrypointPath, "utf-8"));
  await rm(artifactPath, { force: true });
  await writeSqliteDocsDatabase({
    databasePath: artifactPath,
    packageId: input.packageInfo.id,
    userVersion: input.packageInfo.artifactSchemaVersion,
    entries: content.entries ?? []
  });
  return buildArtifactResult(
    artifactName,
    artifactPath,
    await readFile(artifactPath)
  );
}

async function buildSqliteSourceIndexArtifact(input) {
  const artifactName = `${input.packageInfo.id}-${input.packageInfo.version}.sqlite`;
  const artifactPath = join(input.outDir, artifactName);
  const entrypointPath = resolveInside(
    input.root,
    dirname(input.packageFile),
    input.manifest.artifact.entrypoint
  );
  if (!entrypointPath) {
    throw new Error(`Package ${input.packageInfo.id} source index entrypoint escapes repository.`);
  }

  const content = JSON.parse(await readFile(entrypointPath, "utf-8"));
  await rm(artifactPath, { force: true });
  await writeSqliteSourceIndexDatabase({
    databasePath: artifactPath,
    packageId: input.packageInfo.id,
    userVersion: input.packageInfo.artifactSchemaVersion,
    files: content.files ?? []
  });
  return buildArtifactResult(
    artifactName,
    artifactPath,
    await readFile(artifactPath)
  );
}

function buildArtifactResult(artifactName, artifactPath, body) {
  return {
    artifactName,
    artifactPath,
    sha256: createHash("sha256").update(body).digest("hex"),
    sizeBytes: body.length
  };
}

function normalizePackageManifest(manifest) {
  if (manifest?.identity?.schemaVersion === 2) {
    return {
      schemaVersion: 2,
      id: manifest.identity.packageId,
      version: manifest.identity.packageVersion,
      namespace: manifest.identity.namespace,
      artifactType: mapV2ArtifactType(manifest.artifact.kind),
      artifactKind: manifest.artifact.kind,
      queryAdapter: manifest.query?.adapter,
      variant: manifest.release.channel,
      required: manifest.release.channel === "required",
      format: manifest.artifact.format,
      payloadRoot: ".",
      releaseChannel: manifest.release.channel,
      releaseFamily: manifest.release.family,
      capabilities: manifest.capabilities,
      artifactSchemaVersion: manifest.artifact.schemaVersion,
      metadata: inferV2PackageMetadata(manifest)
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
    capabilities: manifest.capabilities ?? [],
    artifactSchemaVersion: 1
  };
}

function inferV2PackageMetadata(manifest) {
  if (
    manifest.artifact.format !== "sqlite" ||
    !["sqlite_docs", "source_index_sqlite"].includes(manifest.query?.adapter)
  ) {
    return undefined;
  }

  if (manifest.query.adapter === "source_index_sqlite") {
    return {
      storageKind: "sqlite_bundle",
      installTier: "runtime_or_optional_dataset",
      commitPolicy: "repository_manifest",
      sqlite: {
        databaseName: `${manifest.identity.packageId}.sqlite`,
        minUserVersion: manifest.artifact.schemaVersion,
        requiredTables: [
          "files",
          "java_symbols",
          "java_members",
          "fts_files",
          "source_chunks",
          "fts_chunks"
        ]
      }
    };
  }

  return {
    storageKind: "sqlite_bundle",
    installTier: "optional_dataset",
    commitPolicy: "repository_manifest",
    sqlite: {
      databaseName: `${manifest.identity.packageId}.sqlite`,
      minUserVersion: manifest.artifact.schemaVersion,
      requiredTables: ["docs_entries", "docs_entries_fts"]
    }
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
  if (kind === "source_index") {
    return "source_index";
  }
  if (kind === "source_tree") {
    return "source_tree";
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

function normalizeReleaseChannels(channels) {
  if (channels === undefined) {
    return undefined;
  }
  const values = Array.isArray(channels) ? channels : [channels];
  return new Set(values.flatMap((value) => {
    return String(value)
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
  }));
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
  if (manifest.metadata) {
    entry.metadata = manifest.metadata;
    detail.metadata = manifest.metadata;
  }

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
  const result = await buildLocalRelease({
    root: process.cwd(),
    outDir,
    releaseChannels: parseChannelArgs(process.argv),
    writeRegistry: !process.argv.includes("--no-registry-update"),
    source: {
      repository: process.env.GITHUB_REPOSITORY,
      ref: process.env.GITHUB_REF_NAME,
      revision: process.env.GITHUB_SHA
    }
  });
  const stats = await Promise.all(
    result.artifacts.map(async (artifact) => ({
      ...artifact,
      sizeBytes: (await stat(artifact.artifactPath)).size
    }))
  );

  console.log(JSON.stringify({ artifacts: stats }, null, 2));
}

function parseChannelArgs(argv) {
  const channels = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if ((arg === "--channel" || arg === "--channels") && argv[index + 1]) {
      channels.push(argv[index + 1]);
      index += 1;
    } else if (arg?.startsWith("--channel=")) {
      channels.push(arg.slice("--channel=".length));
    } else if (arg?.startsWith("--channels=")) {
      channels.push(arg.slice("--channels=".length));
    }
  }

  return channels.length > 0 ? channels : undefined;
}
