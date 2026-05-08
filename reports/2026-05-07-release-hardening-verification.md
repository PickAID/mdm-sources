# MDM Sources Release Hardening Verification

Date: 2026-05-07
Author: m1hono

## Scope

This verifies the package source repository release hardening slice.

The slice makes `mdm-sources` safer as a real package source repository by:

- generating real SQLite docs artifacts with a declared schema version;
- emitting SQLite validation metadata into release manifests and registry detail;
- cleaning stale `release-out` files before each build;
- allowing CI release builds to avoid rewriting tracked registry metadata;
- uploading only artifacts listed in `mdm-release-manifest.json`.

## Behavior

SQLite docs package:

```json
{
  "packageId": "core-docs-search-sqlite",
  "format": "sqlite",
  "metadata": {
    "storageKind": "sqlite_bundle",
    "installTier": "optional_dataset",
    "commitPolicy": "repository_manifest",
    "sqlite": {
      "databaseName": "core-docs-search-sqlite.sqlite",
      "minUserVersion": 3,
      "requiredTables": ["docs_entries", "docs_entries_fts"]
    }
  }
}
```

Observed generated SQLite artifact:

```json
{
  "userVersion": 3,
  "entries": 5,
  "ftsEntries": 5
}
```

Release artifact listing:

```text
node tools/list-release-artifacts.mjs release-out/mdm-release-manifest.json
```

This returns the manifest plus exactly the package artifacts declared by the
manifest. The workflow uses this list instead of `release-out/*`.

## Verification

Commands:

```bash
node --test tests/*.test.mjs
node tools/validate.mjs
printf stale > release-out/stale-again.tmp
node tools/build-local-release.mjs --out release-out --no-registry-update
test ! -e release-out/stale-again.tmp
node tools/list-release-artifacts.mjs release-out/mdm-release-manifest.json | wc -l
git diff --check
wc -l tools/build-local-release.mjs tools/sqlite-docs-artifact.mjs tools/list-release-artifacts.mjs
```

Results:

```text
node --test tests/*.test.mjs: 19 passed
node tools/validate.mjs: packageCount 14, errorCount 0
manifest-listed upload paths: 15
git diff --check: passed
tools/build-local-release.mjs: 406 lines
tools/sqlite-docs-artifact.mjs: 136 lines
tools/list-release-artifacts.mjs: 31 lines
```

## Remaining Work

- Run a real GitHub Release URL acceptance after publishing a release.
- Add provenance/signing if release consumers need tamper-evident metadata beyond
  SHA-256.
- Expand the docs corpus and versioned datapack/resourcepack package coverage.

## 2026-05-08 Resourcepack Guidance Package Check

Added `resourcepack-1.20.1-guidance` as a public `docs_bundle` package. The
payload is structured guidance only: asset path patterns, model/texture/font/
sound/shader/UI evidence chains, relationship discovery rules, and distribution
boundaries. It does not include vanilla assets, private modpack assets,
generated archive indexes, copied shader source, or private workspace paths.

Commands:

```bash
node tools/sync-registry.mjs
node tools/validate.mjs
node tools/build-local-release.mjs --out release-out --no-registry-update
node tools/verify-release-schema.mjs release-out/mdm-release-manifest.json
node tools/verify-release-install.mjs release-out/mdm-release-manifest.json
node --test tests/*.test.mjs
node tools/write-release-acceptance-report.mjs --out release-out
```

Results:

```text
node tools/validate.mjs: packageCount 466, errorCount 0
release schema verifier: packageCount 466, errorCount 0
release install verifier: verifiedCount 466/466, totalSizeBytes 2746327
resourcepack guidance artifact: resourcepack-1.20.1-guidance-0.1.0.mdm-resource.json, sha256 78b30435da54905a3a80702e0e133aa8b058bbd1dae3323fa603f962e6d2e36e, sizeBytes 14250
node --test tests/*.test.mjs: 55 passed
local acceptance report: status passed, packageCount 466, artifactCount 468, totalSizeBytes 2746327, repositoryErrorCount 0, schemaErrorCount 0, installVerifiedCount 466
```
