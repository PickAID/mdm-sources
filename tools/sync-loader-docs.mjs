import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { syncRegistry } from "./sync-registry.mjs";

const execFileAsync = promisify(execFile);
const PACKAGE_ID = "minecraft-loader-docs";
const PACKAGE_ROOT = "packages/docs/loader-docs";
const PAYLOAD_NAME = "loader-docs.json";
const NEOFORGE_DOCS_REPO = "https://github.com/neoforged/Documentation.git";
const NEOFORGE_WEBSITES_REPO = "https://github.com/neoforged/websites.git";
const FORGE_DOCS_REPO = "https://github.com/MinecraftForge/Documentation.git";
const DEFAULT_FORGE_BRANCHES = [
  "1.21.x",
  "1.20.x",
  "1.20.1",
  "1.19.x",
  "1.18.x",
  "1.16.x",
  "1.12.x"
];
const CHAMPION_PRIMER_GISTS = [
  "c21724bafbc630da2ed8899fe0c1d226",
  "163a75e87599d19ee6b4b879821953e8",
  "cf818acc53ffea6f4387fe28c2977d56",
  "d895a7b1a34341e19c80870720f9880f",
  "53b04132e292aa12638d339abfabf955"
];
const MAX_SUMMARY_CHARS = 700;
const MAX_PREVIEW_CHARS = 1400;

export async function syncLoaderDocs(input = {}) {
  const root = resolve(input.root ?? process.cwd());
  const tempRoot = await mkdtemp(join(tmpdir(), "mdm-loader-docs-"));
  try {
    const neoforgeDocsRoot = input.neoforgeDocsRoot
      ? resolve(input.neoforgeDocsRoot)
      : await cloneRepo(tempRoot, "neoforge-docs", NEOFORGE_DOCS_REPO, input.neoforgeDocsRef);
    const neoforgeWebsitesRoot = input.neoforgeWebsitesRoot
      ? resolve(input.neoforgeWebsitesRoot)
      : await cloneRepo(
          tempRoot,
          "neoforge-websites",
          NEOFORGE_WEBSITES_REPO,
          input.neoforgeWebsitesRef
        );
    const forgeRoots = input.forgeDocsRoots
      ? normalizeForgeRoots(input.forgeDocsRoots)
      : await cloneForgeDocsBranches({
          tempRoot,
          branches: parseList(input.forgeBranches, DEFAULT_FORGE_BRANCHES)
        });
    const gistData = input.gistData ?? await fetchChampionPrimerGists({
      fetchImpl: input.fetchImpl ?? globalThis.fetch,
      gistIds: parseList(input.gistIds, CHAMPION_PRIMER_GISTS)
    });
    const payload = await buildPayload({
      neoforgeDocsRoot,
      neoforgeWebsitesRoot,
      forgeRoots,
      gistData
    });
    const packageRoot = join(root, PACKAGE_ROOT);
    const payloadPath = join(packageRoot, "payload", PAYLOAD_NAME);

    await mkdir(dirname(payloadPath), { recursive: true });
    await writeFile(payloadPath, stableJson(payload));
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

async function buildPayload(input) {
  const neoforgeDocsEntries = await buildNeoForgeDocsEntries(input.neoforgeDocsRoot);
  const neoforgeNewsEntries = await buildNeoForgeNewsEntries(input.neoforgeWebsitesRoot);
  const forgeDocsEntries = await buildForgeDocsEntries(input.forgeRoots);
  const championPrimerEntries = buildChampionPrimerEntries(input.gistData);
  const entries = [
    overviewEntry({
      neoforgeDocsEntries,
      neoforgeNewsEntries,
      forgeDocsEntries,
      championPrimerEntries
    }),
    ...neoforgeDocsEntries,
    ...neoforgeNewsEntries,
    ...forgeDocsEntries,
    ...championPrimerEntries
  ];

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    upstreams: [
      await upstreamInfo(
        input.neoforgeDocsRoot,
        "neoforged/Documentation",
        NEOFORGE_DOCS_REPO,
        "NeoForge official docs, versioned docs, user/modpack/toolchain docs, and repository primers."
      ),
      await upstreamInfo(
        input.neoforgeWebsitesRoot,
        "neoforged/websites",
        NEOFORGE_WEBSITES_REPO,
        "NeoForged official website news markdown under content/news."
      ),
      ...(await Promise.all(input.forgeRoots.map((item) =>
        upstreamInfo(
          item.root,
          `MinecraftForge/Documentation:${item.branch}`,
          FORGE_DOCS_REPO,
          `Forge official docs branch ${item.branch}.`
        )
      ))),
      ...input.gistData.map((gist) => ({
        name: `ChampionAsh5357 gist ${gist.id}`,
        url: gist.htmlUrl,
        commit: gist.historyVersion,
        includedContent: gist.description || "ChampionAsh5357 migration primer gist."
      }))
    ],
    attribution: [
      {
        name: "NeoForged official docs",
        url: "https://docs.neoforged.net/docs/",
        sourceUrl: "https://github.com/neoforged/Documentation",
        includedContent:
          "Compact searchable summaries, headings, source paths, upstream URLs, content hashes, and previews."
      },
      {
        name: "NeoForged official news",
        url: "https://neoforged.net/news/",
        sourceUrl: "https://github.com/neoforged/websites/tree/main/content/news",
        includedContent:
          "Compact searchable summaries, headings, source paths, upstream URLs, content hashes, and previews."
      },
      {
        name: "Forge official documentation",
        url: "https://docs.minecraftforge.net/",
        sourceUrl: "https://github.com/MinecraftForge/Documentation",
        includedContent:
          "Compact searchable summaries from selected maintained documentation branches."
      },
      {
        name: "ChampionAsh5357 migration primers",
        url: "https://gist.github.com/ChampionAsh5357",
        includedContent:
          "Selected high-signal migration primer gists pinned by id."
      }
    ],
    entries
  };
}

async function buildNeoForgeDocsEntries(root) {
  const files = [];
  await collectMarkdownFiles(root, files, (path) =>
    relative(root, path).startsWith(".git/") === false &&
    !relative(root, path).startsWith("node_modules/")
  );
  return buildMarkdownEntries({
    root,
    files: files.filter((file) => {
      const rel = relative(root, file).replaceAll("\\", "/");
      return (
        rel.startsWith("docs/") ||
        rel.startsWith("versioned_docs/") ||
        rel.startsWith("primer/") ||
        rel.startsWith("user/docs/") ||
        rel.startsWith("modpack/docs/") ||
        rel.startsWith("toolchain/docs/")
      );
    }),
    sourceKind: "neoforge-docs",
    packageKind: "loader-doc",
    titlePrefix: "NeoForge docs",
    pathPrefix: "neoforged/Documentation",
    upstreamUrlPrefix: "https://github.com/neoforged/Documentation/blob/main",
    publicUrlForPath: neoforgeDocsPublicUrl,
    baseSearchTerms: ["NeoForge", "NeoForged", "docs.neoforged.net", "modding docs"]
  });
}

async function buildNeoForgeNewsEntries(root) {
  const newsRoot = join(root, "content", "news");
  const files = [];
  await collectMarkdownFiles(newsRoot, files);
  return buildMarkdownEntries({
    root,
    files,
    sourceKind: "neoforge-news",
    packageKind: "release-note",
    titlePrefix: "NeoForged news",
    pathPrefix: "neoforged/websites",
    upstreamUrlPrefix: "https://github.com/neoforged/websites/blob/main",
    publicUrlForPath: neoforgeNewsPublicUrl,
    baseSearchTerms: ["NeoForge", "NeoForged", "news", "release notes", "neoforged.net/news"]
  });
}

async function buildForgeDocsEntries(forgeRoots) {
  const groups = await Promise.all(forgeRoots.map(async ({ branch, root }) => {
    const docsRoot = join(root, "docs");
    const files = [];
    await collectMarkdownFiles(docsRoot, files);
    return buildMarkdownEntries({
      root,
      files,
      sourceKind: `forge-docs-${branch}`,
      packageKind: "loader-doc",
      titlePrefix: `Forge docs ${branch}`,
      pathPrefix: `MinecraftForge/Documentation:${branch}`,
      upstreamUrlPrefix: `https://github.com/MinecraftForge/Documentation/blob/${branch}`,
      publicUrlForPath: (repoPath) => forgeDocsPublicUrl(branch, repoPath),
      baseSearchTerms: ["Forge", "MinecraftForge", "docs.minecraftforge.net", branch]
    });
  }));
  return groups.flat();
}

function buildChampionPrimerEntries(gists) {
  const entries = [];
  for (const gist of gists) {
    for (const file of gist.files) {
      if (!file.name.endsWith(".md") || file.name === "notice.md") {
        continue;
      }
      const headings = markdownHeadings(file.content);
      const frontmatter = parseFrontmatter(file.content);
      const compact = compactMarkdown(frontmatter.body);
      const title = frontmatter.data.title ?? headings[0] ?? gist.description ?? file.name;
      entries.push({
        id: `${PACKAGE_ID}-champion-primer-${slug(gist.id)}-${slug(file.name)}`,
        kind: "upgrade-note",
        title,
        path: `gist:ChampionAsh5357/${gist.id}/${file.name}`,
        headings: ["ChampionAsh5357 primer", ...headings.slice(0, 12)],
        summary: firstParagraph(compact) || title,
        searchTerms: [
          "ChampionAsh5357",
          "migration primer",
          "mod migration",
          "Forge",
          "NeoForge",
          gist.description,
          file.name,
          ...headings.slice(0, 24)
        ].filter(Boolean),
        codeSymbols: [
          file.name,
          file.rawUrl,
          gist.htmlUrl
        ],
        metadata: {
          upstream: "ChampionAsh5357 gist",
          gistId: gist.id,
          gistUrl: gist.htmlUrl,
          upstreamPath: file.name,
          upstreamUrl: file.rawUrl,
          contentHash: sha256(file.content),
          preview: compact.slice(0, MAX_PREVIEW_CHARS)
        }
      });
    }
  }
  return entries.sort((left, right) => left.path.localeCompare(right.path));
}

function buildMarkdownEntries(input) {
  return input.files.sort().map((file) => {
    const repoPath = relative(input.root, file).replaceAll("\\", "/");
    return markdownFileEntry({
      ...input,
      file,
      repoPath
    });
  });
}

function markdownFileEntry(input) {
  const content = readCachedFile(input.file);
  const frontmatter = parseFrontmatter(content);
  const compact = compactMarkdown(frontmatter.body);
  const headings = markdownHeadings(frontmatter.body);
  const title = frontmatter.data.title ?? headings[0] ?? titleFromPath(input.repoPath);
  const publicUrl = input.publicUrlForPath(input.repoPath);
  return {
    id: `${PACKAGE_ID}-${input.sourceKind}-${slug(input.repoPath)}`,
    kind: input.packageKind,
    title: `${input.titlePrefix}: ${title}`,
    path: `${input.pathPrefix}:${input.repoPath}`,
    headings: headings.slice(0, 14),
    summary: frontmatter.data.summary ?? firstParagraph(compact) ?? title,
    searchTerms: [
      ...input.baseSearchTerms,
      title,
      input.repoPath,
      ...headings.slice(0, 28),
      ...markdownCodeSymbols(frontmatter.body).slice(0, 40)
    ],
    codeSymbols: [
      input.repoPath,
      publicUrl,
      ...markdownCodeSymbols(frontmatter.body).slice(0, 40)
    ].filter(Boolean),
    metadata: {
      upstream: input.pathPrefix,
      upstreamPath: input.repoPath,
      upstreamUrl: `${input.upstreamUrlPrefix}/${input.repoPath}`,
      publicUrl,
      contentHash: sha256(content),
      frontmatter: frontmatter.data,
      preview: compact.slice(0, MAX_PREVIEW_CHARS)
    }
  };
}

const fileCache = new Map();

function readCachedFile(path) {
  const cached = fileCache.get(path);
  if (cached !== undefined) {
    return cached;
  }
  throw new Error(`file content was not preloaded: ${path}`);
}

async function collectMarkdownFiles(directory, files, predicate = () => true) {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      await collectMarkdownFiles(path, files, predicate);
    } else if (
      entry.isFile() &&
      (entry.name.endsWith(".md") || entry.name.endsWith(".mdx")) &&
      predicate(path)
    ) {
      files.push(path);
      fileCache.set(path, await readFile(path, "utf-8"));
    }
  }
}

function overviewEntry(counts) {
  return {
    id: `${PACKAGE_ID}-overview`,
    kind: "loader-doc",
    title: "Minecraft loader documentation sources",
    summary:
      "Authoritative loader documentation bundle covering NeoForged docs, NeoForged news, Forge docs, and selected ChampionAsh5357 migration primers.",
    headings: ["NeoForge docs", "NeoForge news", "Forge docs", "ChampionAsh5357 primers"],
    searchTerms: [
      "NeoForge",
      "NeoForged",
      "Forge",
      "MinecraftForge",
      "loader docs",
      "migration primer",
      "docs.neoforged.net",
      "docs.minecraftforge.net",
      "neoforged.net/news"
    ],
    codeSymbols: [
      "https://docs.neoforged.net/docs/",
      "https://neoforged.net/news/",
      "https://docs.minecraftforge.net/",
      "https://gist.github.com/ChampionAsh5357"
    ],
    metadata: {
      upstreamSourceCounts: {
        neoforgeDocsEntries: counts.neoforgeDocsEntries.length,
        neoforgeNewsEntries: counts.neoforgeNewsEntries.length,
        forgeDocsEntries: counts.forgeDocsEntries.length,
        championPrimerEntries: counts.championPrimerEntries.length
      }
    }
  };
}

function buildPackageManifest() {
  return {
    identity: {
      schemaVersion: 2,
      packageId: PACKAGE_ID,
      packageVersion: "0.1.0",
      namespace: "minecraft",
      displayName: "Minecraft Loader Documentation",
      description:
        "Generated public loader documentation index from NeoForged docs/news, Forge docs, and selected ChampionAsh5357 migration primers."
    },
    target: {
      minecraftVersions: [],
      loaders: ["forge", "neoforge"]
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
      "datapack_trace",
      "resourcepack_trace"
    ],
    policy: {
      privacy: "public_release",
      lifecycle: ["downloadable", "auto_generated", "refreshable"],
      canCommitToRepository: true,
      canUploadToPublicRelease: true,
      requiresUserConsent: false
    },
    query: {
      adapter: "sqlite_docs",
      capabilities: [
        "docs_search",
        "docs_direct_read",
        "datapack_trace",
        "resourcepack_trace"
      ],
      defaultLimit: 8,
      maxLimit: 50,
      preferredFallbacks: ["minecraft-version-changes", "vanilla-schema-docs"]
    },
    release: {
      channel: "docs",
      family: "minecraft-loader-docs"
    }
  };
}

function parseFrontmatter(content) {
  if (!content.startsWith("---")) {
    return { data: {}, body: content };
  }
  const end = content.indexOf("\n---", 3);
  if (end < 0) {
    return { data: {}, body: content };
  }
  const raw = content.slice(3, end).trim();
  return {
    data: parseSimpleYaml(raw),
    body: content.slice(end + 4).trimStart()
  };
}

function parseSimpleYaml(raw) {
  const data = {};
  const lines = raw.split(/\r?\n/u);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/u);
    if (!match) {
      continue;
    }
    const [, key, value] = match;
    if (value === "") {
      const values = [];
      for (let next = index + 1; next < lines.length; next += 1) {
        const listMatch = lines[next].match(/^\s*-\s*(.+)$/u);
        if (!listMatch) {
          break;
        }
        values.push(unquote(listMatch[1].trim()));
        index = next;
      }
      data[key] = values;
    } else {
      data[key] = unquote(value.trim());
    }
  }
  return data;
}

function unquote(value) {
  return value.replace(/^["']|["']$/gu, "");
}

function markdownHeadings(content) {
  const atx = content
    .split(/\r?\n/u)
    .map((line) => line.match(/^#{1,6}\s+(.+)$/u)?.[1]?.trim())
    .filter(Boolean);
  const setext = [];
  const lines = content.split(/\r?\n/u);
  for (let index = 0; index < lines.length - 1; index += 1) {
    if (/^(?:=+|-+)\s*$/u.test(lines[index + 1]) && lines[index].trim()) {
      setext.push(lines[index].trim());
    }
  }
  return [...atx, ...setext]
    .map((heading) => heading.replace(/[`*_#]/gu, ""))
    .filter(Boolean);
}

function markdownCodeSymbols(content) {
  const matches = content.match(/`[^`\n]{2,80}`/gu) ?? [];
  return [...new Set(matches.map((item) => item.slice(1, -1)).filter(Boolean))];
}

function compactMarkdown(content) {
  return content
    .replace(/```[\s\S]*?```/gu, " ")
    .replace(/<[^>]+>/gu, " ")
    .replace(/`([^`]+)`/gu, "$1")
    .replace(/\{\{<[^>]+>\}\}/gu, " ")
    .split(/\r?\n/u)
    .map((line) => line.replace(/^#{1,6}\s*/u, "").trim())
    .filter((line) => line.length > 0)
    .join("\n\n");
}

function firstParagraph(content) {
  return content
    .split(/\n{2,}/u)
    .map((paragraph) => paragraph.trim())
    .find((paragraph) => paragraph.length > 0)
    ?.slice(0, MAX_SUMMARY_CHARS);
}

function titleFromPath(path) {
  return basename(path)
    .replace(/\.(?:md|mdx)$/u, "")
    .replace(/[-_]+/gu, " ")
    .replace(/\b\w/gu, (letter) => letter.toUpperCase());
}

function neoforgeDocsPublicUrl(repoPath) {
  if (repoPath.startsWith("docs/")) {
    return `https://docs.neoforged.net/docs/${repoPath.slice("docs/".length).replace(/\.(?:md|mdx)$/u, "")}/`;
  }
  const versionMatch = repoPath.match(/^versioned_docs\/version-([^/]+)\/(.+)\.(?:md|mdx)$/u);
  if (versionMatch) {
    return `https://docs.neoforged.net/docs/${versionMatch[1]}/${versionMatch[2]}/`;
  }
  return `https://docs.neoforged.net/${repoPath.replace(/\.(?:md|mdx)$/u, "")}/`;
}

function neoforgeNewsPublicUrl(repoPath) {
  const match = repoPath.match(/^content\/news\/(.+)\.(?:md|mdx)$/u);
  return match ? `https://neoforged.net/news/${match[1]}/` : "https://neoforged.net/news/";
}

function forgeDocsPublicUrl(branch, repoPath) {
  const path = repoPath.replace(/^docs\//u, "").replace(/\.(?:md|mdx)$/u, "");
  return `https://docs.minecraftforge.net/en/${branch}/${path}/`;
}

function normalizeForgeRoots(value) {
  if (Array.isArray(value)) {
    return value.map((item) => ({
      branch: item.branch,
      root: resolve(item.root)
    }));
  }
  return Object.entries(value).map(([branch, root]) => ({ branch, root: resolve(root) }));
}

async function cloneForgeDocsBranches(input) {
  const result = [];
  for (const branch of input.branches) {
    result.push({
      branch,
      root: await cloneRepo(
        input.tempRoot,
        `forge-docs-${slug(branch)}`,
        FORGE_DOCS_REPO,
        branch
      )
    });
  }
  return result;
}

async function fetchChampionPrimerGists(input) {
  if (typeof input.fetchImpl !== "function") {
    throw new Error("fetch is required to sync ChampionAsh5357 primer gists.");
  }
  const result = [];
  for (const gistId of input.gistIds) {
    const response = await input.fetchImpl(`https://api.github.com/gists/${gistId}`);
    if (!response.ok) {
      throw new Error(`Failed to fetch gist ${gistId}: ${response.status}`);
    }
    const gist = await response.json();
    const files = [];
    for (const file of Object.values(gist.files ?? {})) {
      if (!file?.raw_url || !file.filename) {
        continue;
      }
      const contentResponse = await input.fetchImpl(file.raw_url);
      if (!contentResponse.ok) {
        throw new Error(`Failed to fetch gist file ${file.filename}: ${contentResponse.status}`);
      }
      files.push({
        name: file.filename,
        rawUrl: file.raw_url,
        content: await contentResponse.text()
      });
    }
    result.push({
      id: gist.id,
      description: gist.description,
      htmlUrl: gist.html_url,
      historyVersion: gist.history?.[0]?.version,
      files
    });
  }
  return result;
}

function parseList(value, fallback) {
  if (value === undefined) {
    return fallback;
  }
  const values = Array.isArray(value) ? value : String(value).split(",");
  return [...new Set(values.map((entry) => String(entry).trim()).filter(Boolean))];
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

async function upstreamInfo(root, name, url, includedContent) {
  return {
    name,
    url,
    commit: await gitOutput(root, ["rev-parse", "HEAD"]),
    includedContent
  };
}

async function gitOutput(cwd, args) {
  const { stdout } = await execFileAsync("git", args, { cwd });
  return stdout.trim();
}

async function pathIsFile(path) {
  return stat(path)
    .then((details) => details.isFile())
    .catch(() => false);
}

function stableJson(value) {
  return `${JSON.stringify(value)}\n`;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function slug(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, "");
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--root") {
      result.root = argv[index + 1];
      index += 1;
    } else if (argv[index] === "--neoforge-docs-root") {
      result.neoforgeDocsRoot = argv[index + 1];
      index += 1;
    } else if (argv[index] === "--neoforge-websites-root") {
      result.neoforgeWebsitesRoot = argv[index + 1];
      index += 1;
    } else if (argv[index] === "--forge-branch" || argv[index] === "--forge-branches") {
      result.forgeBranches = argv[index + 1];
      index += 1;
    }
  }
  return result;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await syncLoaderDocs(parseArgs(process.argv.slice(2)));
  console.log(JSON.stringify(result, null, 2));
}
