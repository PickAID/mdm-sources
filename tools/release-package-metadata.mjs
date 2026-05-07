export function normalizePackageManifest(manifest) {
  if (manifest?.identity?.schemaVersion === 2) {
    return {
      schemaVersion: 2,
      id: manifest.identity.packageId,
      version: manifest.identity.packageVersion,
      namespace: manifest.identity.namespace,
      artifactType: mapV2ArtifactType(manifest.artifact.kind),
      artifactKind: manifest.artifact.kind,
      queryAdapter: manifest.query?.adapter,
      variant: manifest.release.channel,
      required: manifest.release.channel === "required",
      format: manifest.artifact.format,
      payloadRoot: ".",
      releaseChannel: manifest.release.channel,
      releaseFamily: manifest.release.family,
      capabilities: manifest.capabilities,
      artifactSchemaVersion: manifest.artifact.schemaVersion,
      metadata: inferV2PackageMetadata(manifest)
    };
  }

  return {
    schemaVersion: 1,
    id: manifest.id,
    version: manifest.version,
    namespace: manifest.namespace,
    artifactType: manifest.artifactType,
    variant: manifest.variant,
    required: manifest.required,
    format: manifest.format,
    payloadRoot: manifest.payloadRoot,
    releaseChannel: manifest.required ? "required" : "docs",
    releaseFamily: manifest.namespace,
    capabilities: manifest.capabilities ?? [],
    artifactSchemaVersion: 1
  };
}

function inferV2PackageMetadata(manifest) {
  if (
    manifest.artifact.format !== "sqlite" ||
    !["sqlite_docs", "source_index_sqlite"].includes(manifest.query?.adapter)
  ) {
    return undefined;
  }

  if (manifest.query.adapter === "source_index_sqlite") {
    return {
      storageKind: "sqlite_bundle",
      installTier: "runtime_or_optional_dataset",
      commitPolicy: "repository_manifest",
      sqlite: {
        databaseName: `${manifest.identity.packageId}.sqlite`,
        minUserVersion: manifest.artifact.schemaVersion,
        requiredTables: [
          "files",
          "java_symbols",
          "java_members",
          "fts_files",
          "source_chunks",
          "fts_chunks"
        ]
      }
    };
  }

  return {
    storageKind: "sqlite_bundle",
    installTier: "optional_dataset",
    commitPolicy: "repository_manifest",
    sqlite: {
      databaseName: `${manifest.identity.packageId}.sqlite`,
      minUserVersion: manifest.artifact.schemaVersion,
      requiredTables: ["docs_entries", "docs_entries_fts"]
    }
  };
}

function mapV2ArtifactType(kind) {
  if (kind === "datapack_bundle") {
    return "datapack";
  }
  if (kind === "resourcepack_bundle") {
    return "resourcepack";
  }
  if (kind === "mapping_bundle") {
    return "mappings";
  }
  if (kind === "source_index") {
    return "source_index";
  }
  if (kind === "source_tree") {
    return "source_tree";
  }
  if (kind === "embedding_bundle") {
    return "accelerator";
  }

  return "docs";
}
