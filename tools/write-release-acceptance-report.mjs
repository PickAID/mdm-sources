import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { buildLocalRelease } from "./build-local-release.mjs";
import { listReleaseArtifacts } from "./list-release-artifacts.mjs";
import { validateRepository } from "./validate.mjs";
import { verifyReleaseInstall } from "./verify-release-install.mjs";
import { verifyReleaseSchema } from "./verify-release-schema.mjs";

export async function writeReleaseAcceptanceReport(input = {}) {
  const root = resolve(input.root ?? process.cwd());
  const outDir = resolve(input.outDir ?? join(root, "release-out"));
  const reportPath = resolve(
    input.reportPath ?? join(outDir, "mdm-release-acceptance-report.json")
  );
  const markdownPath = resolve(
    input.markdownPath ?? join(outDir, "mdm-release-acceptance-report.md")
  );
  const builtAt = input.builtAt ?? new Date().toISOString();

  const build = await buildLocalRelease({
    root,
    outDir,
    builtAt,
    releaseChannels: input.releaseChannels,
    writeRegistry: false,
    source: input.source
  });
  const schema = await verifyReleaseSchema({ manifestPath: build.manifestPath });
  const install = await verifyReleaseInstall({ manifest: build.manifestPath });
  const artifactPaths = await listReleaseArtifacts(build.manifestPath);
  const repository = await validateRepository(root);
  const manifest = JSON.parse(await readFile(build.manifestPath, "utf-8"));
  const summary = JSON.parse(await readFile(build.summaryPath, "utf-8"));

  const report = {
    schemaVersion: 1,
    generatedAt: builtAt,
    status: statusFor({ schema, install, repository }),
    release: {
      manifestPath: build.manifestPath,
      summaryPath: build.summaryPath,
      packageCount: manifest.packages.length,
      artifactCount: artifactPaths.length,
      packageArtifactCount: build.artifacts.length,
      totalSizeBytes: summary.totals.sizeBytes,
      distributions: summary.distributions
    },
    checks: {
      repository: {
        packageCount: repository.packageCount,
        errorCount: repository.errors.length,
        errors: repository.errors
      },
      schema,
      install: {
        packageCount: install.packageCount,
        verifiedCount: install.verifiedCount,
        totalSizeBytes: install.totalSizeBytes
      }
    },
    artifacts: artifactPaths.map((path) => ({
      name: basename(path),
      path
    }))
  };

  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, stableJson(report));
  await writeFile(markdownPath, renderMarkdown(report));
  return { report, reportPath, markdownPath };
}

function statusFor({ schema, install, repository }) {
  if (repository.errors.length > 0 || schema.errorCount > 0) {
    return "failed";
  }
  if (install.verifiedCount !== install.packageCount) {
    return "failed";
  }
  return "passed";
}

function renderMarkdown(report) {
  const lines = [
    "# MDM Release Acceptance Report",
    "",
    `- Status: ${report.status}`,
    `- Generated at: ${report.generatedAt}`,
    `- Packages: ${report.release.packageCount}`,
    `- Package artifacts: ${report.release.packageArtifactCount}`,
    `- Listed artifacts: ${report.release.artifactCount}`,
    `- Total size bytes: ${report.release.totalSizeBytes}`,
    `- Repository validation errors: ${report.checks.repository.errorCount}`,
    `- Schema validation errors: ${report.checks.schema.errorCount}`,
    `- Install verified packages: ${report.checks.install.verifiedCount}/${report.checks.install.packageCount}`,
    "",
    "## Distributions",
    "",
    "```json",
    JSON.stringify(report.release.distributions, null, 2),
    "```",
    "",
    "## Artifacts",
    "",
    ...report.artifacts.map((artifact) => `- ${artifact.name}`)
  ];
  return `${lines.join("\n")}\n`;
}

function stableJson(value) {
  return `${JSON.stringify(sortJson(value), null, 2)}\n`;
}

function sortJson(value) {
  if (Array.isArray(value)) {
    return value.map(sortJson);
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, sortJson(nested)])
  );
}

function parseArgs(argv) {
  const input = {};
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--out" && argv[index + 1]) {
      input.outDir = argv[++index];
    } else if (arg === "--report" && argv[index + 1]) {
      input.reportPath = argv[++index];
    } else if (arg === "--markdown" && argv[index + 1]) {
      input.markdownPath = argv[++index];
    } else if ((arg === "--channel" || arg === "--channels") && argv[index + 1]) {
      input.releaseChannels = [...(input.releaseChannels ?? []), argv[++index]];
    } else if (arg.startsWith("--channel=")) {
      input.releaseChannels = [...(input.releaseChannels ?? []), arg.slice("--channel=".length)];
    } else if (arg.startsWith("--channels=")) {
      input.releaseChannels = [...(input.releaseChannels ?? []), arg.slice("--channels=".length)];
    }
  }
  return input;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await writeReleaseAcceptanceReport({
    ...parseArgs(process.argv),
    source: {
      repository: process.env.GITHUB_REPOSITORY,
      ref: process.env.GITHUB_REF_NAME,
      revision: process.env.GITHUB_SHA
    }
  });
  console.log(JSON.stringify(buildConsoleSummary(result), null, 2));
  if (result.report.status !== "passed") {
    process.exitCode = 1;
  }
}

function buildConsoleSummary(result) {
  return {
    status: result.report.status,
    reportPath: result.reportPath,
    markdownPath: result.markdownPath,
    packageCount: result.report.release.packageCount,
    artifactCount: result.report.release.artifactCount,
    totalSizeBytes: result.report.release.totalSizeBytes,
    repositoryErrorCount: result.report.checks.repository.errorCount,
    schemaErrorCount: result.report.checks.schema.errorCount,
    installVerifiedCount: result.report.checks.install.verifiedCount
  };
}
