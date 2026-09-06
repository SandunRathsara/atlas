# Start-session defaults, replay safety, and Repository-scoped GitHub access

> **Reconstructed on 2026-09-05.** This replaces a missing research asset; it is not the original note or a record of the original experiment. Findings below come from fresh, read-only primary-source research. No agent sessions/prompts, GitHub mutations, token minting, secret access, provisioning, or integration experiments were performed.

## Summary

- **Verified in pinned source:** omitted agent/model selections can resolve through OpenCode's location-aware defaults; they do not mean one fixed global model.
- **Verified in pinned source:** callers can provide session/message IDs. Same-ID prompt admission still reaches execution wake-up. Deduplication is **not** permission to replay uncertain requests.
- **Accepted Atlas policy:** durably save admission and request identities before writes; save the OpenCode association before prompting; reconcile lost responses with reads, not retries.
- **Accepted deployment policy, not tested wiring:** Atlas token supplier + host-managed `gh` launcher + Git credential helper, using exactly one Repository per token.
- **Verified limitation:** per-session environment is an in-memory map, not durable credentials or a demonstrated parent-to-subagent inheritance mechanism.

## Evidence and version boundary

The authoritative product decisions are the **final resolutions**, not their earlier checkpoints:

- [Start-session contract: initial prompt, spec context, and OpenCode request][issue9], resolved 2026-09-05.
- [Phase 1 deployment: systemd, secrets, data directories, logs, and backups][issue17], resolved 2026-09-05, especially section 7. This turns the start contract's feasible credential option into the approved deployment arrangement; it does not claim deployment acceptance checks passed.

Both issues and all their comments were read using `gh issue view` in this repository. Exact published packages were downloaded from the upstream npm registry and inspected as text, without importing/running OpenCode:

| Artifact | Version | Primary source |
| --- | --- | --- |
| `@opencode-ai/client` | `0.0.0-beta-19135` | [Published tarball][client] |
| `@opencode-ai/core` | `0.0.0-beta-19135` | [Published tarball][core] |
| `@opencode-ai/schema` | `0.0.0-beta-19135` | [Published tarball][schema] |

The core/client package manifests identify `github.com/anomalyco/opencode`, under `packages/core` and `packages/client`. Registry metadata queried here did not supply a `gitHead`; no source-commit identity is invented. References below identify exact files inside those tarballs, including bundled source-section names where available. These published artifacts are stronger evidence for this beta than current `main`.

Current official V2 documentation was fetched on the reconstruction date. Context7 lookup used `library` then `docs` for OpenCode V2, GitHub CLI, and Git (two commands per question). The OpenCode V2 index had no matching pinned beta version, so it provides documentation context, **not beta-specific proof**. No V1 configuration schema was used. Git/GitHub CLI documentation describes current behavior; deployed executable versions were not inventoried here. GitHub's fetched App guide examples use REST API version `2026-03-10`.

## 1. Omitted selections and location configuration

**Verified — published client/core.**

- `client/dist/promise/generated/client.js` sends optional `id`, `title`, `agent`, `model`, `location`, and `metadata` on create. Its generated types expose optional agent/model fields. Omission is supported, not a requirement to fill a selector first.
- Core `dist/chunks/event-logger-0ak8fpq9.js`, `Session.create`, lines 168–204, records supplied agent/model rather than forcing defaults at creation. It uses the supplied location (or an existing parent's location). Atlas should supply the prepared clone's explicit directory.
- Core `event-logger-7a627tte.js`, `ConfigAgentPlugin`, lines 75–98, reads `default_agent` from loaded configuration documents and updates the agent registry. Core `event-logger-tgtjrhay.js`, line 144, selects using `session.agent`.
- Core `event-logger-5ranmbyz.js`, `SessionRunnerModel.resolve`, lines 64–84, invokes the model resolver when `session.model` is absent. `event-logger-vv4xtdqm.js`, `ModelResolver.resolve`, lines 233–239, tries the catalog default, then an available model with a supported package if that default is unsuitable. It is a location-scoped service. `event-logger-hpkkrthc.js` applies the configured model default to that catalog.

**Verified — current official docs, not an exact-beta precedence experiment.** [V2 configuration][config] documents global configuration plus discovery from the current Location through every ancestor to filesystem root, including above the repository. Direct configs merge farthest-to-nearest, followed by `.opencode` configs farthest-to-nearest; discovered `.opencode` configs override discovered direct configs. It documents `default_agent` and root `model`.

**Accepted policy.** The start-session resolution omits Atlas agent/model selectors and selections, allowing OpenCode effective defaults, including location configuration. Neither Atlas nor this note promises a particular model name. Availability, credentials, plugins, and effective configuration still matter; successful session creation is not proof a model can execute. Do not import assumptions about TUI model history or agent-specific model precedence into an untested HTTP client flow.

## 2. Caller-generated identity and acceptance

**Verified — pinned schema and client.**

- `schema/dist/session-id.js:4–8`: Session ID validation is `Schema.isStartsWith("ses")`; its normal generator emits `ses_` plus a descending identifier. This beta's validator is weaker than an assumed UUID format.
- `schema/dist/session-message.js`, `ID`: message IDs require the `msg_` prefix. `schema/dist/identifier.js` generates time/counter plus random identifiers. Prefer the matching schema's constructors/generators and validate against the pinned contract, rather than treating Atlas's raw database ID as an OpenCode ID.
- Create's caller ID field is **`id`**. Prompt's caller message ID field is also **`id`**, alongside **`sessionID`**. Do not mistakenly send a `messageID` field as the prompt identity.
- `client/dist/promise/generated/client.js:325–341` sends `POST /api/session/{sessionID}/prompt`, expects HTTP **200**, and returns `value.data`. Generated `client.d.ts` declares `Promise<SessionInboxUser>`. This is inbox admission, **not the completed assistant response**.

**Verified — replay hazards in pinned core.**

1. `event-logger-0ak8fpq9.js:168–173` returns an already stored session for the requested ID before creating anything. This lookup does not compare every newly supplied input with the original request. Use unique IDs and Atlas's durable request content; do not reuse an ID for different intent.
2. `event-logger-xr1t7wkk.js:145–168`, `Session.prompt`, resolves the ID, reconciles an existing inbox/message identity, otherwise prepares and admits the input, then calls `execution.wake(sessionID)` unless `resume === false`.
3. That wake-up occurs **even when reconciliation found an existing item**. Repeating the same ID can therefore have execution effects without duplicating the inbox item.
4. `event-logger-vkn1y4t9.js:160–183`, `SessionInbox.reconcile/admit`, checks stored inbox identity or a promoted message and raises lifecycle conflicts for incompatible matches. Admission deduplication is not an exactly-once execution or content-replacement API.

**Conclusion:** a lost response cannot establish that create/prompt failed. Neither a new ID nor a same-ID retry is an acceptable read probe. Setting `resume: false` is not an approved workaround for replaying unknown requests.

## 3. Atlas startup ordering and reconciliation

The following is **accepted start-session policy**, not an implemented/tested transaction:

1. Opening/cancelling the form creates nothing. Reject whitespace-only input and enforce the 20,000-character user-prompt cap. Refresh the Spec on submission; reject closed, unlabelled, or inaccessible Specs while retaining typed input.
2. A database-backed form submission identity survives refresh/retry and admits one queued Atlas Session. Persist unchanged user text, separated context, preparation intent, correlation, and stable schema-valid OpenCode session/message IDs before their respective remote requests.
3. Wait for global and target eligibility; prepare a dedicated full clone and unique branch. Establish scoped Git/gh access before execution.
4. Create OpenCode with explicit clone location and title `Spec #<number>: <title>`. Durably save its association before sending the initial prompt. Mutable title is not the identity key.
5. Subscribe before prompting, and use HTTP as canonical reconciliation. [The client guide][client-doc] says event subscriptions are live-only, lazy until consumed, and have no replay/automatic reconnection. Merely constructing an iterator is not a proven subscription barrier.
6. Lost create/prompt responses remain **Start unconfirmed** under the settled failure contract, not a new semantic state. Read by saved session ID and validate correlation/location. Check initial inbox/message identity, including delivered messages rather than only pending inbox contents. An empty pending inbox alone does not prove non-admission.
7. Preserve Session rows, prompt, directories, and partial resources. No rollback deletion and no automatic uncertain replay. A persistence failure must not permit an unassociated prompt launch.

Context precedes the unchanged user prompt and identifies Spec URL/title/body, Repository, and resolved starting base. Stacked work also includes parent PR URL, immediate parent branch, trunk, stack identity where present, working branch, and actual preparation SHA, explicitly saying the new layer is local and not yet published. The cap is Atlas user-input policy, not a verified OpenCode maximum for the combined context payload. Exact character-count semantics and a transport-size budget are not established by this source investigation.

## 4. GitHub authentication: what the platform supports

**Verified — GitHub's App documentation.** [Token generation][tokens] supports `repository_ids` when minting an installation token. Omitting repository selection grants the token all repositories available to that installation. For Atlas, specify exactly the registered Repository ID; do not rely on installation-wide defaults. Permissions cannot exceed the installation grant. Tokens expire after **one hour**, and the response supplies expiry information.

[Installation authentication][installation] supports REST/GraphQL subject to endpoint-specific token support and permissions, and HTTP Git access with the Contents permission. A token is the HTTP password; Atlas's policy intentionally rejects the guide's credential-bearing clone-URL example in favor of a credential helper and credential-free HTTPS remotes. Authenticated `gh` does not imply all subcommands/endpoints work with App tokens or bypass rulesets.

**Verified — GitHub CLI.** [Environment documentation][gh-env] gives `GH_TOKEN` precedence over `GITHUB_TOKEN` and stored credentials for GitHub.com. `GH_HOST`, `GH_REPO`, enterprise token variables, and `GH_CONFIG_DIR` affect routing/configuration. `GH_DEBUG=api` logs HTTP traffic. [The `gh auth token` command][gh-token] explicitly outputs a token: ordinary authenticated CLI access is not a non-disclosure boundary.

**Verified — Git.** [Credential documentation][git-credentials] supports external helpers over stdin/stdout. An empty `credential.helper` resets inherited helper lists; `credential.useHttpPath=true` makes HTTP repository paths available for distinction. Helpers must validate exact protocol, host, and authorized Repository path themselves. Returning `quit=true` prevents subsequent helper/prompt fallback on failure; merely returning no credentials is not fail-closed behavior.

## 5. Approved supplier / launcher / helper arrangement

**Accepted deployment policy — the deployment resolution's section 7, not operational verification.**

| Component | Responsibility |
| --- | --- |
| Atlas-local supplier | Resolve registered Session-to-Repository mapping, not an arbitrary caller repository; mint same-App-installation tokens with exactly one repository ID and agreed permissions; cache outside clones and refresh before expiry. |
| Host-managed `gh` launcher | Resolve registered Session directory, get a current token per invocation, invoke an explicit real binary with child-only token environment and controlled external configuration; clear conflicting auth/target variables and credential-revealing debug settings. Fail closed outside scope or when supplier is unavailable. |
| Host-managed Git helper | Authenticate preparation and later clone-local Git operations using the same mapping/token source. Reset inherited helpers, validate HTTPS GitHub host and exact repository path, deliver credentials only through Git's credential pipe, and keep remotes credential-free. |
| OpenCode service configuration | Put the trusted launcher on controlled PATH from service startup; use explicit executable paths/HOME/working directory. Do not copy Atlas's secret-bearing environment to agent shells. |

The App key stays in restricted files outside clones/source control (`/etc/atlas` under the deployment resolution). Helpers live outside clones. Forks are excluded. No human-login, SSH, or broad-installation-token fallback is allowed. Renewal creates/supplies current installation credentials; `gh auth refresh` is not the supplier for this design. Do not automatically rerun a mutating Git/gh command after an uncertain response.

Scope protects against accidental cross-Repository credential use, not every possible cross-repository read (for example, public data), and not a hostile same-user agent. The deployment resolution deliberately shares `omega`; filesystem permissions and host-managed helpers are not isolation from that account. Tokens supplied to ordinary commands can be deliberately printed or copied. Atlas must keep them out of its prompts, URLs, UI, reports, arguments, and diagnostics without claiming absolute secrecy from agents.

## 6. Descendants, renewal, and restart limits

**Verified — pinned source.**

- `event-logger-bg0z499z.js:17–27`, `SessionEnvironment`, stores cloned variable objects in a process-local `Map`, keyed by session ID. There is no persistence in this implementation.
- `event-logger-0ak8fpq9.js:230–235`, `Session.environment`, sets/gets that map after confirming the session exists.
- `event-logger-hjagmg68.js:205–217`, `Shell.create`, obtains variables for the exact session ID on local locations, then constructs environment from `sessionEnvironment ?? process.env`, with terminal markers. A supplied map is a replacement base, **not an automatic merge with process environment**. Workspace-backed locations take a different path; this note covers local full clones.
- `event-logger-ajxr8k0d.js:133–147`, subagent creation, passes parent ID, title, agent and model, then prompts the child. Together with create/environment source, this does **not** copy the parent session's environment map to the child. Parent location/metadata inheritance is not credential-environment inheritance.

**Accepted mitigation.** Use durable host/service PATH and clone-local Git helper configuration, so normal commands request credentials at invocation instead of depending solely on a parent's transient environment. Supplier restart must recover authorization from durable Atlas associations. OpenCode restart loses the map; discover/authenticate/reconcile the restarted service rather than assuming old environment or executing old prompts again. The deployment resolution selects `Service.discover()` / `Service.headers()`, not an Atlas-owned auto-start/upgrade lifecycle.

**Unverified limits.** Login shells, shell startup files, explicit PATH replacement, absolute binary paths, moved directories, and custom plugins can bypass or alter launcher routing. A nested process launched by a token-bearing `gh` child may inherit that child's token, but this is not a refresh mechanism. A long-running command does not magically receive a replacement environment token mid-process. Deployment must verify real descendant behavior; no general inheritance guarantee follows from source inspection.

## 7. Gaps / acceptance checks still required

None of these checks was executed during reconstruction:

- Pin and record the actual server/client/schema, Git, gh, runtime and shell versions; verify effective defaults in the actual prepared clone without assuming all betas match.
- Fault-inject lost create/prompt responses and database-save failures; verify read-only reconciliation, message/inbox correlation, no duplicate admission, no execution re-wake, and no cleanup deletion.
- Verify event-subscription readiness and missed-event recovery through HTTP; define reconciliation behavior while projections are unavailable or not yet visible.
- Implement and inspect IPC authentication, canonical directory-to-Session resolution (including nested directories/symlinks), repository-path normalization, permissions, cache expiry margin, and fail-closed errors.
- Verify ordinary Git/gh, nested shells/directories, subagents, login-shell overrides, and OpenCode/supplier restarts. Correct trusted PATH wiring before allowing execution; do not accept partial coverage.
- In a separately authorized deployment exercise, test allowed operations, denial against another private Repository, token expiry/refresh, and supplier outage without logging credentials. Test in-flight expiry without blindly replaying mutations.
- Inspect existing helper, askpass, SSH, URL-rewrite and CLI configuration fallback so the intended identity is actually used; validate that no Atlas secret environment or debug output leaks.

These are downstream acceptance work, not a reopening of the start-session/deployment decisions or a claim that their approved design is deployed.

[issue9]: https://github.com/SandunRathsara/atlas/issues/9#issuecomment-5550733490
[issue17]: https://github.com/SandunRathsara/atlas/issues/17#issuecomment-5550786789
[client]: https://registry.npmjs.org/@opencode-ai/client/-/client-0.0.0-beta-19135.tgz
[core]: https://registry.npmjs.org/@opencode-ai/core/-/core-0.0.0-beta-19135.tgz
[schema]: https://registry.npmjs.org/@opencode-ai/schema/-/schema-0.0.0-beta-19135.tgz
[client-doc]: https://opencode.ai/v2/docs/build/client
[config]: https://opencode.ai/v2/docs/config
[tokens]: https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app
[installation]: https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/authenticating-as-a-github-app-installation
[gh-env]: https://cli.github.com/manual/gh_help_environment
[gh-token]: https://cli.github.com/manual/gh_auth_token
[git-credentials]: https://git-scm.com/docs/gitcredentials
