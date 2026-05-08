import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, normalize, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { syncRegistry } from "./sync-registry.mjs";

export async function createSourceIndexPackage(input = {}) {
  const root = resolve(required(input.root, "root"));
  const payloadPath = resolve(required(input.payloadJson, "payloadJson"));
  const minecraftVersion = required(input.minecraftVersion, "minecraftVersion");
  const loader = input.loader ?? "vanilla";
  const mappings = normalizeMappings(input.mappings ?? defaultMappings(loader));
  const packageId = input.packageId ?? `minecraft-${minecraftVersion}-${loader}-source-index`;
  const packageVersion = input.version ?? input.packageVersion ?? "0.1.0";
  const packageRoot = resolvePackageRoot(root, input.outRoot, loader, minecraftVersion);

  const payload = JSON.parse(await readFile(payloadPath, "utf-8"));
  validatePayloadTarget(payload, { minecraftVersion, loader, mappings });
  await writeJson(join(packageRoot, "package.json"), {
    identity: {
      schemaVersion: 2,
      packageId,
      packageVersion,
      namespace: "minecraft",
      displayName: `Minecraft ${minecraftVersion} ${displayLoader(loader)} Source Index`,
      description:
        `Source-index package for Minecraft ${minecraftVersion} ${loader}. ` +
        "It contains normalized source metadata/chunks supplied by an allowed local or user-confirmed input."
    },
    target: {
      minecraftVersions: [minecraftVersion],
      loaders: [loader],
      mappings
    },
    artifact: {
      kind: "source_index",
      format: "sqlite",
      schemaId: "mdm.source.index.sqlite",
      schemaVersion: 1,
      entrypoint: "payload/source-index.json"
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
      adapter: "source_index_sqlite",
      capabilities: ["source_lookup", "source_chunk_search"],
      defaultLimit: 8,
      maxLimit: 50,
      preferredFallbacks: []
    },
    release: {
      channel: "sources",
      family: loader === "vanilla" ? "vanilla-source-index" : "loader-source-index"
    }
  });
  await writeJson(join(packageRoot, "payload/source-index.json"), payload);
  const registry = input.syncRegistry === false ? undefined : await syncRegistry({ root });

  return {
    packageId,
    packageRoot,
    payloadPath: join(packageRoot, "payload/source-index.json"),
    registryPackageCount: registry?.packageIds.length ?? 0
  };
}

function required(value, name) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Missing required option ${name}.`);
  }
  return value;
}

function defaultMappings(loader) {
  if (loader === "fabric" || loader === "quilt") {
    return ["official", "intermediary", "named", "yarn"];
  }
  if (loader === "forge" || loader === "neoforge") {
    return ["official", "mojmap", "parchment"];
  }
  return ["official", "mojmap"];
}

function normalizeMappings(value) {
  if (Array.isArray(value)) {
    return value;
  }
  return String(value).split(",").map((entry) => entry.trim()).filter(Boolean);
}

function validatePayloadTarget(payload, target) {
  const files = Array.isArray(payload?.files) ? payload.files : [];
  for (const file of files) {
    if (
      file?.minecraftVersion !== target.minecraftVersion ||
      file?.loader !== target.loader ||
      !target.mappings.includes(file?.mappings)
    ) {
      throw new Error(
        "Payload files must match minecraftVersion, loader, and mappings arguments."
      );
    }
  }
}

function resolvePackageRoot(root, outRoot, loader, minecraftVersion) {
  const packageRoot = outRoot
    ? resolve(root, outRoot)
    : resolve(root, "packages/source-index", loader, minecraftVersion);
  const normalized = normalize(packageRoot);
  if (!isWithin(root, normalized)) {
    throw new Error("outRoot must stay inside the repository root.");
  }
  return normalized;
}

function isWithin(parentPath, childPath) {
  const rel = relative(parentPath, childPath);
  return rel.length === 0 || (!rel.startsWith("..") && !isAbsolute(rel));
}

function displayLoader(loader) {
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
    const name = argv[index];
    if (!name.startsWith("--")) {
      continue;
    }
    const key = name.slice(2);
    if (key === "no-sync-registry") {
      result.syncRegistry = false;
    } else {
      result[toCamelCase(key)] = argv[index + 1];
      index += 1;
    }
  }
  if (typeof result.mappings === "string") {
    result.mappings = normalizeMappings(result.mappings);
  }
  return result;
}

function toCamelCase(value) {
  return value.replaceAll(/-([a-z])/gu, (_, letter) => letter.toUpperCase());
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await createSourceIndexPackage(parseArgs(process.argv.slice(2)));
  console.log(JSON.stringify(result, null, 2));
}
