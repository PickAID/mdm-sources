import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const CATALOG_PATH =
  "packages/minecraft/releases/catalog/payload/release-catalog.json";

export async function readCatalogVersions(root, seedProfileKey) {
  return (await readCatalogVersionEntries(root, seedProfileKey)).map((entry) => entry.id);
}

export async function readCatalogVersionEntries(root, seedProfileKey) {
  const catalog = JSON.parse(await readFile(join(root, CATALOG_PATH), "utf-8"));
  const releases = catalog.releases
    ?.filter((release) => typeof release?.id === "string" && release.id.length > 0);
  if (releases?.length > 0) {
    return releases;
  }

  const seedVersions = catalog.currentSeedProfiles?.[seedProfileKey];
  if (Array.isArray(seedVersions) && seedVersions.length > 0) {
    return seedVersions
      .filter((version) => typeof version === "string" && version.length > 0)
      .map((id) => ({ id }));
  }

  throw new Error(
    `release catalog must list releases or currentSeedProfiles.${seedProfileKey}.`
  );
}
