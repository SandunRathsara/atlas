# 03 - GitHub App for Atlas: permissions, installation tokens, webhooks, signature verification
Type: research
Status: resolved
Blocked by:

## Question

For a GitHub App that Atlas runs as:

1. Minimum permissions to: read issues and labels, read pull requests, read issue dependencies, and clone the repository over HTTPS.
2. How to mint an installation token from a Bun/TypeScript process, its lifetime, and how to use it for `git clone` and `git push`.
3. Webhook events and actions Atlas needs for: issue opened/closed/edited, label `spec` added/removed, pull request opened, ready for review, closed, merged. Payload fields that matter.
4. How to verify webhook signatures in Hono on Bun.
5. Whether webhook events fire when an issue dependency (blocked by) is added or removed.
6. Recommended TypeScript packages (e.g. Octokit) that work on Bun, with versions.

Answer with exact permission names, event names, and source links.

## Answer

Full notes: [research/03-github-app.md](../research/03-github-app.md)

**1. Permissions (repository, minimum)** - Issues: read (`issues`), Pull requests: read (`pull_requests`), Contents: read for clone / write for push (`contents`), Metadata: read (`metadata`). Issue dependencies are covered by Issues read (`GET .../issues/{n}/dependencies/blocked_by` and `/blocking`).

**2. Installation token** - RS256 JWT (`iss` = client ID, `exp` <= 10 min, `iat` 60 s in the past) -> `POST /app/installations/{installation_id}/access_tokens` with `Authorization: Bearer <JWT>` -> `{ token, expires_at, permissions }`. Token lives 1 hour, then 401. Git: `git clone https://x-access-token:TOKEN@github.com/owner/repo.git` (username literally `x-access-token`; push uses the same form, inferred). Private key must be converted to PKCS#8 for Web Crypto: `openssl pkcs8 -topk8 -inform PEM -outform PEM -nocrypt -in private-key.pem -out private-key-pkcs8.key`. With Octokit: `createAppAuth({ appId, privateKey, installationId })` then `auth({ type: "installation" })`, or `app.getInstallationOctokit(id)`.

**3. Webhook events** (subscribe in the app registration; payload has `installation.id`, `repository.full_name`):
- `issues`: `opened`, `closed`, `reopened`, `edited` (`changes.title.from` / `changes.body.from`), `labeled` / `unlabeled` (`label.name === "spec"`, `issue.labels` is post-change). Also worth handling: `deleted`, `transferred`. Issue objects carry `issue_dependencies_summary { blocked_by, blocking, total_blocked_by, total_blocking }`.
- `pull_request`: `opened`, `ready_for_review`, `converted_to_draft`, `closed`, `reopened`. Merged = `closed` with `pull_request.merged === true` (no separate merged action). Fields: `pull_request.number`, `.state`, `.draft`, `.merged`, `.merged_at`, `.head.ref`, `.html_url`.

**4. Signature verification (Hono on Bun)** - Header `X-Hub-Signature-256: sha256=<hex>`, HMAC-SHA256 over the raw body with the app's webhook secret, constant-time compare. Hono has no first-party helper. Route: read `x-hub-signature-256`, `x-github-event`, `x-github-delivery`; `body = await c.req.text()`; `await webhooks.verify(body, sig)` (or `verifyAndReceive({ id, name, signature, payload: body })`) from `@octokit/webhooks`; only then `JSON.parse(body)`. Bun implements Web Crypto and `node:crypto`. `createWebMiddleware(webhooks)` is a `(Request) => Promise<Response>` and can be mounted as `app.post(path, c => mw(c.req.raw))`.

**5. Dependency webhooks: yes.** Event `issue_dependencies`, actions `blocked_by_added`, `blocked_by_removed`, `blocking_added`, `blocking_removed`; needs Issues read; payload `blocked_issue`, `blocking_issue`, `blocking_issue_repo`. GA 2025-08-21. Blocker open/closed changes arrive as `issues.closed` / `issues.reopened` on the blocker, so re-check dependents then.

**6. Packages** (npm, 2026-09-04): `octokit@5.0.5` (covers App + REST + webhooks) or `@octokit/app@16.1.4` + `@octokit/webhooks@14.2.0`; `@octokit/auth-app@8.3.1` for raw tokens; `@octokit/webhooks-methods@6.0.0` if only `verify` is wanted; `hono@4.13.5`. Skip `@octokit/webhooks-types@7.6.1` (no `issue_dependencies` types). Avoid `createNodeMiddleware`.

**Unverified**: Bun is not named as a supported runtime by any Octokit package (Node/Deno/browsers) - smoke test needed; `git push` with `x-access-token` and Contents write is inferred from the clone docs; Metadata "mandatory" wording not found in docs; `issue_dependencies_summary` field semantics undocumented; cross-repo blocker behaviour, webhook retry policy, and GraphQL dependency fields not researched.
