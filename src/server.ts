import { createApp } from "./app.ts";
import { loadGitHubEnv } from "./config.ts";
import { createGitHubClient } from "./github.ts";
import { createPersistence } from "./persistence.ts";
import { createRefreshCoordinator } from "./sync.ts";
import { createWebhookApp } from "./webhook.ts";

loadGitHubEnv();

const sharedToken = Bun.env.ATLAS_SHARED_TOKEN;
if (!sharedToken) {
  throw new Error("ATLAS_SHARED_TOKEN is required");
}

const configuredPort = Number(Bun.env.ATLAS_PORT ?? "3000");
if (!Number.isInteger(configuredPort) || configuredPort < 1 || configuredPort > 65535) {
  throw new Error("ATLAS_PORT must be a valid TCP port");
}

const webhookPort = Number(Bun.env.ATLAS_WEBHOOK_PORT ?? "3001");
if (!Number.isInteger(webhookPort) || webhookPort < 1 || webhookPort > 65535 || webhookPort === configuredPort) {
  throw new Error("ATLAS_WEBHOOK_PORT must be a valid port different from ATLAS_PORT");
}

const organization = Bun.env.ATLAS_GITHUB_ORGANIZATION ?? "";
const installationId = Bun.env.ATLAS_GITHUB_INSTALLATION_ID ?? "";
const githubToken = () => Bun.env.ATLAS_GITHUB_INSTALLATION_TOKEN;
const persistence = createPersistence({ path: Bun.env.ATLAS_DATABASE_PATH ?? "./data/atlas.sqlite" });
const github = createGitHubClient({
  organization,
  installationId,
  getToken: githubToken,
  baseUrl: Bun.env.ATLAS_GITHUB_API_URL,
});
const refreshCoordinator = createRefreshCoordinator({
  persistence,
  github,
  organization,
  installationId,
});

const app = createApp({
  allowedOrigin: Bun.env.ATLAS_ORIGIN,
  github,
  githubInstallationId: installationId,
  githubOrganization: organization,
  githubToken,
  getSharedToken: () => Bun.env.ATLAS_SHARED_TOKEN,
  persistence,
  refreshCoordinator,
  sharedToken,
});

const webhookApp = createWebhookApp({
  persistence,
  secret: Bun.env.ATLAS_GITHUB_WEBHOOK_SECRET ?? "",
  organization,
  installationId,
  onAccepted: (repositoryIds) => refreshCoordinator.wake(repositoryIds),
});

refreshCoordinator.start();

Bun.serve({
  fetch: app.fetch,
  hostname: "127.0.0.1",
  port: configuredPort,
});

Bun.serve({
  fetch: webhookApp.fetch,
  hostname: "127.0.0.1",
  port: webhookPort,
});

console.log(`Atlas listening on http://127.0.0.1:${configuredPort}; webhook listener on http://127.0.0.1:${webhookPort}`);
