import { createHash } from "node:crypto";
import { createRequire } from "node:module";
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

const require = createRequire(import.meta.url);

export async function buildLocalRelease(input = {}) {
  const root = normalize(resolve(input.root ?? process.cwd()));
  const outDir = normalize(resolve(input.outDir ?? join(root, "release-out")));
  const packageFiles = await findPackageFiles(join(root, "packages"));
  const releaseChannels = normalizeReleaseChannels(input.releaseChannels);
  const artifacts = [];
  const releasePackages = [];
  const generatedAt = input.builtAt ?? new Date().toISOString();

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
    await updateRegistryRelease(root, packageInfo, {
      artifactName: artifact.artifactName,
      sha256: artifact.sha256,
      sizeBytes: artifact.sizeBytes,
      builtAt: generatedAt
    });

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
      variant: packageInfo.variant,
      required: packageInfo.required,
      format: packageInfo.format,
      releaseChannel: packageInfo.releaseChannel,
      releaseFamily: packageInfo.releaseFamily,
      capabilities: packageInfo.capabilities,
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

  return { artifacts, manifestPath };
}

async function buildPackageArtifact(input) {
  if (
    input.packageInfo.schemaVersion === 2 &&
    input.packageInfo.format === "sqlite" &&
    input.manifest.query?.adapter === "sqlite_docs"
  ) {
    return buildSqliteDocsArtifact(input);
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
  await writeSqliteDocsDatabase(artifactPath, input.packageInfo.id, content.entries ?? []);
  return buildArtifactResult(
    artifactName,
    artifactPath,
    await readFile(artifactPath)
  );
}

function writeSqliteDocsDatabase(databasePath, packageId, entries) {
  const { DatabaseSync } = require("node:sqlite");
  const database = new DatabaseSync(databasePath);
  try {
    database.exec([
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
    ].join(" "));

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
    for (const entry of entries.map(normalizeDocsEntry)) {
      const path = entry.path ?? `${packageId}#${entry.id}`;
      const searchTerms = entry.searchTerms.length > 0
        ? entry.searchTerms
        : [entry.id, entry.title, entry.summary];
      insertEntry.run(
        entry.id,
        packageId,
        entry.kind,
        entry.title,
        path,
        JSON.stringify(entry.headings),
        entry.summary,
        JSON.stringify(searchTerms),
        JSON.stringify(entry.scriptScopes),
        JSON.stringify(entry.addonNames),
        JSON.stringify(entry.eventNames),
        JSON.stringify(entry.codeSymbols)
      );
      insertFts.run(
        entry.id,
        entry.title,
        path,
        entry.summary,
        searchTerms.join(" "),
        entry.scriptScopes.join(" "),
        entry.addonNames.join(" "),
        entry.eventNames.join(" "),
        entry.codeSymbols.join(" ")
      );
    }
    database.exec("COMMIT");
  } catch (error) {
    try {
      database.exec("ROLLBACK");
    } catch {
      // Ignore rollback failures so the original build error is preserved.
    }
    throw error;
  } finally {
    database.close();
  }
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
    releaseChannels: parseChannelArgs(process.argv)
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
