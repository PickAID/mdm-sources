import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { readCatalogVersionEntries } from "./release-catalog-versions.mjs";

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

  return { datapackProfiles, resourcepackProfiles };
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

function buildPackageManifest(version, kind) {
  const profileName = kind.directory === "datapack" ? "Datapack" : "Resourcepack";
  return {
    identity: {
      schemaVersion: 2,
      packageId: `minecraft-${version}-vanilla-${kind.directory}-profile`,
      packageVersion: "0.1.0",
      namespace: "minecraft",
      displayName: `Minecraft ${version} Vanilla ${profileName} Profile`,
      description:
        `Generated public ${kind.directory} profile for Minecraft ${version}. ` +
        "It defines stable lookup roots and tells MCP to resolve exact pack metadata locally."
    },
    target: {
      minecraftVersions: [version],
      loaders: ["vanilla"],
      mappings: ["official"]
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
      family: kind.family
    }
  };
}

function buildProfile(entry, kind) {
  const version = entry.id;
  return {
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
      loaders: ["vanilla"],
      mappings: ["official"]
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
}

function rule(kind, pathPattern, lookupKey) {
  return { kind, pathPattern, lookupKey };
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
