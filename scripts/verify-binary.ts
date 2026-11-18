// Smoke check for the compiled `atlas` binary: build it (cached per source tree,
// scripts/verify-binaries.ts), copy ONLY the binary into an empty folder, and
// run it with a PATH that has no Bun.
import { strict as assert } from "node:assert";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { createReleaseMetadata } from "../src/release.ts";
import { verifyBinary } from "./verify-binaries.ts";
import { RELEASE_SHIMS, releaseShimText } from "../src/shims.ts";

const repositoryRoot = resolve(import.meta.dir, "..");
const tag = "v0.1.0+build.1";
const gitSha = "c".repeat(40);
const token = "verify-binary-token";

// The binary is ~100 MB; keep it off the /tmp tmpfs.
const cacheRoot = process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache");
mkdirSync(cacheRoot, { recursive: true });
const scratch = mkdtempSync(join(cacheRoot, "atlas-verify-binary-"));
const children: ReturnType<typeof Bun.spawn>[] = [];

const freePort = () => {
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() });
  const port = server.port!;
  server.stop(true);
  return port;
};

try {
  // Build into one folder, run from another that holds only the binary.
  const built = await verifyBinary(tag, gitSha);
  const releaseRoot = join(scratch, "release");
  mkdirSync(releaseRoot, { mode: 0o700 });
  const binary = join(releaseRoot, "atlas");
  copyFileSync(built, binary);
  chmodSync(binary, 0o755);

  const emptyBin = join(scratch, "empty-bin");
  const home = join(scratch, "home");
  const work = join(scratch, "work");
  for (const directory of [emptyBin, home, work]) mkdirSync(directory, { mode: 0o700 });
  assert.equal(Bun.which("bun", { PATH: emptyBin }), null);
  // Only what the processes need; no inherited PATH, Bun, or OpenCode discovery.
  const baseEnv = {
    PATH: emptyBin,
    HOME: home,
    XDG_STATE_HOME: join(scratch, "state"),
    OPENCODE_SERVICE_FILE: join(scratch, "missing-opencode-service.json"),
    // Keep Release discovery offline: outbound requests hit a closed port.
    HTTP_PROXY: "http://127.0.0.1:9",
    HTTPS_PROXY: "http://127.0.0.1:9",
  };
  const runSync = (args: string[], options: { env?: Record<string, string>; stdin?: string; cwd?: string } = {}) => {
    const result = Bun.spawnSync(args, {
      cwd: options.cwd ?? work,
      env: { ...baseEnv, ...options.env },
      stdin: options.stdin === undefined ? "ignore" : Buffer.from(options.stdin),
      stdout: "pipe",
      stderr: "pipe",
    });
    return { code: result.exitCode, stdout: result.stdout.toString(), stderr: result.stderr.toString() };
  };

  // version
  const version = runSync([binary, "version", "--json"]);
  assert.equal(version.code, 0, version.stderr);
  assert.deepEqual(JSON.parse(version.stdout), { published: true, tag, semver: "0.1.0", build: 1, gitSha });
  assert.match(runSync([binary, "version"]).stdout, new RegExp(`atlas ${tag.replace(/[.+]/gu, "\\$&")} \\(${gitSha}\\)`));

  // dispatcher
  assert.notEqual(runSync([binary]).code, 0, "no subcommand must fail");
  const unknown = runSync([binary, "frobnicate"]);
  assert.notEqual(unknown.code, 0, "unknown subcommand must fail");
  assert.match(unknown.stderr, /unknown command "frobnicate"/);
  const help = runSync([binary, "--help"]);
  assert.equal(help.code, 0);
  for (const name of ["serve", "credentials", "updater", "gh", "git-credential", "setup", "version"]) assert.match(help.stdout, new RegExp(`\\b${name}\\b`));
  const setup = runSync([binary, "setup"]);
  assert.notEqual(setup.code, 0, "setup is a stub");
  assert.match(setup.stderr, /not implemented/);

  // git-credential and gh fail closed without a credential supplier.
  const supplierEnv = { ATLAS_SUPPLIER_SOCKET: join(scratch, "no-supplier.sock"), ATLAS_SUPPLIER_KEY_PATH: join(scratch, "no-supplier.key") };
  const credentialInput = "protocol=https\nhost=github.com\npath=Acme/repo.git\n\n";
  const gitCredential = runSync([binary, "git-credential", "get"], { env: supplierEnv, stdin: credentialInput });
  assert.equal(gitCredential.code, 1);
  assert.equal(gitCredential.stdout, "quit=true\n\n");
  assert.equal(runSync([binary, "git-credential", "store"], { env: supplierEnv, stdin: credentialInput }).stdout, "quit=true\n\n");
  const gh = runSync([binary, "gh", "pr", "list"], { env: supplierEnv });
  assert.equal(gh.code, 1);
  assert.match(gh.stderr, /Atlas gh access was rejected/);
  assert.match(runSync([binary, "gh", "auth", "token"], { env: supplierEnv }).stderr, /Atlas gh access was rejected/);

  // Generated Release shims dispatch to the binary.
  for (const [path, subcommand] of Object.entries(RELEASE_SHIMS)) {
    const shim = join(releaseRoot, path);
    mkdirSync(join(releaseRoot, "bin"), { recursive: true });
    writeFileSync(shim, releaseShimText(binary, subcommand), { mode: 0o755 });
  }
  const shimCredential = runSync(["/bin/sh", join(releaseRoot, "bin", "git-credential-atlas"), "get"], { env: supplierEnv, stdin: credentialInput });
  assert.equal(shimCredential.stdout, "quit=true\n\n");
  assert.match(runSync(["/bin/sh", join(releaseRoot, "bin", "gh"), "pr", "list"], { env: supplierEnv }).stderr, /Atlas gh access was rejected/);
  rmSync(join(releaseRoot, "bin"), { recursive: true });

  // serve
  const port = freePort();
  let webhookPort = freePort();
  while (webhookPort === port) webhookPort = freePort();
  const data = join(scratch, "data");
  mkdirSync(data, { mode: 0o700 });
  const serveEnv = {
    ATLAS_SHARED_TOKEN: token,
    ATLAS_GITHUB_WEBHOOK_SECRET: "verify-binary-webhook-secret",
    ATLAS_GITHUB_ORGANIZATION: "fixture-org",
    ATLAS_GITHUB_INSTALLATION_ID: "1",
    ATLAS_PORT: String(port),
    ATLAS_WEBHOOK_PORT: String(webhookPort),
    ATLAS_DATABASE_PATH: join(data, "atlas.sqlite"),
    ATLAS_SESSION_ROOT: join(data, "sessions"),
    ATLAS_GITHUB_ENV_PATH: join(data, "github.env"),
    ATLAS_CREDENTIAL_REGISTRY_PATH: join(data, "session-scopes.json"),
    ATLAS_SUPPLIER_SOCKET: join(data, "supplier.sock"),
    ATLAS_SUPPLIER_KEY_PATH: join(data, "supplier.key"),
    ATLAS_UPDATER_SOCKET: join(data, "updater.sock"),
    ATLAS_UPDATER_KEY_PATH: join(data, "updater.key"),
  };
  const server = Bun.spawn([binary, "serve"], { cwd: work, env: { ...baseEnv, ...serveEnv }, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  children.push(server);
  const base = `http://127.0.0.1:${port}`;
  const authorization = { Authorization: `Bearer ${token}` };
  let health: Response | undefined;
  for (let attempt = 0; attempt < 100 && !health; attempt += 1) {
    health = await fetch(`${base}/health`, { headers: authorization }).catch(() => undefined);
    if (!health) {
      if (server.exitCode !== null) break;
      await Bun.sleep(100);
    }
  }
  if (!health) {
    server.kill();
    throw new Error(`atlas serve did not answer /health:\n${await new Response(server.stderr).text()}`);
  }
  assert.equal(health.status, 200);
  const body = await health.json() as { atlas: { process: boolean; release: unknown }; persistence: { healthy: boolean }; openCode: { ready: boolean; clientVersion: string | null } };
  assert.equal(body.atlas.process, true);
  assert.deepEqual(body.atlas.release, { published: true, tag, semver: "0.1.0", build: 1, gitSha }, "serve must report the embedded identity");
  assert.equal(body.persistence.healthy, true);
  assert.equal(body.openCode.ready, false);
  const client = JSON.parse(readFileSync(join(repositoryRoot, "node_modules", "@opencode", "client", "package.json"), "utf8")) as { version: string };
  assert.equal(body.openCode.clientVersion, client.version, "clientVersion must be the build-time client version");

  const assets: [string, string][] = [
    ["/assets/app.css", "text/css; charset=UTF-8"],
    ["/assets/app.js", "text/javascript; charset=UTF-8"],
    ["/assets/theme.js", "text/javascript; charset=UTF-8"],
    ["/assets/htmx.min.js", "text/javascript; charset=UTF-8"],
    ["/assets/fonts/inter.woff2", "font/woff2"],
    ["/assets/fonts/geist-mono.woff2", "font/woff2"],
    ["/assets/icon.svg", "image/svg+xml"],
  ];
  for (const [route, contentType] of assets) {
    const response = await fetch(`${base}${route}`);
    assert.equal(response.status, 200, route);
    assert.equal(response.headers.get("content-type"), contentType, route);
    const bytes = new Uint8Array(await response.arrayBuffer());
    assert.ok(bytes.length > 0, `${route} is empty`);
    if (route.endsWith(".woff2")) assert.equal(new TextDecoder().decode(bytes.subarray(0, 4)), "wOF2", `${route} is not a woff2 font`);
  }
  assert.equal(
    await (await fetch(`${base}/assets/app.css`)).text(),
    readFileSync(join(repositoryRoot, "public", "app.css"), "utf8"),
    "embedded CSS must be the freshly built public/app.css",
  );
  const login = await fetch(`${base}/login`);
  assert.equal(login.status, 200);
  assert.match(await login.text(), /\/assets\/htmx\.min\.js/);

  server.kill("SIGTERM");
  assert.equal(await server.exited, 143, "serve must stop on SIGTERM");

  // RELEASE_METADATA.json next to the binary must agree with the embedded identity.
  const metadataPath = join(releaseRoot, "RELEASE_METADATA.json");
  writeFileSync(metadataPath, JSON.stringify(createReleaseMetadata("v0.1.0+build.2", gitSha, { sha256: "0".repeat(64), size: 1 }, client.version)));
  const mismatched = Bun.spawn([binary, "serve"], { cwd: work, env: { ...baseEnv, ...serveEnv }, stdin: "ignore", stdout: "ignore", stderr: "pipe" });
  children.push(mismatched);
  assert.notEqual(await mismatched.exited, 0, "serve must refuse metadata that disagrees with the embedded identity");
  assert.match(await new Response(mismatched.stderr).text(), /does not match the release identity built into this binary/);
  rmSync(metadataPath);

  // credentials and updater start and stop cleanly.
  const credentials = Bun.spawn([binary, "credentials"], {
    cwd: work,
    env: { ...baseEnv, ATLAS_GITHUB_ENV_PATH: serveEnv.ATLAS_GITHUB_ENV_PATH, ATLAS_CREDENTIAL_REGISTRY_PATH: serveEnv.ATLAS_CREDENTIAL_REGISTRY_PATH, ATLAS_SUPPLIER_SOCKET: serveEnv.ATLAS_SUPPLIER_SOCKET, ATLAS_SUPPLIER_KEY_PATH: serveEnv.ATLAS_SUPPLIER_KEY_PATH },
    stdin: "ignore", stdout: "pipe", stderr: "pipe",
  });
  children.push(credentials);
  const updaterRoot = join(scratch, "updater");
  mkdirSync(join(updaterRoot, "state"), { recursive: true, mode: 0o700 });
  mkdirSync(join(updaterRoot, "releases"), { recursive: true });
  writeFileSync(join(updaterRoot, "state", "updater.key"), `${"k".repeat(64)}\n`, { mode: 0o600 });
  const updater = Bun.spawn([binary, "updater"], {
    cwd: work,
    env: {
      ...baseEnv,
      ATLAS_CREDENTIAL_REGISTRY_PATH: join(updaterRoot, "state", "session-scopes.json"),
      ATLAS_UPDATE_STATE_PATH: join(updaterRoot, "state", "update-state.json"),
      ATLAS_UPDATER_SOCKET: join(updaterRoot, "state", "updater.sock"),
      ATLAS_UPDATER_KEY_PATH: join(updaterRoot, "state", "updater.key"),
      ATLAS_RELEASES_ROOT: join(updaterRoot, "releases"),
      ATLAS_CURRENT_PATH: join(updaterRoot, "current"),
      ATLAS_SUPPORT_ROOT: join(updaterRoot, "services"),
      ATLAS_ENV_PATH: join(updaterRoot, "atlas.env"),
    },
    stdin: "ignore", stdout: "pipe", stderr: "pipe",
  });
  children.push(updater);
  const readyLine = async (child: ReturnType<typeof Bun.spawn>, expected: string, label: string) => {
    const reader = (child.stdout as ReadableStream<Uint8Array>).getReader();
    let text = "";
    const deadline = Date.now() + 10_000;
    while (!text.includes(expected) && Date.now() < deadline) {
      const chunk = await Promise.race([reader.read(), child.exited.then(() => ({ done: true, value: undefined }))]);
      if (chunk.done) break;
      text += new TextDecoder().decode(chunk.value);
    }
    reader.releaseLock();
    if (!text.includes(expected)) {
      child.kill();
      throw new Error(`atlas ${label} did not become ready:\n${await new Response(child.stderr as ReadableStream<Uint8Array>).text()}`);
    }
  };
  await readyLine(credentials, "Atlas credential supplier is ready", "credentials");
  assert.equal(existsSync(serveEnv.ATLAS_SUPPLIER_SOCKET), true, "credential supplier socket was not created");
  await readyLine(updater, "Atlas updater is ready", "updater");
  credentials.kill("SIGTERM");
  updater.kill("SIGTERM");
  assert.equal(await credentials.exited, 143);
  assert.equal(await updater.exited, 143);

  console.log(`verify:binary passed (${(Bun.file(binary).size / 1024 / 1024).toFixed(1)} MiB, no Bun on PATH)`);
} finally {
  for (const child of children) if (child.exitCode === null) child.kill("SIGKILL");
  rmSync(scratch, { recursive: true, force: true });
}
