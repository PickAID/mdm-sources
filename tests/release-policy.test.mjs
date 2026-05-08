import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("release policy documents public/private and attestation boundaries", async () => {
  const [readme, policy] = await Promise.all([
    readFile("README.md", "utf-8"),
    readFile("docs/release-policy.md", "utf-8")
  ]);

  assert.match(readme, /docs\/release-policy\.md/);
  assert.match(policy, /must not upload `release-out\/\*` by glob/);
  assert.match(policy, /generated ProbeJS dumps from private modpacks/);
  assert.match(policy, /generated Minecraft source trees/);
  assert.match(policy, /No release may claim to be signed or GitHub-attested/);
  assert.match(policy, /not a cryptographic\s+signature/);
  assert.match(policy, /tools\/verify-live-release\.mjs/);
});
