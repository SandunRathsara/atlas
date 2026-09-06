import { strict as assert } from "node:assert";
import { generateKeyPairSync } from "node:crypto";
import { chmodSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createCredentialBoundary } from "../src/credentials.ts";
import { createPreparationService } from "../src/preparation.ts";
import { createPersistence, type RepositoryInput, type SpecInput } from "../src/persistence.ts";

const root = join(tmpdir(), `atlas-issue-27-fixes-${crypto.randomUUID()}`);
mkdirSync(root, { recursive: true, mode: 0o700 });

const repository: RepositoryInput = {
  githubId: "1",
  installationId: "2",
  organization: "Acme",
  owner: "Acme",
  name: "repo",
  fullName: "Acme/repo",
  htmlUrl: "https://github.com/Acme/repo",
  description: null,
  visibility: "private",
  defaultBranch: "main",
  archived: false,
  disabled: false,
  hasIssues: true,
};

const spec = (issueNumber: string): SpecInput => ({
  githubId: `spec-${issueNumber}`,
  issueNumber,
  title: `Spec ${issueNumber}`,
  body: "body",
  htmlUrl: `https://github.com/Acme/repo/issues/${issueNumber}`,
  state: "open",
  labels: ["spec"],
  isPullRequest: false,
  hasSpecLabel: true,
  updatedAt: null,
});

const candidate = {
  id: repository.githubId,
  owner: repository.owner,
  name: repository.name,
  fullName: repository.fullName,
  htmlUrl: repository.htmlUrl,
  description: repository.description,
  visibility: repository.visibility,
  defaultBranch: repository.defaultBranch,
  archived: repository.archived,
  disabled: repository.disabled,
  hasIssues: repository.hasIssues,
};

const queue = (persistence: ReturnType<typeof createPersistence>, issueNumber: string, atlasId: string) => {
  const saved = persistence.queueSession({
    atlasId,
    repositoryId: repository.githubId,
    spec: persistence.getSpec(repository.githubId, issueNumber)!,
    submissionId: `${atlasId}-submission`,
    submissionOrderTime: new Date().toISOString(),
    prompt: "start",
    targetKind: "default",
    targetBranch: "main",
  });
  assert.equal(saved.kind, "created");
};

const fakeGithub = {
  listInstallationRepositories: async () => [candidate],
  hasLabel: async () => true,
  listIssues: async () => [],
  getBranchRef: async () => ({ sha: "a".repeat(40) }),
};

const fakeCredentials = (onStart: () => Promise<void> | void) => ({
  start: onStart,
  close: () => undefined,
  registerScope: () => undefined,
  assertReady: async () => undefined,
  helperEnvironment: () => ({ ATLAS_SUPPLIER_SOCKET: join(root, "supplier.sock"), ATLAS_SUPPLIER_KEY_PATH: join(root, "supplier.key") }),
}) as never;

try {
  const persistence = createPersistence({ path: ":memory:" });
  persistence.upsertRepository(repository);
  persistence.replaceSpecs(repository.githubId, [spec("1"), spec("2")]);
  queue(persistence, "1", "ses_1");
  queue(persistence, "2", "ses_2");

  const intent = {
    directory: join(root, "ses_2"),
    baseBranch: "main",
    baseSha: "a".repeat(40),
    workingBranch: "atlas/ses_2",
  };
  assert.equal(persistence.claimPreparation("ses_2", intent, 1), undefined, "older eligible Session must win atomically");

  const outageService = createPreparationService({
    persistence,
    github: fakeGithub,
    refreshRepository: async (saved) => ({ ok: true, repository: saved }),
    sessionRoot: join(root, "sessions"),
    minFreeBytes: 1,
    credentials: fakeCredentials(() => { throw new Error("supplier unavailable"); }),
  });
  await outageService.prepareNext();
  const paused = persistence.getSession("ses_1")!;
  assert.equal(paused.state, "queued", "supplier outage must requeue before local work");
  assert.equal(paused.executionSlotHeld, false);
  assert.match(paused.stateReason ?? "", /credentials/u);
  persistence.close();

  const storagePersistence = createPersistence({ path: ":memory:" });
  storagePersistence.upsertRepository(repository);
  storagePersistence.replaceSpecs(repository.githubId, [spec("3")]);
  queue(storagePersistence, "3", "ses_3");
  const storagePath = join(root, "not-a-directory");
  writeFileSync(storagePath, "x", { mode: 0o600 });
  let credentialStarted = false;
  const storageService = createPreparationService({
    persistence: storagePersistence,
    github: fakeGithub,
    refreshRepository: async (saved) => ({ ok: true, repository: saved }),
    sessionRoot: storagePath,
    minFreeBytes: 1,
    credentials: fakeCredentials(() => { credentialStarted = true; }),
  });
  await storageService.prepareNext();
  const storagePaused = storagePersistence.getSession("ses_3")!;
  assert.equal(storagePaused.state, "queued", "storage outage must pause before admission");
  assert.equal(credentialStarted, false, "storage gate must precede credential work");
  assert.match(storagePaused.stateReason ?? "", /storage/u);
  storagePersistence.close();

  const credentialRoot = join(root, "credential");
  mkdirSync(credentialRoot, { recursive: true, mode: 0o700 });
  const privateKeyPath = join(credentialRoot, "app.pem");
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  writeFileSync(privateKeyPath, privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
  const envPath = join(credentialRoot, "github.env");
  writeFileSync(envPath, `ATLAS_GITHUB_APP_ID=1\nATLAS_GITHUB_INSTALLATION_ID=2\nATLAS_GITHUB_APP_PRIVATE_KEY_PATH=${privateKeyPath}\n`, { mode: 0o600 });
  chmodSync(envPath, 0o600);
  const sessionDirectory = join(credentialRoot, "session");
  mkdirSync(sessionDirectory, { recursive: true, mode: 0o700 });
  let requestedBody: Record<string, unknown> | undefined;
  const boundary = createCredentialBoundary({
    credentialsPath: envPath,
    registryPath: join(credentialRoot, "registry.json"),
    socketPath: join(credentialRoot, "supplier.sock"),
    keyPath: join(credentialRoot, "supplier.key"),
    fetcher: (async (_url, init) => {
      requestedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({
        token: "scoped-token",
        expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        permissions: { contents: "write", pull_requests: "write" },
      }), { status: 201 });
    }) as typeof fetch,
  });
  await boundary.start();
  boundary.registerScope({ atlasId: "ses_credential", directory: sessionDirectory, repositoryId: "123", fullName: "Acme/repo" });
  await boundary.requestToken({ operation: "preflight", sessionDirectory });
  assert.deepEqual(requestedBody?.repository_ids, [123]);
  assert.equal((requestedBody?.permissions as Record<string, unknown>).contents, "write");
  assert.equal((requestedBody?.permissions as Record<string, unknown>).pull_requests, "write");
  boundary.close();

  const unrestricted = createCredentialBoundary({
    registryPath: join(credentialRoot, "unrestricted-registry.json"),
    socketPath: join(credentialRoot, "unrestricted.sock"),
    keyPath: join(credentialRoot, "unrestricted.key"),
    authorizedRepositories: undefined,
    allowStaticToken: true,
    staticToken: "scoped-token",
  });
  await unrestricted.start();
  unrestricted.registerScope({ atlasId: "ses_other", directory: sessionDirectory, repositoryId: "456", fullName: "Other/repo" });
  const unrestrictedToken = await unrestricted.requestToken({ operation: "preflight", sessionDirectory });
  assert.equal(unrestrictedToken.password, "scoped-token");
  unrestricted.close();

  console.log("Issue #27 fix checks passed");
} finally {
  rmSync(root, { recursive: true, force: true });
}
