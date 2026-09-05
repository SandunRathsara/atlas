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
  getSharedToken: () => Bun.env.ATLAS_SHARED_TOKEN,
  sharedToken,
});

Bun.serve({
  fetch: app.fetch,
  hostname: "127.0.0.1",
  port: configuredPort,
});

console.log(`Atlas listening on http://127.0.0.1:${configuredPort}`);
