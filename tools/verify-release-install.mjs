import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);

export async function verifyReleaseInstall(input) {
  const manifestRef = requireString(input.manifest, "manifest");
  const manifest = JSON.parse((await readBytes(manifestRef, input)).toString("utf-8"));
  const packages = requirePackages(manifest);
  const tempDir = await mkdtemp(join(tmpdir(), "mdm-release-verify-"));
  const verified = [];

  try {
    for (const entry of packages) {
      const artifactRef = resolveArtifactRef(manifestRef, entry.artifactName);
      const bytes = await readBytes(artifactRef, input);
      const actualSha256 = sha256(bytes);
      if (actualSha256 !== entry.sha256) {
        throw new Error(
          `${entry.packageId} sha256 mismatch: expected ${entry.sha256}, got ${actualSha256}`
        );
      }

      if (entry.sizeBytes !== undefined && bytes.length !== entry.sizeBytes) {
        throw new Error(
          `${entry.packageId} size mismatch: expected ${entry.sizeBytes}, got ${bytes.length}`
        );
      }

      if (entry.format === "sqlite") {
        await verifySqliteArtifact(tempDir, entry, bytes);
      }

      verified.push({
        packageId: entry.packageId,
        artifactName: entry.artifactName,
        format: entry.format,
        sizeBytes: bytes.length
      });
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }

  return {
    schemaVersion: 1,
    manifest: manifestRef,
    packageCount: packages.length,
    verifiedCount: verified.length,
    totalSizeBytes: verified.reduce((total, entry) => total + entry.sizeBytes, 0),
    packages: verified
  };
}

function requirePackages(manifest) {
  if (!Array.isArray(manifest.packages)) {
    throw new Error("Release manifest packages must be an array.");
  }
  return manifest.packages.map((entry, index) => ({
    packageId: requireString(entry.packageId, `packages[${index}].packageId`),
    artifactName: requireString(entry.artifactName, `packages[${index}].artifactName`),
    sha256: requireString(entry.sha256, `packages[${index}].sha256`),
    format: entry.format,
    sizeBytes: entry.sizeBytes
  }));
}

async function readBytes(ref, input) {
  if (isHttpUrl(ref)) {
    const fetcher = input.fetcher ?? fetch;
    const response = await fetcher(ref);
    if (!response.ok) {
      throw new Error(`Failed to fetch ${ref}: HTTP ${response.status}`);
    }
    return Buffer.from(await response.arrayBuffer());
  }

  return readFile(filePathFromRef(ref));
}

function resolveArtifactRef(manifestRef, artifactName) {
  if (isHttpUrl(manifestRef)) {
    return new URL(artifactName, manifestRef).toString();
  }
  return join(dirname(filePathFromRef(manifestRef)), artifactName);
}

async function verifySqliteArtifact(tempDir, entry, bytes) {
  const artifactPath = join(tempDir, basename(entry.artifactName));
  await writeFile(artifactPath, bytes);
  const { DatabaseSync } = require("node:sqlite");
  const database = new DatabaseSync(artifactPath, { readOnly: true });
  try {
    const tables = database
      .prepare("SELECT name FROM sqlite_master WHERE type IN ('table', 'virtual table')")
      .all()
      .map((row) => row.name);
    for (const tableName of ["docs_entries", "docs_entries_fts"]) {
      if (!tables.includes(tableName)) {
        throw new Error(`${entry.packageId} sqlite artifact missing ${tableName}`);
      }
    }
  } finally {
    database.close();
  }
}

function filePathFromRef(ref) {
  return ref.startsWith("file:") ? fileURLToPath(ref) : ref;
}

function isHttpUrl(ref) {
  return ref.startsWith("http://") || ref.startsWith("https://");
}

function sha256(body) {
  return createHash("sha256").update(body).digest("hex");
}

function requireString(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const manifest = process.argv[2];
  if (!manifest) {
    throw new Error("Usage: node tools/verify-release-install.mjs <manifest-path-or-url>");
  }
  await access(filePathFromRef(manifest)).catch((error) => {
    if (!isHttpUrl(manifest)) {
      throw error;
    }
  });
  console.log(JSON.stringify(await verifyReleaseInstall({ manifest }), null, 2));
}
