# OpenAxes private releases

The public source repository remains public. Distribution is only **@openaxes/pi-subagents** on **https://npm.pkg.github.com**, with restricted access; never publish unscoped pi-subagents or to npmjs.org. Preserve upstream MIT and Nico Bailon attribution. Version **0.66.0-openaxes.3** retains upstream base 0.66.0 provenance. GitHub creates new packages private by default, but maintainers must independently verify actual visibility is PRIVATE; restricted publishConfig does not convert an existing public package.

## Owner-directed direct-main policy

Commit/push releases directly to main, without a release branch, PR or extra review cycle. Branch protection/rulesets, environment approvals and personal preflight tokens are not prerequisites. The workflow does not claim they exist. Never move/reuse tags or versions; server-enforced tag immutability is not claimed.

Create a new annotated tag **v0.66.0-openaxes.3** at current pushed origin/main. Dispatch **Release Private Package** (`.github/workflows/release.yml`), branch **main**, input **tag** = **v0.66.0-openaxes.3**. A tag push alone does not publish. Repository-wide serial concurrency prevents overlapping releases.

Read-only validation checks strict version syntax, exact private name/registry/access, annotated object identity, embedded name, direct/peeled commit and current main. It runs `npm ci --ignore-scripts` (existing lockfile policy, no legacy-peer override), `npm run typecheck`, **full `npm run test:all`**, `npm run test:release` and `bun run pack:check`. This source-native TypeScript fork needs no second compiled/bundled module graph. Pack checks exercise actual tarball exports, inventory and negative publication metadata fixtures. SDK peer ranges/development shims remain unchanged. The .3 release changes the documented child-tool-plan builtin-availability predicates and carries focused planner/native integration evidence; it is not byte-identical to the prior fork revision.

Only the separate publisher has `packages: write`. It downloads the digest-named tarball, refetches current main/tag, rechecks immutable tag/commit/version provenance, SHA-256 and internal identity. Only authenticated lookup/publishing receives `NODE_AUTH_TOKEN` from `secrets.GITHUB_TOKEN`. Existing version means abort; npm E404 alone permits an attempt; other errors abort. Publication uses the exact absolute tarball with **--ignore-scripts --access restricted --registry https://npm.pkg.github.com --tag openaxes**. No npmjs provenance/OIDC or personal/cross-repository secret is needed. Actions must have organization permission to publish this repository's package.

## SDK use and evidence limitations

The .3 planner correction is a new tested source revision: it preserves declared extension requirements beside real parent builtins without widening ceilings or bypassing child provider validation. Historical source manifests remain historical; do not claim unchanged fork hashes.

Use one `pi-subagents@npm:@openaxes/pi-subagents@0.66.0-openaxes.3` alias in the explicit governance SDK host so native factory, launch-identity, native-settlement and preflight resolve to one physical source graph. Do not load a second fork copy or transpile a parallel API graph. Pi SDK 0.85.1 is host-provided, never bundled. Governance stock CLI enrollment and `governance_run_packet_task` remain unsupported; unknown/restarted task-bearing recovery remains denied.

Pre-edit local Windows baseline: npm ci passed (125 installed; 0 vulnerabilities); typecheck passed. `npm run test:all` stopped at unit tests: **3120 total, 3051 passed, 18 failed, 51 skipped**; integration was not reached. Failures included Windows symlink EPERM, package-agent discovery/management path assumptions, builtin project-context expectation and skills-fallback missing npm-calls.txt. The owner authorized packaging without repairing/skipping these tests. **The full Linux release gate remains fail-closed; any failure blocks publication.** Historical accepted native fixtures with machine/base-HEAD assumptions are not rerun as portable release tests. Existing 24 legacy lint diagnostics (23 errors, one warning) are unchanged debt, not suppressed or newly waived.

After Actions succeeds, verify private visibility, repository linkage, exact version, `openaxes` dist-tag and tarball identity, then test an authorized disposable SDK host installation. External publication/visibility and Linux results are not proven by local packaging checks.

The historical upstream-cloning `install.mjs` remains source-only and is excluded from the npm files and binary surface. Use the exact private npm alias in the SDK host; no replacement CLI installer is introduced.


## Job-token verification receipt

After npm publish succeeds, the publisher records that fact and uses only its job-scoped GITHUB_TOKEN to query the exact OpenAxes npm package metadata, download the exact version from GitHub Packages, compare its tarball SHA-256 with the validated artifact, and perform an isolated exact-version npm installation with lifecycle scripts disabled. Public transitive dependencies use npmjs; the @openaxes scope remains GitHub Packages. No personal credential refresh or scope escalation is required or attempted.

The required post-publication check demands actual PRIVATE visibility and exact repository linkage, not restricted metadata alone. It uploads a bounded non-secret `private-publication-<version>` artifact even on failure. GitHub REST metadata support for GITHUB_TOKEN must be observed in Actions: an HTTP denial is recorded and verification fails honestly. A receipt stating **publication-succeeded; verification-blocked** means the version already exists: do not retry publication, overwrite it or move its tag. Inspect the receipt/package settings and resolve verification separately. Missing/failed pre-publication steps must not be described as published.


## Roll-forward correction and install boundary

Governance 0.4.0 was published by Actions run 34677378165; its post-publication registry-name installation failed before PRIVATE metadata was queried. That failure remains unclassified because npm stderr was not retained. The exact validated Actions tarball (SHA-256 48c2192ab164b61535ef5821cda44480d39d2c5fe1d717dde208d482290c2c45) installs successfully in genuine isolated npm runs with both npm 11.12.1 (Actions version) and 11.17.0, scripts disabled and public transitive dependencies. This does not prove direct registry-name installation works or identify its original failure.

The correction first queries actual PRIVATE metadata, then downloads/authenticates the exact registry version and verifies its tarball digest before installation. It runs genuine `npm install --json --ignore-scripts` on those verified downloaded bytes, not a second registry-name resolution or a fabricated dependency tree. Final installed name/version/private configuration checks remain mandatory. Early PRIVATE metadata and digest observations survive later install failure. Failure receipts include only allowlisted npm error codes, HTTP status where derivable and fixed explanatory details; free-form messages, auth-bearing URLs and raw npm logs are withheld. `pack:check` now also performs a genuine local-tarball npm install against public transitive dependencies and proves unused host SDK peers remain absent.

The prior tags v0.4.0 and v0.66.0-openaxes.1 remain immutable. Roll forward only to governance v0.4.1 and fork v0.66.0-openaxes.2; never retry or overwrite governance 0.4.0. The fork's failed run 34677377101 was caused by its omitted project-panes self-import rename; the test import is corrected without removing any lifecycle assertions or full Linux gates. SDK alias consumers intentionally retain the alias spelling pi-subagents, now bound exactly to the private .2 fork.
