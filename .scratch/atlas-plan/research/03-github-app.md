# 03 - GitHub App for Atlas: permissions, installation tokens, webhooks, signature verification

Ticket: [issues/03-github-app.md](../issues/03-github-app.md)
Date: 2026-09-04
Method: GitHub docs fetched directly; package READMEs fetched from GitHub raw; `npm view` for versions; `hono@4.13.5` tarball inspected; GitHub's OpenAPI webhook descriptions read from `@octokit/openapi-webhooks@12.1.0` (a verbatim mirror of `github/rest-api-description`). Anything not backed by one of those is flagged in section 7.

## TL;DR

- Yes, a webhook fires for dependency changes: event `issue_dependencies`, actions `blocked_by_added`, `blocked_by_removed`, `blocking_added`, `blocking_removed`. Needs the "Issues" repository permission (read).
- Repository permissions: **Issues: read**, **Pull requests: read**, **Contents: read** (clone) or **write** (push), **Metadata: read**. API keys: `issues`, `pull_requests`, `contents`, `metadata`.
- Token flow: RS256 JWT (exp <= 10 min) -> `POST /app/installations/{installation_id}/access_tokens` -> token valid 1 hour -> `git clone https://x-access-token:TOKEN@github.com/owner/repo.git`.
- Signature: HMAC-SHA256 of the raw body, header `X-Hub-Signature-256: sha256=<hex>`, constant-time compare. Hono has no first-party helper; use `@octokit/webhooks` (`verify`, `verifyAndReceive`, or `createWebMiddleware`) or Web Crypto by hand.
- Packages (2026-09-04): `octokit@5.0.5` (or `@octokit/app@16.1.4` + `@octokit/webhooks@14.2.0`), `@octokit/auth-app@8.3.1`, `hono@4.13.5`. Bun is not named as a supported runtime in any Octokit README; needs a smoke test.

## 1. Permissions

All are *repository* permissions on the GitHub App registration. The API-side keys (used in the `permissions` body of the token endpoint and in token responses) are in the second column.

| Registration name | API key | Level | Why |
|---|---|---|---|
| Issues | `issues` | read | list/get issues, issue labels, issue dependencies, timeline; subscribe to `issues` and `issue_dependencies` webhooks |
| Pull requests | `pull_requests` | read | list/get PRs; subscribe to `pull_request` webhook |
| Contents | `contents` | read (clone) / write (push) | HTTPS git access with the installation token |
| Metadata | `metadata` | read | `GET /repos/{owner}/{repo}`, `GET /repos/{owner}/{repo}/labels` |

Sources:

- Endpoint-to-permission mapping: [Permissions required for GitHub Apps](https://docs.github.com/en/rest/authentication/permissions-required-for-github-apps).
  - Under "Repository permissions for 'Issues'": `GET /repos/{owner}/{repo}/issues` (read), `GET /repos/{owner}/{repo}/issues/{issue_number}` (read), `GET /repos/{owner}/{repo}/issues/{issue_number}/labels` (read), `GET /repos/{owner}/{repo}/labels` (read), `GET /repos/{owner}/{repo}/issues/{issue_number}/timeline` (read), `GET .../issues/{issue_number}/dependencies/blocked_by` (read), `GET .../dependencies/blocking` (read), `POST .../dependencies/blocked_by` (write), `DELETE .../dependencies/blocked_by/{issue_id}` (write).
  - Under "Repository permissions for 'Pull requests'": `GET /repos/{owner}/{repo}/pulls` (read), `GET /repos/{owner}/{repo}/pulls/{pull_number}` (read).
  - Under "Repository permissions for 'Metadata'": `GET /repos/{owner}/{repo}` (read), `GET /repos/{owner}/{repo}/labels` (read), `GET /repos/{owner}/{repo}/labels/{name}` (read).
- Issue dependency endpoints and their permission text ("Issues" repository permissions (read) for the two GETs, (write) for POST/DELETE): [REST API endpoints for issue dependencies](https://docs.github.com/en/rest/issues/issue-dependencies). The page shows `X-GitHub-Api-Version: 2026-03-10` in its examples.
- Git over HTTPS needs Contents: "If you want your app to use an installation or user access token to authenticate for HTTP-based Git access, you should request the 'Contents' repository permission." [Choosing permissions for a GitHub App, "Choosing permissions for Git access"](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/choosing-permissions-for-a-github-app). Same statement in [Authenticating as a GitHub App installation](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/authenticating-as-a-github-app-installation).
- API key names and descriptions, from the `permissions` body parameter of [Create an installation access token for an app](https://docs.github.com/en/rest/apps/apps?apiVersion=2022-11-28#create-an-installation-access-token-for-an-app):
  - `contents`: "The level of permission to grant the access token for repository contents, commits, branches, downloads, releases, and merges. Can be one of: read, write"
  - `issues`: "The level of permission to grant the access token for issues and related comments, assignees, labels, and milestones. Can be one of: read, write"
  - `metadata`: "The level of permission to grant the access token to search repositories, list collaborators, and access repository metadata. Can be one of: read, write"
  - `pull_requests`: "The level of permission to grant the access token for pull requests and related comments, assignees, labels, milestones, and merges. Can be one of: read, write"
- Webhook subscription is gated by permissions: "The specific webhook events that you can select for your GitHub App registration are determined by the type of permissions you selected for your app." [Using webhooks with GitHub Apps](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/using-webhooks-with-github-apps). Per-event requirement text is on the [events page](https://docs.github.com/en/webhooks/webhook-events-and-payloads): `issues` and `issue_dependencies` need "at least read-level access for the 'Issues' repository permission"; `pull_request` needs the same for "Pull requests".

Notes:

- Contents *write* for push is an inference from the permission's read/write levels; the docs only demonstrate `git clone`. See section 7.
- Minimum set for Phase 1 if Atlas never pushes (the agent pushes from inside the run directory using the same token): Contents read is enough for the clone, but the agent's push needs write. Since the token is what the agent will use, request **Contents: write**.

## 2. Installation tokens

### 2.1 Flow

1. Build a JWT signed with the app's private key. Source: [Generating a JSON Web Token (JWT) for a GitHub App](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-json-web-token-jwt-for-a-github-app).
   - Claims: `iat` ("The time that the JWT was created" - the page recommends setting it 60 seconds in the past for clock drift), `exp` (at most "10 minutes into the future"), `iss` ("The client ID or application ID of your GitHub App" - "Use of the client ID is recommended"), `alg` = `RS256`.
   - Send as `Authorization: Bearer <JWT>` ("if you are passing a JSON web token (JWT), you must use `Authorization: Bearer`").
2. Find the installation ID: from the webhook payload's `installation.id`, or `GET /app/installations`. Source: [Generating an installation access token for a GitHub App](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app).
3. `POST /app/installations/{installation_id}/access_tokens` with the JWT. "You must use a JWT to access this endpoint." Optional body: `repositories` (names), `repository_ids`, `permissions` (subset, e.g. `{"issues":"read","contents":"write"}`). Response `201`: `token`, `expires_at` (ISO 8601), `permissions`, `repository_selection` (`all` | `selected`), `repositories`. Source: [Create an installation access token for an app](https://docs.github.com/en/rest/apps/apps?apiVersion=2022-11-28#create-an-installation-access-token-for-an-app).

### 2.2 Lifetime

- "The installation access token will expire after 1 hour." ([Generating an installation access token](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app))
- "Installation tokens expire one hour from the time you create them. Using an expired token produces a status code of 401 - Unauthorized, and requires creating a new installation token." ([REST: Create an installation access token](https://docs.github.com/en/rest/apps/apps?apiVersion=2022-11-28#create-an-installation-access-token-for-an-app))
- Consequence for Atlas: a run's clone happens at start (fine), but the agent's `git push` may happen hours later. Atlas must mint a fresh token when the push is due, or give the agent a way to fetch a fresh one (credential helper, see 2.3). Do not bake a 1-hour token into the clone's remote URL and expect it to work later.

### 2.3 git clone / push over HTTPS

- Docs, verbatim: "You can also use an installation access token to authenticate for HTTP-based Git access. Your app must have the 'Contents' repository permission. You can then use the installation access token as the HTTP password. Replace `TOKEN` with the installation access token: `git clone https://x-access-token:TOKEN@github.com/owner/repo.git`." ([Authenticating as a GitHub App installation](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/authenticating-as-a-github-app-installation)). Same command on the [Choosing permissions](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/choosing-permissions-for-a-github-app) page.
- Push: the docs show only `clone`; `push` uses the same HTTP password mechanism (not shown verbatim - see section 7). Username is the literal `x-access-token`.
- Embedding the token in the URL writes it into `.git/config` of the run directory. Git supports credential helpers as the alternative to URL-embedded secrets ([git-credential-store](https://git-scm.com/docs/git-credential-store) documents the `https://user:pass@example.com` line format and `credential.helper`). A per-run helper script that asks Atlas for a fresh token solves both the 1-hour expiry and the secret-in-config problem; the exact helper wiring was not researched.
- Spawning git from Bun: `Bun.spawn(["git", "clone", ...], { cwd, env })`, then `await proc.exited` and read `proc.exitCode`; `Bun.spawnSync` returns `success`, `stdout`, `stderr` as Buffers. Source: [Bun.spawn](https://bun.com/docs/api/spawn). `node:child_process` is also listed as implemented (partial notes only around IPC handles): [Bun Node.js compatibility](https://bun.com/docs/runtime/nodejs-apis).

### 2.4 With Octokit

- `@octokit/auth-app` ([README](https://github.com/octokit/auth-app.js#readme)): `createAppAuth({ appId, privateKey, installationId })` then `await auth({ type: "installation", installationId })` returns `{ token, expiresAt, tokenType: "installation", installationId, createdAt, permissions?, repositoryIds?, repositoryNames? }`. "Installation tokens expire after an hour. By default, `@octokit/auth-app` is caching up to 15000 tokens simultaneously"; pass `refresh: true` to bypass the cache. Recommends the **Client ID** over App ID for `appId`.
- `App` class (`octokit` or `@octokit/app`, [README](https://github.com/octokit/app.js#readme)): `new App({ appId, privateKey, webhooks: { secret } })`, `await app.getInstallationOctokit(installationId)` returns an Octokit whose `authStrategy` is always `createAppAuth`; token creation and refresh are automatic. GitHub's own docs show this form ([Authenticating as a GitHub App installation](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/authenticating-as-a-github-app-installation)).
- To get the raw token string for git, call `auth({ type: "installation" })` directly (or `octokit.auth({ type: "installation" })` on the installation Octokit) and read `.token`.
- Private key format: "The private keys provided by GitHub are in `PKCS#1` format, but the WebCrypto API only supports `PKCS#8`. You need to convert it first: `openssl pkcs8 -topk8 -inform PEM -outform PEM -nocrypt -in private-key.pem -out private-key-pkcs8.key`" ([@octokit/auth-app README](https://github.com/octokit/auth-app.js#readme); same in [universal-github-app-jwt](https://github.com/gr2m/universal-github-app-jwt#readme), which lists `-----BEGIN RSA PRIVATE KEY-----` = PKCS#1 and `-----BEGIN PRIVATE KEY-----` = PKCS#8). On Node the README shows `crypto.createPrivateKey(pem).export({ type: "pkcs8", format: "pem" })` for in-process conversion. Recommendation for Atlas: convert once with openssl and store the PKCS#8 key; avoids depending on Bun's `node:crypto` for this.

## 3. Webhooks

### 3.1 App webhook basics

- One webhook URL and one secret per GitHub App registration; events are chosen in the app settings and gated by permissions. Source: [Using webhooks with GitHub Apps](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/using-webhooks-with-github-apps).
- App-delivered payloads carry `installation` ("The GitHub App installation. Webhook payloads contain the installation property when the event is configured for and sent to a GitHub App."), `repository` ("... when the event occurs from activity in a repository."), `sender`, and `organization` when applicable. Source: [Webhook events and payloads](https://docs.github.com/en/webhooks/webhook-events-and-payloads). The `installation` object has `id` and `node_id` (OpenAPI schema `simple-installation`).
- Delivery headers (same page, "Delivery headers"): `X-GitHub-Hook-ID`, `X-GitHub-Event` ("The name of the event that triggered the delivery."), `X-GitHub-Delivery` ("A globally unique identifier (GUID) to identify the event."), `X-Hub-Signature` (legacy HMAC-SHA1), `X-Hub-Signature-256` ("... HMAC hex digest of the request body, and is generated using the SHA-256 hash function."), `X-GitHub-Hook-Installation-Target-Type`, `X-GitHub-Hook-Installation-Target-ID`.

### 3.2 `issues` event

Source: [Webhook events and payloads, `issues`](https://docs.github.com/en/webhooks/webhook-events-and-payloads#issues). Availability: Repositories, Organizations, GitHub Apps. Permission: Issues (read).

All actions: `assigned`, `closed`, `deleted`, `demilestoned`, `edited`, `field_added`, `field_removed`, `labeled`, `locked`, `milestoned`, `opened`, `pinned`, `reopened`, `transferred`, `typed`, `unassigned`, `unlabeled`, `unlocked`, `unpinned`, `untyped`.

Actions Atlas needs, with GitHub's descriptions (the docs page renders these client-side per action; text taken from GitHub's OpenAPI webhook definitions, `webhooks.issues-<action>.post.description`, via `@octokit/openapi-webhooks@12.1.0/generated/api.github.com.json`):

| action | description | extra payload |
|---|---|---|
| `opened` | "An issue was created. When a closed issue is reopened, the action will be `reopened` instead." | |
| `closed` | "An issue was closed." | |
| `reopened` | "A closed issue was reopened." | |
| `edited` | "The title or body on an issue was edited." | `changes` (required): `changes.title.from`, `changes.body.from` |
| `labeled` | "A label was added to an issue." | `label`: `id`, `node_id`, `name`, `color`, `default`, `description`, `url` |
| `unlabeled` | "A label was removed from an issue." | `label` as above |
| `deleted` | "An issue was deleted." | worth handling: a spec vanishing |
| `transferred` | "An issue was transferred to another repository." | worth handling |

Payload fields that matter (required: `action`, `issue`, `repository`, `sender`): `issue.number`, `issue.id`, `issue.node_id`, `issue.title`, `issue.body`, `issue.state` ("either 'open' or 'closed'"), `issue.state_reason`, `issue.labels[]` (each with `name`), `issue.pull_request` (present only when the "issue" is a PR: "GitHub's REST API considers every pull request an issue, but not every issue is a pull request ... You can identify pull requests by the pull_request key", [REST: Issues](https://docs.github.com/en/rest/issues/issues?apiVersion=2022-11-28)), `issue.issue_dependencies_summary` (see 3.4), `repository.full_name`, `installation.id`, `sender.login`.

For `spec` label add/remove: handle `issues.labeled` / `issues.unlabeled` and check `payload.label.name === "spec"`; `payload.issue.labels` is the post-change list.

### 3.3 `pull_request` event

Source: [Webhook events and payloads, `pull_request`](https://docs.github.com/en/webhooks/webhook-events-and-payloads#pull_request). Availability: Repositories, Organizations, GitHub Apps. Permission: Pull requests (read).

All actions: `assigned`, `auto_merge_disabled`, `auto_merge_enabled`, `closed`, `converted_to_draft`, `demilestoned`, `dequeued`, `edited`, `enqueued`, `labeled`, `locked`, `milestoned`, `opened`, `ready_for_review`, `reopened`, `review_request_removed`, `review_requested`, `stacked`, `synchronize`, `unassigned`, `unlabeled`, `unlocked`.

Actions Atlas needs (descriptions from the same OpenAPI source, `webhooks.pull-request-<action>`):

| action | description |
|---|---|
| `opened` | "A pull request was created" |
| `ready_for_review` | "A draft pull request was marked as ready for review." |
| `converted_to_draft` | "A pull request was converted to a draft." |
| `closed` | "A pull request was closed. If `merged` is false in the webhook payload, the pull request was closed with unmerged commits. If `merged` is true in the webhook payload, the pull request was merged." |
| `reopened` | "A previously closed pull request was reopened." |
| `synchronize` | "A pull request's head branch was updated. For example, the head branch was updated from the base branch or new commits were pushed to the head branch." (optional; useful for run activity) |

There is no separate `merged` action: merged = `action === "closed" && pull_request.merged === true`.

Payload fields that matter (required: `action`, `number`, `pull_request`, `repository`, `sender`): `number`, `pull_request.number`, `pull_request.state` (`open` | `closed`), `pull_request.draft` (boolean, "Indicates whether or not the pull request is a draft."), `pull_request.merged` (boolean), `pull_request.merged_at` (string or null), `pull_request.head.ref` / `head.sha`, `pull_request.base.ref`, `pull_request.html_url`, `repository.full_name`, `installation.id`.

Linking a PR to its spec is out of scope here (map: "Run to PR link = GitHub's own linked-PR data (no research needed)").

### 3.4 Issue dependency changes: `issue_dependencies` event (exists)

Source: [Webhook events and payloads, `issue_dependencies`](https://docs.github.com/en/webhooks/webhook-events-and-payloads#issue_dependencies), verbatim: "This event occurs when there is activity relating to issue dependencies, such as blocking or blocked-by relationships. For activity relating to issues more generally, use the issues event instead. To subscribe to this event, a GitHub App must have at least read-level access for the 'Issues' repository permissions." Availability: Repositories, Organizations, GitHub Apps.

Actions and descriptions (docs page for `blocked_by_added`; the rest from the OpenAPI definitions `webhooks.issue-dependencies-*`):

| action | description |
|---|---|
| `blocked_by_added` | "An issue was marked as blocked by another issue." |
| `blocked_by_removed` | "The blocked by relationship between an issue and another issue was removed." |
| `blocking_added` | "An issue was marked as blocking another issue." |
| `blocking_removed` | "The blocking relationship between an issue and another issue was removed." |

Payload (OpenAPI schema, required: `action`, `blocked_issue_id`, `blocked_issue`, `blocking_issue_id`, `blocking_issue`, `blocking_issue_repo`, `organization`, `repository`, `sender`): `blocked_issue_id` ("The ID of the blocked issue."), `blocked_issue` (full issue object: `number`, `state`, `labels`, ...), `blocking_issue_id`, `blocking_issue` (full issue object), `blocking_issue_repo` (repository object - implies the blocker can live in another repository), plus `repository`, `installation`, `sender`.

Related facts:

- GA: "Issue dependencies are fully supported in the API and webhooks." Up to 50 issues per relationship type. [GitHub Changelog, 2025-08-21, "Dependencies on issues"](https://github.blog/changelog/2025-08-21-dependencies-on-issues/).
- Issue objects (REST `GET /repos/{owner}/{repo}/issues/{issue_number}` response schema and webhook `issue` objects) carry `issue_dependencies_summary: { blocked_by, blocking, total_blocked_by, total_blocking }` (all integers, all required). Verified in the response schema embedded in [REST: Issues](https://docs.github.com/en/rest/issues/issues?apiVersion=2022-11-28) and in the OpenAPI `issue` schema. The schema has no field descriptions; the open-vs-total semantics are a guess (see section 7).
- Which side fires: a "blocked by" edit on spec S produces `blocked_by_added` on S's repository. Both `blocked_by_*` and `blocking_*` deliver the same pair (`blocked_issue`, `blocking_issue`); handle both and dedupe on (`blocked_issue_id`, `blocking_issue_id`, action family).
- Blocker *state* changes (a blocker gets closed/reopened) do not produce `issue_dependencies` events; they produce `issues.closed` / `issues.reopened` on the blocker. Atlas should, on `issues.closed`/`reopened` for any issue, re-evaluate specs that list it as a blocker (`GET .../issues/{n}/dependencies/blocking` on the closed issue lists them).
- `sub_issues` is a separate event (`parent_issue_added`, `parent_issue_removed`, `sub_issue_added`, `sub_issue_removed`); not needed for blockers.
- Type coverage: `@octokit/webhooks@14.2.0` emits `issue_dependencies`, `issue_dependencies.blocked_by_added`, `.blocked_by_removed`, `.blocking_added`, `.blocking_removed` (its `dist-src/generated/webhook-names.js`), with types from its dependency `@octokit/openapi-webhooks-types@12.1.0`. The older standalone `@octokit/webhooks-types@7.6.1` has **no** `issue_dependencies` types - do not use it for this event.

## 4. Verifying signatures in Hono on Bun

### 4.1 What GitHub specifies

Source: [Validating webhook deliveries](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries).

- "GitHub will use your secret token to create a hash signature that's sent to you with each payload. The hash signature will appear in each delivery as the value of the `X-Hub-Signature-256` header."
- HMAC hex digest, SHA-256; "The hash signature always starts with `sha256=`."
- Compare in constant time: "Never use a plain `==` operator. Instead consider using a method like `secure_compare` or `crypto.timingSafeEqual`".
- Compute over the raw request body, treated as UTF-8. `X-Hub-Signature` (SHA-1) "is only included for legacy purposes".
- GitHub's own JavaScript example uses Web Crypto: `crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: { name: "SHA-256" } }, false, ["sign", "verify"])` then `crypto.subtle.verify("HMAC", key, hexToBytes(sigHex), encoder.encode(payload))`. The TypeScript example uses `new Webhooks({ secret })` from `@octokit/webhooks` and `await webhooks.verify(body, signature)` with `body = await req.text()`.

### 4.2 Hono facts (hono@4.13.5)

- No first-party GitHub webhook helper: `hono.dev/docs/helpers/webhook` is a 404; the `hono@4.13.5` tarball has no `X-Hub-Signature` or GitHub webhook code; the `honojs/middleware` monorepo has no webhook package (package list checked via `gh api repos/honojs/middleware/contents/packages`).
- Hono does ship `timingSafeEqual(a: string, b: string, hashFunction?) => Promise<boolean>` in `hono/utils/buffer` (`dist/types/utils/buffer.d.ts`). Not needed if you use `crypto.subtle.verify` or Octokit, which compare internally.
- Raw body: `await c.req.text()`. HonoRequest caches parsed bodies (`#cachedBody` in `dist/request.js`), and `c.req.json()` is implemented as `this.#cachedBody("text").then(JSON.parse)`, so reading `text()` first and `json()` later does not consume the stream twice. (Behaviour verified in source; the [HonoRequest docs](https://hono.dev/docs/api/request) do not state it. Safer: `JSON.parse` the verified string yourself.) Do not read `c.req.raw.body` directly before Hono does; the source throws "Cannot clone request: body was already consumed and not cached" in that case.
- Bun serving: `export default app` or `export default { port, fetch: app.fetch }` ([Hono on Bun](https://hono.dev/docs/getting-started/bun)).

### 4.3 Bun facts

- Web Crypto (`crypto`, `SubtleCrypto`, `CryptoKey`) is implemented: [Bun Web APIs](https://bun.com/docs/runtime/web-apis).
- `node:crypto` is implemented; the only listed gap is "Missing `encapsulate`/`decapsulate`" ([Bun Node.js compatibility](https://bun.com/docs/runtime/nodejs-apis)), so `createHmac` / `timingSafeEqual` are not flagged as missing.

### 4.4 Steps for the Hono route

1. `const sig = c.req.header("x-hub-signature-256")`, `const event = c.req.header("x-github-event")`, `const id = c.req.header("x-github-delivery")`. Reject with 401 if `sig` is missing.
2. `const body = await c.req.text()` (raw string, before any JSON parsing).
3. Verify, one of:
   - `@octokit/webhooks`: `const webhooks = new Webhooks({ secret })`; `if (!(await webhooks.verify(body, sig))) return c.text("Unauthorized", 401)`. Or `await webhooks.verifyAndReceive({ id, name: event, signature: sig, payload: body })`, which rejects on a bad signature and dispatches to `webhooks.on("issues.labeled", ...)` handlers ([@octokit/webhooks README](https://github.com/octokit/webhooks.js#readme): `eventPayload` "is a String"; "Content Type must be set to `application/json`").
   - `@octokit/webhooks-methods`: `verify(secret, body, sig)` returns boolean ([README](https://github.com/octokit/webhooks-methods.js#readme)).
   - Hand-rolled: GitHub's Web Crypto example verbatim (4.1).
4. `JSON.parse(body)` only after step 3 succeeds. Return 2xx quickly and do the work off the request path.
5. Alternative mount: `createWebMiddleware(webhooks, { path: "/api/github/webhooks" })` returns `(request: Request) => Promise<Response>` and is documented for Deno, Cloudflare Workers, Lambda and Vercel ([@octokit/webhooks README](https://github.com/octokit/webhooks.js#readme)); in Hono that is `app.post(path, (c) => middleware(c.req.raw))`. Not documented for Hono or Bun specifically; it reads the body from the `Request`, so nothing else may consume it first. Avoid `createNodeMiddleware` (Node `http` req/res shape).

## 5. Packages

Versions from `npm view` on 2026-09-04. Local Bun: 1.3.14.

| Package | Version | Role | Notes |
|---|---|---|---|
| `octokit` | 5.0.5 | umbrella: `App`, `Octokit` (REST + GraphQL), webhooks | README: "Works in all modern browsers, Node.js, and Deno"; requires Node 18+ for native fetch |
| `@octokit/app` | 16.1.4 | `App` only (JWT, installation Octokit, `app.webhooks`) | `engines.node >= 20`; exports map has `node` / `browser` / `default` conditions; exports only `createNodeMiddleware` (src/index.ts) |
| `@octokit/auth-app` | 8.3.1 | token minting for git (`auth({ type: "installation" })`) | token cache; PKCS#8 note above |
| `@octokit/webhooks` | 14.2.0 | verify + typed event dispatch, `createWebMiddleware` | has `issue_dependencies.*`; deps `@octokit/webhooks-methods ^6`, `@octokit/openapi-webhooks-types 12.1.0` |
| `@octokit/webhooks-methods` | 6.0.0 | bare `sign`/`verify`/`verifyWithFallback` | if you want no dispatcher |
| `@octokit/rest` | 22.0.1 | REST client alone | not needed if using `octokit`/`@octokit/app` |
| `@octokit/core` | 7.0.8 | minimal client | |
| `@octokit/graphql` | 9.0.5 | GraphQL alone | not needed for Phase 1 |
| `@octokit/webhooks-types` | 7.6.1 | standalone payload types | lacks `issue_dependencies`; skip |
| `hono` | 4.13.5 | web framework | no webhook helper |

Recommendation: `octokit@5.0.5` alone covers `App`, installation tokens, REST calls and webhooks (`app.webhooks.verifyAndReceive`, `app.webhooks.on("issue_dependencies.blocked_by_added", ...)`). If tree size matters, `@octokit/app@16.1.4` + `@octokit/webhooks@14.2.0` (`@octokit/auth-app` comes with `@octokit/app`).

Runtime caveat: no Octokit README mentions Bun (grepped `octokit.js`, `webhooks.js`, `auth-app.js`, `app.js`, `webhooks-methods.js`, `universal-github-app-jwt`: Node, Deno, browsers only). The code paths involved (fetch, Web Crypto HMAC and RS256) are all things Bun documents as implemented, so it is expected to work, but it needs a smoke test: sign a JWT with a PKCS#8 key, mint a token, verify one delivery.

## 6. Atlas-specific design notes (derived, not sourced)

- Subscribe to: `issues`, `pull_request`, `issue_dependencies`. Also `installation` / `installation_repositories` if Atlas should learn about new projects without restarts (not researched further).
- Webhooks are a cache invalidation signal, not the source of truth: on each event re-read the issue (`GET .../issues/{n}`, includes `issue_dependencies_summary`) and its blockers (`GET .../issues/{n}/dependencies/blocked_by`) rather than trusting the payload snapshot; deliveries can arrive out of order or be missed.
- Keep `X-GitHub-Delivery` for idempotency; GitHub can redeliver.
- A token per run: mint at clone time; for later pushes mint again (1-hour expiry). Consider a credential helper in the run directory so the agent never sees a stale token.

## 7. Not verified / open

- **Bun support**: not stated by any Octokit package; inferred from Bun's Web Crypto and fetch support. Needs a smoke test.
- **`git push` with `x-access-token`**: docs show `git clone` only. Push via the same HTTP password plus Contents write is an inference.
- **Metadata "mandatory"**: the GitHub App registration UI marks Metadata as mandatory (memory); no docs page with that wording was found. What is verified is that `GET /repos/{owner}/{repo}` and `GET /repos/{owner}/{repo}/labels` sit under the Metadata permission.
- **`issue_dependencies_summary` semantics**: fields are undocumented (`blocked_by` vs `total_blocked_by`); "open vs all" is a guess. Verify against a live issue.
- **Cross-repository blockers**: `blocking_issue_repo` in the payload suggests support; behaviour and permission needs for a blocker in a repository the installation cannot read were not researched.
- **Delivery timeout and retry policy** for webhooks: not researched.
- **GraphQL** dependency fields: not researched; REST endpoints cover the need.
- **Credential-helper wiring** for git on the server: only the existence of helpers was confirmed.
- **Hono `c.req.text()` then `json()` caching**: verified in `hono@4.13.5` source, not in docs; may change.
