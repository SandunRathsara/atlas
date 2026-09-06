import { createApp } from "./app.ts";

const sharedToken = Bun.env.ATLAS_SHARED_TOKEN;
if (!sharedToken) {
  throw new Error("ATLAS_SHARED_TOKEN is required");
}

const configuredPort = Number(Bun.env.ATLAS_PORT ?? "3000");
if (!Number.isInteger(configuredPort) || configuredPort < 1 || configuredPort > 65535) {
  throw new Error("ATLAS_PORT must be a valid TCP port");
}

const app = createApp({
  allowedOrigin: Bun.env.ATLAS_ORIGIN,
  databasePath: Bun.env.ATLAS_DATABASE_PATH ?? "./data/atlas.sqlite",
  githubApiUrl: Bun.env.ATLAS_GITHUB_API_URL,
  githubInstallationId: Bun.env.ATLAS_GITHUB_INSTALLATION_ID,
  githubOrganization: Bun.env.ATLAS_GITHUB_ORGANIZATION,
  githubToken: () => Bun.env.ATLAS_GITHUB_INSTALLATION_TOKEN,
  getSharedToken: () => Bun.env.ATLAS_SHARED_TOKEN,
  sharedToken,
});

Bun.serve({
  fetch: app.fetch,
  hostname: "127.0.0.1",
  port: configuredPort,
});

console.log(`Atlas listening on http://127.0.0.1:${configuredPort}`);
