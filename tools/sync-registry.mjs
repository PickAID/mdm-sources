import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export async function syncRegistry(input = {}) {
  const root = resolve(input.root ?? process.cwd());
  const packages = await readPackages(root);
  const existingDetails = await readExistingDetails(root);
  const entries = [];

  await mkdir(join(root, "registry/packages"), { recursive: true });

  for (const item of packages) {
    const existingDetail = existingDetails.get(item.id);
    const currentRelease = existingDetail?.currentRelease ?? null;
    const detail = {
      schemaVersion: 1,
      id: item.id,
      sourcePath: item.sourcePath,
      currentRelease
    };
    if (existingDetail?.metadata !== undefined) {
      detail.metadata = existingDetail.metadata;
    }
    const detailPath = join(root, "registry/packages", `${item.id}.json`);
    await writeJson(detailPath, detail);
    entries.push({
      id: item.id,
      manifestPath: `registry/packages/${item.id}.json`,
      required: item.required,
      format: item.format,
      currentRelease
    });
  }

  await writeJson(join(root, "registry/index.json"), {
    schemaVersion: 1,
    packages: entries
  });

  return { packageIds: entries.map((entry) => entry.id) };
}

async function readPackages(root) {
  const files = [];
  await walk(join(root, "packages"), files);
  const packages = [];

  for (const file of files.filter((path) => path.endsWith("/package.json")).sort()) {
    const manifest = JSON.parse(await readFile(file, "utf-8"));
    packages.push({
      id: getPackageId(manifest),
      sourcePath: relative(root, file),
      required: getReleaseChannel(manifest) === "required",
      format: getFormat(manifest)
    });
  }

  return packages.sort((a, b) => a.id.localeCompare(b.id));
}

async function readExistingDetails(root) {
  const result = new Map();
  const dir = join(root, "registry/packages");
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) {
      continue;
    }
    const detail = JSON.parse(await readFile(join(dir, entry.name), "utf-8"));
    if (typeof detail.id === "string") {
      result.set(detail.id, detail);
    }
  }

  return result;
}

async function walk(directory, files) {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      await walk(path, files);
    } else if (entry.isFile()) {
      files.push(path);
    }
  }
}

function getPackageId(manifest) {
  return manifest.identity?.packageId ?? manifest.id;
}

function getFormat(manifest) {
  return manifest.artifact?.format ?? manifest.format;
}

function getReleaseChannel(manifest) {
  if (manifest.release?.channel) {
    return manifest.release.channel;
  }
  return manifest.required ? "required" : "docs";
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
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
  const result = await syncRegistry(parseArgs(process.argv.slice(2)));
  console.log(JSON.stringify(result, null, 2));
}
