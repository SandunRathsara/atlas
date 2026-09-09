import { strict as assert } from "node:assert";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer as createHttpsServer } from "node:https";
import { connect, createServer as createNetServer, type AddressInfo, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cloneGitEnvironment } from "../src/preparation.ts";

type Result = { exitCode: number; stdout: string; stderr: string };

const readOutput = async (stream: unknown) =>
  stream && typeof stream !== "number" ? await new Response(stream as ReadableStream<Uint8Array>).text() : "";

const run = async (command: string[], options: { cwd?: string; env?: Record<string, string> } = {}): Promise<Result> => {
  const child = Bun.spawn(command, {
    cwd: options.cwd,
    env: { ...(process.env as Record<string, string>), ...(options.env ?? {}) },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([child.exited, readOutput(child.stdout), readOutput(child.stderr)]);
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
const close = (server: Server | undefined) => new Promise<void>((resolve) => {
  if (!server?.listening) return resolve();
  server.close(() => resolve());
});

const root = mkdtempSync(join(tmpdir(), "atlas-clone-scope-"));
const sessionRoot = join(root, "sessions");
const sessionDirectory = join(sessionRoot, "ses-test");
const marker = join(root, "helper-scope");
let proxy: Server | undefined;
let tls: Server | undefined;

try {
  mkdirSync(sessionRoot, { recursive: true, mode: 0o700 });
  const helper = join(root, "credential-helper");
  writeFileSync(helper, [
    "#!/bin/sh",
    "cat >/dev/null",
    "printf '%s\\n' \"$ATLAS_SESSION_DIRECTORY\" >> \"$ATLAS_TEST_MARKER\"",
    "printf 'username=probe\\npassword=probe\\n\\n'",
  ].join("\n") + "\n", { mode: 0o700 });
  chmodSync(helper, 0o700);

  const certificate = join(root, "test.crt");
  const privateKey = join(root, "test.key");
  const certificateResult = await run([
    "openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes",
    "-keyout", privateKey, "-out", certificate, "-subj", "/CN=github.com", "-days", "1",
  ]);
  assert.equal(certificateResult.exitCode, 0, certificateResult.stderr);

  tls = createHttpsServer({ key: readFileSync(privateKey), cert: readFileSync(certificate) }, (_request, response) => {
    response.writeHead(401, { "WWW-Authenticate": "Basic realm=github" });
    response.end();
  }) as unknown as Server;
  const tlsPort = await listen(tls);
  proxy = createNetServer((client) => {
    client.once("data", (chunk) => {
      if (!chunk.toString().startsWith("CONNECT github.com:")) return client.destroy();
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

  const environment = {
    ...cloneGitEnvironment(
      process.env as Record<string, string>,
      { ATLAS_SUPPLIER_SOCKET: join(root, "supplier.sock"), ATLAS_SUPPLIER_KEY_PATH: join(root, "supplier.key") },
      sessionDirectory,
    ),
    ATLAS_TEST_MARKER: marker,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_TERMINAL_PROMPT: "0",
    GIT_ASKPASS: "/bin/false",
    GIT_SSH_COMMAND: "/bin/false",
  };
  const helperConfig = `!${shellQuote(helper)}`;
  const result = await run([
    "/usr/bin/git",
    "-c", "credential.helper=",
    "-c", `credential.helper=${helperConfig}`,
    "-c", "credential.useHttpPath=true",
    "-c", `http.proxy=http://127.0.0.1:${proxyPort}`,
    "-c", "http.sslVerify=false",
    "clone", "--no-checkout", "--origin", "origin",
    "https://github.com/Acme/repo.git", sessionDirectory,
  ], { cwd: sessionRoot, env: environment });

  assert.notEqual(result.exitCode, 0, "the local 401 endpoint must prevent a real clone");
  assert.equal(existsSync(marker), true, `real Git did not invoke the clone-time helper: ${result.stderr}`);
  const scopes = readFileSync(marker, "utf8").trim().split(/\r?\n/u);
  assert.equal(scopes.length > 0, true);
  assert.equal(scopes.every((scope) => scope === sessionDirectory), true, "clone-time helper received the caller root instead of the future Session directory");
  console.log("real Git clone-time Session scope regression passed");
} finally {
  await close(proxy);
  await close(tls);
  rmSync(root, { recursive: true, force: true });
}
