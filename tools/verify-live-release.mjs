import { fileURLToPath } from "node:url";

import { verifyReleaseInstall } from "./verify-release-install.mjs";
import { verifyReleaseSchema } from "./verify-release-schema.mjs";

export async function verifyLiveRelease(input) {
  const manifest = requireString(input?.manifest, "manifest");
  const schema = await verifySchemaCheck(input, manifest);
  const install = await verifyInstallCheck(input, manifest);
  const status =
    schema.status === "passed" && install.status === "passed"
      ? "passed"
      : "failed";

  return {
    schemaVersion: 1,
    status,
    manifest,
    schema: {
      status: schema.status,
      packageCount: schema.packageCount,
      errorCount: schema.errorCount,
      errors: schema.errors,
      summaryPath: schema.summaryPath
    },
    install: {
      status: install.status,
      packageCount: install.packageCount,
      verifiedCount: install.verifiedCount,
      totalSizeBytes: install.totalSizeBytes,
      error: install.error
    }
  };
}

async function verifySchemaCheck(input, manifest) {
  try {
    const result = await verifyReleaseSchema({
      manifestPath: manifest,
      fetcher: input.fetcher
    });
    return {
      status: result.errorCount === 0 ? "passed" : "failed",
      packageCount: result.packageCount,
      errorCount: result.errorCount,
      errors: result.errors,
      summaryPath: result.summaryPath
    };
  } catch (error) {
    return {
      status: "failed",
      packageCount: 0,
      errorCount: 1,
      errors: [toErrorMessage(error)],
      summaryPath: null
    };
  }
}

async function verifyInstallCheck(input, manifest) {
  try {
    const result = await verifyReleaseInstall({
      manifest,
      fetcher: input.fetcher
    });
    return {
      status: result.verifiedCount === result.packageCount ? "passed" : "failed",
      packageCount: result.packageCount,
      verifiedCount: result.verifiedCount,
      totalSizeBytes: result.totalSizeBytes,
      error: null
    };
  } catch (error) {
    return {
      status: "failed",
      packageCount: 0,
      verifiedCount: 0,
      totalSizeBytes: 0,
      error: toErrorMessage(error)
    };
  }
}

function requireString(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }

  return value;
}

function toErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const manifest = process.argv[2];
  if (!manifest) {
    throw new Error("Usage: node tools/verify-live-release.mjs <release-manifest-path-or-url>");
  }
  const result = await verifyLiveRelease({ manifest });
  console.log(JSON.stringify(result, null, 2));
  if (result.status !== "passed") {
    process.exitCode = 1;
  }
}
