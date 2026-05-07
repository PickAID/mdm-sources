import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { validateJsonSchemaSubset } from "./json-schema-subset.mjs";

export async function verifyReleaseSchema(input) {
  const manifestPath = input.manifestPath;
  const releaseDir = dirname(manifestPath);
  const summaryPath = input.summaryPath ?? join(releaseDir, "mdm-release-summary.json");
  const [manifestSchema, summarySchema, manifest, summary] = await Promise.all([
    readJson(input.manifestSchemaPath ?? "schema/release-manifest.schema.json"),
    readJson(input.summarySchemaPath ?? "schema/release-summary.schema.json"),
    readJson(manifestPath),
    readJson(summaryPath)
  ]);

  const errors = [
    ...validateJsonSchemaSubset(manifestSchema, manifest, { path: "manifest" }),
    ...validateJsonSchemaSubset(summarySchema, summary, { path: "summary" }),
    ...validateReleaseConsistency(manifest, summary)
  ];

  return {
    manifestPath,
    summaryPath,
    packageCount: manifest.packages?.length ?? 0,
    errorCount: errors.length,
    errors
  };
}

function validateReleaseConsistency(manifest, summary) {
  const errors = [];
  const packages = Array.isArray(manifest.packages) ? manifest.packages : [];
  const artifacts = Array.isArray(summary.artifacts) ? summary.artifacts : [];

  if (summary.manifest?.packageCount !== packages.length) {
    errors.push("summary.manifest.packageCount must equal manifest packages length");
  }
  if (summary.totals?.artifactCount !== packages.length) {
    errors.push("summary.totals.artifactCount must equal manifest packages length");
  }
  if (artifacts.length !== packages.length) {
    errors.push("summary.artifacts length must equal manifest packages length");
  }

  for (let index = 0; index < Math.min(packages.length, artifacts.length); index += 1) {
    if (packages[index].artifactName !== artifacts[index].artifactName) {
      errors.push(`summary.artifacts[${index}].artifactName must match manifest`);
    }
    if (packages[index].sha256 !== artifacts[index].sha256) {
      errors.push(`summary.artifacts[${index}].sha256 must match manifest`);
    }
  }

  return errors;
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf-8"));
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
