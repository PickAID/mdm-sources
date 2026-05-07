# Sources Profile Verification

Date: 2026-05-07
Author: m1hono

## Scope

This verifies the initial multi-version public `sources` channel seed coverage
in `mdm-sources`. These packages are profiles and acquisition guides only. They
do not distribute Minecraft source, remapped source, source indexes, snippets,
or private cache data.

## Package

Package ids:

```text
minecraft-1.18.2-vanilla-source-profile
minecraft-1.20.1-vanilla-source-profile
minecraft-1.21.1-vanilla-source-profile
```

Release channel and family:

```json
{
  "releaseChannel": "sources",
  "releaseFamily": "vanilla-sources"
}
```

Artifacts:

```text
minecraft-1.18.2-vanilla-source-profile-0.1.0.mdm-resource.json
minecraft-1.20.1-vanilla-source-profile-0.1.0.mdm-resource.json
minecraft-1.21.1-vanilla-source-profile-0.1.0.mdm-resource.json
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
node tools/build-local-release.mjs --out /tmp/mdm-sources-sources-release-out --channel sources --no-registry-update
```

Results:

```text
sources test: 2 passed
full mdm-sources tests: 21 passed
validate: packageCount 17, errorCount 0
sources release artifacts: 3
release catalog currentSeedProfiles.sources: 1.18.2, 1.20.1, 1.21.1
```

Generated manifest excerpt:

```json
[
  {
    "packageId": "minecraft-1.18.2-vanilla-source-profile",
    "artifactType": "docs",
    "releaseChannel": "sources",
    "releaseFamily": "vanilla-sources",
    "capabilities": ["source_lookup", "source_chunk_search"],
    "format": "json",
    "sizeBytes": 5917
  },
  {
    "packageId": "minecraft-1.20.1-vanilla-source-profile",
    "artifactType": "docs",
    "releaseChannel": "sources",
    "releaseFamily": "vanilla-sources",
    "capabilities": ["source_lookup", "source_chunk_search"],
    "format": "json",
    "sizeBytes": 5917
  },
  {
    "packageId": "minecraft-1.21.1-vanilla-source-profile",
    "artifactType": "docs",
    "releaseChannel": "sources",
    "releaseFamily": "vanilla-sources",
    "capabilities": ["source_lookup", "source_chunk_search"],
    "format": "json",
    "sizeBytes": 5917
  }
]
```

## Boundary

`artifactType` remains `docs` because the public artifact is profile guidance,
not a source tree. The package is discoverable under the `sources` release
channel so MCP can recommend it for source tasks while still requiring local
generation for actual source content.
