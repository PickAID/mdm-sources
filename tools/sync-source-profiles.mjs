import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { readCatalogVersions } from "./release-catalog-versions.mjs";

export const LOADER_SOURCE_PROFILE_TARGETS = [
  { version: "1.7.10", loader: "forge" },
  { version: "1.12.2", loader: "forge" },
  { version: "1.14.4", loader: "fabric" },
  { version: "1.16.5", loader: "forge" },
  { version: "1.16.5", loader: "fabric" },
  { version: "1.18.2", loader: "forge" },
  { version: "1.18.2", loader: "fabric" },
  { version: "1.18.2", loader: "quilt" },
  { version: "1.20.1", loader: "forge" },
  { version: "1.20.1", loader: "fabric" },
  { version: "1.20.1", loader: "quilt" },
  { version: "1.21.1", loader: "neoforge" },
  { version: "1.21.1", loader: "fabric" },
  { version: "1.21.1", loader: "quilt" },
  { version: "26.1", loader: "neoforge" },
  { version: "26.1", loader: "fabric" },
  { version: "26.1.2", loader: "neoforge" },
  { version: "26.1.2", loader: "fabric" }
];

export async function syncSourceProfiles(input = {}) {
  const root = resolve(input.root ?? process.cwd());
  const versions = input.versions ?? await readSourceVersions(root);
  const loaderProfiles = [];

  for (const version of versions) {
    await writeSourceProfilePackage(root, version);
  }

  for (const target of LOADER_SOURCE_PROFILE_TARGETS.filter((entry) =>
    versions.includes(entry.version)
  )) {
    loaderProfiles.push(await writeLoaderSourceProfilePackage(root, target));
  }

  return {
    generatedVersions: versions,
    loaderProfiles: {
      generatedPackageIds: loaderProfiles.map((profile) => profile.packageId)
    }
  };
}

async function readSourceVersions(root) {
  return readCatalogVersions(root, "sources");
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

async function writeLoaderSourceProfilePackage(root, target) {
  const packageId = `minecraft-${target.version}-${target.loader}-source-profile`;
  const packageRoot = join(root, "packages/sources/loaders", target.loader, target.version);
  await writeJson(
    join(packageRoot, "package.json"),
    buildPackageManifest(target.version, packageId, target.loader)
  );
  await writeJson(
    join(packageRoot, "payload/source-profile.json"),
    buildSourceProfile(target.version, target.loader)
  );
  return { packageId };
}

function buildPackageManifest(version, packageId, loader = "vanilla") {
  const displayLoader = displayNameForLoader(loader);
  const isVanilla = loader === "vanilla";
  return {
    identity: {
      schemaVersion: 2,
      packageId,
      packageVersion: "0.1.0",
      namespace: "minecraft",
      displayName: `Minecraft ${version} ${displayLoader} Source Profile`,
      description: isVanilla
        ? `Public source acquisition profile for Minecraft ${version}. ` +
          "It describes legal local generation and cache policy without bundling Minecraft source."
        : `Public ${displayLoader} source acquisition profile for Minecraft ${version}. ` +
          "It describes legal local generation and cache policy without bundling source."
    },
    target: {
      minecraftVersions: [version],
      loaders: [loader],
      mappings: mappingsForLoader(loader)
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
      family: loader === "vanilla" ? "vanilla-sources" : "loader-sources"
    }
  };
}

function buildSourceProfile(version, loader = "vanilla") {
  const isVanilla = loader === "vanilla";
  const profile = {
    minecraftVersion: version,
    targetMappings: mappingsForLoader(loader),
    purpose:
      `Describe how MCP can acquire and generate local ${loader} source evidence for Minecraft ${version} ` +
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
      targets: localGenerationTargets(version, loader),
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
      agentGuidance: isVanilla
        ? "Use this profile to request local source generation or to explain why no vanilla source package is currently cached. Do not treat this profile as source content."
        : `Use this profile to request local ${loader} source generation or to explain why no ${loader} source package is currently cached. Do not treat this profile as source content.`
    },
    legalNotes: [
      "This profile is not a redistributable Minecraft source artifact.",
      "Full source packages, remapped source trees, source indexes, and snippets must be acquired or generated locally with user confirmation."
    ]
  };

  if (!isVanilla) {
    profile.loader = loader;
    profile.distributionPolicy.bundlesLoaderSource = false;
    profile.distributionPolicy.publicRepositoryContains.splice(
      2,
      0,
      "loader-scoped acquisition guidance"
    );
    profile.distributionPolicy.publicRepositoryMustNotContain.splice(
      1,
      0,
      "loader API Java source files"
    );
    profile.localGeneration.expectedSteps.splice(
      1,
      0,
      "resolve loader Maven or Gradle metadata from the local workspace or user-approved remote metadata"
    );
  }

  return profile;
}

function mappingsForLoader(loader) {
  if (loader === "fabric" || loader === "quilt") {
    return ["official", "intermediary", "named", "yarn"];
  }
  if (loader === "forge" || loader === "neoforge") {
    return ["official", "mojmap", "parchment"];
  }
  return ["official", "mojmap"];
}

function displayNameForLoader(loader) {
  return {
    fabric: "Fabric",
    forge: "Forge",
    neoforge: "NeoForge",
    quilt: "Quilt",
    vanilla: "Vanilla"
  }[loader] ?? loader;
}

function localGenerationTargets(version, loader) {
  const targets = [
    {
      packageId: `minecraft-${version}-source-pack-named`,
      namespace: "minecraft",
      artifactType: "source-pack",
      variant: "named",
      cacheScope: "runtime-private"
    }
  ];

  if (loader !== "vanilla") {
    targets.push({
      packageId: `minecraft-${version}-${loader}-api-source-pack`,
      namespace: loader,
      artifactType: "source-pack",
      variant: "named",
      cacheScope: "runtime-private"
    });
  }

  return targets;
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
