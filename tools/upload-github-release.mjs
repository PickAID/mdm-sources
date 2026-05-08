import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";

import { listReleaseArtifacts } from "./list-release-artifacts.mjs";

const githubApiBaseUrl = "https://api.github.com";

export async function uploadGithubRelease(input) {
  const repo = requireString(input.repo, "repo");
  const tag = requireString(input.tag, "tag");
  const manifestPath = requireString(input.manifestPath, "manifestPath");
  const artifacts = await listReleaseArtifacts(manifestPath);
  const dryRun = input.dryRun === true;
  const token = input.token ?? process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;

  if (dryRun) {
    return {
      schemaVersion: 1,
      status: "dry_run",
      repo,
      tag,
      artifactCount: artifacts.length,
      artifacts: artifacts.map((path) => basename(path))
    };
  }
  if (!token) {
    throw new Error("GITHUB_TOKEN or GH_TOKEN must be set unless --dry-run is used.");
  }

  const client = createGitHubClient({
    token,
    apiBaseUrl: input.apiBaseUrl,
    uploadBaseUrl: input.uploadBaseUrl,
    fetcher: input.fetcher
  });
  const release = await ensureRelease({
    client,
    repo,
    tag,
    name: input.name ?? tag,
    notes: input.notes ?? ""
  });
  const existingAssets = new Map(
    (release.assets ?? []).map((asset) => [asset.name, asset])
  );
  const uploaded = [];
  const skipped = [];
  const deleted = [];

  for (const artifactPath of artifacts) {
    const name = basename(artifactPath);
    const existing = existingAssets.get(name);

    if (existing && input.clobber !== true) {
      skipped.push(name);
      continue;
    }
    if (existing) {
      await client.request(existing.url, { method: "DELETE" });
      deleted.push(name);
    }

    await uploadAsset({
      client,
      uploadUrl: release.upload_url,
      artifactPath,
      name
    });
    uploaded.push(name);
  }

  return {
    schemaVersion: 1,
    status: "uploaded",
    repo,
    tag,
    releaseId: release.id,
    artifactCount: artifacts.length,
    uploadedCount: uploaded.length,
    skippedCount: skipped.length,
    deletedCount: deleted.length,
    uploaded,
    skipped,
    deleted
  };
}

async function ensureRelease({ client, repo, tag, name, notes }) {
  const existing = await client.maybeRequest(`/repos/${repo}/releases/tags/${tag}`);
  if (existing) {
    return client.request(`/repos/${repo}/releases/${existing.id}`, {
      method: "PATCH",
      body: {
        name,
        body: notes,
        draft: false,
        prerelease: false
      }
    });
  }

  return client.request(`/repos/${repo}/releases`, {
    method: "POST",
    body: {
      tag_name: tag,
      name,
      body: notes,
      draft: false,
      prerelease: false
    }
  });
}

async function uploadAsset({ client, uploadUrl, artifactPath, name }) {
  const url = new URL(uploadUrl.replace("{?name,label}", ""));
  url.searchParams.set("name", name);

  await client.request(url.toString(), {
    method: "POST",
    bodyBytes: await readFile(artifactPath),
    headers: {
      "content-type": contentTypeFor(name)
    }
  });
}

function createGitHubClient(input) {
  const fetcher = input.fetcher ?? fetch;
  const apiBaseUrl = input.apiBaseUrl ?? githubApiBaseUrl;
  const uploadBaseUrl = input.uploadBaseUrl;

  return {
    async maybeRequest(path, options = {}) {
      const response = await send(path, options);
      if (response.status === 404) {
        return null;
      }
      return readJsonResponse(response);
    },
    async request(path, options = {}) {
      return readJsonResponse(await send(path, options));
    }
  };

  async function send(path, options) {
    const url = resolveGitHubUrl(path, apiBaseUrl, uploadBaseUrl);
    const response = await fetcher(url, {
      method: options.method ?? "GET",
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${input.token}`,
        "x-github-api-version": "2022-11-28",
        ...(options.body ? { "content-type": "application/json" } : {}),
        ...(options.headers ?? {})
      },
      body: options.bodyBytes ?? (
        options.body ? JSON.stringify(options.body) : undefined
      )
    });

    return response;
  }
}

function resolveGitHubUrl(path, apiBaseUrl, uploadBaseUrl) {
  if (path.startsWith("http://") || path.startsWith("https://")) {
    if (uploadBaseUrl && path.startsWith("https://uploads.github.com")) {
      return `${uploadBaseUrl}${new URL(path).pathname}${new URL(path).search}`;
    }
    return path;
  }

  return `${apiBaseUrl}${path}`;
}

async function readJsonResponse(response) {
  if (!response.ok) {
    throw new Error(`GitHub API request failed: ${response.status} ${await safeText(response)}`);
  }
  if (response.status === 204) {
    return {};
  }

  return response.json();
}

async function safeText(response) {
  try {
    return await response.text();
  } catch {
    return "";
  }
}

function contentTypeFor(name) {
  if (name.endsWith(".json")) {
    return "application/json";
  }
  if (name.endsWith(".sqlite")) {
    return "application/x-sqlite3";
  }
  if (name.endsWith(".md")) {
    return "text/markdown; charset=utf-8";
  }

  return "application/octet-stream";
}

async function readOptionalText(path) {
  return path ? readFile(path, "utf-8") : "";
}

function requireString(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }

  return value;
}

function parseArgs(argv) {
  const options = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--clobber") {
      options.clobber = true;
    } else if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`${arg} requires a value.`);
      }
      options[key] = value;
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  if (!args.repo || !args.tag || !args.manifest) {
    throw new Error(
      [
        "Usage: node tools/upload-github-release.mjs",
        "--repo <owner/name>",
        "--tag <tag>",
        "--manifest <manifest>",
        "[--name <release-name>]",
        "[--notes <notes-md>]",
        "[--dry-run]",
        "[--clobber]"
      ].join(" ")
    );
  }

  const result = await uploadGithubRelease({
    repo: args.repo,
    tag: args.tag,
    manifestPath: args.manifest,
    name: args.name,
    notes: await readOptionalText(args.notes),
    dryRun: args["dry-run"] === true || args.dryRun === true,
    clobber: args.clobber === true
  });
  console.log(JSON.stringify(result, null, 2));
}
