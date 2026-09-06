import { createApp } from "./app.ts";
import { createCredentialBoundary, loadGithubEnv } from "./credentials.ts";
import { homedir } from "node:os";

const githubEnvPath = Bun.env.ATLAS_GITHUB_ENV_PATH ?? `${homedir()}/.config/atlas/github.env`;
loadGithubEnv(githubEnvPath);
const sharedToken = Bun.env.ATLAS_SHARED_TOKEN;
if (!sharedToken) {
  throw new Error("ATLAS_SHARED_TOKEN is required");
}

const configuredPort = Number(Bun.env.ATLAS_PORT ?? "3000");
if (!Number.isInteger(configuredPort) || configuredPort < 1 || configuredPort > 65535) {
  throw new Error("ATLAS_PORT must be a valid TCP port");
}

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

const app = createApp({
  allowedOrigin: Bun.env.ATLAS_ORIGIN,
  databasePath: Bun.env.ATLAS_DATABASE_PATH ?? "./data/atlas.sqlite",
  githubApiUrl: Bun.env.ATLAS_GITHUB_API_URL,
  githubInstallationId: Bun.env.ATLAS_GITHUB_INSTALLATION_ID,
  githubOrganization: Bun.env.ATLAS_GITHUB_ORGANIZATION,
  githubToken: () => githubToken,
  sessionRoot: Bun.env.ATLAS_SESSION_ROOT,
  globalCapacity: Bun.env.ATLAS_GLOBAL_CAPACITY ? Number(Bun.env.ATLAS_GLOBAL_CAPACITY) : undefined,
  credentialsPath: Bun.env.ATLAS_GITHUB_ENV_PATH,
  credentialRegistryPath: Bun.env.ATLAS_CREDENTIAL_REGISTRY_PATH,
  credentialSocketPath: Bun.env.ATLAS_SUPPLIER_SOCKET,
  credentialKeyPath: Bun.env.ATLAS_SUPPLIER_KEY_PATH,
  gitBinary: Bun.env.ATLAS_GIT_BINARY,
  credentials,
  getSharedToken: () => Bun.env.ATLAS_SHARED_TOKEN,
  sharedToken,
});

Bun.serve({
  fetch: app.fetch,
  hostname: "127.0.0.1",
  port: configuredPort,
});

console.log(`Atlas listening on http://127.0.0.1:${configuredPort}`);
