// `atlas setup` inputs: command-line flags plus an optional answers JSON file.
// A flag wins over the answers file; anything still missing is asked on the
// terminal (or setup stops when there is none). See docs/INSTALL.md.
import { readFileSync } from "node:fs";

export type Tailscale = "yes" | "no" | "ask";

/** Answers a file or flags may give. Every field is optional. */
export type Answers = {
  user?: string;
  group?: string;
  organization?: string;
  appId?: string;
  installationId?: string;
  privateKeyPath?: string;
  origin?: string;
  port?: number;
  webhookPort?: number;
  git?: string;
  gh?: string;
  openCode?: string;
  dataDir?: string;
  tailscale?: Tailscale;
  /** Consent to create the service account (a system account, no login). */
  createUser?: boolean;
  /** Consent to run Atlas as an account that can become root (sudo, wheel, docker, …). */
  allowPrivilegedUser?: boolean;
};

export type SetupOptions = {
  root: string;
  dryRun: boolean;
  /** Accept every yes/no confirmation that has a safe meaning (never Tailscale). */
  yes: boolean;
  sourceDir?: string;
  answers: Answers;
  rotateToken: boolean;
  rotateWebhookSecret: boolean;
  adopt: boolean;
  confirmRunningSessions: boolean;
  healthTimeoutMs: number;
  help: boolean;
};

export class UsageError extends Error {}

const ANSWER_KEYS: Record<string, keyof Answers> = {
  "--user": "user",
  "--group": "group",
  "--org": "organization",
  "--app-id": "appId",
  "--installation-id": "installationId",
  "--private-key": "privateKeyPath",
  "--origin": "origin",
  "--port": "port",
  "--webhook-port": "webhookPort",
  "--git": "git",
  "--gh": "gh",
  "--opencode": "openCode",
  "--data-dir": "dataDir",
  "--tailscale": "tailscale",
};

const JSON_KEYS: Record<string, "string" | "number" | "boolean"> = {
  user: "string", group: "string", organization: "string", appId: "string", installationId: "string",
  privateKeyPath: "string", origin: "string", port: "number", webhookPort: "number", git: "string",
  gh: "string", openCode: "string", dataDir: "string", tailscale: "string", createUser: "boolean",
  allowPrivilegedUser: "boolean",
};

export const SETUP_USAGE = `usage: atlas setup [options]

Installs Atlas on this host, re-runs safely on an installed host, or adopts an
older /opt/atlas install. Run as root. Missing answers are asked on the terminal.

  --answers <file>          JSON answers (keys: ${Object.keys(JSON_KEYS).join(", ")})
  --source-dir <dir>        folder holding atlas-linux-x64, .sha256, atlas-release.json
  --user/--group <name>     service account (default: a dedicated "atlas" account)
  --create-user             create the service account if it is missing
  --allow-privileged-user   allow a service account that can become root (not advised)
  --org <login>             GitHub organization
  --app-id/--installation-id <n>
  --private-key <file>      GitHub App private key (PEM); copied to /etc/atlas
  --origin <https-url>      browser URL of Atlas (default: the Tailscale URL)
  --port/--webhook-port <n> default 3000/3001
  --git/--gh/--opencode <path>
  --data-dir <dir>          default /var/lib/atlas
  --tailscale yes|no|ask    share Atlas on your tailnet (default ask)
  --rotate-token            new sign-in token
  --rotate-webhook-secret   new GitHub webhook secret
  --adopt                   confirm adopting an older install
  --confirm-running-sessions  continue while Sessions are running
  --health-timeout <sec>    default 90
  --yes                     accept confirmations (never Tailscale)
  --dry-run                 print the plan; change nothing
  --root <dir>              prefix every file path (testing; env ATLAS_SETUP_ROOT)
`;

const readAnswersFile = (path: string): Answers => {
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new UsageError(`answers file ${path} is not readable JSON: ${(error as Error).message}`);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new UsageError("answers file must hold a JSON object");
  const answers: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    const type = JSON_KEYS[key];
    if (!type) throw new UsageError(`answers file has an unknown key "${key}"`);
    if (typeof entry !== type) throw new UsageError(`answers file key "${key}" must be a ${type}`);
    answers[key] = entry;
  }
  return answers as Answers;
};

const setAnswer = (answers: Answers, key: keyof Answers, raw: string) => {
  if (key === "port" || key === "webhookPort") {
    if (!/^\d{1,5}$/u.test(raw)) throw new UsageError(`${key} must be a port number`);
    answers[key] = Number(raw);
  } else {
    (answers as Record<string, unknown>)[key] = raw;
  }
};

export const parseSetupArgs = (args: string[], env: Record<string, string | undefined> = process.env): SetupOptions => {
  const options: SetupOptions = {
    root: env.ATLAS_SETUP_ROOT ?? "",
    dryRun: false,
    yes: false,
    answers: {},
    rotateToken: false,
    rotateWebhookSecret: false,
    adopt: false,
    confirmRunningSessions: false,
    healthTimeoutMs: 90_000,
    help: false,
  };
  const flagAnswers: Answers = {};
  let answersPath: string | undefined;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    const equals = arg.indexOf("=");
    const name = arg.startsWith("--") && equals > 0 ? arg.slice(0, equals) : arg;
    const inline = arg.startsWith("--") && equals > 0 ? arg.slice(equals + 1) : undefined;
    const value = () => {
      if (inline !== undefined) return inline;
      const next = args[++index];
      if (next === undefined) throw new UsageError(`${name} needs a value`);
      return next;
    };
    switch (name) {
      case "--help": case "-h": options.help = true; break;
      case "--dry-run": options.dryRun = true; break;
      case "--yes": case "-y": options.yes = true; break;
      case "--rotate-token": options.rotateToken = true; break;
      case "--rotate-webhook-secret": options.rotateWebhookSecret = true; break;
      case "--adopt": options.adopt = true; break;
      case "--confirm-running-sessions": options.confirmRunningSessions = true; break;
      case "--create-user": flagAnswers.createUser = true; break;
      case "--allow-privileged-user": flagAnswers.allowPrivilegedUser = true; break;
      case "--root": options.root = value(); break;
      case "--source-dir": options.sourceDir = value(); break;
      case "--answers": answersPath = value(); break;
      case "--health-timeout": {
        const seconds = value();
        if (!/^\d{1,4}$/u.test(seconds) || Number(seconds) < 1) throw new UsageError("--health-timeout must be whole seconds");
        options.healthTimeoutMs = Number(seconds) * 1000;
        break;
      }
      default: {
        const key = ANSWER_KEYS[name];
        if (!key) throw new UsageError(`unknown option ${arg}`);
        setAnswer(flagAnswers, key, value());
      }
    }
  }
  if (options.root && (!options.root.startsWith("/") || options.root === "/")) throw new UsageError("--root must be an absolute folder other than /");
  options.root = options.root.replace(/\/+$/u, "");
  options.answers = { ...(answersPath ? readAnswersFile(answersPath) : {}), ...flagAnswers };
  const tailscale = options.answers.tailscale;
  if (tailscale !== undefined && !["yes", "no", "ask"].includes(tailscale)) throw new UsageError("--tailscale must be yes, no, or ask");
  return options;
};
