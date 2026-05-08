# MDM Release Policy

This repository publishes public MDM resource artifacts through GitHub Releases.

## Published Assets

Only files listed by `tools/list-release-artifacts.mjs` from
`mdm-release-manifest.json` may be uploaded as release assets:

- `mdm-release-manifest.json`
- `mdm-release-summary.json`
- manifest-declared package artifacts

The workflow must not upload `release-out/*` by glob. Local acceptance reports
and release notes are workflow evidence, not package artifacts.

## Private Data Boundary

Public releases must not include:

- private user workspace caches
- generated ProbeJS dumps from private modpacks
- private modpack-derived indexes or assets
- generated Minecraft source trees
- remapped Minecraft source trees
- API keys, local filesystem paths, or user-specific configuration
- embeddings built from private or copyrighted inputs

Runtime-derived artifacts belong in local MCP cache, not in this repository and
not in public releases.

## Provenance

Every release must publish `mdm-release-summary.json`, which records:

- repository, ref, and revision when available from CI
- manifest sha256
- package and artifact counts
- artifact sha256 and size
- distribution counts

GitHub Release notes are generated from that summary plus local acceptance
status. The notes make provenance visible, but they are not a cryptographic
signature.

## Signing And Attestation

No release may claim to be signed or GitHub-attested unless the workflow adds
real signing or GitHub artifact attestation support and verifies it in CI.

Until then, release notes must state that no signature or GitHub artifact
attestation is claimed.

## Retention

GitHub Release assets are the durable distribution channel for published
packages. Workflow-local files such as acceptance reports and generated notes
are transient CI evidence unless intentionally uploaded as separate workflow
artifacts. They must not be treated as package distribution assets.

If workflow artifacts are added later for diagnostics, they must use explicit
retention settings and must not contain private cache data.

## Acceptance

Release CI must:

1. Build and locally accept release output with
   `tools/write-release-acceptance-report.mjs`.
2. Upload only manifest-listed assets.
3. Generate release notes with provenance and boundary statements.
4. Verify the published GitHub Release URL with
   `tools/verify-live-release.mjs`.
