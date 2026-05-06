import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const MOJANG_VERSION_MANIFEST_URL =
  "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json";

export const DEFAULT_CATALOG_PATH =
  "packages/minecraft/releases/catalog/payload/release-catalog.json";

export async function updateReleaseCatalog(input = {}) {
  const manifest = input.manifest ??
    await readVersionManifest({
      inputPath: input.inputPath,
      manifestUrl: input.manifestUrl
    });
  const catalog = buildReleaseCatalog(manifest, {
    generatedAt: input.generatedAt
  });
  const outPath = resolve(input.outPath ?? DEFAULT_CATALOG_PATH);

  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, formatCatalogJson(catalog));

  return { catalog, outPath };
}

export function buildReleaseCatalog(manifest, input = {}) {
  const releases = requireArray(manifest.versions, "versions")
    .filter((version) => version?.type === "release")
    .map((version) => ({
      id: requireString(version.id, "version.id"),
      releaseTime: requireString(version.releaseTime, "version.releaseTime"),
      metadataUrl: requireString(version.url, "version.url"),
      sha1: requireString(version.sha1, "version.sha1"),
      complianceLevel: requireNumber(
        version.complianceLevel,
        "version.complianceLevel"
      )
    }));

  if (releases.length === 0) {
    throw new Error("Mojang version manifest contains no release versions.");
  }

  return {
    schemaVersion: 1,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    source: {
      kind: "mojang_version_manifest_v2",
      url: MOJANG_VERSION_MANIFEST_URL
    },
    latest: requireRecord(manifest.latest, "latest"),
    releaseCount: releases.length,
    localGenerationPolicy: {
      vanillaSource:
        "Generate or download locally only after user consent. Do not commit Minecraft source or remapped source to public repositories.",
      datapackProfiles:
        "Use this catalog to select version metadata, then use version-specific generated vanilla data or curated profile rules locally.",
      resourcepackProfiles:
        "Use this catalog to select client assets and pack metadata locally. Public mdm-sources packages contain only curated profiles and guidance.",
      cacheOwnership:
        "Generated indexes, source trees, mappings, ProbeJS dumps, and embeddings belong to MCP local cache."
    },
    currentSeedProfiles: {
      datapack: ["1.18.2", "1.20.1", "1.21.1"],
      resourcepack: ["1.18.2", "1.20.1", "1.21.1"]
    },
    releases
  };
}

export function formatCatalogJson(catalog) {
  const lines = ["{"];
  const scalarEntries = Object.entries(catalog).filter(([key]) => {
    return key !== "releases";
  });

  for (const [key, value] of scalarEntries) {
    lines.push(`  ${JSON.stringify(key)}: ${JSON.stringify(value)},`);
  }

  lines.push('  "releases": [');
  for (const [index, release] of catalog.releases.entries()) {
    const comma = index === catalog.releases.length - 1 ? "" : ",";
    lines.push(`    ${JSON.stringify(release)}${comma}`);
  }
  lines.push("  ]");
  lines.push("}");

  return `${lines.join("\n")}\n`;
}

async function readVersionManifest(input) {
  if (input.inputPath) {
    return JSON.parse(await readFile(resolve(input.inputPath), "utf-8"));
  }

  const response = await fetch(input.manifestUrl ?? MOJANG_VERSION_MANIFEST_URL);
  if (!response.ok) {
    throw new Error(`Failed to fetch Mojang version manifest: HTTP ${response.status}.`);
  }

  return response.json();
}

function requireRecord(value, field) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${field} must be an object.`);
  }

  return value;
}

function requireArray(value, field) {
  if (!Array.isArray(value)) {
    throw new Error(`${field} must be an array.`);
  }

  return value;
}

function requireString(value, field) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${field} must be a non-empty string.`);
  }

  return value;
}

function requireNumber(value, field) {
  if (typeof value !== "number") {
    throw new Error(`${field} must be a number.`);
  }

  return value;
}

function parseArgs(argv) {
  const result = {};
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--input") {
      result.inputPath = argv[index + 1];
      index += 1;
    } else if (arg === "--out") {
      result.outPath = argv[index + 1];
      index += 1;
    } else if (arg === "--generated-at") {
      result.generatedAt = argv[index + 1];
      index += 1;
    }
  }

  return result;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await updateReleaseCatalog(parseArgs(process.argv));
  console.log(JSON.stringify({
    outPath: result.outPath,
    releaseCount: result.catalog.releaseCount,
    latestRelease: result.catalog.latest.release
  }, null, 2));
}
