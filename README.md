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
- `mdm-release-manifest.json`: release-level artifact index used by MCP clients

Private user caches, generated ProbeJS dumps from private modpacks, large vanilla source bundles, and derived local package indexes must stay outside this repository and outside public releases.

## Local Commands

Validate package metadata:

```bash
node tools/validate.mjs
```

Build local release artifacts:

```bash
node tools/build-local-release.mjs --out release-out
```

Run tests:

```bash
node --test tests/*.test.mjs
```
