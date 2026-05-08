import { access, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export async function listReleaseArtifacts(manifestPath) {
  const manifest = JSON.parse(await readFile(manifestPath, "utf-8"));
  if (!Array.isArray(manifest.packages)) {
    throw new Error("Release manifest packages must be an array.");
  }

  const root = dirname(manifestPath);
  const summaryPath = join(root, "mdm-release-summary.json");
  const artifactNames = [
    ...manifest.packages
      .map((entry) => entry.artifactName)
      .filter((artifactName) => artifactName !== undefined),
    ...(manifest.bundles ?? []).map((entry) => entry.artifactName)
  ];

  return [
    manifestPath,
    ...(await fileExists(summaryPath) ? [summaryPath] : []),
    ...artifactNames.map((artifactName) => {
      if (typeof artifactName !== "string" || artifactName === "") {
        throw new Error("Release manifest artifactName must be a string.");
      }

      return join(root, artifactName);
    })
  ];
}

async function fileExists(path) {
  return access(path).then(
    () => true,
    () => false
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const manifestPath = process.argv[2];
  if (!manifestPath) {
    throw new Error("Usage: node tools/list-release-artifacts.mjs <manifest>");
  }

  console.log((await listReleaseArtifacts(manifestPath)).join("\n"));
}
