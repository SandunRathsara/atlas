import { strict as assert } from "node:assert";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { createServer as createHttpsServer } from "node:https";
import { connect, createServer as createNetServer, type AddressInfo, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCredentialBoundary } from "../src/credentials.ts";
import { cloneGitEnvironment } from "../src/preparation.ts";

type Result = { exitCode: number; stdout: string; stderr: string };

const readOutput = async (stream: unknown) =>
  stream && typeof stream !== "number" ? await new Response(stream as ReadableStream<Uint8Array>).text() : "";

const run = async (
  command: string[],
  options: { cwd?: string; env?: Record<string, string>; stdin?: Blob } = {},
): Promise<Result> => {
  const child = Bun.spawn(command, {
    cwd: options.cwd,
    env: { ...(process.env as Record<string, string>), ...(options.env ?? {}) },
    stdin: options.stdin ?? "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    readOutput(child.stdout),
    readOutput(child.stderr),
  ]);
  return { exitCode, stdout, stderr };
};

const shellQuote = (value: string) => `'${value.replace(/'/gu, `\'"'"'`)}'`;

const listen = (server: Server) => new Promise<number>((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    if (!address || typeof address === "string") reject(new Error("test server did not expose a TCP port"));
    else resolve((address as AddressInfo).port);
  });
});

const closeServer = (server: Server) => new Promise<void>((resolve) => {
  if (!server.listening) {
    resolve();
    return;
  }
  server.close(() => resolve());
});

const makeDirectory = (path: string) => {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  chmodSync(path, 0o700);
};

const makeExecutable = (path: string, content: string) => {
  writeFileSync(path, content, { encoding: "utf8", mode: 0o700 });
  chmodSync(path, 0o700);
};

const assertMode = (path: string, mode: number) =>
  assert.equal(lstatSync(path).mode & 0o777, mode, `unexpected permissions for ${path}`);

const root = mkdtempSync(join(tmpdir(), "atlas-issue37-deployment-"));
const repositoryRoot = join(import.meta.dir, "..");
const helperPath = join(import.meta.dir, "atlas-git-credential.ts");
const boundaryRoot = join(root, "supplier");
const sessionsRoot = join(root, "sessions");
const sessionDirectory = join(sessionsRoot, "ses_test");
const supplierKey = join(boundaryRoot, "supplier.key");
const supplierSocket = join(boundaryRoot, "supplier.sock");
const registryPath = join(boundaryRoot, "session-scopes.json");
const boundary = createCredentialBoundary({
  registryPath,
  socketPath: supplierSocket,
  keyPath: supplierKey,
  allowStaticToken: true,
  staticToken: "test-only-token",
});
let proxy: Server | undefined;
let tlsServer: Server | undefined;

try {
  makeDirectory(boundaryRoot);
  makeDirectory(sessionsRoot);
  await boundary.start();

  // The target does not exist yet. Registration and preflight must still bind
  // the future directory to exactly one Repository.
  assert.equal(existsSync(sessionDirectory), false);
  boundary.registerScope({ atlasId: "ses_test", directory: sessionDirectory, repositoryId: "123", fullName: "Acme/repo" });
  await boundary.assertReady({ atlasId: "ses_test", directory: sessionDirectory, repositoryId: "123", fullName: "Acme/repo" });

  const bunWrapper = join(root, "bun-wrapper");
  const marker = join(root, "clone-helper.marker");
  makeExecutable(bunWrapper, [
    "#!/bin/sh",
    "\"$ATLAS_TEST_REAL_BUN\" \"$@\"",
    "status=$?",
    "printf '%s|%s\\n' \"$ATLAS_SESSION_DIRECTORY\" \"$status\" >> \"$ATLAS_TEST_MARKER\"",
    "exit \"$status\"",
  ].join("\n") + "\n");

  const certificate = join(root, "test.crt");
  const privateKey = join(root, "test.key");
  const certificateResult = await run([
    "openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes",
    "-keyout", privateKey, "-out", certificate, "-subj", "/CN=github.com", "-days", "1",
  ]);
  assert.equal(certificateResult.exitCode, 0, certificateResult.stderr);
  let tlsRequests = 0;
  tlsServer = createHttpsServer({ key: readFileSync(privateKey), cert: readFileSync(certificate) }, (_request, response) => {
    tlsRequests += 1;
    response.writeHead(401, { "WWW-Authenticate": "Basic realm=github" });
    response.end();
  }) as unknown as Server;
  const tlsPort = await listen(tlsServer);
  proxy = createNetServer((client) => {
    client.once("data", (chunk) => {
      if (!chunk.toString().startsWith("CONNECT github.com:")) {
        client.destroy();
        return;
      }
      const upstream = connect(tlsPort, "127.0.0.1");
      upstream.once("connect", () => {
        client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        client.pipe(upstream);
        upstream.pipe(client);
      });
      upstream.on("error", () => client.destroy());
    });
  });
  const proxyPort = await listen(proxy);
  const supplierEnvironment = boundary.helperEnvironment();
  const cloneEnvironment = {
    ...cloneGitEnvironment(process.env as Record<string, string>, supplierEnvironment, sessionDirectory),
    ATLAS_TEST_MARKER: marker,
    ATLAS_TEST_REAL_BUN: process.execPath,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_TERMINAL_PROMPT: "0",
    GIT_ASKPASS: "/bin/false",
    GIT_SSH_COMMAND: "/bin/false",
  };
  const helper = `!${shellQuote(bunWrapper)} ${shellQuote(helperPath)}`;
  const clone = await run([
    "/usr/bin/git",
    "-c", "credential.helper=",
    "-c", `credential.helper=${helper}`,
    "-c", "credential.useHttpPath=true",
    "-c", `http.proxy=http://127.0.0.1:${proxyPort}`,
    "-c", "http.sslVerify=false",
    "clone", "--no-checkout", "--origin", "origin",
    "https://github.com/Acme/repo.git", sessionDirectory,
  ], { cwd: sessionsRoot, env: cloneEnvironment });
  assert.notEqual(clone.exitCode, 0, "the isolated proxy must prevent a real network clone");
  assert.equal(existsSync(marker), true, `clone-time helper was not invoked: ${clone.stderr}`);
  assert.equal(tlsRequests > 0, true, "the local TLS challenge was not reached");
  assert.equal(readFileSync(marker, "utf8").split(/\r?\n/u).some((line) => line === `${sessionDirectory}|0`), true, "clone-time helper did not authorize the future Session directory");
  assert.equal(clone.stdout.includes("test-only-token") || clone.stderr.includes("test-only-token"), false);

  // Once the clone exists, the same durable scope must authorize nested cwd
  // resolution without relying on a transient Session environment variable.
  const nestedDirectory = join(sessionDirectory, "nested", "directory");
  makeDirectory(nestedDirectory);
  const nested = await run([process.execPath, helperPath, "get"], {
    cwd: nestedDirectory,
    env: supplierEnvironment,
    stdin: new Blob(["protocol=https\nhost=github.com\npath=Acme/repo.git\n\n"]),
  });
  assert.equal(nested.exitCode, 0);
  assert.equal(nested.stdout.includes("username=x-access-token\n"), true);
  assert.equal(nested.stdout.includes("password=test-only-token\n"), true);

  const outsideDirectory = join(root, "outside");
  makeDirectory(outsideDirectory);
  const denied = await run([process.execPath, helperPath, "get"], {
    cwd: outsideDirectory,
    env: supplierEnvironment,
    stdin: new Blob(["protocol=https\nhost=github.com\npath=Acme/repo.git\n\n"]),
  });
  assert.equal(denied.exitCode, 1);
  assert.equal(denied.stdout, "quit=true\n\n");
  assert.equal(denied.stdout.includes("test-only-token") || denied.stderr.includes("test-only-token"), false);
  await closeServer(proxy);
  boundary.close();

  // Both the runtime wrapper and release staging must reject a drifted Git.
  const wrongGit = join(root, "wrong-git");
  makeExecutable(wrongGit, ["#!/bin/sh", "if [ \"${1:-}\" = \"--version\" ]; then printf 'git version 2.54.0\\n'; exit 0; fi", "exit 1"].join("\n") + "\n");
  const driftPinRoot = join(root, "drift-pin-root");
  makeDirectory(join(driftPinRoot, "deploy"));
  writeFileSync(join(driftPinRoot, "deploy/pins.env"), `ATLAS_GIT_VERSION=2.55.0\nATLAS_GIT_BINARY=${wrongGit}\n`, { mode: 0o644 });
  const pin = await run([join(repositoryRoot, "deploy/bin/git"), "--version"], {
    env: { ATLAS_RELEASE_ROOT: driftPinRoot },
  });
  assert.equal(pin.exitCode, 1);
  const driftRelease = join(root, "release-drift");
  const stagedDrift = await run(["bash", join(repositoryRoot, "deploy/stage-release.sh"), repositoryRoot, driftRelease], {
    env: { ATLAS_STAGE_GIT_BINARY: wrongGit, ATLAS_STAGE_BUN_BINARY: process.execPath },
  });
  assert.equal(stagedDrift.exitCode, 1);
  assert.equal(existsSync(driftRelease), false);

  // Recovery capture is atomic: a missing input leaves the previous current
  // copy untouched; refresh retains it as previous; rollback retains failure.
  const configSource = join(root, "etc-atlas");
  const unitSource = join(root, "units");
  const releaseSource = join(root, "release");
  const releaseDeploy = join(releaseSource, "deploy");
  const recoveryRoot = join(root, "recovery-config");
  const routeRecord = join(root, "route-record");
  const firewallRecord = join(root, "firewall-record");
  makeDirectory(configSource);
  makeDirectory(unitSource);
  makeDirectory(releaseDeploy);
  makeDirectory(recoveryRoot);
  for (const [name, contents] of Object.entries({
    "atlas.env": "ATLAS_SHARED_TOKEN=placeholder\n",
    "github.env": "ATLAS_GITHUB_APP_ID=1\n",
    "github-app.pem": "test-private-key-placeholder\n",
    "supplier.key": "test-supplier-key-placeholder\n",
  })) {
    writeFileSync(join(configSource, name), contents, { mode: 0o600 });
    chmodSync(join(configSource, name), 0o600);
  }
  for (const name of ["atlas.service", "opencode.service"]) {
    writeFileSync(join(unitSource, name), `${name}\n`, { mode: 0o644 });
    chmodSync(join(unitSource, name), 0o644);
  }
  writeFileSync(routeRecord, "private=ui\npublic=webhook\n", { mode: 0o600 });
  writeFileSync(firewallRecord, "loopback-only\n", { mode: 0o600 });
  writeFileSync(join(releaseSource, "RELEASE_COMMIT"), "old-commit\n", { mode: 0o644 });
  chmodSync(join(releaseSource, "RELEASE_COMMIT"), 0o644);
  const fakeTools = {
    bun: join(root, "bun"),
    opencode: join(root, "opencode2"),
    git: join(root, "git"),
    gitWrapper: join(root, "git-wrapper"),
    gh: join(root, "gh"),
  };
  for (const path of Object.values(fakeTools)) makeExecutable(path, "#!/bin/sh\nexit 0\n");
  writeFileSync(join(releaseDeploy, "pins.env"), [
    "ATLAS_BUN_VERSION=1.3.14",
    "ATLAS_OPENCODE_VERSION=0.0.0-beta-19135",
    "ATLAS_OPENCODE_CLIENT_VERSION=0.0.0-beta-19135",
    "ATLAS_GIT_VERSION=2.55.0",
    "ATLAS_GH_VERSION=2.100.0",
    `ATLAS_BUN_BINARY=${fakeTools.bun}`,
    `ATLAS_OPENCODE_BINARY=${fakeTools.opencode}`,
    `ATLAS_GIT_BINARY=${fakeTools.git}`,
    `ATLAS_GIT_WRAPPER=${fakeTools.gitWrapper}`,
    `ATLAS_REAL_GH=${fakeTools.gh}`,
    "",
  ].join("\n"), { mode: 0o644 });
  chmodSync(join(releaseDeploy, "pins.env"), 0o644);
  const captureEnvironment = {
    ATLAS_RECOVERY_CONFIG_ROOT: recoveryRoot,
    ATLAS_RECOVERY_CONFIG_SOURCE: configSource,
    ATLAS_RECOVERY_UNIT_SOURCE: unitSource,
    ATLAS_RECOVERY_RELEASE_ROOT: releaseSource,
    ATLAS_RECOVERY_ROUTE_RECORD: routeRecord,
    ATLAS_RECOVERY_FIREWALL_RECORD: firewallRecord,
  };
  const captureScript = join(repositoryRoot, "deploy/capture-recovery-config.sh");
  const firstCapture = await run(["bash", captureScript], { env: captureEnvironment });
  assert.equal(firstCapture.exitCode, 0, firstCapture.stderr);
  const current = join(recoveryRoot, "current");
  const previous = join(recoveryRoot, "previous");
  assert.equal(lstatSync(current).isSymbolicLink(), false);
  assertMode(current, 0o700);
  assertMode(join(current, "etc-atlas", "atlas.env"), 0o400);
  assertMode(join(current, "units", "atlas.service"), 0o400);
  assert.equal(readFileSync(join(current, "release", "RELEASE_COMMIT"), "utf8"), "old-commit\n");

  unlinkSync(routeRecord);
  const failedCapture = await run(["bash", captureScript], { env: captureEnvironment });
  assert.equal(failedCapture.exitCode, 1);
  assert.equal(readFileSync(join(current, "release", "RELEASE_COMMIT"), "utf8"), "old-commit\n");
  writeFileSync(routeRecord, "private=ui\npublic=webhook\n", { mode: 0o600 });
  chmodSync(routeRecord, 0o600);
  writeFileSync(join(releaseSource, "RELEASE_COMMIT"), "new-commit\n", { mode: 0o644 });
  chmodSync(join(releaseSource, "RELEASE_COMMIT"), 0o644);
  const secondCapture = await run(["bash", captureScript], { env: captureEnvironment });
  assert.equal(secondCapture.exitCode, 0, secondCapture.stderr);
  assert.equal(readFileSync(join(current, "release", "RELEASE_COMMIT"), "utf8"), "new-commit\n");
  assert.equal(readFileSync(join(previous, "release", "RELEASE_COMMIT"), "utf8"), "old-commit\n");
  assertMode(join(previous, "etc-atlas", "github.env"), 0o400);
  const rollback = await run(["bash", captureScript, "rollback"], { env: { ATLAS_RECOVERY_CONFIG_ROOT: recoveryRoot } });
  assert.equal(rollback.exitCode, 0, rollback.stderr);
  assert.equal(readFileSync(join(current, "release", "RELEASE_COMMIT"), "utf8"), "old-commit\n");
  assert.equal(readdirSync(recoveryRoot).some((name) => name.startsWith("failed-")), true);

  // The #37 space guard exposes warning versus new-preparation pause without
  // installing a timer or changing global snapshot policy.
  const spaceScript = join(repositoryRoot, "deploy/check-space.sh");
  const healthySpace = await run(["bash", spaceScript], { env: { ATLAS_STORAGE_PATH: root, ATLAS_STORAGE_WARNING_BYTES: "1", ATLAS_MIN_FREE_BYTES: "1" } });
  assert.equal(healthySpace.exitCode, 0, healthySpace.stderr);
  const warningSpace = await run(["bash", spaceScript], { env: { ATLAS_STORAGE_PATH: root, ATLAS_STORAGE_WARNING_BYTES: "999999999999999", ATLAS_MIN_FREE_BYTES: "1" } });
  assert.equal(warningSpace.exitCode, 1);
  const pausedSpace = await run(["bash", spaceScript], { env: { ATLAS_STORAGE_PATH: root, ATLAS_STORAGE_WARNING_BYTES: "999999999999999", ATLAS_MIN_FREE_BYTES: "999999999999998" } });
  assert.equal(pausedSpace.exitCode, 2);

  console.log("Issue #37 deployment checks passed");
} finally {
  boundary.close();
  if (proxy) await closeServer(proxy);
  if (tlsServer) await closeServer(tlsServer);
  rmSync(root, { recursive: true, force: true });
}
