// Throwaway taste-round prototypes. Not part of the Atlas runtime.

const paths: Record<string, string> = {
  inbox: "M2.25 13.5h3.86a2.25 2.25 0 0 1 2.012 1.244l.256.512a2.25 2.25 0 0 0 2.013 1.244h3.218a2.25 2.25 0 0 0 2.013-1.244l.256-.512a2.25 2.25 0 0 1 2.013-1.244h3.859m-19.5.338V18a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18v-4.162c0-.224-.034-.447-.1-.661L19.24 5.338a2.25 2.25 0 0 0-2.15-1.588H6.911a2.25 2.25 0 0 0-2.15 1.588L2.35 13.177a2.25 2.25 0 0 0-.1.661Z",
  chevron: "m8.25 4.5 7.5 7.5-7.5 7.5",
  back: "M15.75 19.5 8.25 12l7.5-7.5",
  check: "m4.5 12.75 6 6 9-13.5",
  x: "M6 18 18 6M6 6l12 12",
  clock: "M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z",
  sun: "M12 3v2.25m6.364.386-1.591 1.591M21 12h-2.25m-.386 6.364-1.591-1.591M12 18.75V21m-4.773-4.227-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0Z",
  moon: "M21.752 15.002A9.72 9.72 0 0 1 18 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 0 0 3 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 0 0 9.002-5.998Z",
  warn: "M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z",
  folder: "M2.25 12.75V12A2.25 2.25 0 0 1 4.5 9.75h15A2.25 2.25 0 0 1 21.75 12v.75m-8.69-6.44-2.12-2.12a1.5 1.5 0 0 0-1.061-.44H4.5A2.25 2.25 0 0 0 2.25 6v12a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9a2.25 2.25 0 0 0-2.25-2.25h-5.379a1.5 1.5 0 0 1-1.06-.44Z",
  sliders: "M10.5 6h9.75M10.5 6a1.5 1.5 0 1 1-3 0m3 0a1.5 1.5 0 1 0-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m-9.75 0h9.75",
  more: "M6.75 12a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0ZM12.75 12a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0ZM18.75 12a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Z",
  pause: "M15.75 5.25v13.5m-7.5-13.5v13.5",
  question: "M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 5.25h.008v.008H12v-.008Z",
  pencil: "m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125",
  eye: "M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178ZM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z",
  branch: "M6 3v12m12-6a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm-12 12a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm12-12a9 9 0 0 1-9 9",
  pr: "M6 8.25a2.25 2.25 0 1 0 0-4.5 2.25 2.25 0 0 0 0 4.5Zm0 0v7.5m0 0a2.25 2.25 0 1 0 0 4.5 2.25 2.25 0 0 0 0-4.5Zm12 0a2.25 2.25 0 1 0 0 4.5 2.25 2.25 0 0 0 0-4.5Zm0 0V9a3 3 0 0 0-3-3h-3m0 0 2.25-2.25M12 6l2.25 2.25",
  search: "m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z",
  stack: "M6 6.878V6a2.25 2.25 0 0 1 2.25-2.25h7.5A2.25 2.25 0 0 1 18 6v.878m-12 0c.235-.083.487-.128.75-.128h10.5c.263 0 .515.045.75.128m-12 0A2.25 2.25 0 0 0 4.5 9v.878m13.5-3A2.25 2.25 0 0 1 19.5 9v.878m0 0a2.246 2.246 0 0 0-.75-.128H5.25c-.263 0-.515.045-.75.128m15 0A2.25 2.25 0 0 1 21 12v6a2.25 2.25 0 0 1-2.25 2.25H5.25A2.25 2.25 0 0 1 3 18v-6c0-.98.626-1.813 1.5-2.122",
  doc: "M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z",
  terminal: "m6.75 7.5 3 2.25-3 2.25m4.5 0h3m-9 8.25h13.5A2.25 2.25 0 0 0 21 18V6a2.25 2.25 0 0 0-2.25-2.25H5.25A2.25 2.25 0 0 0 3 6v12a2.25 2.25 0 0 0 2.25 2.25Z",
  external: "M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25",
  play: "M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 0 1 0 1.972l-11.54 6.347a1.125 1.125 0 0 1-1.667-.986V5.653Z",
  refresh: "M16.023 9.348h4.992V4.356m-1.291 15.17a9 9 0 1 1 1.33-9.035M3.528 4.474v4.992H8.52",
  sparkle: "M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 0 0-2.456 2.456Z",
  queue: "M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 0 1 0 3.75H5.625a1.875 1.875 0 0 1 0-3.75Z",
  plus: "M12 4.5v15m7.5-7.5h-15",
  list: "M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5",
};

export const ic = (name: keyof typeof paths | string, size = 20, cls = "") =>
  `<svg class="ic ${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name]}"/></svg>`;

/** Atlas mark: a globe with one meridian and one parallel, on exact brand navy. */
export const logo = (size = 28, radius = 7) =>
  `<svg class="logo" width="${size}" height="${size}" viewBox="0 0 32 32" aria-hidden="true">
    <rect width="32" height="32" rx="${radius}" fill="#012B68"/>
    <rect x=".5" y=".5" width="31" height="31" rx="${radius - 0.5}" fill="none" stroke="#ffffff" stroke-opacity=".14"/>
    <g fill="none" stroke="#EEF2F9" stroke-width="1.8" stroke-linecap="round">
      <circle cx="16" cy="16" r="9"/>
      <ellipse cx="16" cy="16" rx="4" ry="9"/>
      <path d="M7.4 13h17.2M7.4 19h17.2" stroke-opacity=".7"/>
    </g>
    <circle cx="23.5" cy="8.5" r="2.6" fill="#E19D63"/>
  </svg>`;

export type State = "waiting" | "running" | "queued" | "idle" | "succeeded" | "failed" | "none";

export const stateLabel: Record<State, string> = {
  waiting: "Waiting",
  running: "Running",
  queued: "Queued",
  idle: "Idle",
  succeeded: "Succeeded",
  failed: "Failed",
  none: "No Session",
};

export const stateIcon: Record<State, string> = {
  waiting: "question",
  running: "sparkle",
  queued: "queue",
  idle: "pause",
  succeeded: "check",
  failed: "x",
  none: "doc",
};

export type Row = { title: string; spec: number; repo: string; state: State; when: string; note: string; unread?: boolean };

export const inbox = {
  needs: [
    { title: "Add idempotency keys to refund endpoint", spec: 10, repo: "payments-api", state: "waiting", when: "4m", note: "The Agent asked a question in OpenCode" },
  ] as Row[],
  progress: [
    { title: "Retry failed webhooks with exponential backoff", spec: 11, repo: "payments-api", state: "running", when: "12m", note: "Running tests" },
    { title: "Paginate invoices list", spec: 11, repo: "web-dashboard", state: "queued", when: "3m", note: "Waiting for a free slot" },
    { title: "Dark mode toggle in account settings", spec: 10, repo: "web-dashboard", state: "idle", when: "40m", note: "No activity for 40 minutes" },
  ] as Row[],
  notStarted: [
    { title: "Remove legacy v1 charge route", spec: 15, repo: "payments-api", state: "none", when: "2d", note: "Updated 2 days ago" },
    { title: "Rate limit card tokenization", spec: 14, repo: "payments-api", state: "none", when: "4d", note: "Updated 4 days ago" },
    { title: "Keyboard shortcuts for search", spec: 13, repo: "web-dashboard", state: "none", when: "5d", note: "Updated 5 days ago" },
  ] as Row[],
  settled: [
    { title: "Migrate ledger table to bigint ids", spec: 12, repo: "payments-api", state: "succeeded", when: "1h", note: "Pull request #43 opened", unread: true },
    { title: "Expose settlement report CSV export", spec: 13, repo: "payments-api", state: "failed", when: "3h", note: "Tests failed", unread: true },
    { title: "Show failed payment banner", spec: 12, repo: "web-dashboard", state: "succeeded", when: "1d", note: "Pull request #18 opened" },
  ] as Row[],
};

export const warnings = [
  { title: "Backup status unknown", body: "No current local recovery status is available." },
  { title: "Storage check unknown", body: "New Sessions stay queued until a storage check succeeds." },
];

export const session = {
  title: "Retry failed webhooks with exponential backoff",
  spec: 11,
  repo: "payments-api",
  fullRepo: "Acme/payments-api",
  state: "running" as State,
  started: "12 min ago",
  branch: "atlas/spec-11-retry-webhooks",
  base: "main",
  prompt: "Implement the Spec. Keep the diff small and add tests.",
  specBody: {
    goal: "Webhook deliveries that fail are dropped after one attempt. Retry them with exponential backoff so customers stop missing events.",
    acceptance: ["Failed deliveries retry at 1s, 2s, 4s … capped at 5 minutes", "Jitter prevents retry storms", "Gives up after 24 hours and marks the delivery failed", "Tests cover backoff and give-up"],
  },
  activity: [
    { kind: "msg", t: "10:02", text: "I'll start by reading the webhook dispatcher to see how failures are handled today." },
    { kind: "tool", t: "10:02", icon: "eye", verb: "Read", target: "src/webhooks/dispatch.ts" },
    { kind: "tool", t: "10:03", icon: "search", verb: "Searched", target: "deliverWebhook", extra: "6 matches" },
    { kind: "msg", t: "10:05", text: "Failures are dropped after one attempt. I'll add a retry queue with exponential backoff and jitter, capped at 5 minutes, giving up after 24 hours." },
    { kind: "tool", t: "10:07", icon: "pencil", verb: "Created", target: "src/webhooks/retry.ts", extra: "+84" },
    { kind: "tool", t: "10:09", icon: "pencil", verb: "Edited", target: "src/webhooks/dispatch.ts", extra: "+12 −3" },
    { kind: "tool", t: "10:11", icon: "pencil", verb: "Created", target: "src/webhooks/retry.test.ts", extra: "+61" },
    { kind: "live", t: "10:12", icon: "terminal", verb: "Running", target: "bun test webhooks" },
  ],
  technical: [
    ["Session ID", "ses_00000001-1111-4111-8111-111111111111", true],
    ["Starting target", "Default branch · main", false],
    ["Execution slot", "Held", false],
    ["Stack reservation", "None for default-branch work", false],
    ["Preparation", "Prepared", false],
    ["OpenCode handoff", "Prompt accepted", false],
    ["OpenCode session", "oc_7f3a9c2e", true],
    ["Last reconciled", "8 seconds ago", false],
  ] as [string, string, boolean][],
};

const fontFile: Record<string, string> = {
  Inter: "inter",
  Geist: "geist",
  "Geist Mono": "geist-mono",
  Figtree: "figtree",
};

export type Look = { id: "a" | "b" | "c"; name: string };

export const page = (opts: { look: Look; screen: "inbox" | "session"; title: string; fonts: string[]; css: string; body: string }) => {
  const faces = opts.fonts
    .map((f) => `@font-face{font-family:"${f}";src:url("../fonts/${fontFile[f]}.woff2") format("woff2");font-weight:100 900;font-display:swap}`)
    .join("");
  const other = opts.screen === "inbox" ? "session" : "inbox";
  return `<!doctype html>
<html lang="en" data-mode="dark">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${opts.title} — Look ${opts.look.id.toUpperCase()}</title>
<script>(()=>{const q=new URLSearchParams(location.search).get("mode");const s=q||localStorage.getItem("proto-mode");document.documentElement.dataset.mode=s||(matchMedia("(prefers-color-scheme: light)").matches?"light":"dark")})()</script>
<style>${faces}
*,*::before,*::after{box-sizing:border-box}
html,body{margin:0}
a{color:inherit;text-decoration:none}
button{font:inherit;color:inherit;background:none;border:0;padding:0;cursor:pointer}
.ic{flex-shrink:0;display:block}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
.proto{position:fixed;right:16px;bottom:16px;z-index:99;display:flex;gap:4px;align-items:center;padding:4px;border-radius:999px;background:#0b0c0e;color:#e8e8ea;font:500 12px/1 Inter,system-ui,sans-serif;box-shadow:0 6px 24px rgb(0 0 0/.35);border:1px solid #2a2b30}
.proto a,.proto button{padding:7px 10px;border-radius:999px;display:flex;align-items:center;gap:6px}
.proto a:hover,.proto button:hover{background:#24262b}
.proto .tag{padding:7px 10px;color:#E19D63;font-weight:600}
@media (max-width:760px){.proto{bottom:96px;right:8px}.proto .hide-sm{display:none}}
@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
${opts.css}
</style>
</head>
<body>
${opts.body}
<nav class="proto" aria-label="Prototype controls">
  <span class="tag">Look ${opts.look.id.toUpperCase()} · ${opts.look.name}</span>
  <a class="hide-sm" href="${opts.look.id}-${other}.html">Show ${other === "inbox" ? "Inbox" : "Session"}</a>
  <button type="button" onclick="const m=document.documentElement.dataset.mode==='dark'?'light':'dark';document.documentElement.dataset.mode=m;localStorage.setItem('proto-mode',m)">${ic("sun", 14)}<span>Light / Dark</span></button>
  <a href="index.html">All looks</a>
</nav>
</body>
</html>`;
};
