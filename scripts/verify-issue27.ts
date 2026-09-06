import { strict as assert } from "node:assert";
import { chmodSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createCredentialBoundary, readGithubEnvFile } from "../src/credentials.ts";

const root = join(tmpdir(), `atlas-issue-27-${crypto.randomUUID()}`);
mkdirSync(root, { recursive: true, mode: 0o700 });
const credentialsPath = join(root, "github.env");
writeFileSync(credentialsPath, "ATLAS_GITHUB_INSTALLATION_TOKEN=regression-only\n", { mode: 0o600 });
chmodSync(credentialsPath, 0o600);
assert.equal(readGithubEnvFile(credentialsPath).ATLAS_GITHUB_INSTALLATION_TOKEN, "regression-only");

const sessionDirectory = join(root, "session");
mkdirSync(sessionDirectory, { recursive: true, mode: 0o700 });
const symlinkedSessionDirectory = join(root, "session-link");
symlinkSync(sessionDirectory, symlinkedSessionDirectory, "dir");
const boundary = createCredentialBoundary({
  credentialsPath,
  registryPath: join(root, "session-scopes.json"),
  socketPath: join(root, "supplier.sock"),
  keyPath: join(root, "supplier.key"),
  authorizedRepositories: ["SandunRathsara/atlas"],
  allowStaticToken: true,
  staticToken: "regression-secret",
});

try {
  await boundary.start();
  boundary.registerScope({
    atlasId: "ses_regression",
    directory: sessionDirectory,
    repositoryId: "1",
    fullName: "SandunRathsara/atlas",
  });

  await assert.rejects(() => boundary.requestToken({
    operation: "git",
    sessionDirectory,
    protocol: "https",
    host: "github.com",
    path: "SandunRathsara/atlas-issue-25-live-acceptance.git",
  }));
  const nested = await boundary.requestToken({
    operation: "git",
    sessionDirectory: join(symlinkedSessionDirectory, "nested", "directory"),
    protocol: "https",
    host: "github.com",
    path: "SandunRathsara/atlas.git",
  });
  assert.equal(nested.password, "regression-secret");
  console.log("Issue #27 credential boundary regression passed");
} finally {
  boundary.close();
  rmSync(root, { recursive: true, force: true });
}
