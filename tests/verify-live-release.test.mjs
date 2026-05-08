import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { verifyLiveRelease } from "../tools/verify-live-release.mjs";

test("verifyLiveRelease validates a GitHub Release shaped manifest URL", async () => {
  const manifestUrl =
    "https://example.invalid/releases/download/mdm-resources-v1/mdm-release-manifest.json";
  const artifactName = "core-docs-required-0.1.0.mdm-resource.json";
  const artifactBody = Buffer.from("{}\n");
  const manifestBody = JSON.stringify({
    schemaVersion: 1,
    generatedAt: "2026-05-08T00:00:00.000Z",
    packages: [
      {
        packageId: "core-docs-required",
        version: "0.1.0",
        namespace: "core",
        artifactType: "docs",
        variant: "required",
        required: true,
        format: "json",
        releaseChannel: "required",
        releaseFamily: "core-docs",
        capabilities: ["docs_search"],
        artifactName,
        sha256: sha256(artifactBody),
        sizeBytes: artifactBody.length
      }
    ]
  });
  const summaryBody = JSON.stringify({
    schemaVersion: 1,
    generatedAt: "2026-05-08T00:00:00.000Z",
    source: { repository: null, ref: null, revision: null },
    manifest: {
      name: "mdm-release-manifest.json",
      sha256: sha256(manifestBody),
      packageCount: 1
    },
    totals: { artifactCount: 1, sizeBytes: artifactBody.length },
    distributions: {
      releaseChannels: { required: 1 },
      releaseFamilies: { "core-docs": 1 },
      artifactTypes: { docs: 1 },
      formats: { json: 1 }
    },
    artifacts: [
      {
        packageId: "core-docs-required",
        artifactName,
        sha256: sha256(artifactBody),
        sizeBytes: artifactBody.length
      }
    ]
  });
  const requested = [];

  const result = await verifyLiveRelease({
    manifest: manifestUrl,
    fetcher: async (url) => {
      requested.push(url);
      const body = responseBody(url, {
        manifestUrl,
        artifactName,
        manifestBody,
        summaryBody,
        artifactBody
      });
      return {
        ok: true,
        status: 200,
        text: async () => body.toString("utf-8"),
        arrayBuffer: async () => body
      };
    }
  });

  assert.equal(result.status, "passed");
  assert.deepEqual(result.schema, {
    status: "passed",
    packageCount: 1,
    errorCount: 0,
    errors: [],
    summaryPath:
      "https://example.invalid/releases/download/mdm-resources-v1/mdm-release-summary.json"
  });
  assert.deepEqual(result.install, {
    status: "passed",
    packageCount: 1,
    verifiedCount: 1,
    totalSizeBytes: artifactBody.length,
    error: null
  });
  assert.deepEqual(requested, [
    manifestUrl,
    "https://example.invalid/releases/download/mdm-resources-v1/mdm-release-summary.json",
    manifestUrl,
    "https://example.invalid/releases/download/mdm-resources-v1/core-docs-required-0.1.0.mdm-resource.json"
  ]);
});

test("verifyLiveRelease reports schema fetch failures without throwing", async () => {
  const result = await verifyLiveRelease({
    manifest: "https://example.invalid/mdm-release-manifest.json",
    fetcher: async () => ({
      ok: false,
      status: 404,
      text: async () => "missing",
      arrayBuffer: async () => Buffer.from("missing")
    })
  });

  assert.equal(result.status, "failed");
  assert.equal(result.schema.status, "failed");
  assert.match(result.schema.errors.join("\n"), /HTTP 404/);
  assert.equal(result.install.status, "failed");
  assert.match(result.install.error, /HTTP 404/);
});

test("verifyLiveRelease reports install failures without throwing", async () => {
  const manifestUrl =
    "https://example.invalid/releases/download/mdm-resources-v1/mdm-release-manifest.json";
  const artifactName = "core-docs-required-0.1.0.mdm-resource.json";
  const manifestBody = JSON.stringify({
    schemaVersion: 1,
    generatedAt: "2026-05-08T00:00:00.000Z",
    packages: [
      {
        packageId: "core-docs-required",
        version: "0.1.0",
        namespace: "core",
        artifactType: "docs",
        variant: "required",
        required: true,
        format: "json",
        releaseChannel: "required",
        releaseFamily: "core-docs",
        capabilities: ["docs_search"],
        artifactName,
        sha256: "0".repeat(64),
        sizeBytes: 3
      }
    ]
  });
  const summaryBody = JSON.stringify({
    ...validSummary(JSON.parse(manifestBody), manifestBody),
    artifacts: [
      {
        packageId: "core-docs-required",
        artifactName,
        sha256: "0".repeat(64),
        sizeBytes: 3
      }
    ]
  });

  const result = await verifyLiveRelease({
    manifest: manifestUrl,
    fetcher: async (url) => ({
      ok: true,
      status: 200,
      text: async () =>
        url.endsWith("/mdm-release-summary.json") ? summaryBody : manifestBody,
      arrayBuffer: async () =>
        url.endsWith(`/${artifactName}`)
          ? Buffer.from("bad")
          : Buffer.from(
              url.endsWith("/mdm-release-summary.json") ? summaryBody : manifestBody
            )
    })
  });

  assert.equal(result.status, "failed");
  assert.equal(result.schema.status, "passed");
  assert.equal(result.install.status, "failed");
  assert.match(result.install.error, /sha256 mismatch/);
});

function responseBody(url, fixture) {
  if (url === fixture.manifestUrl) {
    return Buffer.from(fixture.manifestBody);
  }
  if (url.endsWith("/mdm-release-summary.json")) {
    return Buffer.from(fixture.summaryBody);
  }
  if (url.endsWith(`/${fixture.artifactName}`)) {
    return fixture.artifactBody;
  }

  throw new Error(`Unexpected URL ${url}`);
}

function sha256(body) {
  return createHash("sha256").update(body).digest("hex");
}

function validSummary(manifest, manifestBody) {
  return {
    schemaVersion: 1,
    generatedAt: manifest.generatedAt,
    source: { repository: null, ref: null, revision: null },
    manifest: {
      name: "mdm-release-manifest.json",
      sha256: sha256(manifestBody),
      packageCount: manifest.packages.length
    },
    totals: { artifactCount: manifest.packages.length, sizeBytes: 3 },
    distributions: {
      releaseChannels: { required: 1 },
      releaseFamilies: { "core-docs": 1 },
      artifactTypes: { docs: 1 },
      formats: { json: 1 }
    },
    artifacts: []
  };
}
