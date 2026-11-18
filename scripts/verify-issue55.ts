import { strict as assert } from "node:assert";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer as createHttpsServer } from "node:https";
import type { AddressInfo } from "node:net";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { createCredentialBoundary, requestCredential } from "../src/credentials.ts";
import { buildReleaseFolder } from "../src/release-layout.ts";
import { verifyBinary, verifyMetadata } from "./verify-binaries.ts";

const TOKEN = "credential-continuity-fixture-token";
// Real compiled Release folders (~100 MB each) stay off the small /tmp.
const cacheRoot = process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache");
mkdirSync(cacheRoot, { recursive: true });
const root = mkdtempSync(join(cacheRoot, "atlas-issue55-"));
const registryPath = join(root, "session-scopes.json");
const socketPath = join(root, "run", "supplier.sock");
const keyPath = join(root, "config", "supplier.key");
const credentialsPath = join(root, "config", "github.env");
let supplier: ReturnType<typeof Bun.spawn> | undefined;
let api: ReturnType<typeof createHttpsServer> | undefined;

// Two real Release folders built by the production builder from two compiled identities.
const fixtureRelease = async (tag: string, sha: string) => {
  const binary = await verifyBinary(tag, sha);
  return await buildReleaseFolder({ binaryPath: binary, metadata: verifyMetadata(binary, tag, sha), releasesRoot: join(root, "releases") });
};

const run = async (
  command: string[],
  options: { cwd?: string; env?: Record<string, string>; stdin?: string } = {},
) => {
  const child = Bun.spawn(command, {
    cwd: options.cwd,
    env: { ...(process.env as Record<string, string>), ...(options.env ?? {}) },
    stdin: options.stdin === undefined ? "ignore" : "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  if (options.stdin !== undefined && child.stdin && typeof child.stdin !== "number") {
    child.stdin.write(options.stdin);
    child.stdin.end();
  }
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    child.stdout && typeof child.stdout !== "number" ? new Response(child.stdout).text() : "",
    child.stderr && typeof child.stderr !== "number" ? new Response(child.stderr).text() : "",
  ]);
  return { exitCode, stdout, stderr };
};

const helperRequest = async (helper: string, environment: Record<string, string>) => {
  const result = await run([helper, "get"], {
    env: environment,
    stdin: "protocol=https\nhost=github.com\npath=Acme/repo.git\n\n",
  });
  assert.equal(result.exitCode, 0, "Git credential helper failed");
  const values = new Map(result.stdout.trim().split(/\r?\n/u).map((line) => {
    const separator = line.indexOf("=");
    return [line.slice(0, separator), line.slice(separator + 1)];
  }));
  assert.ok(values.get("password") === TOKEN, "Git credential helper returned the wrong credential");
};

const closeServer = (server: ReturnType<typeof createHttpsServer> | undefined) => new Promise<void>((resolve) => {
  if (!server?.listening) return resolve();
  server.close(() => resolve());
});

try {
  const oldRelease = await fixtureRelease("v0.1.0+build.1", "1".repeat(40));
  const newRelease = await fixtureRelease("v0.1.0+build.2", "2".repeat(40));
  const currentRelease = join(root, "current");
  symlinkSync(oldRelease, currentRelease, "dir");

  const fakeGh = join(root, "bin", "gh");
  mkdirSync(dirname(fakeGh), { recursive: true });
  writeFileSync(fakeGh, "#!/bin/sh\nset -eu\ntest -n \"${GH_TOKEN:-}\"\ntest \"${GH_HOST:-}\" = github.com\ntest -d \"$GH_CONFIG_DIR\"\nprintf 'gh-ok\\n'\n", { mode: 0o755 });
  chmodSync(fakeGh, 0o755);

  const privateKeyPath = join(root, "config", "app.pem");
  const certificatePath = join(root, "config", "api.crt");
  mkdirSync(dirname(privateKeyPath), { recursive: true, mode: 0o700 });
  const certificate = Bun.spawnSync([
    "openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes",
    "-keyout", privateKeyPath, "-out", certificatePath, "-subj", "/CN=127.0.0.1", "-days", "1",
  ], { stdout: "ignore", stderr: "ignore" });
  assert.equal(certificate.exitCode, 0, "fixture certificate generation failed");
  chmodSync(privateKeyPath, 0o600);
  writeFileSync(credentialsPath, [
    "ATLAS_GITHUB_APP_ID=1",
    "ATLAS_GITHUB_INSTALLATION_ID=2",
    `ATLAS_GITHUB_APP_PRIVATE_KEY_PATH=${privateKeyPath}`,
    "",
  ].join("\n"), { mode: 0o600 });
  chmodSync(credentialsPath, 0o600);

  let tokenRequests = 0;
  api = createHttpsServer({ key: readFileSync(privateKeyPath), cert: readFileSync(certificatePath) }, (_request, response) => {
    tokenRequests += 1;
    response.writeHead(201, { "Content-Type": "application/json" });
    response.end(JSON.stringify({
      token: TOKEN,
      expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      permissions: { contents: "write", pull_requests: "write" },
    }));
  });
  const apiPort = await new Promise<number>((resolve, reject) => {
    api!.once("error", reject);
    api!.listen(0, "127.0.0.1", () => resolve((api!.address() as AddressInfo).port));
  });

  // The surviving supplier is the compiled binary's `credentials` subcommand.
  supplier = Bun.spawn([join(oldRelease, "atlas"), "credentials"], {
    env: {
      PATH: "/usr/bin:/bin",
      HOME: root,
      ATLAS_GITHUB_ENV_PATH: credentialsPath,
      ATLAS_CREDENTIAL_REGISTRY_PATH: registryPath,
      ATLAS_SUPPLIER_SOCKET: socketPath,
      ATLAS_SUPPLIER_KEY_PATH: keyPath,
      ATLAS_GITHUB_API_URL: `https://127.0.0.1:${apiPort}`,
      NODE_TLS_REJECT_UNAUTHORIZED: "0",
    },
    stdin: "ignore",
    stdout: "ignore",
    stderr: "pipe",
  });

  const firstSession = join(root, "sessions", "ses_old");
  mkdirSync(firstSession, { recursive: true, mode: 0o700 });
  // A compiled Release's helper reference is its own binary (src/runtime.ts#selfHelperPaths).
  const oldHelper = join(oldRelease, "atlas");
  const client = createCredentialBoundary({ registryPath, socketPath, keyPath, serve: false });
  client.registerScope({
    atlasId: "ses_old",
    directory: firstSession,
    repositoryId: "123",
    fullName: "Acme/repo",
    helperPaths: [oldHelper],
  });

  let firstCredential: Awaited<ReturnType<typeof requestCredential>> | undefined;
  for (let attempt = 0; attempt < 50 && !firstCredential; attempt += 1) {
    try {
      firstCredential = await requestCredential({ operation: "preflight", sessionDirectory: firstSession }, { socketPath, keyPath });
    } catch {
      await Bun.sleep(50);
    }
  }
  assert.ok(firstCredential?.password === TOKEN, "independent supplier did not return the scoped credential");
  assert.equal(tokenRequests, 1, "supplier did not make one controlled token request");

  client.close();
  assert.equal(existsSync(socketPath), true, "Atlas client close removed the independent supplier socket");
  assert.ok((await requestCredential({ operation: "preflight", sessionDirectory: firstSession }, { socketPath, keyPath })).password === TOKEN);

  const secondSession = join(root, "sessions", "ses_new");
  mkdirSync(secondSession, { recursive: true, mode: 0o700 });
  const newHelper = join(newRelease, "atlas");
  const restartedClient = createCredentialBoundary({ registryPath, socketPath, keyPath, serve: false });
  const requestDuringRegistration = requestCredential({ operation: "preflight", sessionDirectory: firstSession }, { socketPath, keyPath });
  restartedClient.registerScope({
    atlasId: "ses_new",
    directory: secondSession,
    repositoryId: "123",
    fullName: "Acme/repo",
    helperPaths: [newHelper],
  });
  assert.ok((await requestDuringRegistration).password === TOKEN, "request failed during atomic scope registration");
  assert.ok((await restartedClient.requestToken({ operation: "preflight", sessionDirectory: secondSession })).password === TOKEN);
  assert.deepEqual(new Set(restartedClient.listHelperReferences()), new Set([oldHelper, newHelper]));
  await assert.rejects(() => restartedClient.requestToken({ operation: "preflight", sessionDirectory: join(root, "sessions", "unknown") }));
  await assert.rejects(() => restartedClient.requestToken({
    operation: "git",
    sessionDirectory: firstSession,
    protocol: "https",
    host: "github.com",
    path: "Acme/other.git",
  }));

  // No Bun on PATH: the shims run the compiled binary only.
  const helperEnvironment = {
    PATH: "/usr/bin:/bin",
    ATLAS_SUPPLIER_SOCKET: socketPath,
    ATLAS_SUPPLIER_KEY_PATH: keyPath,
    ATLAS_SESSION_DIRECTORY: firstSession,
    ATLAS_REAL_GH: fakeGh,
  };
  await helperRequest(join(currentRelease, "bin", "git-credential-atlas"), helperEnvironment);
  let gh = await run([join(currentRelease, "bin", "gh"), "--repo", "Acme/repo", "api", "repos/Acme/repo"], {
    cwd: firstSession,
    env: helperEnvironment,
  });
  assert.equal(gh.exitCode, 0, "selected-release gh helper failed");
  assert.equal(gh.stdout.trim(), "gh-ok");

  const failedRelease = join(root, "releases", "failed-candidate");
  mkdirSync(failedRelease, { recursive: true });
  let nextSelection = join(root, "current-next");
  symlinkSync(failedRelease, nextSelection, "dir");
  renameSync(nextSelection, currentRelease);
  // A Session that captured the old Release's helper keeps working while `current` points elsewhere.
  await helperRequest(join(oldRelease, "bin", "git-credential-atlas"), helperEnvironment);

  nextSelection = join(root, "current-next");
  symlinkSync(newRelease, nextSelection, "dir");
  renameSync(nextSelection, currentRelease);
  await helperRequest(join(currentRelease, "bin", "git-credential-atlas"), helperEnvironment);
  gh = await run([join(currentRelease, "bin", "gh"), "--repo", "Acme/repo", "api", "repos/Acme/repo"], {
    cwd: firstSession,
    env: helperEnvironment,
  });
  assert.equal(gh.exitCode, 0, "gh helper failed after release selection changed");
  assert.equal(gh.stdout.trim(), "gh-ok");

  restartedClient.close();
  assert.equal(existsSync(socketPath), true, "restarted Atlas client removed the supplier socket");
  console.log("Issue #55 credential continuity checks passed");
} finally {
  if (supplier?.exitCode === null) supplier.kill("SIGTERM");
  if (supplier) await supplier.exited;
  await closeServer(api);
  Bun.spawnSync(["chmod", "-R", "u+w", root]);
  rmSync(root, { recursive: true, force: true });
}
