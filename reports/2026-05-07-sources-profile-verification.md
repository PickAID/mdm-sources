# Sources Profile Verification

Date: 2026-05-07
Author: m1hono

## Scope

This verifies automatically generated public `sources` channel coverage in
`mdm-sources`. Source profile packages are generated from the release catalog's
official release list. They are profiles and acquisition guides only. They do
not distribute Minecraft source, remapped source, source indexes, snippets, or
private cache data.

## Package

Coverage:

```text
release catalog releases: 101
source profile packages generated: 101
example packages: minecraft-1.14.4-vanilla-source-profile, minecraft-1.12.2-vanilla-source-profile, minecraft-26.1-vanilla-source-profile
```

Release channel and family:

```json
{
  "releaseChannel": "sources",
  "releaseFamily": "vanilla-sources"
}
```

Example artifacts:

```text
minecraft-1.14.4-vanilla-source-profile-0.1.0.mdm-resource.json
minecraft-1.12.2-vanilla-source-profile-0.1.0.mdm-resource.json
minecraft-26.1-vanilla-source-profile-0.1.0.mdm-resource.json
```

Each payload states:

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
node tools/sync-source-profiles.mjs
node tools/sync-registry.mjs
node tools/sync-repository.mjs
node tools/build-local-release.mjs --out /tmp/mdm-sources-sources-release-out --channel sources --no-registry-update
```

Results:

```text
sources test: 2 passed
full mdm-sources tests: 24 passed
validate: packageCount 115, errorCount 0
sources release artifacts: 101
release catalog source versions: derived from releases[], not currentSeedProfiles.sources
sync-source-profiles: generated 101 versioned source profile packages
sync-registry: generated registry/index.json and registry/packages/*.json from package manifests
sync-repository: one-command source profile plus registry sync
```

Generated manifest excerpt:

```json
[
  {
    "packageId": "minecraft-1.14.4-vanilla-source-profile",
    "artifactType": "docs",
    "releaseChannel": "sources",
    "releaseFamily": "vanilla-sources",
    "capabilities": ["source_lookup", "source_chunk_search"],
    "format": "json",
    "sizeBytes": 6080
  },
  {
    "packageId": "minecraft-1.12.2-vanilla-source-profile",
    "artifactType": "docs",
    "releaseChannel": "sources",
    "releaseFamily": "vanilla-sources",
    "capabilities": ["source_lookup", "source_chunk_search"],
    "format": "json",
    "sizeBytes": 6080
  },
  {
    "packageId": "minecraft-26.1-vanilla-source-profile",
    "artifactType": "docs",
    "releaseChannel": "sources",
    "releaseFamily": "vanilla-sources",
    "capabilities": ["source_lookup", "source_chunk_search"],
    "format": "json",
    "sizeBytes": 6054
  },
  {
    "packageId": "minecraft-26.1.2-vanilla-source-profile",
    "artifactType": "docs",
    "releaseChannel": "sources",
    "releaseFamily": "vanilla-sources",
    "capabilities": ["source_lookup", "source_chunk_search"],
    "format": "json",
    "sizeBytes": 6080
  }
]
```

## Boundary

`artifactType` remains `docs` because the public artifact is profile guidance,
not a source tree. The package is discoverable under the `sources` release
channel so MCP can recommend it for source tasks while still requiring local
generation for actual source content.
