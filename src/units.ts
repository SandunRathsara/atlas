// systemd units for the four long-running Atlas services, rendered from one
// place. Used by Phase 4 `atlas setup` (fresh install and adopt) and checked by
// tests. Every hardening directive of the old checked-in units is kept.
//
//   atlas.service             UI + webhooks           <prefix>/current/atlas serve
//   atlas-credentials.service credential supplier     <prefix>/services/current/atlas credentials
//   atlas-updater.service     staging + activation    <prefix>/services/current/atlas updater (root)
//   opencode.service          OpenCode server         <openCodeBinary> serve
//
// The credential and updater services run from `<prefix>/services/current`,
// a separate Release folder the updater swaps only after a candidate passed
// its health check, so a UI restart or rollback never touches them.

export type UnitOptions = {
  /** Unprivileged account that runs Atlas, OpenCode, and every candidate binary. */
  user: string;
  group: string;
  /** The service user's home (Sessions and OpenCode need it). */
  home: string;
  /** Install prefix holding `releases/`, `current`, and `services/`. Default `/opt/atlas`. */
  prefix?: string;
  /** Default `/etc/atlas/atlas.env`. */
  atlasEnvPath?: string;
  /** Default `/etc/atlas/github.env`. */
  githubEnvPath?: string;
  /** Holds `supplier.key` and `updater.key`. Default `/etc/atlas`. */
  configDir?: string;
  /** Default `/var/lib/atlas`. */
  dataDir?: string;
  /** Host tools. Defaults `/usr/bin/git`, `/usr/bin/gh`. */
  realGit?: string;
  realGh?: string;
  /** Default `/opt/atlas/tools/opencode/current/bin/opencode`. */
  openCodeBinary?: string;
  openCodePort?: number;
};

export const UNIT_NAMES = ["atlas.service", "atlas-credentials.service", "atlas-updater.service", "opencode.service"] as const;
export type UnitName = (typeof UNIT_NAMES)[number];

const safePath = (label: string, value: string) => {
  if (!/^\/[A-Za-z0-9._/@+-]*$/u.test(value) || value.split("/").includes("..") || (value !== "/" && value.endsWith("/"))) {
    throw new Error(`${label} must be a plain absolute path`);
  }
  return value;
};

const safeName = (label: string, value: string) => {
  if (!/^[a-z_][a-z0-9_-]{0,31}$/u.test(value)) throw new Error(`${label} must be a plain account name`);
  return value;
};

const lines = (...items: Array<string | false>) => `${items.filter((item) => item !== false).join("\n")}\n`;

const common = (identifier: string) => [
  "Restart=on-failure",
  "RestartSec=5s",
  "TimeoutStopSec=30s",
  "LogRateLimitIntervalSec=30s",
  "LogRateLimitBurst=1000",
  `SyslogIdentifier=${identifier}`,
  "LogNamespace=atlas",
];

/** Unit file name → text. Pure; writes nothing. */
export const renderUnits = (options: UnitOptions): Record<UnitName, string> => {
  const user = safeName("user", options.user);
  const group = safeName("group", options.group);
  if (user === "root" || group === "root") throw new Error("Atlas services must not run as root");
  const home = safePath("home", options.home);
  const prefix = safePath("prefix", options.prefix ?? "/opt/atlas");
  if (prefix === "/") throw new Error("prefix must not be /");
  const configDir = safePath("configDir", options.configDir ?? "/etc/atlas");
  const atlasEnv = safePath("atlasEnvPath", options.atlasEnvPath ?? `${configDir}/atlas.env`);
  const githubEnv = safePath("githubEnvPath", options.githubEnvPath ?? `${configDir}/github.env`);
  const data = safePath("dataDir", options.dataDir ?? "/var/lib/atlas");
  const realGit = safePath("realGit", options.realGit ?? "/usr/bin/git");
  const realGh = safePath("realGh", options.realGh ?? "/usr/bin/gh");
  const openCode = safePath("openCodeBinary", options.openCodeBinary ?? `${prefix}/tools/opencode/current/bin/opencode`);
  const openCodePort = options.openCodePort ?? 49475;
  if (!Number.isSafeInteger(openCodePort) || openCodePort < 1 || openCodePort > 65535) throw new Error("openCodePort is invalid");

  const current = `${prefix}/current`;
  const services = `${prefix}/services/current`;
  const path = `${current}/bin:/usr/local/bin:/usr/bin:/bin`;
  const supplierSocket = "/run/atlas/supplier.sock";
  const supplierKey = `${configDir}/supplier.key`;
  const registry = `${data}/session-scopes.json`;
  const hostTools = [`Environment=ATLAS_REAL_GIT=${realGit}`, `Environment=ATLAS_REAL_GH=${realGh}`, `Environment=ATLAS_GIT_BINARY=${current}/bin/git`];

  return {
    "atlas.service": lines(
      "[Unit]",
      "Description=Atlas private UI and webhook observer",
      "Wants=network-online.target atlas-credentials.service atlas-updater.service",
      "After=network-online.target atlas-credentials.service atlas-updater.service",
      `RequiresMountsFor=${current} ${data} ${configDir} ${home}`,
      "StartLimitIntervalSec=5min",
      "StartLimitBurst=5",
      "",
      "[Service]",
      "Type=simple",
      `User=${user}`,
      `Group=${group}`,
      `WorkingDirectory=${current}`,
      `Environment=HOME=${home}`,
      `Environment=PATH=${path}`,
      ...hostTools,
      `EnvironmentFile=${atlasEnv}`,
      `ExecStartPre=/usr/bin/test -x ${current}/atlas`,
      `ExecStartPre=${current}/bin/git --version`,
      `ExecStartPre=/usr/bin/test -f ${atlasEnv}`,
      `ExecStartPre=/usr/bin/test -d ${data}`,
      `ExecStart=${current}/atlas serve`,
      ...common("atlas"),
      "UMask=0077",
      "LimitNOFILE=65536",
      "",
      "[Install]",
      "WantedBy=multi-user.target",
    ),
    "atlas-credentials.service": lines(
      "[Unit]",
      "Description=Atlas Repository-scoped credential supplier",
      "Wants=network-online.target",
      "After=network-online.target",
      `RequiresMountsFor=${services} ${data} ${configDir} ${home}`,
      "StartLimitIntervalSec=5min",
      "StartLimitBurst=5",
      "",
      "[Service]",
      "Type=simple",
      `User=${user}`,
      `Group=${group}`,
      `WorkingDirectory=${services}`,
      `Environment=HOME=${home}`,
      `Environment=ATLAS_GITHUB_ENV_PATH=${githubEnv}`,
      `Environment=ATLAS_CREDENTIAL_REGISTRY_PATH=${registry}`,
      `Environment=ATLAS_SUPPLIER_SOCKET=${supplierSocket}`,
      `Environment=ATLAS_SUPPLIER_KEY_PATH=${supplierKey}`,
      `ExecStartPre=/usr/bin/test -x ${services}/atlas`,
      `ExecStart=${services}/atlas credentials`,
      ...common("atlas-credentials"),
      "UMask=0077",
      "RuntimeDirectory=atlas",
      "RuntimeDirectoryMode=0700",
      "LimitNOFILE=65536",
      "",
      "[Install]",
      "WantedBy=multi-user.target",
    ),
    // Root only to swap Release folders and run `systemctl`; it runs every
    // candidate binary as `user` (src/release-layout.ts). It reads only
    // ATLAS_SHARED_TOKEN and ATLAS_PORT from atlas.env, never as EnvironmentFile.
    "atlas-updater.service": lines(
      "[Unit]",
      "Description=Atlas release staging and activation service",
      "Wants=network-online.target",
      "After=network-online.target",
      `RequiresMountsFor=${services} ${prefix}/releases ${data} ${configDir}`,
      "StartLimitIntervalSec=5min",
      "StartLimitBurst=5",
      "",
      "[Service]",
      "Type=simple",
      "User=root",
      `Group=${group}`,
      `WorkingDirectory=${services}`,
      `Environment=ATLAS_UPDATE_STATE_PATH=${data}/update-state.json`,
      "Environment=ATLAS_UPDATER_SOCKET=/run/atlas-updater/updater.sock",
      `Environment=ATLAS_UPDATER_KEY_PATH=${configDir}/updater.key`,
      `Environment=ATLAS_RELEASES_ROOT=${prefix}/releases`,
      `Environment=ATLAS_CURRENT_PATH=${current}`,
      `Environment=ATLAS_SUPPORT_ROOT=${prefix}/services`,
      `Environment=ATLAS_ENV_PATH=${atlasEnv}`,
      `Environment=ATLAS_CREDENTIAL_REGISTRY_PATH=${registry}`,
      `Environment=ATLAS_SERVICE_USER=${user}`,
      `Environment=ATLAS_SERVICE_GROUP=${group}`,
      `Environment=ATLAS_REAL_GIT=${realGit}`,
      `Environment=ATLAS_REAL_GH=${realGh}`,
      `ExecStartPre=/usr/bin/test -x ${services}/atlas`,
      `ExecStart=${services}/atlas updater`,
      ...common("atlas-updater"),
      "UMask=0007",
      "RuntimeDirectory=atlas-updater",
      "RuntimeDirectoryMode=0750",
      "NoNewPrivileges=true",
      "PrivateTmp=true",
      "ProtectHome=true",
      "ProtectSystem=strict",
      // The prefix itself must be writable: `current` is swapped by renaming a
      // temporary symlink inside it. OpenCode tools stay read-only.
      `ReadWritePaths=${prefix} ${data} /run/atlas-updater`,
      `ReadOnlyPaths=-${prefix}/tools`,
      "LimitNOFILE=65536",
      "",
      "[Install]",
      "WantedBy=multi-user.target",
    ),
    "opencode.service": lines(
      "[Unit]",
      "Description=OpenCode private service",
      "Wants=network-online.target atlas-credentials.service",
      "After=network-online.target atlas-credentials.service",
      `RequiresMountsFor=${current} ${data} ${configDir} ${home}`,
      "StartLimitIntervalSec=5min",
      "StartLimitBurst=5",
      "",
      "[Service]",
      "Type=simple",
      `User=${user}`,
      `Group=${group}`,
      `WorkingDirectory=${data}/opencode-runtime`,
      `Environment=HOME=${home}`,
      `Environment=PATH=${path}`,
      ...hostTools,
      `Environment=ATLAS_SUPPLIER_SOCKET=${supplierSocket}`,
      `Environment=ATLAS_SUPPLIER_KEY_PATH=${supplierKey}`,
      `Environment=XDG_CONFIG_HOME=${data}/opencode-config`,
      `Environment=XDG_DATA_HOME=${data}/opencode-data`,
      `Environment=XDG_STATE_HOME=${data}/opencode-state`,
      `Environment=XDG_CACHE_HOME=${data}/opencode-cache`,
      `Environment=OPENCODE_SERVICE_FILE=${data}/opencode-state/opencode/service.json`,
      "Environment=GIT_CONFIG_NOSYSTEM=1",
      "Environment=GIT_CONFIG_GLOBAL=/dev/null",
      "Environment=GIT_TERMINAL_PROMPT=0",
      "Environment=GIT_ASKPASS=/bin/false",
      "Environment=SSH_ASKPASS=/bin/false",
      "Environment=GIT_SSH_COMMAND=/bin/false",
      "Environment=GH_PROMPT_DISABLED=1",
      // OpenCode's version is diagnostic only: it must run, any version is accepted.
      `ExecStartPre=/usr/bin/test -x ${openCode}`,
      `ExecStartPre=${openCode} --version`,
      `ExecStartPre=${current}/bin/git --version`,
      `ExecStartPre=/usr/bin/test -d ${data}/opencode-runtime`,
      `ExecStartPre=/usr/bin/test -f ${data}/opencode-config/opencode/opencode.json`,
      `ExecStart=${openCode} --log-level warn serve --service --hostname 127.0.0.1 --port ${openCodePort}`,
      ...common("opencode"),
      "UMask=0077",
      "LimitNOFILE=65536",
      "",
      "[Install]",
      "WantedBy=multi-user.target",
    ),
  };
};
