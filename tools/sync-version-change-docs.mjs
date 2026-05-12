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
const NEOFORGED_REPO = "https://github.com/neoforged/.github.git";
const MISODE_TECHNICAL_CHANGES_REPO =
  "https://github.com/misode/technical-changes.git";
const PACKAGE_ROOT = "packages/docs/version-changes";
const PAYLOAD_NAME = "version-changes.json";
const MAX_SUMMARY_CHARS = 700;
const MAX_PREVIEW_CHARS = 1200;

export async function syncVersionChangeDocs(input = {}) {
  const root = resolve(input.root ?? process.cwd());
  const tempRoot = await mkdtemp(join(tmpdir(), "mdm-version-changes-"));
  try {
    const neoforgedRoot = input.neoforgedRoot
      ? resolve(input.neoforgedRoot)
      : await cloneRepo(tempRoot, "neoforged-github", NEOFORGED_REPO, input.neoforgedRef);
    const misodeRoot = input.misodeRoot
      ? resolve(input.misodeRoot)
      : await cloneRepo(
          tempRoot,
          "misode-technical-changes",
          MISODE_TECHNICAL_CHANGES_REPO,
          input.misodeRef
        );
    const versions = await selectVersions({
      requestedVersions: parseRequestedVersions(input.versions),
      neoforgedRoot,
      misodeRoot
    });
    const upstreams = [
      await upstreamInfo(
        neoforgedRoot,
        "neoforged/.github",
        NEOFORGED_REPO,
        "NeoForged primer markdown under primers/<version>/."
      ),
      await upstreamInfo(
        misodeRoot,
        "misode/technical-changes",
        MISODE_TECHNICAL_CHANGES_REPO,
        "Technical changelog markdown under <version>/*.md."
      )
    ];
    const written = [];

    for (const version of versions) {
      const packageId = packageIdForVersion(version);
      const packageRoot = join(root, PACKAGE_ROOT, version);
      const payloadPath = join(packageRoot, "payload", PAYLOAD_NAME);
      const payload = await buildPayload({
        version,
        neoforgedRoot,
        misodeRoot,
        upstreams
      });

      await mkdir(dirname(payloadPath), { recursive: true });
      await writeFile(payloadPath, stableJson(payload));
      await writeFile(
        join(packageRoot, "package.json"),
        `${JSON.stringify(buildPackageManifest(version, packageId), null, 2)}\n`
      );
      written.push({
        packageId,
        packagePath: relative(root, join(packageRoot, "package.json")),
        payloadPath: relative(root, payloadPath)
      });
    }

    if (input.updateRegistry !== false) {
      await syncRegistry({ root });
    }

    return { packages: written };
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

async function selectVersions(input) {
  if (input.requestedVersions.length > 0) {
    return input.requestedVersions;
  }

  const neoforgedVersions = await collectNeoForgedVersions(input.neoforgedRoot);
  const misodeVersions = await collectMisodeVersions(input.misodeRoot);
  return [...new Set([...neoforgedVersions, ...misodeVersions])].sort(compareVersions);
}

function parseRequestedVersions(value) {
  if (value === undefined) {
    return [];
  }
  const values = Array.isArray(value) ? value : String(value).split(",");
  return [...new Set(values.map((entry) => String(entry).trim()).filter(Boolean))];
}

async function collectNeoForgedVersions(root) {
  const primersRoot = join(root, "primers");
  const entries = await readdir(primersRoot, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort(compareVersions);
}

async function collectMisodeVersions(root) {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((entry) => entry.isDirectory() && /^\d+(?:\.\d+)+$/u.test(entry.name))
    .map((entry) => entry.name)
    .sort(compareVersions);
}

async function buildPayload(input) {
  const neoforgedEntries = await buildNeoForgedEntries(
    input.version,
    input.neoforgedRoot
  );
  const misodeEntries = await buildMisodeEntries(input.version, input.misodeRoot);
  const entries = [
    overviewEntry(input.version, neoforgedEntries.length, misodeEntries.length),
    ...neoforgedEntries,
    ...misodeEntries
  ];

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    version: input.version,
    upstreams: input.upstreams,
    attribution: [
      {
        name: "NeoForged primers",
        url: "https://github.com/neoforged/.github/tree/main/primers",
        includedContent:
          "Compact searchable summaries, content hashes, source paths, headings, and previews."
      },
      {
        name: "misode technical changes",
        url: "https://github.com/misode/technical-changes",
        pageUrl: `https://misode.github.io/versions/?id=${input.version}&tab=changelog`,
        includedContent:
          "Compact searchable summaries, content hashes, source paths, headings, and previews."
      }
    ],
    entries
  };
}

function overviewEntry(version, neoforgedCount, misodeCount) {
  return {
    id: `minecraft-${version}-version-changes-overview`,
    kind: "upgrade-note",
    title: `Minecraft ${version} version-change sources`,
    summary:
      "Authoritative version-change evidence should combine NeoForged primers for loader migration notes with misode technical-changes markdown for vanilla data and resource format changes.",
    headings: [
      "NeoForged primers",
      "misode technical changes",
      "version migration"
    ],
    searchTerms: [
      version,
      "version changes",
      "technical changes",
      "changelog",
      "migration",
      "upgrade",
      "NeoForged primers",
      "misode changelog"
    ],
    codeSymbols: [
      `primers/${version}/index.md`,
      `${version}/*.md`,
      `https://misode.github.io/versions/?id=${version}&tab=changelog`
    ],
    metadata: {
      upstreamSourceCounts: {
        neoforgedPrimerEntries: neoforgedCount,
        misodeChangelogEntries: misodeCount
      },
      sourcePatterns: [
        "neoforged/.github:primers/<version>/index.md",
        "misode/technical-changes:<version>/*.md"
      ]
    }
  };
}

async function buildNeoForgedEntries(version, root) {
  const primerPath = join(root, "primers", version, "index.md");
  if (!(await pathIsFile(primerPath))) {
    return [];
  }

  const content = await readFile(primerPath, "utf-8");
  const repoPath = `primers/${version}/index.md`;
  const headings = markdownHeadings(content);
  return [
    {
      id: `minecraft-${version}-neoforged-primer`,
      kind: "upgrade-note",
      title: `NeoForged ${version} primer`,
      path: `neoforged/.github:${repoPath}`,
      headings: ["NeoForged primer", ...headings.slice(0, 10)],
      summary: firstParagraph(content) || `NeoForged migration primer for ${version}.`,
      searchTerms: [
        version,
        "NeoForged",
        "NeoForge",
        "primer",
        "primers",
        "migration",
        "version changes",
        ...headings.slice(0, 24)
      ],
      codeSymbols: [
        repoPath,
        `https://github.com/neoforged/.github/tree/main/primers/${version}`
      ],
      metadata: {
        upstream: "neoforged/.github",
        upstreamPath: repoPath,
        upstreamUrl: `https://github.com/neoforged/.github/blob/main/${repoPath}`,
        contentHash: sha256(content),
        preview: compactMarkdown(content).slice(0, MAX_PREVIEW_CHARS)
      }
    }
  ];
}

async function buildMisodeEntries(version, root) {
  const versionRoot = join(root, version);
  const files = (await readdir(versionRoot, { withFileTypes: true }).catch(() => []))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => join(versionRoot, entry.name))
    .sort(compareChangelogFiles);
  const entries = [];

  for (const file of files) {
    const content = await readFile(file, "utf-8");
    const fileName = basename(file);
    const repoPath = `${version}/${fileName}`;
    const slug = fileName.replace(/\.md$/u, "");
    const headings = markdownHeadings(content);

    entries.push({
      id: `minecraft-${version}-misode-${slug}`,
      kind: "migration-map",
      title: `misode ${slug} technical changes`,
      path: `misode/technical-changes:${repoPath}`,
      headings: ["misode technical changes", ...headings.slice(0, 10)],
      summary: firstParagraph(content) || `Technical changes for ${slug}.`,
      searchTerms: [
        version,
        slug,
        "misode",
        "technical changes",
        "changelog",
        "version changes",
        "datapack",
        "resourcepack",
        "pack_format",
        ...headings.slice(0, 24)
      ],
      codeSymbols: [
        repoPath,
        `https://github.com/misode/technical-changes/blob/main/${repoPath}`,
        `https://misode.github.io/versions/?id=${version}&tab=changelog`
      ],
      metadata: {
        upstream: "misode/technical-changes",
        upstreamPath: repoPath,
        upstreamUrl: `https://github.com/misode/technical-changes/blob/main/${repoPath}`,
        changelogPageUrl: `https://misode.github.io/versions/?id=${version}&tab=changelog`,
        contentHash: sha256(content),
        preview: compactMarkdown(content).slice(0, MAX_PREVIEW_CHARS)
      }
    });
  }

  return entries;
}

function markdownHeadings(content) {
  return content
    .split(/\r?\n/u)
    .map((line) => line.match(/^#{1,6}\s+(.+)$/u)?.[1]?.trim())
    .filter(Boolean)
    .map((heading) => heading.replace(/[`*_#]/gu, ""))
    .filter(Boolean);
}

function firstParagraph(content) {
  return compactMarkdown(content)
    .split(/\n{2,}/u)
    .map((paragraph) => paragraph.trim())
    .find((paragraph) => paragraph.length > 0)
    ?.slice(0, MAX_SUMMARY_CHARS);
}

function compactMarkdown(content) {
  return content
    .replace(/```[\s\S]*?```/gu, " ")
    .replace(/`([^`]+)`/gu, "$1")
    .split(/\r?\n/u)
    .map((line) => line.replace(/^#{1,6}\s*/u, "").trim())
    .filter((line) => line.length > 0)
    .join("\n\n");
}

function buildPackageManifest(version, packageId) {
  return {
    identity: {
      schemaVersion: 2,
      packageId,
      packageVersion: "0.1.0",
      namespace: "minecraft",
      displayName: `Minecraft ${version} Version Changes`,
      description:
        "Generated public version-change docs from NeoForged primers and misode technical changes."
    },
    target: {
      minecraftVersions: [version],
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
      preferredFallbacks: ["vanilla-schema-docs", "misode-generator-catalog"]
    },
    release: {
      channel: "docs",
      family: "minecraft-version-changes"
    }
  };
}

function packageIdForVersion(version) {
  return `minecraft-${version}-version-changes`;
}

function compareVersions(left, right) {
  return left.localeCompare(right, "en", { numeric: true });
}

function compareChangelogFiles(left, right) {
  return basename(left).localeCompare(basename(right), "en", { numeric: true });
}

function stableJson(value) {
  return `${JSON.stringify(value)}\n`;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function pathIsFile(path) {
  return stat(path)
    .then((details) => details.isFile())
    .catch(() => false);
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

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--root") {
      result.root = argv[index + 1];
      index += 1;
    } else if (argv[index] === "--version") {
      result.versions = [...(result.versions ?? []), argv[index + 1]];
      index += 1;
    } else if (argv[index] === "--versions") {
      result.versions = argv[index + 1];
      index += 1;
    } else if (argv[index] === "--neoforged-root") {
      result.neoforgedRoot = argv[index + 1];
      index += 1;
    } else if (argv[index] === "--neoforged-ref") {
      result.neoforgedRef = argv[index + 1];
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
  const result = await syncVersionChangeDocs(parseArgs(process.argv.slice(2)));
  console.log(JSON.stringify(result, null, 2));
}
