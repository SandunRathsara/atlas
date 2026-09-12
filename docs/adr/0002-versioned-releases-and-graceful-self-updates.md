# ADR-0002: Versioned releases and graceful Atlas self-updates

## Status

Accepted on 2026-09-11 after the developer explicitly expanded [#49](https://github.com/SandunRathsara/atlas/issues/49), answered the grilling rounds, and confirmed the final agreement. Implementation is pending; this is a decision record.

## Context

Atlas currently identifies staged releases by Git SHA and an operator-selected release directory. A client dependency bump already fits that mechanism, but the developer requires SemVer plus build numbers and graceful self-updates performed by Atlas installations. The same intended Atlas behavior must be releasable with a newer OpenCode client without inventing a new product version.

The current release layout runs TypeScript with host-installed Bun. GitHub has no existing Atlas releases or tags, and the repository is public. Release downloads therefore need no repository credential. Activation is currently operator-run; the Atlas process owns credential serving, and Session helpers may depend on files in release directories. Simply restarting Atlas is not sufficient to protect all ongoing Agent operations.

OpenCode execution is independently owned. Atlas updating must neither wait for those Sessions to finish nor make startup or activation conditional on OpenCode versions, a client/server pairing, or OpenCode readiness.

## Scope

This decision covers release identity, tag-triggered publishing, release archives, update discovery and web controls, installation-local activation and recovery, credential/helper continuity, release retention, and one-time bootstrap of supporting services.

The developer explicitly replaced #49's original narrow fence, which excluded CI, update UI, and self-update. This remains a decision-only ticket. Additional authentication/authorization, a compatibility matrix, OpenCode lifecycle management, host-tool/OS upgrades, coordinated fleet updates, and additional deployment platforms are outside this feature. Existing web access is sufficient to approve an update; no new operator role is introduced.

## Decision

### 1. Identity and release contents

- Start with `v0.1.0+build.1`.
- Use SemVer for intended Atlas behavior: bug fixes bump patch, features bump minor, and breaking changes bump major.
- Behavior-preserving dependency/compatibility updates, including OpenCode client-only bumps, may retain the SemVer and increment only the build number. They must not introduce unrelated product behavior changes.
- The build number is globally increasing across releases, including across SemVer changes; it does not reset.
- The release tag is authoritative. Embed its SemVer, build number, and exact Git SHA in generated release metadata, and report that identity in `/health` JSON and update controls. Do not require a second manually edited identity source.
- Compare SemVer first and, for equal SemVer, explicitly compare numeric build numbers. Standard SemVer precedence ignores build metadata and is insufficient on its own.
- Reject reused or non-increasing global build numbers. Published release identities and artifacts are immutable; a correction requires a new build.

### 2. Publishing and packaging

- A tag such as `v1.1.1+build.42` triggers GitHub Actions to build the tagged commit and publish its GitHub Release. Installations consume published releases, not a moving branch.
- Maintainers commit dependency changes before tagging. For a client-only release, update `@opencode-ai/client`, `bun.lock`, `deploy/pins.env`, and any documentation naming the changed pin as needed. The workflow uses the frozen lockfile; it does not select or modify dependencies or query an OpenCode server.
- Publish a ready-to-run Linux x64 release-directory archive containing Atlas source, production dependencies, built CSS, helpers, required deployment assets, and release metadata.
- Run the release using host-installed Bun. Installations extract/stage the archive in a new release directory without installing dependencies or building CSS during the update.
- Self-update covers Atlas and its shipped components. Bun, Git, gh, OS packages, and OpenCode remain operator-managed. Explain unmet host-runtime requirements before activation; this is not an OpenCode compatibility check.

### 3. Discovery, approval, and UI

- Each installation owns its own update policy, checks, activation, and recovery; there is no fleet coordinator.
- Check on startup and every four hours, with a manual **Check now** action.
- Default to approval mode. An installation may opt into automatic mode, which installs only newer builds of its current SemVer. Patch, minor, and major version changes require approval.
- Download and stage eligible releases before pausing new starts. In approval mode, activation waits for approval.
- Add a global **Updates** link and dedicated page showing installed and available version/build, automatic versus approval mode, progress, and the last result. Provide **Check now**, **Install**, and failed-update **Retry** actions.
- Anyone with existing Atlas web access can approve updates and configure the policy. Additional authentication is outside this feature; this does not remove existing access or browser-mutation protections.

### 4. Graceful activation and Session continuity

- Brief Atlas UI downtime is acceptable. Persisted Atlas state and ongoing Agent work must survive the update.
- Pause new starts and allow Atlas-owned preparation/handoff operations to reach safe checkpoints. Preserve queued work and resume it afterward. Never wait for running, Waiting, or Idle OpenCode Sessions to finish, and never terminate Agent execution for an update.
- Allow up to five minutes to reach the safe checkpoint. If it cannot be reached, abandon activation and resume normal operation rather than force an unsafe interruption.
- Keep credential serving independently available during Atlas restarts and preserve helper availability for existing Sessions.
- Use a host-side updater that survives Atlas restarting or failing to boot. Atlas requests an update; the updater activates, validates, and recovers it independently of the candidate Atlas process.
- Atlas startup and self-update activation do not inspect OpenCode versions or require a verified client/server pairing or OpenCode readiness. They must succeed independently of OpenCode availability.
- After restart, reconnect to OpenCode and refresh existing Session observations/results through normal discovery and reconciliation. Preserve the existing identities, one-prompt contract, and stale/not-ready behavior when observation fails; an update does not restart or replay Agent work.

### 5. Validation, rollback, and retention

- Allow the new Atlas release 60 seconds to report the expected release identity and healthy Atlas storage. OpenCode is not part of this success gate; normal Session observation proceeds independently.
- On failed activation, automatically restore the previous working release and surface the failure. Do not automatically retry that failed build. Explicit **Retry** is allowed, and a subsequently published eligible build may update normally.
- Normal web updates, including approved SemVer changes, must allow rollback to previous code without restoring an older database or interrupting OpenCode work. Build-only releases must remain rollback-compatible.
- Refuse normal web activation of releases that cannot meet that rollback contract. Show **Manual maintenance required** and the release's operator instructions instead; approval alone does not bypass the requirement.
- Keep the current release, previous working release, and any older releases still needed by Session helpers. Automatically remove only older, unreferenced releases.

### 6. Bootstrap

- Provide one documented operator-run bootstrap command to install the host updater and independently running credential service on existing installations.
- Include those services in new-install setup. Subsequent normal releases update through Atlas.

## Alternatives

- **SHA-only release identity:** rejected because the developer explicitly requires a stable behavior version plus distinguishable dependency builds.
- **Per-SemVer build counters or manually duplicated identity:** rejected in favor of one global sequence and tag-authoritative metadata.
- **Manual publishing or building dependencies on the installation:** rejected in favor of tag-triggered Actions and ready-to-run archives.
- **Automatic upgrades across SemVer versions:** rejected; automatic mode is limited to newer builds of the installed SemVer.
- **Server/client pairing or OpenCode-ready activation gates:** rejected; Atlas must start and update independently of the operator-selected OpenCode server.
- **Drain all Active Sessions:** rejected; OpenCode execution continues while Atlas updates. Only Atlas preparation/handoff needs a safe checkpoint.
- **Updater and credential serving only inside the restarting Atlas process:** rejected because recovery and Agent credential access must survive that restart.
- **Separate operator authorization for update controls:** excluded by the developer; existing web access suffices for this feature.
- **Database-restore rollback through the normal updater:** rejected because ongoing OpenCode work must not be interrupted or have state rewound.

## Consequences

- This is broader than the original client-bump decision. Implementation must supply publishing, metadata and ordering, discovery/policy UI, durable host update/recovery orchestration, safe preparation/handoff checkpoints, independent credential serving, helper continuity/retention, and bootstrap/runbook changes.
- Existing deployment assumptions about draining all Active Sessions and using OpenCode readiness to approve activation cannot be copied into the self-updater. Runtime/API observation failures remain separate from Atlas installation health; a successful update is not a claim that the OpenCode client works with every server.
- Keep shipped-baseline DOMAIN/ARCHITECTURE documentation distinct from this accepted, implementation-pending decision; refresh those baselines through their required repository-map workflow when implementation lands.
- Follow-up verification should cover tag/build ordering and frozen release contents, same-SemVer automatic eligibility, manual approval, safe-checkpoint timeout, failed startup and code rollback, failed-build retry suppression, retained helper references and credential continuity, and reconnection without creating or prompting duplicate Sessions. Include Atlas activation with OpenCode absent or not ready. Human-run UI verification covers discovery, approval, progress, and post-update Session observations.

## Supersession

This ADR supersedes the original SHA-only recommendation and narrow scope fence in [#49](https://github.com/SandunRathsara/atlas/issues/49).

It partially supersedes [ADR-0001](0001-discover-opencode-without-version-gating.md), specifically the deployment-health requirement in Decision 4 and the startup/deployment OpenCode inspection in Decision 6 **where they would gate Atlas startup or self-update activation**. This path uses the Atlas-only health contract above and does not query OpenCode to approve activation. ADR-0001's normal Session discovery/readiness handling, observation semantics, independently managed OpenCode service, and explicit operator-run OpenCode staging/diagnostics remain in force.

No superseding ADR exists.
