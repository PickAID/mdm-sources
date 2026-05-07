import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const CATALOG_PATH =
  "packages/minecraft/releases/catalog/payload/release-catalog.json";

export async function syncSourceProfiles(input = {}) {
  const root = resolve(input.root ?? process.cwd());
  const versions = input.versions ?? await readSourceVersions(root);

  for (const version of versions) {
    await writeSourceProfilePackage(root, version);
  }

  return { generatedVersions: versions };
}

async function readSourceVersions(root) {
  const catalog = JSON.parse(await readFile(join(root, CATALOG_PATH), "utf-8"));
  const releaseVersions = catalog.releases
    ?.map((release) => release?.id)
    .filter((version) => typeof version === "string" && version.length > 0);
  if (releaseVersions?.length > 0) {
    return releaseVersions;
  }

  const seedVersions = catalog.currentSeedProfiles?.sources;
  if (Array.isArray(seedVersions) && seedVersions.length > 0) {
    return seedVersions;
  }

  throw new Error("release catalog must list releases or currentSeedProfiles.sources.");
}

async function writeSourceProfilePackage(root, version) {
  const packageId = `minecraft-${version}-vanilla-source-profile`;
  const packageRoot = join(root, "packages/sources/vanilla", version);
  await writeJson(join(packageRoot, "package.json"), buildPackageManifest(version, packageId));
  await writeJson(
    join(packageRoot, "payload/source-profile.json"),
    buildSourceProfile(version)
  );
}

function buildPackageManifest(version, packageId) {
  return {
    identity: {
      schemaVersion: 2,
      packageId,
      packageVersion: "0.1.0",
      namespace: "minecraft",
      displayName: `Minecraft ${version} Vanilla Source Profile`,
      description:
        `Public source acquisition profile for Minecraft ${version}. ` +
        "It describes legal local generation and cache policy without bundling Minecraft source."
    },
    target: {
      minecraftVersions: [version],
      loaders: ["vanilla"],
      mappings: ["official", "mojmap"]
    },
    artifact: {
      kind: "docs_bundle",
      format: "json",
      schemaId: "mdm.sources.profile.json",
      schemaVersion: 1,
      entrypoint: "payload/source-profile.json"
    },
    capabilities: ["source_lookup", "source_chunk_search"],
    policy: {
      privacy: "public_release",
      lifecycle: ["downloadable"],
      canCommitToRepository: true,
      canUploadToPublicRelease: true,
      requiresUserConsent: false
    },
    query: {
      adapter: "json_docs",
      capabilities: ["source_lookup", "source_chunk_search"],
      defaultLimit: 8,
      maxLimit: 50,
      preferredFallbacks: ["source_index_sqlite"]
    },
    release: {
      channel: "sources",
      family: "vanilla-sources"
    }
  };
}

function buildSourceProfile(version) {
  return {
    minecraftVersion: version,
    targetMappings: ["official", "mojmap"],
    purpose:
      `Describe how MCP can acquire and generate local vanilla source evidence for Minecraft ${version} ` +
      "without distributing source code in mdm-sources.",
    distributionPolicy: {
      bundlesMinecraftSource: false,
      bundlesRemappedSource: false,
      localGenerationOnly: true,
      publicRepositoryContains: [
        "acquisition guidance",
        "version-scoped source profile",
        "cache ownership policy",
        "query fallback hints"
      ],
      publicRepositoryMustNotContain: [
        "vanilla Java source files",
        "remapped source trees",
        "generated source indexes",
        "private workspace caches",
        "modpack-derived source data"
      ]
    },
    localGeneration: {
      confirmationRequired: true,
      confirmationScope: "package-version",
      targets: [
        {
          packageId: `minecraft-${version}-source-pack-named`,
          namespace: "minecraft",
          artifactType: "source-pack",
          variant: "named",
          cacheScope: "runtime-private"
        }
      ],
      expectedSteps: [
        "resolve official Minecraft release metadata",
        "ask for explicit user confirmation before acquiring or generating source artifacts",
        "download or generate the local source package in the MCP runtime cache",
        "derive optional source indexes or snippets only in runtime-private cache",
        "avoid committing generated source or indexes to mdm-sources"
      ]
    },
    provenance: {
      metadataSource: "Mojang version metadata and MCP runtime acquisition providers",
      repositoryStoresSourceBytes: false,
      repositoryStoresRemappedSourceBytes: false
    },
    cacheOwnership: {
      generatedSourceOwner: "mcp-runtime-cache",
      generatedIndexesOwner: "mcp-runtime-cache",
      evictionAllowed: true,
      workspaceIndependence:
        "Generated source artifacts must not be stored inside user workspaces unless explicitly exported by the user."
    },
    queryHints: {
      capabilities: ["source_lookup", "source_chunk_search"],
      preferredFallbacks: ["source_index_sqlite"],
      agentGuidance:
        "Use this profile to request local source generation or to explain why no vanilla source package is currently cached. Do not treat this profile as source content."
    },
    legalNotes: [
      "This profile is not a redistributable Minecraft source artifact.",
      "Full source packages, remapped source trees, source indexes, and snippets must be acquired or generated locally with user confirmation."
    ]
  };
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--root") {
      result.root = argv[index + 1];
      index += 1;
    }
  }
  return result;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await syncSourceProfiles(parseArgs(process.argv.slice(2)));
  console.log(JSON.stringify(result, null, 2));
}
