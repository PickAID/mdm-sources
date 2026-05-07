import { fileURLToPath } from "node:url";

import { syncRegistry } from "./sync-registry.mjs";
import { syncSourceProfiles } from "./sync-source-profiles.mjs";
import { syncVanillaDataProfiles } from "./sync-vanilla-data-profiles.mjs";

export async function syncRepository(input = {}) {
  const sourceProfiles = await syncSourceProfiles(input);
  const { datapackProfiles, resourcepackProfiles } =
    await syncVanillaDataProfiles(input);
  const registry = await syncRegistry(input);

  return { sourceProfiles, datapackProfiles, resourcepackProfiles, registry };
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--root") {
      result.root = argv[index + 1];
      index += 1;
    }
  }
  return result;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await syncRepository(parseArgs(process.argv.slice(2)));
  console.log(JSON.stringify(result, null, 2));
}
