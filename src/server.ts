import { createApp } from "./app.ts";
import { createCredentialBoundary, loadGithubEnv } from "./credentials.ts";
import { loadGitHubEnv } from "./config.ts";
import { createGitHubClient } from "./github.ts";
import { createPersistence } from "./persistence.ts";
import { createRefreshCoordinator } from "./sync.ts";
import { createWebhookApp } from "./webhook.ts";
import { homedir } from "node:os";
import { join } from "node:path";
import { loadReleaseIdentity } from "./release.ts";
import { createUpdateService } from "./update-discovery.ts";
import { activationInProgress, createUpdaterClient } from "./updater.ts";

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
  serve: false,
});
const fallbackGitHubToken = Bun.env.ATLAS_GITHUB_INSTALLATION_TOKEN;
const githubToken = async () => {
  try {
    return await credentials.installationToken();
  } catch {
    // Browsing can retain its existing configured token path; preparation never falls back to it.
    return fallbackGitHubToken;
  }
};

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
const releaseRoot = Bun.env.ATLAS_RELEASE_ROOT ?? join(import.meta.dir, "..");
const releaseIdentity = loadReleaseIdentity(releaseRoot);
const updater = createUpdaterClient({
  socketPath: Bun.env.ATLAS_UPDATER_SOCKET,
  keyPath: Bun.env.ATLAS_UPDATER_KEY_PATH,
});
const startupUpdaterStatus = await updater.status().catch(() => null);
const updates = createUpdateService({
  persistence,
  installed: releaseIdentity,
  updater,
});

const app = createApp({
  allowedOrigin: Bun.env.ATLAS_ORIGIN,
  databasePath: Bun.env.ATLAS_DATABASE_PATH ?? "./data/atlas.sqlite",
  github,
  githubInstallationId: installationId,
  githubOrganization: organization,
  githubApiUrl: Bun.env.ATLAS_GITHUB_API_URL,
  githubToken,
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
  releaseIdentity,
  startPausedForUpdate: Boolean(startupUpdaterStatus && activationInProgress(startupUpdaterStatus)),
  updates,
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
updates.start(app.updatePause.pause);
if (startupUpdaterStatus && activationInProgress(startupUpdaterStatus)) {
  void app.updatePause.pause().then(async (outcome) => {
    if (outcome.status !== "paused") return;
    while (true) {
      try {
        if (!activationInProgress(await updater.status())) {
          outcome.resume();
          return;
        }
      } catch {
        // The surviving updater remains authoritative while activation status is unavailable.
      }
      await Bun.sleep(250);
    }
  });
}

const uiServer = Bun.serve({
  fetch: app.fetch,
  hostname: "127.0.0.1",
  port: configuredPort,
});

const webhookServer = Bun.serve({
  fetch: webhookApp.fetch,
  hostname: "127.0.0.1",
  port: webhookPort,
});

console.log(`Atlas listening on http://127.0.0.1:${configuredPort}; webhook listener on http://127.0.0.1:${webhookPort}`);

let stopping = false;
const shutdown = async (signal: NodeJS.Signals) => {
  if (stopping) {
    process.exit(1);
    return;
  }
  stopping = true;
  console.log(`Atlas stopping (${signal})`);
  refreshCoordinator.stop();
  updates.stop();
  try {
    await Promise.all([uiServer.stop(true), webhookServer.stop(true)]);
  } catch {
    // Ports are released on process exit even if stop() rejects.
  }
  try {
    persistence.close();
  } catch {
    // SQLite close is best-effort during shutdown.
  }
  process.exit(signal === "SIGINT" ? 130 : 143);
};

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});
process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});
