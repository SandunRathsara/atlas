import { homedir } from "node:os";
import { createCredentialBoundary } from "./credentials.ts";

const credentials = createCredentialBoundary({
  credentialsPath: Bun.env.ATLAS_GITHUB_ENV_PATH ?? `${homedir()}/.config/atlas/github.env`,
  registryPath: Bun.env.ATLAS_CREDENTIAL_REGISTRY_PATH,
  socketPath: Bun.env.ATLAS_SUPPLIER_SOCKET,
  keyPath: Bun.env.ATLAS_SUPPLIER_KEY_PATH,
  apiUrl: Bun.env.ATLAS_GITHUB_API_URL,
});

await credentials.start();
console.log("Atlas credential supplier is ready");

let stopping = false;
const shutdown = (signal: NodeJS.Signals) => {
  if (stopping) return;
  stopping = true;
  credentials.close();
  process.exit(signal === "SIGINT" ? 130 : 143);
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
