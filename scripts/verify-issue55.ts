import { strict as assert } from "node:assert";
import {
  chmodSync,
  copyFileSync,
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
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createCredentialBoundary, requestCredential } from "../src/credentials.ts";

const TOKEN = "credential-continuity-fixture-token";
const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const root = mkdtempSync(join(tmpdir(), "atlas-issue55-"));
const registryPath = join(root, "session-scopes.json");
const socketPath = join(root, "run", "supplier.sock");
const keyPath = join(root, "config", "supplier.key");
const credentialsPath = join(root, "config", "github.env");
let supplier: ReturnType<typeof Bun.spawn> | undefined;
let api: ReturnType<typeof createHttpsServer> | undefined;

const copy = (source: string, target: string, mode?: number) => {
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(source, target);
  if (mode !== undefined) chmodSync(target, mode);
};

const fixtureRelease = (name: string) => {
  const release = join(root, "releases", name);
  copy(join(repositoryRoot, "src", "credentials.ts"), join(release, "src", "credentials.ts"));
  copy(join(repositoryRoot, "scripts", "atlas-git-credential.ts"), join(release, "scripts", "atlas-git-credential.ts"), 0o755);
  copy(join(repositoryRoot, "scripts", "atlas-gh.ts"), join(release, "scripts", "atlas-gh.ts"), 0o755);
  copy(join(repositoryRoot, "deploy", "bin", "git-credential-atlas"), join(release, "deploy", "bin", "git-credential-atlas"), 0o755);
  copy(join(repositoryRoot, "deploy", "bin", "gh"), join(release, "deploy", "bin", "gh"), 0o755);
  return release;
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
  const oldRelease = fixtureRelease("old");
  const newRelease = fixtureRelease("new");
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

  supplier = Bun.spawn([process.execPath, join(repositoryRoot, "src", "credential-server.ts")], {
    env: {
      ...(process.env as Record<string, string>),
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
  const oldHelper = join(oldRelease, "scripts", "atlas-git-credential.ts");
  const client = createCredentialBoundary({ registryPath, socketPath, keyPath, serve: false });
  client.registerScope({
    atlasId: "ses_old",
    directory: firstSession,
    repositoryId: "123",
    fullName: "Acme/repo",
    helperPaths: [process.execPath, oldHelper],
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
  const newHelper = join(newRelease, "scripts", "atlas-git-credential.ts");
  const restartedClient = createCredentialBoundary({ registryPath, socketPath, keyPath, serve: false });
  const requestDuringRegistration = requestCredential({ operation: "preflight", sessionDirectory: firstSession }, { socketPath, keyPath });
  restartedClient.registerScope({
    atlasId: "ses_new",
    directory: secondSession,
    repositoryId: "123",
    fullName: "Acme/repo",
    helperPaths: [process.execPath, newHelper],
  });
  assert.ok((await requestDuringRegistration).password === TOKEN, "request failed during atomic scope registration");
  assert.ok((await restartedClient.requestToken({ operation: "preflight", sessionDirectory: secondSession })).password === TOKEN);
  assert.deepEqual(new Set(restartedClient.listHelperReferences()), new Set([process.execPath, oldHelper, newHelper]));
  await assert.rejects(() => restartedClient.requestToken({ operation: "preflight", sessionDirectory: join(root, "sessions", "unknown") }));
  await assert.rejects(() => restartedClient.requestToken({
    operation: "git",
    sessionDirectory: firstSession,
    protocol: "https",
    host: "github.com",
    path: "Acme/other.git",
  }));

  const helperEnvironment = {
    ATLAS_SUPPLIER_SOCKET: socketPath,
    ATLAS_SUPPLIER_KEY_PATH: keyPath,
    ATLAS_SESSION_DIRECTORY: firstSession,
    ATLAS_BUN_BINARY: process.execPath,
    ATLAS_REAL_GH: fakeGh,
  };
  await helperRequest(join(currentRelease, "deploy", "bin", "git-credential-atlas"), {
    ...helperEnvironment,
    ATLAS_RELEASE_ROOT: currentRelease,
  });
  let gh = await run([join(currentRelease, "deploy", "bin", "gh"), "--repo", "Acme/repo", "api", "repos/Acme/repo"], {
    cwd: firstSession,
    env: { ...helperEnvironment, ATLAS_RELEASE_ROOT: currentRelease },
  });
  assert.equal(gh.exitCode, 0, "selected-release gh helper failed");
  assert.equal(gh.stdout.trim(), "gh-ok");

  const failedRelease = join(root, "releases", "failed-candidate");
  mkdirSync(failedRelease, { recursive: true });
  let nextSelection = join(root, "current-next");
  symlinkSync(failedRelease, nextSelection, "dir");
  renameSync(nextSelection, currentRelease);
  await helperRequest(oldHelper, helperEnvironment);

  nextSelection = join(root, "current-next");
  symlinkSync(newRelease, nextSelection, "dir");
  renameSync(nextSelection, currentRelease);
  await helperRequest(join(currentRelease, "deploy", "bin", "git-credential-atlas"), {
    ...helperEnvironment,
    ATLAS_RELEASE_ROOT: currentRelease,
  });
  gh = await run([join(currentRelease, "deploy", "bin", "gh"), "--repo", "Acme/repo", "api", "repos/Acme/repo"], {
    cwd: firstSession,
    env: { ...helperEnvironment, ATLAS_RELEASE_ROOT: currentRelease },
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
  rmSync(root, { recursive: true, force: true });
}
