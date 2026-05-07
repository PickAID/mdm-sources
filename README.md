# mdm-sources

Structured Minecraft development resource package source repository.

This repository stores package manifests, small legal payloads, generated registry metadata, and release tooling for MCP-consumable `mdm-resources`.

It must not store private user workspace caches, generated ProbeJS dumps from private modpacks, or large vanilla source bundles that require user-side acquisition.

## Layout

- `packages/`: source package definitions and small payloads
- `registry/`: generated registry metadata consumed by MCP
- `schema/`: JSON schemas for package and registry files
- `tools/`: local validation and local release artifact scripts
- `modules/`: legacy module manifests kept for compatibility during migration

## Distribution Model

The repository is the source of truth for manifests, schemas, small legal payloads, and release tooling. Generated release artifacts are not committed.

GitHub Releases are the distribution channel for built artifacts:

- `*.mdm-resource.json`: package payload artifacts
- `*.sqlite`: queryable SQLite package artifacts, for example docs search indexes
- `mdm-release-manifest.json`: release-level artifact index used by MCP clients
- `mdm-release-summary.json`: release provenance, package counts, distribution totals, and artifact hashes

SQLite artifacts may represent docs bundles or source indexes. Source index
artifacts use `artifactKind: "source_index"` and
`queryAdapter: "source_index_sqlite"` in the release manifest. Public source
profiles still do not bundle Minecraft source or generated source trees.

MCP clients resolve each package artifact as a sibling of the release manifest:
`new URL(entry.artifactName, manifestUrl)`. Local tooling uses the same rule with
the manifest file's directory.

The release-level contracts are described by:

- `schema/release-manifest.schema.json`
- `schema/release-summary.schema.json`

Private user caches, generated ProbeJS dumps from private modpacks, large vanilla source bundles, and derived local package indexes must stay outside this repository and outside public releases.

`release-out/` is ignored build output. It is safe to delete and regenerate. The release workflow uploads only artifacts listed in `mdm-release-manifest.json`, not every file in `release-out/`, so stale local files cannot leak into a release.

The tracked `registry/` files describe package sources and optional pinned release metadata. Normal CI release builds use `--no-registry-update` so publishing does not rewrite repository metadata. Maintainers can run a local build without that flag when they intentionally want to refresh `currentRelease` hashes in the registry.

## Local Commands

Validate package metadata:

```bash
node tools/validate.mjs
```

Build local release artifacts:

```bash
node tools/build-local-release.mjs --out release-out
```

Build release artifacts without mutating tracked registry metadata:

```bash
node tools/build-local-release.mjs --out release-out --no-registry-update
```

Verify that a local or remote release manifest is installable:

```bash
node tools/verify-release-install.mjs release-out/mdm-release-manifest.json
```

Verify the release manifest and summary schema contract:

```bash
node tools/verify-release-schema.mjs release-out/mdm-release-manifest.json
```

Run tests:

```bash
node --test tests/*.test.mjs
```
