import { createApp } from "./app.ts";
import { createCredentialBoundary, loadGithubEnv } from "./credentials.ts";
import { loadGitHubEnv } from "./config.ts";
import { createGitHubClient } from "./github.ts";
import { createPersistence } from "./persistence.ts";
import { createRefreshCoordinator } from "./sync.ts";
import { createWebhookApp } from "./webhook.ts";
import { homedir } from "node:os";

const githubEnvPath = Bun.env.ATLAS_GITHUB_ENV_PATH ?? `${homedir()}/.config/atlas/github.env`;
loadGithubEnv(githubEnvPath);
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
const credentials = createCredentialBoundary({
  credentialsPath: githubEnvPath,
  registryPath: Bun.env.ATLAS_CREDENTIAL_REGISTRY_PATH,
  socketPath: Bun.env.ATLAS_SUPPLIER_SOCKET,
  keyPath: Bun.env.ATLAS_SUPPLIER_KEY_PATH,
  apiUrl: Bun.env.ATLAS_GITHUB_API_URL,
});
let githubToken = Bun.env.ATLAS_GITHUB_INSTALLATION_TOKEN;
try {
  githubToken = await credentials.installationToken();
} catch {
  // Browsing can retain its existing configured token path; preparation never falls back to it.
}

const persistence = createPersistence({ path: Bun.env.ATLAS_DATABASE_PATH ?? "./data/atlas.sqlite" });
const github = createGitHubClient({
  organization,
  installationId,
  getToken: () => githubToken,
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
  databasePath: Bun.env.ATLAS_DATABASE_PATH ?? "./data/atlas.sqlite",
  github,
  githubInstallationId: installationId,
  githubOrganization: organization,
  githubApiUrl: Bun.env.ATLAS_GITHUB_API_URL,
  githubToken: () => githubToken,
  sessionRoot: Bun.env.ATLAS_SESSION_ROOT,
  globalCapacity: Bun.env.ATLAS_GLOBAL_CAPACITY ? Number(Bun.env.ATLAS_GLOBAL_CAPACITY) : undefined,
  credentialsPath: githubEnvPath,
  credentialRegistryPath: Bun.env.ATLAS_CREDENTIAL_REGISTRY_PATH,
  credentialSocketPath: Bun.env.ATLAS_SUPPLIER_SOCKET,
  credentialKeyPath: Bun.env.ATLAS_SUPPLIER_KEY_PATH,
  gitBinary: Bun.env.ATLAS_GIT_BINARY,
  credentials,
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
