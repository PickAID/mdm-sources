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
  return [
    manifestPath,
    ...(await fileExists(summaryPath) ? [summaryPath] : []),
    ...manifest.packages.map((entry) => {
      if (typeof entry.artifactName !== "string" || entry.artifactName === "") {
        throw new Error("Release manifest package artifactName must be a string.");
      }

      return join(root, entry.artifactName);
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
