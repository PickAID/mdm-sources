import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { writeReleaseNotes } from "../tools/write-release-notes.mjs";

test("writeReleaseNotes renders provenance and verification command", async () => {
  const outDir = await mkdtemp(join(tmpdir(), "mdm-release-notes-"));
  await writeFile(
    join(outDir, "mdm-release-summary.json"),
    JSON.stringify({
      schemaVersion: 1,
      generatedAt: "2026-05-08T00:00:00.000Z",
      source: {
        repository: "PickAID/mdm-sources",
        ref: "mdm-resources-v1",
        revision: "abc123"
      },
      manifest: {
        name: "mdm-release-manifest.json",
        sha256: "0".repeat(64),
        packageCount: 465
      },
      totals: { artifactCount: 465, sizeBytes: 2732077 },
      distributions: {
        formats: { json: 463, jsonl: 1, sqlite: 1 }
      },
      artifacts: []
    })
  );
  await writeFile(
    join(outDir, "mdm-release-acceptance-report.json"),
    JSON.stringify({
      status: "passed",
      checks: {
        repository: { errorCount: 0 },
        schema: { errorCount: 0 },
        install: { packageCount: 465, verifiedCount: 465 }
      }
    })
  );

  const result = await writeReleaseNotes({
    outDir,
    releaseTag: "mdm-resources-v1"
  });
  const body = await readFile(result.notesPath, "utf-8");

  assert.match(body, /Repository: PickAID\/mdm-sources/);
  assert.match(body, /Revision: abc123/);
  assert.match(body, /Manifest sha256: 0000/);
  assert.match(body, /Packages: 465/);
  assert.match(body, /No signature or GitHub artifact attestation is claimed/);
  assert.match(body, /private runtime caches are not uploaded/);
  assert.match(body, /Local acceptance status: passed/);
  assert.match(body, /Install verified: 465\/465/);
  assert.match(
    body,
    /node tools\/verify-live-release\.mjs https:\/\/github\.com\/PickAID\/mdm-sources\/releases\/download\/mdm-resources-v1\/mdm-release-manifest\.json/
  );
});

test("writeReleaseNotes tolerates missing local acceptance report", async () => {
  const outDir = await mkdtemp(join(tmpdir(), "mdm-release-notes-no-report-"));
  await mkdir(outDir, { recursive: true });
  await writeFile(
    join(outDir, "mdm-release-summary.json"),
    JSON.stringify({
      source: {},
      manifest: { sha256: "0".repeat(64), packageCount: 1 },
      totals: { artifactCount: 1, sizeBytes: 3 },
      distributions: {}
    })
  );

  const result = await writeReleaseNotes({ outDir, releaseTag: "v-test" });

  assert.match(result.body, /Local acceptance status: not-recorded/);
});
