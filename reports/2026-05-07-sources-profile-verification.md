# Sources Profile Verification

Date: 2026-05-07
Author: m1hono

## Scope

This verifies the first public `sources` channel package in `mdm-sources`.
The package is a profile and acquisition guide only. It does not distribute
Minecraft source, remapped source, source indexes, snippets, or private cache
data.

## Package

Package id:

```text
minecraft-1.20.1-vanilla-source-profile
```

Release channel and family:

```json
{
  "releaseChannel": "sources",
  "releaseFamily": "vanilla-sources"
}
```

Artifact:

```text
minecraft-1.20.1-vanilla-source-profile-0.1.0.mdm-resource.json
```

The payload states:

- `distributionPolicy.bundlesMinecraftSource: false`
- `distributionPolicy.bundlesRemappedSource: false`
- `distributionPolicy.localGenerationOnly: true`
- `localGeneration.confirmationRequired: true`
- generated source packages and source indexes belong to MCP runtime-private
  cache, not this repository.

## Verification

Commands:

```bash
node --test tests/build-local-release-sources.test.mjs
node --test tests/*.test.mjs
node tools/validate.mjs
node tools/build-local-release.mjs --out /tmp/mdm-sources-sources-release-out --channel sources --no-registry-update
```

Results:

```text
sources test: 2 passed
full mdm-sources tests: 21 passed
validate: packageCount 15, errorCount 0
sources release artifacts: 1
```

Generated manifest excerpt:

```json
{
  "packageId": "minecraft-1.20.1-vanilla-source-profile",
  "artifactType": "docs",
  "releaseChannel": "sources",
  "releaseFamily": "vanilla-sources",
  "capabilities": ["source_lookup", "source_chunk_search"],
  "format": "json",
  "sizeBytes": 5917
}
```

## Boundary

`artifactType` remains `docs` because the public artifact is profile guidance,
not a source tree. The package is discoverable under the `sources` release
channel so MCP can recommend it for source tasks while still requiring local
generation for actual source content.
