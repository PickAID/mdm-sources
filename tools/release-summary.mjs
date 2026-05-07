import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export async function writeReleaseSummary(input) {
  const manifestBody = await readFile(input.manifestPath);
  const summary = buildReleaseSummary({
    manifest: JSON.parse(manifestBody.toString("utf-8")),
    manifestSha256: sha256(manifestBody),
    artifacts: input.artifacts,
    source: input.source
  });
  const summaryPath = join(input.outDir, "mdm-release-summary.json");

  await writeFile(summaryPath, stableJson(summary));
  return { summary, summaryPath };
}

export function buildReleaseSummary(input) {
  const packages = input.manifest.packages ?? [];
  return {
    schemaVersion: 1,
    generatedAt: input.manifest.generatedAt,
    source: normalizeSource(input.source),
    manifest: {
      name: "mdm-release-manifest.json",
      sha256: input.manifestSha256,
      packageCount: packages.length
    },
    totals: {
      artifactCount: input.artifacts.length,
      sizeBytes: input.artifacts.reduce((total, artifact) => {
        return total + artifact.sizeBytes;
      }, 0)
    },
    distributions: {
      releaseChannels: countBy(packages, "releaseChannel"),
      releaseFamilies: countBy(packages, "releaseFamily"),
      artifactTypes: countBy(packages, "artifactType"),
      formats: countBy(packages, "format")
    },
    artifacts: input.artifacts.map((artifact) => ({
      packageId: artifact.packageId,
      artifactName: artifact.artifactName,
      sha256: artifact.sha256,
      sizeBytes: artifact.sizeBytes
    }))
  };
}

function normalizeSource(source = {}) {
  return {
    repository: source.repository ?? null,
    ref: source.ref ?? null,
    revision: source.revision ?? null
  };
}

function countBy(entries, key) {
  return Object.fromEntries(
    Object.entries(
      entries.reduce((counts, entry) => {
        const value = entry[key] ?? "unknown";
        counts[value] = (counts[value] ?? 0) + 1;
        return counts;
      }, {})
    ).sort(([left], [right]) => left.localeCompare(right))
  );
}

function sha256(body) {
  return createHash("sha256").update(body).digest("hex");
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
