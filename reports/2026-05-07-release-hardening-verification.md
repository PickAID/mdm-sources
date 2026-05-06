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
