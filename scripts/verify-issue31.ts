import { strict as assert } from "node:assert";
import { createHmac } from "node:crypto";
import { createGitHubClient, GitHubError, type GitHubClient } from "../src/github.ts";
import { createPersistence } from "../src/persistence.ts";
import { createRefreshCoordinator } from "../src/sync.ts";
import { createWebhookApp } from "../src/webhook.ts";

const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const repositoryResponse = (headers?: HeadersInit) => new Response(
  JSON.stringify({ repositories: [] }),
  { headers: { "Content-Type": "application/json", ...headers } },
);

const verifyRateLimitDelay = async () => {
  let calls = 0;
  let secondCallAt = 0;
  const client = createGitHubClient({
    organization: "org",
    installationId: "7",
    getToken: () => "test-token",
    fetcher: (async () => {
      calls += 1;
      if (calls === 1) {
        return new Response(JSON.stringify({ message: "You have exceeded a secondary rate limit" }), {
          status: 429,
          headers: { "Retry-After": "0.05" },
        });
      }
      secondCallAt = Date.now();
      return repositoryResponse();
    }) as unknown as typeof fetch,
  });

  let caught: unknown;
  try {
    await client.listInstallationRepositories();
  } catch (error) {
    caught = error;
  }
  assert(caught instanceof GitHubError);
  assert.equal(caught.kind, "temporary");
  assert((caught.retryAfterMs ?? 0) >= 50);

  const firstFailureAt = Date.now();
  await client.listInstallationRepositories();
  assert(secondCallAt - firstFailureAt >= 30, "Retry-After must delay the next GitHub request");

  let resetCalls = 0;
  let resetSecondCallAt = 0;
  const resetClient = createGitHubClient({
    organization: "org",
    installationId: "7",
    getToken: () => "test-token",
    fetcher: (async () => {
      resetCalls += 1;
      if (resetCalls === 1) {
        return new Response(JSON.stringify({ message: "API rate limit exceeded" }), {
          status: 403,
          headers: {
            "X-RateLimit-Remaining": "0",
            "X-RateLimit-Reset": String(Math.floor(Date.now() / 1000) + 1),
          },
        });
      }
      resetSecondCallAt = Date.now();
      return repositoryResponse();
    }) as unknown as typeof fetch,
  });
  caught = undefined;
  try {
    await resetClient.listInstallationRepositories();
  } catch (error) {
    caught = error;
  }
  assert(caught instanceof GitHubError);
  assert((caught.retryAfterMs ?? 0) > 0);
  const resetFailureAt = Date.now();
  await resetClient.listInstallationRepositories();
  assert(resetSecondCallAt - resetFailureAt >= (caught.retryAfterMs ?? 0) - 20, "X-RateLimit-Reset must delay the next GitHub request");

  let normalCalls = 0;
  const normalClient = createGitHubClient({
    organization: "org",
    installationId: "7",
    getToken: () => "test-token",
    fetcher: (async () => {
      normalCalls += 1;
      return repositoryResponse({
        "X-RateLimit-Remaining": "10",
        "X-RateLimit-Reset": String(Math.floor(Date.now() / 1000) + 1),
      });
    }) as unknown as typeof fetch,
  });
  const normalStarted = Date.now();
  await normalClient.listInstallationRepositories();
  await normalClient.listInstallationRepositories();
  assert.equal(normalCalls, 2);
  assert(Date.now() - normalStarted < 250, "X-RateLimit-Reset must not block while quota remains");
};

const verifyCoordinatorBackoff = async () => {
  const persistence = createPersistence({ path: ":memory:" });
  persistence.upsertRepository({
    githubId: "1",
    installationId: "7",
    organization: "org",
    owner: "org",
    name: "repo",
    fullName: "org/repo",
    htmlUrl: "https://github.com/org/repo",
    description: null,
    visibility: "private",
    defaultBranch: "main",
    archived: false,
    disabled: false,
    hasIssues: true,
  });

  let calls = 0;
  let startedResolve!: () => void;
  const started = new Promise<void>((resolve) => {
    startedResolve = resolve;
  });
  const github: GitHubClient = {
    listInstallationRepositories: async () => {
      calls += 1;
      startedResolve();
      throw new GitHubError("rate limited", { status: 429, kind: "temporary", retryAfterMs: 50 });
    },
    hasLabel: async () => false,
    listIssues: async () => [],
  };
  const coordinator = createRefreshCoordinator({ persistence, github, organization: "org", installationId: "7" });
  try {
    coordinator.request("1");
    await started;
    await wait(25);
    coordinator.wake(["1"]);
    await wait(50);
    assert.equal(calls, 1, "a wake during retry backoff must not start another GitHub read");
  } finally {
    coordinator.stop();
    persistence.close();
  }
};

const signed = (body: string, secret: string) => `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;

const verifyPingScope = async () => {
  const persistence = createPersistence({ path: ":memory:" });
  let accepted = 0;
  const app = createWebhookApp({
    persistence,
    secret: "webhook-secret",
    organization: "org",
    installationId: "7",
    onAccepted: () => {
      accepted += 1;
    },
  });
  const post = async (payload: Record<string, unknown>) => {
    const body = JSON.stringify(payload);
    return app.fetch(new Request("http://127.0.0.1/webhooks/github", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-GitHub-Delivery": crypto.randomUUID(),
        "X-GitHub-Event": "ping",
        "X-Hub-Signature-256": signed(body, "webhook-secret"),
      },
      body,
    }));
  };

  try {
    const valid = await post({
      installation: { id: 7 },
      organization: { login: "org" },
      repository: { id: 1, owner: { login: "org" } },
    });
    assert.equal(valid.status, 204);
    assert.equal(accepted, 0);
    const deliveryCount = persistence.database.query("SELECT COUNT(*) AS count FROM webhook_deliveries").get() as { count: number } | null;
    assert.equal(deliveryCount?.count, 0);

    const invalid = await post({
      installation: { id: 8 },
      organization: { login: "org" },
      repository: { id: 1, owner: { login: "org" } },
    });
    assert.equal(invalid.status, 403);
  } finally {
    persistence.close();
  }
};

await verifyRateLimitDelay();
await verifyCoordinatorBackoff();
await verifyPingScope();
console.log("Issue #31 focused checks passed");
