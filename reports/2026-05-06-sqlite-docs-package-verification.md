# SQLite Docs Package Verification

Date: 2026-05-06

## Scope

This slice verifies that `mdm-sources` can produce a real SQLite database artifact, not only JSON manifests or JSON-wrapped payloads.

## Implemented Chain

- Package manifest: `packages/docs/search/core-sqlite/package.json`
- Curated source payload: `packages/docs/search/core-sqlite/payload/docs-search.json`
- Registry detail: `registry/packages/core-docs-search-sqlite.json`
- Registry index entry: `core-docs-search-sqlite`, `format: "sqlite"`
- Build output: `release-out/core-docs-search-sqlite-0.1.0.sqlite`
- Query schema: `docs_entries` plus `docs_entries_fts`

## Commands And Results

```bash
node --test tests/build-local-release.test.mjs
```

Result: 4 tests passed.

```bash
node --test tests/validate-v2.test.mjs tests/build-local-release.test.mjs && node tools/validate.mjs
```

Result: 11 tests passed. Repository validation returned `packageCount: 14`, `errorCount: 0`.

```bash
node --test tests/*.test.mjs && node tools/validate.mjs
```

Result: 16 tests passed. Repository validation returned `packageCount: 14`, `errorCount: 0`.

```bash
node tools/build-local-release.mjs --out release-out --channels=docs
```

Result included:

```json
{
  "packageId": "core-docs-search-sqlite",
  "artifactName": "core-docs-search-sqlite-0.1.0.sqlite",
  "sha256": "8ad6f521f16be7fb0ac4aa0580744be70f0703b16f148223c017405f6b99d458",
  "sizeBytes": 32768
}
```

```bash
node -e 'const {DatabaseSync}=require("node:sqlite"); const db=new DatabaseSync("release-out/core-docs-search-sqlite-0.1.0.sqlite"); const tables=db.prepare("SELECT name FROM sqlite_master WHERE type = ? ORDER BY name").all("table"); const entries=db.prepare("SELECT entry_id,title,search_terms,code_symbols FROM docs_entries ORDER BY entry_id").all(); const fts=db.prepare("SELECT entry_id FROM docs_entries_fts WHERE docs_entries_fts MATCH ?").all("sqlite"); console.log(JSON.stringify({tables, entries, fts}, null, 2)); db.close();'
```

Result: SQLite opened successfully. `docs_entries` and `docs_entries_fts` exist. `docs_entries` contains 5 curated records, including `mdm.sqlite-index-role`. FTS search for `sqlite` returned all 5 records.

## Current Boundary

This package contains public curated docs/search data only. Minecraft source, remapped Java source, private ProbeJS dumps, private modpack indexes, and embeddings over user content remain local-generated MCP cache artifacts and must not be committed to this repository.

## Next Required Slice

Connect `SkillUpdate` smoke tests to install/read the `.sqlite` docs artifact from `mdm-sources/release-out` through `resource-registry` and `docs-retrieval`, then expose the result through MCP evidence.
