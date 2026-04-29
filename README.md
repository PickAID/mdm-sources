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
