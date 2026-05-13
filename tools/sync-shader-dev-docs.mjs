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
const PACKAGE_ID = "shader-dev-docs";
const PACKAGE_ROOT = "packages/docs/shader-dev";
const PAYLOAD_NAME = "shader-dev-docs.json";
const MINIMAX_SKILLS_REPO = "https://github.com/MiniMax-AI/skills.git";
const SHADER_DEV_ROOT = "skills/shader-dev";
const MAX_SUMMARY_CHARS = 700;
const MAX_PREVIEW_CHARS = 1400;

export async function syncShaderDevDocs(input = {}) {
  const root = resolve(input.root ?? process.cwd());
  const tempRoot = await mkdtemp(join(tmpdir(), "mdm-shader-dev-docs-"));
  try {
    const skillsRoot = input.skillsRoot
      ? resolve(input.skillsRoot)
      : await cloneRepo(tempRoot, "minimax-skills", MINIMAX_SKILLS_REPO, input.skillsRef);
    const payload = await buildPayload(skillsRoot);
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

async function buildPayload(skillsRoot) {
  const shaderRoot = join(skillsRoot, SHADER_DEV_ROOT);
  const files = [];
  await collectMarkdownFiles(shaderRoot, files);
  const entries = [
    overviewEntry(files.length),
    ...(await buildMarkdownEntries({ root: skillsRoot, files }))
  ];

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    upstreams: [
      await upstreamInfo(
        skillsRoot,
        "MiniMax-AI/skills:shader-dev",
        MINIMAX_SKILLS_REPO,
        "MiniMax shader-dev skill markdown under skills/shader-dev, including SKILL.md, techniques, and reference docs."
      )
    ],
    attribution: [
      {
        name: "MiniMax shader-dev skill",
        url: "https://github.com/MiniMax-AI/skills/tree/main/skills/shader-dev",
        includedContent:
          "Compact searchable summaries, headings, source paths, upstream URLs, content hashes, and previews for all markdown files under skills/shader-dev."
      }
    ],
    entries
  };
}

async function buildMarkdownEntries(input) {
  const entries = [];
  for (const file of input.files.sort()) {
    const repoPath = relative(input.root, file).replaceAll("\\", "/");
    const content = await readFile(file, "utf-8");
    entries.push(markdownFileEntry({ repoPath, content }));
  }

  return entries;
}

function markdownFileEntry(input) {
  const frontmatter = parseFrontmatter(input.content);
  const compact = compactMarkdown(frontmatter.body);
  const headings = markdownHeadings(frontmatter.body);
  const title = frontmatter.data.title ?? headings[0] ?? titleFromPath(input.repoPath);
  const localPath = input.repoPath.slice(`${SHADER_DEV_ROOT}/`.length);
  const category = localPath === "SKILL.md" ? "skill" : localPath.split("/")[0];

  return {
    id: `${PACKAGE_ID}-${slug(localPath)}`,
    kind: category === "techniques" ? "shader-technique" : "shader-reference",
    title: `MiniMax shader-dev: ${title}`,
    path: `MiniMax-AI/skills:${input.repoPath}`,
    headings: headings.slice(0, 14),
    summary: frontmatter.data.description ?? firstContentParagraph(frontmatter.body) ?? firstParagraph(compact) ?? title,
    searchTerms: [
      "shader-dev",
      "MiniMax-AI skills",
      "GLSL",
      "ShaderToy",
      "WebGL2",
      "fragment shader",
      "vertex shader",
      "shader",
      category,
      title,
      input.repoPath,
      ...termsFromPath(localPath),
      ...shaderKeywordTerms(`${localPath}\n${frontmatter.body}`),
      ...headings.slice(0, 28),
      ...markdownCodeSymbols(frontmatter.body).slice(0, 40)
    ].filter(Boolean),
    codeSymbols: [
      input.repoPath,
      upstreamUrl(input.repoPath),
      ...markdownCodeSymbols(frontmatter.body).slice(0, 40)
    ],
    metadata: {
      upstream: "MiniMax-AI/skills",
      upstreamPath: input.repoPath,
      upstreamUrl: upstreamUrl(input.repoPath),
      category,
      contentHash: sha256(input.content),
      frontmatter: frontmatter.data,
      preview: compact.slice(0, MAX_PREVIEW_CHARS)
    }
  };
}

function overviewEntry(markdownFileCount) {
  return {
    id: `${PACKAGE_ID}-overview`,
    kind: "shader-reference",
    title: "MiniMax shader-dev documentation sources",
    summary:
      "Generated shader documentation bundle covering MiniMax shader-dev SKILL.md, technique guides, and reference guides for GLSL, ShaderToy, WebGL2, ray marching, SDF, simulation, procedural generation, lighting, and post-processing.",
    headings: ["Shader Craft", "Techniques", "Reference", "GLSL", "WebGL2"],
    searchTerms: [
      "shader-dev",
      "MiniMax-AI skills",
      "GLSL",
      "ShaderToy",
      "WebGL2",
      "ray marching",
      "raymarching",
      "SDF",
      "signed distance functions",
      "fragment shader",
      "vertex shader",
      "post-processing",
      "procedural noise",
      "particle system",
      "fluid simulation",
      "volumetric rendering",
      "着色器",
      "光线步进"
    ],
    codeSymbols: [
      "https://github.com/MiniMax-AI/skills/tree/main/skills/shader-dev",
      "skills/shader-dev/SKILL.md",
      "skills/shader-dev/techniques/*.md",
      "skills/shader-dev/reference/*.md"
    ],
    metadata: {
      upstreamSourceCounts: {
        markdownFileCount
      },
      sourcePatterns: [
        "MiniMax-AI/skills:skills/shader-dev/SKILL.md",
        "MiniMax-AI/skills:skills/shader-dev/techniques/*.md",
        "MiniMax-AI/skills:skills/shader-dev/reference/*.md"
      ]
    }
  };
}

function buildPackageManifest() {
  return {
    identity: {
      schemaVersion: 2,
      packageId: PACKAGE_ID,
      packageVersion: "0.1.0",
      namespace: "shader",
      displayName: "Shader Development Documentation",
      description:
        "Generated public shader-dev docs index from MiniMax-AI shader-dev skill techniques and references."
    },
    target: {
      minecraftVersions: [],
      loaders: []
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
      "shader_reference",
      "glsl_reference"
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
        "shader_reference",
        "glsl_reference"
      ],
      defaultLimit: 8,
      maxLimit: 50,
      preferredFallbacks: ["minecraft-loader-docs", "vanilla-schema-docs"]
    },
    release: {
      channel: "docs",
      family: "shader-dev-docs"
    }
  };
}

async function collectMarkdownFiles(directory, files) {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      await collectMarkdownFiles(path, files);
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(path);
    }
  }
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
  for (const line of lines) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/u);
    if (match) {
      data[match[1]] = unquote(match[2].trim());
    }
  }
  return data;
}

function unquote(value) {
  return value.replace(/^["']|["']$/gu, "");
}

function markdownHeadings(content) {
  return content
    .split(/\r?\n/u)
    .map((line) => line.match(/^#{1,6}\s+(.+)$/u)?.[1]?.trim())
    .filter(Boolean)
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

function firstContentParagraph(content) {
  return content
    .replace(/```[\s\S]*?```/gu, " ")
    .split(/\n{2,}/u)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => !/^#{1,6}\s+/u.test(paragraph))
    .filter((paragraph) => !/^(?:[-*+]\s+|\d+\.\s+|\|)/u.test(paragraph))
    .map((paragraph) => compactMarkdown(paragraph))
    .find((paragraph) => paragraph.length > 0)
    ?.slice(0, MAX_SUMMARY_CHARS);
}

function termsFromPath(path) {
  const stem = path
    .replace(/\.md$/u, "")
    .split("/");
  return stem
    .flatMap((part) => [
      part,
      part.replace(/-/gu, " "),
      ...part.split("-")
    ])
    .filter(Boolean);
}

function shaderKeywordTerms(content) {
  const terms = [
    ["GLSL", /\bglsl\b/u],
    ["ShaderToy", /\bshadertoy\b/u],
    ["WebGL2", /\bwebgl2?\b/u],
    ["fragment shader", /fragment shader/u],
    ["vertex shader", /vertex shader/u],
    ["ray marching", /ray[-\s]?march/u],
    ["sphere tracing", /sphere tracing/u],
    ["SDF", /\bsdf\b|signed distance function/u],
    ["signed distance functions", /signed distance functions?/u],
    ["normal estimation", /normal estimation|calcNormal/u],
    ["soft shadows", /soft shadows?/u],
    ["ambient occlusion", /ambient occlusion|\bao\b/u],
    ["post-processing", /post[-\s]?processing/u],
    ["procedural noise", /procedural noise|fbm|simplex|perlin/u],
    ["particle system", /particle system/u],
    ["fluid simulation", /fluid simulation|navier[-\s]?stokes/u],
    ["volumetric rendering", /volumetric rendering|volume ray/u],
    ["path tracing", /path tracing/u],
    ["tone mapping", /tone mapping/u]
  ];
  const normalized = content.toLowerCase();
  return terms
    .filter(([, pattern]) => pattern.test(normalized))
    .map(([term]) => term);
}

function titleFromPath(path) {
  return basename(path)
    .replace(/\.md$/u, "")
    .replace(/[-_]+/gu, " ")
    .replace(/\b\w/gu, (letter) => letter.toUpperCase());
}

function upstreamUrl(repoPath) {
  return `https://github.com/MiniMax-AI/skills/blob/main/${repoPath}`;
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
    } else if (argv[index] === "--skills-root") {
      result.skillsRoot = argv[index + 1];
      index += 1;
    } else if (argv[index] === "--skills-ref") {
      result.skillsRef = argv[index + 1];
      index += 1;
    }
  }
  return result;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await syncShaderDevDocs(parseArgs(process.argv.slice(2)));
  console.log(JSON.stringify(result, null, 2));
}
