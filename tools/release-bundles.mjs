import { createHash } from "node:crypto";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

export async function materializeReleaseBundles(input) {
  const bundleChannels = normalizeBundleChannels(input.bundleChannels);
  if (!bundleChannels) {
    return {
      packages: input.packages,
      artifacts: input.artifacts,
      bundles: []
    };
  }

  const artifactsByPackage = new Map(
    input.artifacts.map((artifact) => [artifact.packageId, artifact])
  );
  const packagesByChannel = groupBundledPackages(input.packages, bundleChannels);
  const bundles = [];
  const bundledPackageIds = new Set();

  for (const [channel, packages] of packagesByChannel) {
    const bundle = await writeChannelBundle({
      outDir: input.outDir,
      channel,
      packages,
      artifactsByPackage
    });

    bundles.push(bundle);
    for (const entry of packages) {
      bundledPackageIds.add(entry.packageId);
    }
  }
  await removeBundledArtifacts(input.artifacts, bundledPackageIds);

  return {
    packages: input.packages.map((entry) => {
      if (!bundledPackageIds.has(entry.packageId)) {
        return entry;
      }

      return {
        ...entry,
        artifactName: undefined,
        bundleRef: {
          bundleName: bundleNameForChannel(entry.releaseChannel),
          memberName: artifactsByPackage.get(entry.packageId)?.artifactName,
          sha256: entry.sha256,
          sizeBytes: entry.sizeBytes
        }
      };
    }).map(removeUndefinedValues),
    artifacts: [
      ...input.artifacts.filter((artifact) => !bundledPackageIds.has(artifact.packageId)),
      ...bundles.map((bundle) => ({
        packageId: bundle.bundleName,
        artifactName: bundle.artifactName,
        artifactPath: bundle.artifactPath,
        sha256: bundle.sha256,
        sizeBytes: bundle.sizeBytes
      }))
    ],
    bundles
  };
}

async function removeBundledArtifacts(artifacts, bundledPackageIds) {
  await Promise.all(
    artifacts
      .filter((artifact) => bundledPackageIds.has(artifact.packageId))
      .map((artifact) => rm(artifact.artifactPath, { force: true }))
  );
}

export function normalizeBundleChannels(channels) {
  if (channels === undefined || channels === false) {
    return undefined;
  }
  if (channels instanceof Set) {
    return channels.size > 0 ? channels : undefined;
  }
  if (channels === true || channels === "all") {
    return new Set(["required", "docs", "sources", "mappings", "datapack", "resourcepack", "accelerators", "external-libraries"]);
  }

  const values = Array.isArray(channels) ? channels : [channels];
  const normalized = values.flatMap((value) => {
    return String(value)
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
  });

  return normalized.length > 0 ? new Set(normalized) : undefined;
}

function groupBundledPackages(packages, bundleChannels) {
  const grouped = new Map();
  for (const entry of packages) {
    if (!bundleChannels.has(entry.releaseChannel)) {
      continue;
    }
    const current = grouped.get(entry.releaseChannel) ?? [];
    current.push(entry);
    grouped.set(entry.releaseChannel, current);
  }

  return grouped;
}

async function writeChannelBundle({ outDir, channel, packages, artifactsByPackage }) {
  const bundleName = bundleNameForChannel(channel);
  const artifactName = `${bundleName}.json`;
  const artifactPath = join(outDir, artifactName);
  const members = [];

  for (const entry of packages) {
    const artifact = artifactsByPackage.get(entry.packageId);
    if (!artifact) {
      throw new Error(`Missing artifact for bundled package ${entry.packageId}.`);
    }

    members.push({
      packageId: entry.packageId,
      memberName: artifact.artifactName,
      format: entry.format,
      sha256: artifact.sha256,
      sizeBytes: artifact.sizeBytes,
      contentBase64: (await readFile(artifact.artifactPath)).toString("base64")
    });
  }

  const body = stableJson({
    schemaVersion: 1,
    bundleName,
    releaseChannel: channel,
    packageCount: members.length,
    members
  });

  await writeFile(artifactPath, body);
  return {
    bundleName,
    releaseChannel: channel,
    artifactName,
    artifactPath,
    packageCount: members.length,
    sha256: sha256(Buffer.from(body)),
    sizeBytes: Buffer.byteLength(body)
  };
}

function bundleNameForChannel(channel) {
  return `${channel}.mdm-bundle`;
}

function removeUndefinedValues(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, nested]) => nested !== undefined)
  );
}

function sha256(body) {
  return createHash("sha256").update(body).digest("hex");
}

function stableJson(value) {
  return `${JSON.stringify(sortJson(value), null, 2)}\n`;
}

function sortJson(value) {
  if (Array.isArray(value)) {
    return value.map(sortJson);
  }
  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, sortJson(nested)])
  );
}
