import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { readCatalogVersionEntries } from "./release-catalog-versions.mjs";

export async function syncMappingProfiles(input = {}) {
  const root = resolve(input.root ?? process.cwd());
  const entries = input.versions
    ? input.versions.map((id) => ({ id }))
    : await readCatalogVersionEntries(root, "mappings");

  for (const entry of entries) {
    await writeMappingProfilePackage(root, entry);
  }

  return { generatedVersions: entries.map((entry) => entry.id) };
}

async function writeMappingProfilePackage(root, entry) {
  const version = entry.id;
  const packageRoot = join(root, "packages/mappings/vanilla", `${version}-yarn-profile`);
  await writeJson(join(packageRoot, "package.json"), buildManifest(version));
  await writeJson(
    join(packageRoot, "payload/mapping-profile.json"),
    buildMappingProfile(entry)
  );
}

function buildManifest(version) {
  return {
    identity: {
      schemaVersion: 2,
      packageId: `minecraft-${version}-yarn-mapping-profile`,
      packageVersion: "0.1.0",
      namespace: "minecraft",
      displayName: `Minecraft ${version} Yarn Mapping Profile`,
      description:
        `Generated public mapping profile for Minecraft ${version}. ` +
        "It explains namespaces and local acquisition without bundling mapping tables."
    },
    target: {
      minecraftVersions: [version],
      loaders: ["fabric"],
      mappings: ["official", "intermediary", "named", "yarn"]
    },
    artifact: {
      kind: "mapping_bundle",
      format: "json",
      schemaId: "mdm.mappings.profile.json",
      schemaVersion: 1,
      entrypoint: "payload/mapping-profile.json"
    },
    capabilities: ["mapping_lookup", "mapping_explain"],
    policy: {
      privacy: "public_release",
      lifecycle: ["downloadable"],
      canCommitToRepository: true,
      canUploadToPublicRelease: true,
      requiresUserConsent: false
    },
    query: {
      adapter: "mapping_index",
      capabilities: ["mapping_lookup", "mapping_explain"],
      defaultLimit: 8,
      maxLimit: 50,
      preferredFallbacks: ["source_index_sqlite"]
    },
    release: {
      channel: "mappings",
      family: "vanilla-mappings"
    }
  };
}

function buildMappingProfile(entry) {
  const version = entry.id;
  return {
    schemaVersion: 1,
    profileKind: "mapping",
    minecraftVersion: version,
    generatedFrom: {
      kind: "mojang_release_catalog",
      metadataUrl: entry.metadataUrl ?? null,
      sha1: entry.sha1 ?? null,
      releaseTime: entry.releaseTime ?? null
    },
    mappingNamespaces: ["official", "intermediary", "named", "yarn"],
    purpose:
      "Explain mapping namespace relationships and guide MCP toward legal local mapping acquisition.",
    namespaceGraph: [
      edge("official", "intermediary", "runtime_to_stable_bridge"),
      edge("intermediary", "named", "stable_to_human_readable"),
      edge("named", "yarn", "public_named_mapping_family")
    ],
    lookupPolicy: {
      bundlesGeneratedMappings: false,
      bundlesRemappedSource: false,
      localGenerationOnly: true,
      preferredLocalAdapters: ["mapping_index", "source_index_sqlite"]
    },
    upstreamLicensing: [
      {
        namespace: "yarn",
        redistributionPolicy: "do_not_bundle_tables_until_verified",
        acquisition: "download_or_generate_locally_after_user_request"
      }
    ],
    cacheOwnership: {
      generatedMappingOwner: "mcp-runtime-cache",
      evictionAllowed: true
    }
  };
}

function edge(from, to, role) {
  return { from, to, role };
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
  const result = await syncMappingProfiles(parseArgs(process.argv.slice(2)));
  console.log(JSON.stringify(result, null, 2));
}
