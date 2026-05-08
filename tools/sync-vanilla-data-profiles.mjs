import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { readCatalogVersionEntries } from "./release-catalog-versions.mjs";
import { LOADER_SOURCE_PROFILE_TARGETS } from "./sync-source-profiles.mjs";

const PROFILE_KINDS = {
  datapack: {
    directory: "datapack",
    fileName: "datapack-profile.json",
    schemaId: "mdm.datapack.profile.json",
    artifactKind: "datapack_bundle",
    capability: "datapack_trace",
    family: "vanilla-datapack",
    roots: [
      "data/<namespace>/advancements",
      "data/<namespace>/functions",
      "data/<namespace>/loot_tables",
      "data/<namespace>/predicates",
      "data/<namespace>/recipes",
      "data/<namespace>/structures",
      "data/<namespace>/tags",
      "data/<namespace>/worldgen"
    ],
    traceRules: [
      rule("recipe", "data/<namespace>/recipes/<path>.json", "<namespace>:<path>"),
      rule("tag", "data/<namespace>/tags/<registry>/<path>.json", "#<namespace>:<path>"),
      rule("function", "data/<namespace>/functions/<path>.mcfunction", "<namespace>:<path>")
    ]
  },
  resourcepack: {
    directory: "resourcepack",
    fileName: "resourcepack-profile.json",
    schemaId: "mdm.resourcepack.profile.json",
    artifactKind: "resourcepack_bundle",
    capability: "resourcepack_trace",
    family: "vanilla-resourcepack",
    roots: [
      "assets/<namespace>/atlases",
      "assets/<namespace>/blockstates",
      "assets/<namespace>/font",
      "assets/<namespace>/lang",
      "assets/<namespace>/models",
      "assets/<namespace>/particles",
      "assets/<namespace>/shaders",
      "assets/<namespace>/sounds",
      "assets/<namespace>/textures"
    ],
    traceRules: [
      rule("model", "assets/<namespace>/models/<path>.json", "<namespace>:<path>"),
      rule("texture", "assets/<namespace>/textures/<path>.png", "<namespace>:<path>"),
      rule("atlas", "assets/<namespace>/atlases/<name>.json", "<namespace>:<name>")
    ]
  }
};

export async function syncVanillaDataProfiles(input = {}) {
  const root = resolve(input.root ?? process.cwd());
  const entries = input.versions
    ? input.versions.map((id) => ({ id }))
    : await readCatalogVersionEntries(root, "datapack");
  const resourcepackEntries = input.resourcepackVersions
    ? input.resourcepackVersions.map((id) => ({ id }))
    : entries;
  const datapackProfiles = await writeProfileKind(root, entries, PROFILE_KINDS.datapack);
  const resourcepackProfiles = await writeProfileKind(
    root,
    resourcepackEntries,
    PROFILE_KINDS.resourcepack
  );
  const loaderDatapackProfiles = await writeLoaderProfileKind(
    root,
    entries,
    PROFILE_KINDS.datapack
  );
  const loaderResourcepackProfiles = await writeLoaderProfileKind(
    root,
    resourcepackEntries,
    PROFILE_KINDS.resourcepack
  );

  return {
    datapackProfiles: withLoaderProfiles(datapackProfiles, loaderDatapackProfiles),
    resourcepackProfiles: withLoaderProfiles(resourcepackProfiles, loaderResourcepackProfiles)
  };
}

async function writeProfileKind(root, entries, kind) {
  for (const entry of entries) {
    const version = entry.id;
    const packageRoot = join(root, `packages/${kind.directory}/vanilla`, version);
    await writeJson(
      join(packageRoot, "package.json"),
      buildPackageManifest(version, kind)
    );
    await writeJson(
      join(packageRoot, `payload/${kind.fileName}`),
      buildProfile(entry, kind)
    );
  }

  return { generatedVersions: entries.map((entry) => entry.id) };
}

async function writeLoaderProfileKind(root, entries, kind) {
  const entryByVersion = new Map(entries.map((entry) => [entry.id, entry]));
  const profiles = [];
  for (const target of LOADER_SOURCE_PROFILE_TARGETS) {
    const entry = entryByVersion.get(target.version);
    if (!entry) {
      continue;
    }
    profiles.push(await writeLoaderProfilePackage(root, entry, kind, target.loader));
  }
  return profiles;
}

async function writeLoaderProfilePackage(root, entry, kind, loader) {
  const version = entry.id;
  const packageId = `minecraft-${version}-${loader}-${kind.directory}-profile`;
  const packageRoot = join(root, `packages/${kind.directory}/loaders`, loader, version);
  await writeJson(
    join(packageRoot, "package.json"),
    buildPackageManifest(version, kind, loader, packageId)
  );
  await writeJson(
    join(packageRoot, `payload/${kind.fileName}`),
    buildProfile(entry, kind, loader)
  );
  return { packageId };
}

function withLoaderProfiles(profiles, loaderProfiles) {
  return {
    ...profiles,
    loaderProfiles: {
      generatedPackageIds: loaderProfiles.map((profile) => profile.packageId)
    }
  };
}

function buildPackageManifest(version, kind, loader = "vanilla", packageId = null) {
  const profileName = kind.directory === "datapack" ? "Datapack" : "Resourcepack";
  const displayLoader = displayNameForLoader(loader);
  const isVanilla = loader === "vanilla";
  return {
    identity: {
      schemaVersion: 2,
      packageId: packageId ?? `minecraft-${version}-vanilla-${kind.directory}-profile`,
      packageVersion: "0.1.0",
      namespace: "minecraft",
      displayName: `Minecraft ${version} ${displayLoader} ${profileName} Profile`,
      description: isVanilla
        ? `Generated public ${kind.directory} profile for Minecraft ${version}. ` +
          "It defines stable lookup roots and tells MCP to resolve exact pack metadata locally."
        : descriptionForProfile(version, kind, displayLoader)
    },
    target: {
      minecraftVersions: [version],
      loaders: [loader],
      mappings: isVanilla ? ["official"] : mappingsForLoader(loader)
    },
    artifact: {
      kind: kind.artifactKind,
      format: "json",
      schemaId: kind.schemaId,
      schemaVersion: 1,
      entrypoint: `payload/${kind.fileName}`
    },
    capabilities: ["resource_location_lookup", kind.capability],
    policy: {
      privacy: "public_release",
      lifecycle: ["downloadable"],
      canCommitToRepository: true,
      canUploadToPublicRelease: true,
      requiresUserConsent: false
    },
    query: {
      adapter: "archive_content",
      capabilities: ["resource_location_lookup", kind.capability],
      defaultLimit: 8,
      maxLimit: 50,
      preferredFallbacks: []
    },
    release: {
      channel: kind.directory,
      family: loader === "vanilla" ? kind.family : `loader-${kind.directory}`
    }
  };
}

function buildProfile(entry, kind, loader = "vanilla") {
  const version = entry.id;
  const profile = {
    schemaVersion: 1,
    profileKind: kind.directory,
    minecraftVersion: version,
    generatedFrom: {
      kind: "mojang_release_catalog",
      metadataUrl: entry.metadataUrl ?? null,
      sha1: entry.sha1 ?? null,
      releaseTime: entry.releaseTime ?? null
    },
    target: {
      namespace: "minecraft",
      loaders: [loader],
      mappings: loader === "vanilla" ? ["official"] : mappingsForLoader(loader)
    },
    packMcmeta: {
      packFormatSource: "runtime_resolved",
      exactPackFormatBundled: false,
      resolution:
        "Read pack.mcmeta or version metadata from the locally acquired vanilla client/server jar."
    },
    roots: kind.roots,
    traceRules: kind.traceRules,
    distributionPolicy: {
      publicRepositoryContains: [
        "version-scoped lookup roots",
        "trace rules",
        "runtime resolution policy"
      ],
      publicRepositoryMustNotContain: [
        "vanilla data files",
        "vanilla asset files",
        "generated archive indexes",
        "workspace-private modpack data"
      ],
      requiresUserConsentForGeneratedArtifacts: true
    },
    licensing: {
      redistribution: "profile_metadata_only",
      sourceMaterial: "Mojang release metadata and curated path rules",
      notes: [
        "This package does not redistribute vanilla data files, assets, or generated archive indexes."
      ]
    },
    cacheOwnership: {
      generatedArchiveIndexesOwner: "mcp-runtime-cache",
      evictionAllowed: true
    }
  };

  if (loader !== "vanilla") {
    profile.loader = loader;
    profile.localResolutionHints = {
      workspace:
        "Prefer the active mod workspace when resolving loader-provided pack overlays.",
      gradle:
        "Inspect Gradle run configurations, source sets, and generated resources directories locally.",
      probejs:
        "Use ProbeJS-generated local metadata only as runtime-private evidence.",
      [kind.directory]:
        `Resolve ${kind.directory} roots from local project packs and runtime caches before falling back to generated indexes.`
    };
    profile.distributionPolicy.publicRepositoryContains.push("loader target metadata");
    profile.distributionPolicy.publicRepositoryMustNotContain.push(
      "private loader workspace files",
      "private modpack data"
    );
  }

  return profile;
}

function rule(kind, pathPattern, lookupKey) {
  return { kind, pathPattern, lookupKey };
}

function descriptionForProfile(version, kind, displayLoader) {
  const scope = `${displayLoader} loader-scoped`;
  return (
    `Generated public ${scope} ${kind.directory} profile for Minecraft ${version}. ` +
    "It defines stable lookup roots and tells MCP to resolve exact pack metadata locally."
  );
}

function mappingsForLoader(loader) {
  if (loader === "fabric" || loader === "quilt") {
    return ["official", "intermediary", "named", "yarn"];
  }
  if (loader === "forge" || loader === "neoforge") {
    return ["official", "mojmap", "parchment"];
  }
  return ["official"];
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
  const result = await syncVanillaDataProfiles(parseArgs(process.argv.slice(2)));
  console.log(JSON.stringify(result, null, 2));
}
