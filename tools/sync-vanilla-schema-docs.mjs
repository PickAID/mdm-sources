import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { syncRegistry } from "./sync-registry.mjs";

const execFileAsync = promisify(execFile);
const VANILLA_MCDOC_REPO = "https://github.com/SpyglassMC/vanilla-mcdoc.git";
const MISODE_REPO = "https://github.com/misode/misode.github.io.git";
const PACKAGE_ROOT = "packages/docs/vanilla-schema-docs";
const PACKAGE_ID = "vanilla-schema-docs";
const PAYLOAD_NAME = "explanations.json";
const PACKAGE_CONFIGS = {
  datapack: {
    domain: "datapack",
    mcdocPattern: /\/data\//u,
    capabilities: ["schema_reference", "mcdoc_reference", "datapack_trace"]
  },
  resourcepack: {
    domain: "resource-pack",
    mcdocPattern: /\/assets\//u,
    capabilities: ["schema_reference", "mcdoc_reference", "resourcepack_trace"]
  }
};
const MAX_MCDOC_FILES = 80;
const MAX_MCDOC_PREVIEW_CHARS = 1600;
const MAX_MISODE_PREVIEW_CHARS = 1600;
const MAX_PAYLOAD_BYTES = 512 * 1024;
const MAX_PAYLOAD_LINES = 1;
const MAX_PAYLOAD_ENTRIES = 220;

export async function syncVanillaSchemaDocs(input = {}) {
  const root = resolve(input.root ?? process.cwd());
  const tempRoot = await mkdtemp(join(tmpdir(), "mdm-vanilla-schema-docs-"));
  try {
    const vanillaRoot = input.vanillaMcdocRoot
      ? resolve(input.vanillaMcdocRoot)
      : await cloneRepo(tempRoot, "vanilla-mcdoc", VANILLA_MCDOC_REPO, input.vanillaMcdocRef);
    const misodeRoot = input.misodeRoot
      ? resolve(input.misodeRoot)
      : await cloneRepo(tempRoot, "misode", MISODE_REPO, input.misodeRef);
    const configs = selectPackageConfigs(input.kind);
    const packageRoot = join(root, PACKAGE_ROOT);
    const payloadPath = join(packageRoot, "payload", PAYLOAD_NAME);

    await mkdir(dirname(payloadPath), { recursive: true });
    const payloadText = stableJson(await buildPayload({ vanillaRoot, misodeRoot, configs }));
    assertPayloadBudget(payloadText);
    await writeFile(payloadPath, payloadText);
    await writeFile(
      join(packageRoot, "package.json"),
      `${JSON.stringify(buildPackageManifest(configs), null, 2)}\n`
    );
    const written = [{
      packageId: PACKAGE_ID,
      packagePath: relative(root, join(packageRoot, "package.json")),
      payloadPath: relative(root, payloadPath)
    }];
    if (input.updateRegistry !== false) {
      await syncRegistry({ root });
    }

    return { packages: written };
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

async function buildPayload(input) {
  const mcdocFiles = await collectFiles(join(input.vanillaRoot, "java"), ".mcdoc");
  const domainEntries = await Promise.all(input.configs.map(async (config) => {
    const selectedMcdoc = mcdocFiles
      .filter((file) => config.mcdocPattern.test(toPosix(relative(input.vanillaRoot, file))))
      .slice(0, MAX_MCDOC_FILES);
    const misodeFiles = await collectMisodeReferenceFiles(input.misodeRoot, config);

    return [
      buildOverviewEntry(selectedMcdoc, misodeFiles, config),
      ...(await Promise.all(selectedMcdoc.map((file) =>
        buildMcdocEntry(input.vanillaRoot, file, config)
      ))),
      ...(await Promise.all(misodeFiles.map((file) =>
        buildMisodeEntry(input.misodeRoot, file, config)
      )))
    ];
  }));

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    upstreams: [
      await upstreamInfo(input.vanillaRoot, "SpyglassMC/vanilla-mcdoc", VANILLA_MCDOC_REPO),
      await upstreamInfo(input.misodeRoot, "misode/misode.github.io", MISODE_REPO)
    ],
    attribution: [
      {
        name: "SpyglassMC/vanilla-mcdoc",
        url: VANILLA_MCDOC_REPO,
        license: "MIT",
        includedContent: "Compact schema previews, content hashes, source paths, and symbols."
      },
      {
        name: "misode/misode.github.io",
        url: MISODE_REPO,
        license: "MIT",
        includedContent:
          "Compact generator/interpreter source previews, content hashes, source paths, and symbols."
      }
    ],
    entries: domainEntries.flat()
  };
}

function buildOverviewEntry(mcdocFiles, misodeFiles, config) {
  return {
    id: `${PACKAGE_ID}-${domainSlug(config)}-overview`,
    kind: "format-reference",
    title: `Vanilla ${config.domain} schema sources`,
    summary:
      `Explains that vanilla ${config.domain} JSON shape should be derived from Spyglass vanilla-mcdoc schemas, while generator/editor behavior should be checked against misode source files before writing version-sensitive JSON.`,
    headings: ["vanilla-mcdoc", "misode generator logic", config.domain],
    searchTerms: [
      "vanilla-mcdoc",
      "mcdoc",
      "misode",
      `${config.domain} schema`,
      "recipe",
      "loot table",
      "model",
      "blockstate"
    ],
    codeSymbols: [],
    sourceFiles: {
      vanillaMcdocCount: mcdocFiles.length,
      misodeReferenceCount: misodeFiles.length
    }
  };
}

async function buildMcdocEntry(root, file, config) {
  const repoPath = toPosix(relative(root, file));
  const content = await readFile(file, "utf-8");
  const topic = basename(file, ".mcdoc").replaceAll("_", " ");

  return {
    id: `${PACKAGE_ID}-${domainSlug(config)}-mcdoc-${repoPath.replaceAll("/", "-").replace(/\.mcdoc$/u, "")}`,
    kind: "format-reference",
    title: `vanilla-mcdoc ${topic}`,
    path: `vanilla-mcdoc:${repoPath}`,
    headings: [config.domain, topic, "mcdoc"],
    summary: `Schema source for ${topic} ${config.domain} data. Use this before inventing JSON fields or relying on stale examples.`,
    searchTerms: [
      "vanilla-mcdoc",
      "mcdoc",
      config.domain,
      topic,
      repoPath,
      ...extractMcdocSymbols(content).slice(0, 12)
    ],
    codeSymbols: extractMcdocSymbols(content).slice(0, 24),
    upstreamPath: repoPath,
    contentHash: sha256(content),
    preview: content.slice(0, MAX_MCDOC_PREVIEW_CHARS)
  };
}

async function buildMisodeEntry(root, file, config) {
  const repoPath = toPosix(relative(root, file));
  const name = basename(file).replace(/\.[^.]+$/u, "");
  const content = await readFile(file, "utf-8");

  return {
    id: `${PACKAGE_ID}-${domainSlug(config)}-misode-${repoPath.replaceAll("/", "-").replace(/\.[^.]+$/u, "")}`,
    kind: "api-proof",
    title: `misode generator logic ${name}`,
    path: `misode:${repoPath}`,
    headings: ["misode", "generator", "interpreter logic"],
    summary:
      "Reference implementation source for generator/editor behavior. Use as a logic source after schema lookup, not as a copied payload.",
    searchTerms: [
      "misode",
      "generator",
      "interpreter",
      "schema renderer",
      "datapack generator",
      "resourcepack generator",
      repoPath
    ],
    codeSymbols: [name, ...extractTypeScriptSymbols(content).slice(0, 20)],
    upstreamPath: repoPath,
    contentHash: sha256(content),
    preview: content.slice(0, MAX_MISODE_PREVIEW_CHARS)
  };
}

async function collectMisodeReferenceFiles(root, config) {
  const files = await collectFiles(join(root, "src", "app"), ".ts", ".tsx");
  const useful = files.filter((file) => {
    const path = toPosix(relative(root, file));
    const shared = /components\/generator|services\/(?:Spyglass|Source|Resources|Versions)|contexts\/Spyglass|pages\/Generator|Config\.ts/u.test(path);
    const preview = config.domain === "datapack"
      ? /components\/previews\/(?:Recipe|LootTable|Biome|Noise|Structure|Density|Decorator)/u.test(path)
      : /components\/previews\/(?:Model|ItemModel|BlockState|Colormap)/u.test(path);
    return shared || preview;
  });

  return useful.slice(0, 80);
}

async function collectFiles(root, ...extensions) {
  const result = [];
  await walk(root, result, extensions);
  return result.sort();
}

async function walk(directory, result, extensions) {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      await walk(path, result, extensions);
    } else if (entry.isFile() && extensions.some((extension) => entry.name.endsWith(extension))) {
      result.push(path);
    }
  }
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

async function upstreamInfo(root, name, url) {
  return {
    name,
    url,
    commit: await gitOutput(root, ["rev-parse", "HEAD"]),
    license: "MIT"
  };
}

async function gitOutput(cwd, args) {
  const { stdout } = await execFileAsync("git", args, { cwd });
  return stdout.trim();
}

function extractMcdocSymbols(content) {
  const symbols = new Set();
  for (const match of content.matchAll(/\b(?:struct|enum|type|dispatch|module)\s+([A-Za-z0-9_.$:-]+)/gu)) {
    symbols.add(match[1]);
  }
  return [...symbols];
}

function extractTypeScriptSymbols(content) {
  const symbols = new Set();
  const patterns = [
    /\b(?:export\s+)?(?:class|interface|type|enum|function)\s+([A-Za-z0-9_$]+)/gu,
    /\b(?:const|let|var)\s+([A-Za-z0-9_$]+)\s*=/gu
  ];

  for (const pattern of patterns) {
    for (const match of content.matchAll(pattern)) {
      symbols.add(match[1]);
    }
  }

  return [...symbols];
}

function buildPackageManifest(configs) {
  const capabilities = [...new Set(configs.flatMap((config) => config.capabilities))];

  return {
    identity: {
      schemaVersion: 2,
      packageId: PACKAGE_ID,
      packageVersion: "0.1.0",
      namespace: "minecraft",
      displayName: "Vanilla Schema Docs",
      description:
        "Generated public explanation docs from Spyglass vanilla-mcdoc and misode generator metadata for vanilla datapack and resource-pack formats."
    },
    target: {
      minecraftVersions: [],
      loaders: ["vanilla", "forge", "neoforge", "fabric", "quilt"]
    },
    artifact: {
      kind: "docs_bundle",
      format: "json",
      schemaId: "mdm.explanation-docs.json",
      schemaVersion: 1,
      entrypoint: `payload/${PAYLOAD_NAME}`
    },
    capabilities: [
      "docs_search",
      "docs_direct_read",
      ...capabilities
    ],
    policy: {
      privacy: "public_release",
      lifecycle: ["downloadable", "auto_generated"],
      canCommitToRepository: true,
      canUploadToPublicRelease: true,
      requiresUserConsent: false
    },
    query: {
      adapter: "json_docs",
      capabilities: [
        "docs_search",
        "docs_direct_read",
        ...capabilities
      ],
      defaultLimit: 8,
      maxLimit: 50,
      preferredFallbacks: []
    },
    release: {
      channel: "docs",
      family: "vanilla-schema-docs"
    }
  };
}

function selectPackageConfigs(kind = "all") {
  if (kind === "all") {
    return [PACKAGE_CONFIGS.datapack, PACKAGE_CONFIGS.resourcepack];
  }
  throw new Error(
    `Unsupported --kind ${kind}. vanilla-schema-docs is a single package; use --kind all.`
  );
}

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

function domainSlug(config) {
  return config.domain.replace(/[^a-z0-9]+/gu, "-");
}

function toPosix(path) {
  return path.replaceAll("\\", "/");
}

function stableJson(value) {
  return `${JSON.stringify(value)}\n`;
}

function assertPayloadBudget(payloadText) {
  const payload = JSON.parse(payloadText);
  const lineCount = payloadText.split("\n").length - 1;
  if (Buffer.byteLength(payloadText) > MAX_PAYLOAD_BYTES) {
    throw new Error(`vanilla-schema-docs payload exceeds ${MAX_PAYLOAD_BYTES} bytes.`);
  }
  if (lineCount > MAX_PAYLOAD_LINES) {
    throw new Error(`vanilla-schema-docs payload exceeds ${MAX_PAYLOAD_LINES} line.`);
  }
  if ((payload.entries?.length ?? 0) > MAX_PAYLOAD_ENTRIES) {
    throw new Error(`vanilla-schema-docs payload exceeds ${MAX_PAYLOAD_ENTRIES} entries.`);
  }
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--root") {
      result.root = argv[++index];
    } else if (arg === "--vanillaMcdocRoot") {
      result.vanillaMcdocRoot = argv[++index];
    } else if (arg === "--misodeRoot") {
      result.misodeRoot = argv[++index];
    } else if (arg === "--vanillaMcdocRef") {
      result.vanillaMcdocRef = argv[++index];
    } else if (arg === "--misodeRef") {
      result.misodeRef = argv[++index];
    } else if (arg === "--kind") {
      result.kind = argv[++index];
    } else if (arg === "--no-registry-update") {
      result.updateRegistry = false;
    }
  }
  return result;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await syncVanillaSchemaDocs(parseArgs(process.argv.slice(2)));
  console.log(JSON.stringify(result, null, 2));
}
