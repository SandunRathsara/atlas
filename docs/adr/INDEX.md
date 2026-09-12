# Architecture Decision Records

An ADR is warranted when a decision constrains future work, has meaningful alternatives or tradeoffs, or is costly to reverse. Recording a decision here requires an approved consequential decision — never invent or record an unapproved entry. Read this index first, then only matching accepted or superseding ADRs; do not scan every ADR.

| ID | Decision | Status | Affected concerns | Supersedes | Detail |
|---|---|---|---|---|---|
| ADR-0001 | Discover OpenCode without version gating | Accepted; partially superseded | OpenCode discovery, health, service selection, staging, deployment verification | Exact server-version/pairing requirements in #28 and #37; self-update activation health superseded by ADR-0002 | [Detail](0001-discover-opencode-without-version-gating.md) |
| ADR-0002 | Versioned releases and graceful Atlas self-updates | Accepted | Release identity/publishing, update policy/UI, safe pause, credential continuity, activation/rollback, retention, bootstrap | ADR-0001 only where OpenCode health/inspection would gate startup or self-update activation | [Detail](0002-versioned-releases-and-graceful-self-updates.md) |
