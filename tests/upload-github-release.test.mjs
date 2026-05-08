import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { uploadGithubRelease } from "../tools/upload-github-release.mjs";

test("uploadGithubRelease dry-run lists manifest, summary, and package artifacts", async () => {
  const root = await writeReleaseFixture();

  const result = await uploadGithubRelease({
    repo: "PickAID/mdm-sources",
    tag: "mdm-resources-test",
    manifestPath: join(root, "mdm-release-manifest.json"),
    dryRun: true
  });

  assert.equal(result.status, "dry_run");
  assert.equal(result.artifactCount, 4);
  assert.deepEqual(result.artifacts, [
    "mdm-release-manifest.json",
    "mdm-release-summary.json",
    "alpha.mdm-resource.json",
    "docs.sqlite"
  ]);
});

test("uploadGithubRelease updates release and clobbers matching assets", async () => {
  const root = await writeReleaseFixture();
  const calls = [];

  const result = await uploadGithubRelease({
    repo: "PickAID/mdm-sources",
    tag: "mdm-resources-test",
    manifestPath: join(root, "mdm-release-manifest.json"),
    token: "test-token",
    clobber: true,
    fetcher: async (url, options) => {
      calls.push({
        url,
        method: options?.method ?? "GET",
        contentType: options?.headers?.["content-type"]
      });

      if (url.endsWith("/repos/PickAID/mdm-sources/releases/tags/mdm-resources-test")) {
        return jsonResponse({
          id: 1,
          upload_url: "https://uploads.github.com/repos/PickAID/mdm-sources/releases/1/assets{?name,label}",
          assets: [
            {
              name: "alpha.mdm-resource.json",
              url: "https://api.github.com/repos/PickAID/mdm-sources/releases/assets/10"
            }
          ]
        });
      }
      if (url.endsWith("/repos/PickAID/mdm-sources/releases/1")) {
        return jsonResponse({
          id: 1,
          upload_url: "https://uploads.github.com/repos/PickAID/mdm-sources/releases/1/assets{?name,label}",
          assets: [
            {
              name: "alpha.mdm-resource.json",
              url: "https://api.github.com/repos/PickAID/mdm-sources/releases/assets/10"
            }
          ]
        });
      }
      if (url.endsWith("/repos/PickAID/mdm-sources/releases/assets/10")) {
        return jsonResponse({}, { status: 204 });
      }
      if (url.includes("/repos/PickAID/mdm-sources/releases/1/assets?name=")) {
        return jsonResponse({ id: 100 });
      }

      return jsonResponse({ message: "not found" }, { status: 404 });
    }
  });

  assert.equal(result.status, "uploaded");
  assert.equal(result.uploadedCount, 4);
  assert.equal(result.deletedCount, 1);
  assert.equal(calls.filter((call) => call.method === "POST").length, 4);
  assert.ok(calls.some((call) => call.method === "DELETE"));
  assert.ok(calls.some((call) => call.contentType === "application/x-sqlite3"));
});

async function writeReleaseFixture() {
  const root = await mkdtemp(join(tmpdir(), "mdm-upload-release-"));

  await mkdir(root, { recursive: true });
  await writeFile(
    join(root, "mdm-release-manifest.json"),
    JSON.stringify({
      packages: [
        { packageId: "alpha", artifactName: "alpha.mdm-resource.json" },
        { packageId: "docs", artifactName: "docs.sqlite" }
      ]
    })
  );
  await writeFile(join(root, "mdm-release-summary.json"), "{}");
  await writeFile(join(root, "alpha.mdm-resource.json"), "{}");
  await writeFile(join(root, "docs.sqlite"), "sqlite");

  return root;
}

function jsonResponse(payload, options = {}) {
  return new Response(options.status === 204 ? null : JSON.stringify(payload), {
    status: options.status ?? 200,
    headers: { "content-type": "application/json" }
  });
}
