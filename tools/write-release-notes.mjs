import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export async function writeReleaseNotes(input = {}) {
  const outDir = resolve(input.outDir ?? "release-out");
  const releaseTag = input.releaseTag ?? process.env.RELEASE_TAG ?? "local";
  const manifestUrl =
    input.manifestUrl ??
    `https://github.com/PickAID/mdm-sources/releases/download/${releaseTag}/mdm-release-manifest.json`;
  const summary = await readJson(join(outDir, "mdm-release-summary.json"));
  const acceptance = await readOptionalJson(
    join(outDir, "mdm-release-acceptance-report.json")
  );
  const notesPath = resolve(input.notesPath ?? join(outDir, "mdm-release-notes.md"));
  const body = renderReleaseNotes({
    releaseTag,
    manifestUrl,
    summary,
    acceptance
  });

  await writeFile(notesPath, body);
  return { notesPath, body };
}

export function renderReleaseNotes(input) {
  const summary = input.summary;
  const acceptance = input.acceptance;
  const source = summary.source ?? {};
  const lines = [
    `# MDM resource package release ${input.releaseTag}`,
    "",
    "## Provenance",
    "",
    `- Repository: ${source.repository ?? "unknown"}`,
    `- Ref: ${source.ref ?? "unknown"}`,
    `- Revision: ${source.revision ?? "unknown"}`,
    `- Manifest sha256: ${summary.manifest?.sha256 ?? "unknown"}`,
    "",
    "## Contents",
    "",
    `- Packages: ${summary.manifest?.packageCount ?? 0}`,
    `- Artifacts: ${summary.totals?.artifactCount ?? 0}`,
    `- Total size bytes: ${summary.totals?.sizeBytes ?? 0}`,
    `- Formats: ${formatCounts(summary.distributions?.formats)}`,
    "",
    "## Distribution Policy",
    "",
    "- No signature or GitHub artifact attestation is claimed by this release notes file.",
    "- Release assets are built from manifest-listed public artifacts only; private runtime caches are not uploaded.",
    "",
    "## Acceptance",
    "",
    `- Local acceptance status: ${acceptance?.status ?? "not-recorded"}`,
    `- Repository errors: ${acceptance?.checks?.repository?.errorCount ?? "unknown"}`,
    `- Schema errors: ${acceptance?.checks?.schema?.errorCount ?? "unknown"}`,
    `- Install verified: ${acceptance?.checks?.install?.verifiedCount ?? "unknown"}/${acceptance?.checks?.install?.packageCount ?? "unknown"}`,
    "",
    "## Verify",
    "",
    "```bash",
    `node tools/verify-live-release.mjs ${input.manifestUrl}`,
    "```",
    ""
  ];

  return lines.join("\n");
}

function formatCounts(counts = {}) {
  const entries = Object.entries(counts);
  if (entries.length === 0) {
    return "none";
  }

  return entries.map(([key, value]) => `${key}=${value}`).join(", ");
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf-8"));
}

async function readOptionalJson(path) {
  try {
    return await readJson(path);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

function parseArgs(argv) {
  const input = {};
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--out" && argv[index + 1]) {
      input.outDir = argv[++index];
    } else if (arg === "--tag" && argv[index + 1]) {
      input.releaseTag = argv[++index];
    } else if (arg === "--manifest-url" && argv[index + 1]) {
      input.manifestUrl = argv[++index];
    } else if (arg === "--notes" && argv[index + 1]) {
      input.notesPath = argv[++index];
    }
  }
  return input;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await writeReleaseNotes(parseArgs(process.argv));
  console.log(JSON.stringify({ notesPath: result.notesPath }, null, 2));
}
