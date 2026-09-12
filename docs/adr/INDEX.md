# Architecture Decision Records

An ADR is warranted when a decision constrains future work, has meaningful alternatives or tradeoffs, or is costly to reverse. Recording a decision here requires an approved consequential decision — never invent or record an unapproved entry. Read this index first, then only matching accepted or superseding ADRs; do not scan every ADR.

| ID | Decision | Status | Affected concerns | Supersedes | Detail |
|---|---|---|---|---|---|
| 0001 | Discover OpenCode without server-version gating | Accepted; partially superseded by 0002 | OpenCode discovery, health, operator-selected server, deployment checks and staging | Exact server-version/pairing requirement in #28 and #37; no prior ADR | [Detail](0001-discover-opencode-without-version-gating.md) |
| 0002 | Versioned releases and graceful Atlas self-updates | Accepted | SemVer/build identity, tag-triggered publishing, update UI/policy, activation, credential/helper continuity, rollback and bootstrap | Original #49 scope; 0001 partially, for Atlas startup/self-update health and inspection gates | [Detail](0002-versioned-releases-and-graceful-self-updates.md) |
