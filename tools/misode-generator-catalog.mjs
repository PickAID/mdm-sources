import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { syncRegistry } from "./sync-registry.mjs";

const execFileAsync = promisify(execFile);
const MISODE_REPO = "https://github.com/misode/misode.github.io.git";
const PACKAGE_ID = "misode-generator-catalog";
const PACKAGE_ROOT = "packages/docs/misode-generator-catalog";
const PAYLOAD_NAME = "generator-catalog.json";
const LEGACY_FOLDERS = new Set([
  "loot_table",
  "predicate",
  "item_modifier",
  "advancement",
  "recipe",
  "tag/function",
  "tag/item",
  "tag/block",
  "tag/fluid",
  "tag/entity_type",
  "tag/game_event"
]);

export async function syncMisodeGeneratorCatalog(input = {}) {
  const root = resolve(input.root ?? process.cwd());
  const tempRoot = await mkdtemp(join(tmpdir(), "mdm-misode-generator-catalog-"));
  try {
    const misodeRoot = input.misodeRoot
      ? resolve(input.misodeRoot)
      : await cloneRepo(tempRoot, "misode", MISODE_REPO, input.misodeRef);
    const packageRoot = join(root, PACKAGE_ROOT);
    const payloadPath = join(packageRoot, "payload", PAYLOAD_NAME);
    const config = JSON.parse(await readFile(join(misodeRoot, "src", "config.json"), "utf-8"));

    await mkdir(dirname(payloadPath), { recursive: true });
    await writeFile(payloadPath, stableJson(buildPayload(config, await upstreamInfo(misodeRoot))));
    await writeFile(
      join(packageRoot, "package.json"),
      `${JSON.stringify(buildPackageManifest(), null, 2)}\n`
    );
    if (input.updateRegistry !== false) {
      await syncRegistry({ root });
    }

    return {
      packages: [{
        packageId: PACKAGE_ID,
        packagePath: relative(root, join(packageRoot, "package.json")),
        payloadPath: relative(root, payloadPath)
      }]
    };
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

function buildPayload(config, upstream) {
  const versions = config.versions.map(normalizeVersion);
  const generators = config.generators.map((generator) =>
    normalizeGenerator(generator, versions)
  );
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    upstream,
    catalog: {
      versionCount: versions.length,
      generatorCount: generators.length,
      legacyPluralBefore: "1.21",
      legacyFolders: [...LEGACY_FOLDERS].sort()
    },
    entries: [
      overviewEntry(versions, generators),
      versionsEntry(versions),
      ...generators.map(generatorEntry)
    ]
  };
}

function normalizeVersion(version) {
  return {
    id: version.id,
    ref: version.ref,
    name: version.name,
    packFormat: version.pack_format,
    show: version.show === true,
    dynamic: version.dynamic === true
  };
}

function normalizeGenerator(generator, versions) {
  const tags = generator.tags ?? [];
  const domain = tags.includes("assets") ? "resourcepack" : "datapack";
  const basePath = generator.path ?? generator.id;
  const extension = generator.ext ?? ".json";
  return {
    id: generator.id,
    url: generator.url,
    aliases: generator.aliases ?? [],
    tags,
    dependency: generator.dependency,
    minVersion: generator.minVersion,
    maxVersion: generator.maxVersion,
    allowedVersionIds: allowedVersionIds(generator, versions),
    wiki: generator.wiki,
    domain,
    packSide: generator.noPath ? "virtual" : domain,
    pathRule: pathRule(generator, domain, basePath, extension)
  };
}

function allowedVersionIds(generator, versions) {
  return versions
    .filter((version) => versionInRange(version.id, generator.minVersion, generator.maxVersion, versions))
    .map((version) => version.id);
}

function versionInRange(versionId, minVersion, maxVersion, versions) {
  const versionIndex = versions.findIndex((version) => version.id === versionId);
  const minIndex = minVersion
    ? versions.findIndex((version) => version.id === minVersion)
    : 0;
  const maxIndex = maxVersion
    ? versions.findIndex((version) => version.id === maxVersion)
    : versions.length - 1;

  return versionIndex >= minIndex && versionIndex <= maxIndex;
}

function pathRule(generator, domain, basePath, extension) {
  if (generator.noPath) {
    return { kind: "no_path" };
  }
  if (generator.id === "pack_mcmeta") {
    return {
      kind: "root_file",
      path: "pack.mcmeta",
      extension: ".mcmeta"
    };
  }
  if (generator.id === "sounds") {
    return {
      kind: "namespaced_file",
      root: "assets",
      path: "",
      fileName: "sounds.json",
      extension: ".json"
    };
  }

  return {
    kind: "namespaced_file",
    root: domain === "resourcepack" ? "assets" : "data",
    path: basePath,
    extension,
    legacyPluralBefore: LEGACY_FOLDERS.has(generator.id) ? "1.21" : undefined,
    legacyPathBefore121: LEGACY_FOLDERS.has(generator.id) ? `${basePath}s` : undefined
  };
}

function overviewEntry(versions, generators) {
  return {
    id: `${PACKAGE_ID}-overview`,
    kind: "format-reference",
    title: "Misode generator catalog overview",
    summary:
      "Generated catalog of vanilla datapack and resource-pack generator ids, version bounds, path rules, and wiki references derived from misode config.json.",
    headings: ["misode", "generator catalog", "datapack", "resourcepack"],
    searchTerms: ["misode", "generator", "catalog", "datapack", "resourcepack", "path rule"],
    codeSymbols: ["ConfigGenerator", "genPath"],
    metadata: {
      versionCount: versions.length,
      generatorCount: generators.length,
      domains: countBy(generators, "domain")
    }
  };
}

function versionsEntry(versions) {
  return {
    id: `${PACKAGE_ID}-versions`,
    kind: "format-reference",
    title: "Misode Minecraft version matrix",
    summary: "Version ids, upstream refs, dynamic flags, and pack_format values used by misode generators.",
    headings: ["misode", "versions", "pack_format"],
    searchTerms: ["misode versions", "pack_format", "26.1", "1.21", "version matrix"],
    codeSymbols: ["VersionId", "pack_format"],
    metadata: { versions }
  };
}

function generatorEntry(generator) {
  return {
    id: `${PACKAGE_ID}-${slug(generator.id)}`,
    kind: "format-reference",
    title: `Misode generator ${generator.id}`,
    summary: `${generator.id} is a ${generator.domain} generator with ${generator.pathRule.kind} path handling.`,
    headings: ["misode", "generator", generator.domain, ...generator.tags],
    searchTerms: [
      "misode",
      "generator",
      generator.id,
      generator.url,
      generator.domain,
      generator.pathRule.path,
      ...(generator.aliases ?? []),
      ...(generator.tags ?? [])
    ].filter(Boolean),
    codeSymbols: [generator.id, generator.pathRule.path].filter(Boolean),
    metadata: { generator }
  };
}

function buildPackageManifest() {
  return {
    identity: {
      schemaVersion: 2,
      packageId: PACKAGE_ID,
      packageVersion: "0.1.0",
      namespace: "minecraft",
      displayName: "Misode Generator Catalog",
      description:
        "Generated public catalog of misode generator ids, version bounds, path rules, and wiki references for vanilla datapack and resource-pack formats."
    },
    target: {
      minecraftVersions: [],
      loaders: ["vanilla", "forge", "neoforge", "fabric", "quilt"]
    },
    artifact: {
      kind: "docs_bundle",
      format: "sqlite",
      schemaId: "mdm.docs.sqlite",
      schemaVersion: 3,
      entrypoint: `payload/${PAYLOAD_NAME}`
    },
    capabilities: [
      "docs_search",
      "docs_direct_read",
      "schema_reference",
      "datapack_trace",
      "resourcepack_trace"
    ],
    policy: {
      privacy: "public_release",
      lifecycle: ["downloadable", "auto_generated"],
      canCommitToRepository: true,
      canUploadToPublicRelease: true,
      requiresUserConsent: false
    },
    query: {
      adapter: "sqlite_docs",
      capabilities: [
        "docs_search",
        "docs_direct_read",
        "schema_reference",
        "datapack_trace",
        "resourcepack_trace"
      ],
      defaultLimit: 8,
      maxLimit: 50,
      preferredFallbacks: ["vanilla-schema-docs"]
    },
    release: {
      channel: "docs",
      family: "misode-generator-catalog"
    }
  };
}

function countBy(items, key) {
  return Object.fromEntries(
    Object.entries(items.reduce((acc, item) => {
      acc[item[key]] = (acc[item[key]] ?? 0) + 1;
      return acc;
    }, {})).sort(([left], [right]) => left.localeCompare(right))
  );
}

function slug(value) {
  return value.replace(/[^a-z0-9]+/giu, "-").replace(/^-|-$/gu, "").toLowerCase();
}

function stableJson(value) {
  return `${JSON.stringify(value)}\n`;
}

async function cloneRepo(tempRoot, name, repo, ref) {
  const target = join(tempRoot, name);
  const args = ["clone", "--depth", "1"];
  if (ref) {
    args.push("--branch", ref);
  }
  args.push(repo, target);
  await execFileAsync("git", args, { maxBuffer: 1024 * 1024 * 8 });
  return target;
}

async function upstreamInfo(root) {
  return {
    name: "misode/misode.github.io",
    url: MISODE_REPO,
    commit: await gitOutput(root, ["rev-parse", "HEAD"]),
    license: "MIT",
    includedContent: "Generator catalog metadata extracted from src/config.json."
  };
}

async function gitOutput(cwd, args) {
  const { stdout } = await execFileAsync("git", args, { cwd });
  return stdout.trim();
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--root") {
      result.root = argv[index + 1];
      index += 1;
    } else if (argv[index] === "--misode-root") {
      result.misodeRoot = argv[index + 1];
      index += 1;
    } else if (argv[index] === "--misode-ref") {
      result.misodeRef = argv[index + 1];
      index += 1;
    }
  }
  return result;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await syncMisodeGeneratorCatalog(parseArgs(process.argv.slice(2)));
  console.log(JSON.stringify(result, null, 2));
}
