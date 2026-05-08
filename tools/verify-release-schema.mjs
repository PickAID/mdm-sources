import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { validateJsonSchemaSubset } from "./json-schema-subset.mjs";

export async function verifyReleaseSchema(input) {
  const manifestPath = input.manifestPath;
  const summaryPath = input.summaryPath ?? resolveSummaryPath(manifestPath);
  const [manifestSchema, summarySchema, manifestDocument, summary] = await Promise.all([
    readJson(input.manifestSchemaPath ?? "schema/release-manifest.schema.json"),
    readJson(input.summarySchemaPath ?? "schema/release-summary.schema.json"),
    readJsonDocument(manifestPath, input),
    readJson(summaryPath, input)
  ]);
  const manifest = manifestDocument.value;

  const errors = [
    ...validateJsonSchemaSubset(manifestSchema, manifest, { path: "manifest" }),
    ...validateJsonSchemaSubset(summarySchema, summary, { path: "summary" }),
    ...validateReleaseConsistency(manifest, summary, manifestDocument.body)
  ];

  return {
    manifestPath,
    summaryPath,
    packageCount: manifest.packages?.length ?? 0,
    errorCount: errors.length,
    errors
  };
}

function validateReleaseConsistency(manifest, summary, manifestBody) {
  const errors = [];
  const packages = Array.isArray(manifest.packages) ? manifest.packages : [];
  const bundles = Array.isArray(manifest.bundles) ? manifest.bundles : [];
  const artifacts = Array.isArray(summary.artifacts) ? summary.artifacts : [];
  const expectedArtifacts = expectedReleaseArtifacts(packages, bundles);
  const manifestSha256 = sha256(manifestBody);

  if (summary.manifest?.packageCount !== packages.length) {
    errors.push("summary.manifest.packageCount must equal manifest packages length");
  }
  if (summary.manifest?.sha256 !== manifestSha256) {
    errors.push("summary.manifest.sha256 must match manifest body");
  }
  if (summary.totals?.artifactCount !== expectedArtifacts.length) {
    errors.push("summary.totals.artifactCount must equal manifest release artifact length");
  }
  if (artifacts.length !== expectedArtifacts.length) {
    errors.push("summary.artifacts length must equal manifest release artifact length");
  }

  for (let index = 0; index < Math.min(expectedArtifacts.length, artifacts.length); index += 1) {
    if (expectedArtifacts[index].artifactName !== artifacts[index].artifactName) {
      errors.push(`summary.artifacts[${index}].artifactName must match manifest`);
    }
    if (expectedArtifacts[index].sha256 !== artifacts[index].sha256) {
      errors.push(`summary.artifacts[${index}].sha256 must match manifest`);
    }
  }

  return errors;
}

function expectedReleaseArtifacts(packages, bundles) {
  return [
    ...packages.filter((entry) => entry.artifactName),
    ...bundles.map((entry) => ({
      packageId: entry.bundleName,
      artifactName: entry.artifactName,
      sha256: entry.sha256,
      sizeBytes: entry.sizeBytes
    }))
  ];
}

async function readJson(path, input = {}) {
  return (await readJsonDocument(path, input)).value;
}

async function readJsonDocument(path, input = {}) {
  if (isHttpUrl(path)) {
    const fetcher = input.fetcher ?? fetch;
    const response = await fetcher(path);
    if (!response.ok) {
      throw new Error(`Failed to fetch ${path}: HTTP ${response.status}`);
    }
    const body = await response.text();
    return { value: JSON.parse(body), body };
  }

  const body = await readFile(path, "utf-8");
  return { value: JSON.parse(body), body };
}

function resolveSummaryPath(manifestPath) {
  if (isHttpUrl(manifestPath)) {
    return new URL("mdm-release-summary.json", manifestPath).toString();
  }

  return join(dirname(manifestPath), "mdm-release-summary.json");
}

function isHttpUrl(ref) {
  return ref.startsWith("http://") || ref.startsWith("https://");
}

function sha256(body) {
  return createHash("sha256").update(body).digest("hex");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const manifestPath = process.argv[2];
  if (!manifestPath) {
    throw new Error("Usage: node tools/verify-release-schema.mjs <release-manifest>");
  }
  const result = await verifyReleaseSchema({ manifestPath });
  console.log(JSON.stringify(result, null, 2));
  if (result.errorCount > 0) {
    process.exitCode = 1;
  }
}
