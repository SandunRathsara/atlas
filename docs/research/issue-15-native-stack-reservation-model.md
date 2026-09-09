# Native stacks and durable reservation evidence

Reconstructed: **2026-09-05**. Scope: evidence-to-persistence mapping, not a general stack API guide or transition catalogue. Policy authority: the **final resolutions**, not intermediate checkpoints, of [Persistence model: repositories, specs, PRs, sessions, associations, and reconciliation][P15] and [PR-stack projection and reservation reconciliation][P21]. This reconstruction used read-only documentation/source and issue reads; no stack mutation experiments, database tests, provisioning, implementation, or tracker edits were performed.

## Conclusion

**One current native stack per PR does not imply one Atlas reservation per target.** Native membership constrains each PR's current location; Atlas reservations preserve owners across time. Unstacking and subsequent creation/append can bring evidence from different owners into one stack, or distribute one owner's evidence across several targets. Therefore the accepted layout keeps owners and PR evidence durable, derives current affected targets, and separately preserves observed conflict holds. This is a deduction from native operations plus Atlas policy—not a GitHub-provided reservation guarantee. [N1][N2][N3][N4][P15][P21]

## Evidence date and versions

| Source | Version / reproducibility boundary |
| --- | --- |
| GitHub REST stack documentation | Read 2026-09-05; examples specify `X-GitHub-Api-Version: 2026-03-10`. Documentation is mutable; no raw mutation responses were sampled. [N1] |
| GitHub native stack availability | Public preview and subject to change, according to the API/webhook reference read on the same date. [N5] |
| First-party `github/gh-stack` | Pinned commit `2bd699a544a09cb5c45a013d03416e0894b0454e`; FAQ, REST reference, UI guide, and CLI source below. This is a source pin, not a claim about an installed extension release. [N2][N3][N4][N6] |
| Bun | Context7 resolved `/oven-sh/bun` and returned `bun-v1.4.0` as an available indexed version; the subsequent docs query used the unversioned ID and returned `main` sources. Direct current Bun docs were also read. **Neither establishes the deployed Bun version.** [B1][B2] |
| SQLite | Current official transaction, PRAGMA and WAL docs read 2026-09-05. WAL page reports last update 2026-08-25 and documents a version-specific corruption fix; deployment's SQLite version/build remains unverified. [S1][S2][S3] |

Context7 workflow completed in two commands: `npx ctx7@latest library Bun "Review Bun SQLite documented prepared plain SQL, WAL, synchronous FULL, foreign keys, immediate short transactions and caveats for durable reservation evidence persistence."`, then `npx ctx7@latest docs /oven-sh/bun` with the same query. Context7's foreign-key excerpt came from a compatibility test, so SQLite's own PRAGMA documentation—not that excerpt—is the authority for foreign-key semantics. [B2][S2]

## 1. Verified native facts, not Atlas policy

| Native evidence | Persistence consequence / limit |
| --- | --- |
| A PR exposes a singular `stack` membership object; the pinned reference specifies `null` for standalone PRs. Its stack has a global ID and Repository-scoped number, and its position is 1-based from the bottom. [N3] | Store explicit current membership and ordinal separately from ownership. Do not derive native membership from branch-name adjacency. This storage rule is accepted Atlas policy. [P15][P21] |
| The official CLI explicitly enforces the “one-stack constraint” before append and rejects a PR already belonging to another stack with “unstack it first.” Its matching logic rejects PRs spanning multiple stacks with “unstack them first, then re-link.” [N4] | This corroborates current single membership, **not** permanent membership or a single reservation owner. CLI validation is not proof of every raw REST rejection case. [N4][P15] |
| REST unstack removes removable unmerged members, retaining locked members such as queued PRs; it returns an updated stack with `200`, or `204` if none remain and the stack dissolves. [N1] The pinned FAQ/UI guide explicitly retain merged and queued PRs and remove open/draft/closed PRs. [N2][N6] | A membership disappearing is not evidence that an Atlas owner released. A surviving historical stack can coexist with moved evidence. [P15][P21] |
| REST create accepts a bottom-to-top list with matching base/head refs; append accepts only new PRs above the current top with the first new base matching that top's head. [N1] The pinned reference specifies creation size 2–100. [N3] | External compositions must respect native chain/eligibility constraints; they need not preserve Atlas target groupings. [P15][P21] |
| The FAQ documents tear-down/recreation; the UI guide says unstacked PRs keep their current base branch while losing stack linkage. [N2][N6] | Reusing PR identities does not justify treating a newly created stack as the old identity. Atlas explicitly retains distinct stack records and requires queue reconfirmation after target disappearance. [P15][P21] |

### Counterexamples: compositions, not mutation-test results

Assume same-Repository PRs, removable open/draft members, valid base/head chains, sufficient capacity, and no other native blockers. The following are **logical compositions of documented operations**, not claims of successful live requests. Atlas holds survive these external changes by policy. [N1][N2][N3][P15][P21]

1. **Convergence:** owner A retains evidence PRs `a1,a2` from stack A; owner B retains `b1,b2` from stack B. With compatible chain `a1 → a2 → b1 → b2`, an external writer unstacks B, then appends `b1,b2` to A. Alternatively, unstack both and create a new combined stack. Each PR still has at most one current native stack, but the destination is affected by **two existing Atlas reservations**. Arbitrary incompatible branches are not claimed to become appendable without external preparation. [N1][N4][P15][P21]
2. **Split:** one owner retains `p1,p2,p3,p4` from a reserved four-layer stack. After full unstack, an external writer creates `[p1,p2]` and `[p3,p4]` separately, using the latter's existing lower base as its trunk; native stacks may use any existing Repository branch as trunk. One reservation now affects **two different native targets**, although each PR belongs to just one. If some PRs remain locked in the original stack, original-target ownership is preserved as well. [N1][N2][N3][N6][P15]

These counterexamples do not require simultaneous membership of a PR in two stacks, nor a hypothetical atomic “merge stacks” operation. They invalidate the proposed ownership uniqueness constraint even while accepting the native single-membership restriction. [N1][N4][P15]

## 2. Accepted Atlas persistence policy

The following is a focused restatement of the approved logical layout, **not a new schema proposal**. All rows and retention rules in this section are policy from the persistence and PR-stack reconciliation resolutions. [P15][P21]

| Record | What must survive | What it must not become |
| --- | --- | --- |
| `pull_requests` | Permanent PR identity, Repository and number lookup, required observed facts; retain referenced closed/merged PRs. | Open-only cache or mutable branch name used as permanent publication identity. [P15][P21] |
| `pr_stacks` | Explicit native identity, Repository-scoped native number, trunk and observation/lifecycle state; preserve historical targets. | A recreated stack silently renamed to its predecessor's identity. [P15] |
| `stack_members` | Refreshable stack/PR/ordinal projection; one current stack per PR and unique position per stack. | Atlas ownership or permanent evidence of every historical membership. [P15] |
| `stack_reservations` | Owner Session, original target, accepted standalone-to-native association, held/released state and release evidence/reason/time. | A single `current_owner` field on a stack or unique-current-target ownership constraint. [P15] |
| `reservation_prs` | Reservation + permanent PR identity, with evidence role: observed reserved-stack member, preparation parent, resulting publication. | A recursive traversal that acquires unrelated members of every successor stack. [P15] |
| `reservation_conflict_holds` | Recorded target + each involved reservation; each owner's hold persists until that owner releases. | A redundant materialization of every current membership-derived blocking edge. [P15] |
| `sessions` / `session_history` | Queue identity/order, original/reconfirmed target, preparation parent, permanent resulting PR, distinct execution-slot ownership, and small admission/reconfirmation/reservation/release history. | A separate job aggregate, event-sourced reconstruction requirement, or copied OpenCode transcript. [P15] |
| `refresh_state` | Requested/completed generations per Repository/view, invalidation, last successful reconciliation and availability/failure. | A volatile refresh flag that can lose an invalidation on restart or older completion. [P15] |

### Derive locations; retain evidence and policy holds

For an unreleased reservation, the accepted blocking model is the union of **original/accepted associated ownership**, **targets derived from its retained PRs' freshly verified current membership or standalone status**, and **recorded conflict holds**. This is explanatory set notation for the persistence policy, not a new persisted edge table. [P15]

- Collect members observed in the reserved stack while held, preparation parent, and permanently identified resulting PR. Follow those identities after movement. Do **not** collect unrelated PRs simply because they share a replacement/successor stack; explicit standalone-to-native association remains the previously accepted exception/contract. [P15][P21]
- Example: retained PR `p` moves into successor S containing unrelated `q`. The reservation affects S because of `p`; merely sharing S does not add `q` to its retained evidence. If `q` later moves to T, `q` alone does not extend this owner's reach to T. This is a direct application of the no-recursive-acquisition policy. [P15]
- Conflict holds are deliberately historical. If A and B were observed converging on S, both owners' holds on S survive later membership movement. Releasing A removes only A's ownership/hold; B continues to block S until B releases. Recomputing only current edges would lose that accepted policy fact. [P15][P21]
- Unknown membership is not verified absence. Failed, incomplete or inconsistent reads must not remove evidence, clear owners, establish standalone status, or authorize admission. Pause the potentially affected scope; unrelated Repositories need not pause. [P15][P21]

### Admission, release and retention boundaries

- Before admission/release, refresh the candidate and relevant held-reservation evidence. Commit verified native observations, retained PR evidence, queue associations, conflict holds and the local admission decision atomically; recheck local owners and invalidations before granting admission. Never hold the database transaction across GitHub/OpenCode requests. [P15]
- Global execution slots and reservations are independent: terminal execution can free a slot while publication retains a reservation. Restore both kinds of ownership before restart admission; no membership loss, outage, missing resource, or queue reconfirmation is itself a release. [P15][P21]
- Publication discovery uses unique working branch + Repository, then freezes the permanent resulting-PR identity. Later branch reuse never switches that association. Replacement-stack release needs fresh proof that the same preparation parent and permanent result belong together, with result above parent, non-draft, open or merged, after confirmed terminal execution. Closed-unmerged/unknown publication retains ownership for terminal-only explicit release. Preserve the default-branch-owner exception and never resurrect a validly released reservation. [P15][P21]
- Keep identities/state/order/ownership/timestamps in SQL columns; JSON is for immutable handoff snapshots and small diagnostic/history details. Keep referenced cache rows even after active-list removal; prune unreferenced cache only after a successful complete refresh. Preserve history on Repository removal and reuse only for the same stable Repository identity. [P15]

## 3. Bun SQLite support for the approved layout

**Bun supplies SQL execution and transaction primitives; Atlas supplies the ownership predicates, schema, migration ledger, refresh protocol and release policy.** The docs support implementing this layout without an ORM; they do not provide an Atlas admission system. [B1][P15]

| Primitive / caveat | Evidence and application |
| --- | --- |
| Prepared plain SQL | `bun:sqlite` is built in and synchronous. `db.query()` caches compiled statements, not results; `db.prepare()` creates uncached statements. Named/positional values bind on execution. This supports parameterized ownership queries without an ORM. [B1] |
| Binding and identity care | Default non-strict binding does not throw for a missing parameter; `strict: true` does. SQLite integers are signed 64-bit; Bun's default number results can round beyond JavaScript's safe integer range, whereas `safeIntegers: true` returns bigint. Implementation must choose lossless identity representation and validate binding; these options are documented safeguards, not additional settled schema decisions. [B1][P15] |
| Atomic synchronous transactions | `db.transaction(fn)` begins on invocation, commits when the callback returns, and rolls back on a thrown exception; `.immediate()` uses `BEGIN IMMEDIATE`. Therefore the accepted transaction callback must contain synchronous database work only, with network reads completed beforehand. Do not claim the wrapper awaits an async callback. [B1][P15] |
| Immediate ownership writes | SQLite has one simultaneous writer; `BEGIN IMMEDIATE` starts the write transaction immediately and can fail with `SQLITE_BUSY`. Use it for admission and ownership-changing reconciliation, rechecking local predicates inside it. Handle failure without reporting a successful claim/release. WAL does not create multiple concurrent writers. [S1][S3][P15] |
| Foreign keys | Enable and verify `PRAGMA foreign_keys=ON` on the connection before transactions; changing it within a transaction is a no-op. Do not rely on compile-time defaults. Same-Repository references still require the accepted constraints/transactional validation, not merely any arbitrary FK. [S2][P15] |
| WAL | Bun documents `db.run("PRAGMA journal_mode = WAL;")`. SQLite returns the effective mode; unsuccessful conversion can leave the old mode. Verify `wal`, not just absence of an exception. WAL permits readers alongside the single writer, requires same-host coordination, and is not suitable for network filesystems. [B1][S2][S3] |
| FULL durability | Set and verify `PRAGMA synchronous=FULL` (`2`). In WAL mode FULL adds a WAL sync after each commit; NORMAL can lose committed transactions after power loss/system crash. FULL is the accepted durability policy, not Bun's performance recommendation inferred as a durability guarantee. [S2][S3][P15] |
| Short work / failure handling | Long readers can prevent checkpoints completing; checkpoints can add commit latency, and WAL queries can still return busy. Short synchronous transactions and explicit lock/write-error handling are therefore important; no throughput or crash-recovery test was performed here. [S1][S3][P15] |
| Migrations | Apply numbered SQL migrations and their `schema_migrations` ledger entries transactionally before serving. Refuse startup on failure; never reset/delete data. This is Atlas policy supported by Bun transaction primitives, not a claimed built-in Bun migration runner. [B1][P15] |
| Backup scope | SQLite says the WAL is persistent database state: separating it from the database can lose committed transactions or corrupt the copy. Follow the accepted coherent snapshot/restore procedure for database and matching WAL/journal state; this is not permission to copy changing files independently or manually delete sidecars. [S3][P15] |

### Deployment caveats requiring verification

1. **Actual SQLite build matters.** Current Bun docs say macOS uses system SQLite (persistent WAL sidecars), while Linux/Windows statically link SQLite and typically clean sidecars on final close. macOS observations are not deployment proof. Record actual Bun and SQLite versions and effective PRAGMAs in deployment validation. [B1][P15]
2. **WAL-reset fix:** SQLite's current WAL documentation says the rare concurrent write/checkpoint corruption bug affects versions through 3.51.2, is fixed in **3.51.3 and later**, and has backports **3.44.6** and **3.50.7**. Verify deployment includes a fixed build; WAL/FULL alone does not establish that. No deployed version was checked in this reconstruction. [S3] (§11)
3. **Sync is not magic:** FULL relies on SQLite's VFS sync operation; `fullfsync` is a distinct macOS-specific setting. This note does not establish storage hardware/filesystem power-loss behavior, backup consistency, or restore success. [S2]

## 4. Evidence gaps / claims deliberately not made

- **No live transition proof:** create/unstack/append compositions show the model must allow convergence/split, but exact raw REST errors, race timing, closed-top append behavior, and every locked-member transition remain untested. CLI guards are not server implementation evidence. [N1][N4][P21]
- **No external lock:** Atlas's accepted exclusivity is between its local admission decisions. No GitHub-wide read-and-reserve/future-layer lock or complete detection of external pending direct merges was verified; a SQLite write transaction cannot establish those guarantees. [P21][S1]
- **No historical reconstruction guarantee:** branch incarnation/reuse continuity and missed simultaneous readiness/membership are not proven by current identities or webhook history. Unknown evidence retains reservations under accepted policy. [P21]
- **No deployed database validation:** no schema, migrations, busy handling, crash recovery, backup/restore, PRAGMA configuration, or deployed Bun/SQLite versions were tested. The new WAL-reset version warning is an implementation verification item, not a reopened ownership decision. [P15][S3]

## Primary sources

- [P15] [Persistence model: repositories, specs, PRs, sessions, associations, and reconciliation][P15] — authoritative persistence policy, resolved 2026-09-05.
- [P21] [PR-stack projection and reservation reconciliation][P21] — authoritative reservation/reconciliation policy, resolved 2026-09-05.
- [N1] [GitHub REST stack endpoints][N1] — create, append, unstack and identities; API examples versioned 2026-03-10.
- [N2] [Pinned first-party stack FAQ][N2] — unstack/recreate, retained members, arbitrary existing trunk.
- [N3] [Pinned first-party REST reference][N3] — singular membership, IDs, ordinals and creation limits.
- [N4] [Pinned CLI `cmd/link.go`][N4] — lines 281–285 and 340–359 enforce one-stack append; lines 754–773 reject multi-stack input and instruct unstack/re-link.
- [N5] [GitHub stack APIs and webhooks][N5] — public-preview status and explicit membership surface.
- [N6] [Pinned UI guide, Unstacking][N6] — PRs retain bases after unlinking; merged/queued survivors.
- [B1] [Bun SQLite documentation][B1] — prepared SQL, binding, transaction wrapper, immediate variant, WAL and platform caveats.
- [B2] [Bun documentation source returned by Context7][B2] — mutable `main`; not a deployment/version pin.
- [S1] [SQLite transaction documentation][S1] — single writer, immediate transactions and errors.
- [S2] [SQLite PRAGMA documentation][S2] — `foreign_keys`, `journal_mode`, `synchronous`, `fullfsync`; unknown PRAGMAs can be silently ignored.
- [S3] [SQLite WAL documentation][S3] — concurrency, checkpoints, sidecar integrity, filesystem limitations and §11 WAL-reset bug.

[P15]: https://github.com/SandunRathsara/atlas/issues/15#issuecomment-5551092831
[P21]: https://github.com/SandunRathsara/atlas/issues/21#issuecomment-5550956896
[N1]: https://docs.github.com/en/rest/pulls/stacks
[N2]: https://github.com/github/gh-stack/blob/2bd699a544a09cb5c45a013d03416e0894b0454e/docs/src/content/docs/faq.md
[N3]: https://github.com/github/gh-stack/blob/2bd699a544a09cb5c45a013d03416e0894b0454e/docs/src/content/docs/reference/rest-api.md
[N4]: https://github.com/github/gh-stack/blob/2bd699a544a09cb5c45a013d03416e0894b0454e/cmd/link.go#L281-L285
[N5]: https://docs.github.com/en/pull-requests/reference/stacked-pull-requests-apis-and-webhooks
[N6]: https://github.com/github/gh-stack/blob/2bd699a544a09cb5c45a013d03416e0894b0454e/docs/src/content/docs/guides/ui.md#unstacking
[B1]: https://bun.sh/docs/runtime/sqlite
[B2]: https://github.com/oven-sh/bun/blob/main/docs/runtime/sqlite.mdx
[S1]: https://www.sqlite.org/lang_transaction.html
[S2]: https://www.sqlite.org/pragma.html
[S3]: https://www.sqlite.org/wal.html
