// Phase 3: building blocks in the locked Look A style. Throwaway.
import { cssA } from "./a.ts";
import { ic, page, stateIcon, stateLabel, warnings, type State } from "./shared.ts";

const css = `${cssA}
.tile-page{max-width:1120px;margin:0 auto;padding:40px 28px 140px}
.tile-page>h1{margin:0 0 6px;font-size:34px;font-weight:750;letter-spacing:-.028em}
.tile-page>p.how{margin:0 0 40px;color:var(--sec);font-size:16px}
.tile-page>p.how b{color:var(--text)}
.part-h{margin:56px 0 6px;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--sec)}
.q{margin:0 0 44px}
.q h2{margin:0 0 14px;font-size:19px;font-weight:650;letter-spacing:-.015em;display:flex;align-items:center;gap:10px}
.q .num{display:inline-grid;place-items:center;width:28px;height:28px;border-radius:50%;background:var(--btn);color:#fff;font-size:15px;flex-shrink:0}
.q .num.check{background:var(--f-succeeded)}
.switch,.phone-only{display:none}
.pair{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.opt{border-radius:18px;padding:18px;background:var(--bg);box-shadow:0 0 0 1px var(--sep);color:var(--text);min-width:0}
.opt .lab{display:flex;align-items:center;gap:8px;font-weight:700;margin-bottom:14px}
.opt .lab span{display:inline-grid;place-items:center;width:24px;height:24px;border-radius:7px;background:var(--fill);font-size:13px}
.opt .lab em{font-style:normal;font-weight:500;color:var(--sec);font-size:14px}
.solo{border-radius:18px;padding:18px;box-shadow:0 0 0 1px var(--sep)}
.stack{display:flex;flex-direction:column;gap:14px}
.wrap{display:flex;flex-wrap:wrap;gap:10px;align-items:center}
.cap-note{font-size:13px;color:var(--ter);margin:0 0 8px}
.btn.quiet{background:none;color:var(--link);padding:0 6px}
.btn.outline{background:none;color:var(--text);box-shadow:inset 0 0 0 1.5px var(--sep)}
.btn.danger{background:none;color:var(--t-failed)}
.chip{display:inline-flex;align-items:center;gap:6px;height:26px;padding:0 10px;border-radius:999px;font-size:13px;font-weight:650;white-space:nowrap}
.chip.p-running{background:color-mix(in srgb,var(--f-running) 16%,transparent);color:var(--t-running)}
.chip.p-waiting{background:color-mix(in srgb,var(--f-waiting) 18%,transparent);color:var(--t-waiting)}
.chip.p-succeeded{background:color-mix(in srgb,var(--f-succeeded) 16%,transparent);color:var(--t-succeeded)}
.chip.p-failed{background:color-mix(in srgb,var(--f-failed) 14%,transparent);color:var(--t-failed)}
.chip.p-idle,.chip.p-queued{background:var(--fill);color:var(--sec)}
.stale{display:inline-flex;align-items:center;gap:5px;font-size:12.5px;font-weight:600;color:var(--t-waiting)}
/* fields */
.field{display:flex;flex-direction:column;gap:6px}
.field label{font-size:14px;font-weight:600}
.field .hint{font-size:13px;color:var(--sec)}
.input{height:44px;border-radius:12px;padding:0 14px;font:inherit;color:var(--text);border:0;width:100%}
textarea.input{height:96px;padding:12px 14px;resize:none;line-height:1.45}
.filled .input{background:var(--fill)}
.outlined .input{background:var(--card);box-shadow:inset 0 0 0 1.5px var(--sep)}
.input::placeholder{color:var(--ter)}
/* target picker */
.choice{display:flex;gap:12px;align-items:flex-start;padding:14px 16px;border-radius:14px;background:var(--card);box-shadow:inset 0 0 0 1.5px var(--sep)}
.choice.on{box-shadow:inset 0 0 0 2px var(--btn);background:color-mix(in srgb,var(--btn) 7%,var(--card))}
.choice.off{opacity:.55}
.choice .radio{width:20px;height:20px;border-radius:50%;box-shadow:inset 0 0 0 1.5px var(--ter);flex-shrink:0;margin-top:2px}
.choice.on .radio{box-shadow:inset 0 0 0 6px var(--btn)}
.choice b{display:block;font-weight:600}
.choice span{font-size:13.5px;color:var(--sec)}
.setrow{display:flex;gap:12px;align-items:center;padding:12px 16px;position:relative;min-height:56px}
.setrow+.setrow::before{content:"";position:absolute;top:0;left:16px;right:0;border-top:1px solid var(--sep)}
.setrow .grow{flex:1;min-width:0}.setrow b{display:block;font-weight:500}.setrow span{font-size:13.5px;color:var(--sec)}
.setrow .tick{color:var(--btn)}
.setrow.off b{color:var(--ter)}
/* menus */
.menu{width:260px;background:var(--card);border-radius:14px;padding:6px;box-shadow:0 12px 40px rgb(0 0 0/.22),0 0 0 1px var(--sep)}
.menu a{display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:9px;font-size:15px}
.menu a:hover{background:var(--fill2)}
.menu hr{border:0;border-top:1px solid var(--sep);margin:4px 6px}
.menu .red{color:var(--t-failed)}
.sheet{background:var(--card);border-radius:22px 22px 0 0;padding:8px 14px 18px;box-shadow:0 -8px 40px rgb(0 0 0/.2);max-width:390px}
.sheet .grab{width:38px;height:5px;border-radius:3px;background:var(--fill);margin:0 auto 10px}
.sheet .sh-t{text-align:center;font-size:13px;color:var(--sec);padding:4px 0 10px}
.sheet .group{background:var(--fill2)}
.sheet .setrow{min-height:50px;justify-content:center;color:var(--link);font-size:16px}
.sheet .setrow.red{color:var(--t-failed)}
.sheet .cancel{margin-top:10px;font-weight:650}
.dim{background:rgb(0 0 0/.35);border-radius:16px;padding:60px 0 0;display:flex;justify-content:center;overflow:hidden}
/* warnings */
.strip{display:flex;align-items:center;gap:10px;padding:10px 14px;border-radius:12px;background:color-mix(in srgb,var(--f-waiting) 14%,transparent);color:var(--text);font-size:14px}
.strip .ic{color:var(--t-waiting)}
.strip a{margin-left:auto;color:var(--link);font-weight:600;white-space:nowrap}
.fakebar{display:flex;align-items:center;gap:10px;padding:10px 0 14px}
.fakebar b{font-size:16px;flex:1}
.panel-open{margin-top:8px;background:var(--card);border-radius:14px;padding:6px;box-shadow:0 12px 40px rgb(0 0 0/.18),0 0 0 1px var(--sep)}
.panel-open div{padding:10px 12px}.panel-open b{display:block;font-weight:600}.panel-open span{color:var(--sec);font-size:13.5px}
/* loading */
.sk{border-radius:8px;background:linear-gradient(90deg,var(--fill) 0%,var(--fill2) 50%,var(--fill) 100%);background-size:200% 100%;animation:skm 1.4s linear infinite}
@keyframes skm{to{background-position:-200% 0}}
.spin{width:28px;height:28px;border-radius:50%;border:3px solid var(--fill);border-top-color:var(--btn);animation:sp .8s linear infinite;margin:24px auto 8px}
@keyframes sp{to{transform:rotate(360deg)}}
/* live output */
.well{border-radius:14px;padding:14px 16px;font:13px/1.65 "Geist Mono",ui-monospace,monospace;overflow:auto}
.well.term{background:#0B0B0D;color:#D7D7DC;box-shadow:0 0 0 1px #2A2A2E}
.well.term .ok{color:#30D158}.well.term .dimt{color:#7C7C83}
.well.page{background:var(--card);color:var(--text)}
.well.page .ok{color:var(--t-succeeded)}.well.page .dimt{color:var(--ter)}
.cursor{display:inline-block;width:7px;height:14px;background:currentColor;vertical-align:-2px;animation:pulse 1s steps(2) infinite}
/* misc */
.empty{text-align:center;padding:28px 12px}
.empty .tile{margin:0 auto 12px;background:var(--fill);color:var(--sec)}
.empty b{display:block;font-size:17px;margin-bottom:4px}
.empty p{margin:0 auto 14px;color:var(--sec);max-width:320px}
.err{display:flex;gap:12px;padding:14px 16px;border-radius:14px;background:color-mix(in srgb,var(--f-failed) 10%,var(--card))}
.err .ic{color:var(--t-failed);margin-top:1px}.err b{display:block}.err span{color:var(--sec);font-size:14px}
.toast{display:inline-flex;align-items:center;gap:10px;padding:12px 16px;border-radius:14px;background:var(--text);color:var(--bg);font-weight:500;box-shadow:0 10px 30px rgb(0 0 0/.25)}
.toast .ic{color:var(--f-succeeded)}
.time-tip{position:relative;display:inline-block;border-bottom:1px dotted var(--ter);cursor:help}
.time-tip i{position:absolute;bottom:130%;left:50%;transform:translateX(-50%);white-space:nowrap;font-style:normal;font-size:12.5px;background:var(--text);color:var(--bg);padding:5px 9px;border-radius:8px}
.prose{background:var(--card);border-radius:14px;padding:18px 20px;line-height:1.6}
.prose h3{margin:0 0 6px;font-size:17px}.prose p{margin:0 0 12px}.prose ul{margin:0 0 12px;padding-left:20px}
.prose code{font:13px "Geist Mono",monospace;background:var(--fill);padding:2px 6px;border-radius:6px}
.tbl{width:100%;border-collapse:collapse;background:var(--card);border-radius:14px;overflow:hidden;font-size:14px}
.tbl th{text-align:left;font-size:12.5px;font-weight:600;color:var(--sec);padding:10px 16px;border-bottom:1px solid var(--sep)}
.tbl td{padding:12px 16px;border-top:1px solid var(--sep)}
.tbl tr:first-child td{border-top:0}
@media (max-width:760px){
  .tile-page{padding:20px 14px 120px}.tile-page>h1{font-size:30px}.tile-page>p.how{font-size:15px;margin-bottom:20px}
  .phone-only{display:inline}
  .q{margin-bottom:36px}.q h2{font-size:17px;align-items:flex-start}
  .switch{display:flex;margin:0 0 10px;padding:3px;border-radius:12px;background:var(--fill)}
  .switch label{flex:1;position:relative}
  .switch input{position:absolute;opacity:0;inset:0;margin:0}
  .switch span{display:block;text-align:center;padding:10px 6px;border-radius:9px;font-size:14px;font-weight:600;color:var(--sec)}
  .switch input:checked+span{background:var(--card);color:var(--text);box-shadow:0 1px 3px rgb(0 0 0/.18)}
  .switch input:focus-visible+span{outline:2px solid var(--link)}
  .pair{grid-template-columns:1fr}
  .q:has(.o1:checked) .opt:last-child,.q:has(.o2:checked) .opt:first-child{display:none}
  .opt,.solo{padding:14px 12px}.opt .lab{display:none}
  .tile-page~.proto{left:12px;right:12px;bottom:calc(12px + env(safe-area-inset-bottom));justify-content:space-between;font-size:14px}
  .tile-page~.proto button{padding:10px 14px}
  .menu{width:100%}
  .tbl .hide-sm{display:none}
}
`;

const states: State[] = ["waiting", "running", "queued", "idle", "succeeded", "failed"];

const listRow = (title: string, sub: string, s: State, end: string) => `
<a class="row" href="#"><span class="tile f-${s}">${ic(stateIcon[s], 18)}</span>
<span class="row-main"><span class="row-title">${title}</span><span class="row-sub">${sub}</span></span>${end}</a>`;

const sample: [string, string, State][] = [
  ["Retry failed webhooks with backoff", "payments-api · Running tests", "running"],
  ["Dark mode toggle in account settings", "web-dashboard · No activity for 40 minutes", "idle"],
  ["Expose settlement report CSV export", "payments-api · Tests failed", "failed"],
];

type Pick = { title: string; o1: [string, string]; o2: [string, string]; a: string; b: string };
const picks: Pick[] = [
  {
    title: "How a status shows at the end of a row",
    o1: ["Coloured text", "what you saw in A"],
    o2: ["Tinted pill", "a soft capsule"],
    a: `<div class="group">${sample.map(([t, s, st]) => listRow(t, s, st, `<span class="row-end"><span class="st t-${st}">${stateLabel[st]}</span><span class="time">12m ago</span></span>`)).join("")}</div>`,
    b: `<div class="group">${sample.map(([t, s, st]) => listRow(t, s, st, `<span class="row-end"><span class="chip p-${st}">${stateLabel[st]}</span><span class="time">12m ago</span></span>`)).join("")}</div>`,
  },
  {
    title: "Second-choice buttons",
    o1: ["Grey fill", "what you saw in A"],
    o2: ["Outline", "a thin border"],
    a: `<div class="wrap"><a class="btn">Start Session</a><a class="btn sec">View Spec</a><a class="btn sec">${ic("external", 16)}GitHub</a></div>`,
    b: `<div class="wrap"><a class="btn">Start Session</a><a class="btn outline">View Spec</a><a class="btn outline">${ic("external", 16)}GitHub</a></div>`,
  },
  {
    title: "Text boxes",
    o1: ["Grey fill", "like iPhone search"],
    o2: ["Outlined", "white box with a border"],
    a: `<div class="stack filled"><div class="field"><label>Prompt</label><textarea class="input" placeholder="Tell the Agent anything extra…"></textarea><span class="hint">Optional. Sent with the Spec.</span></div></div>`,
    b: `<div class="stack outlined"><div class="field"><label>Prompt</label><textarea class="input" placeholder="Tell the Agent anything extra…"></textarea><span class="hint">Optional. Sent with the Spec.</span></div></div>`,
  },
  {
    title: "Picking where a Session starts",
    o1: ["Cards", "each option is a box"],
    o2: ["Settings list", "like iPhone Settings, with a tick"],
    a: `<div class="stack">
      <div class="choice on"><span class="radio"></span><div><b>Default branch · main</b><span>Start fresh from the latest main.</span></div></div>
      <div class="choice"><span class="radio"></span><div><b>On top of PR #42</b><span>Build on an open pull request.</span></div></div>
      <div class="choice off"><span class="radio"></span><div><b>Stack #3</b><span>Can’t use: auto-merge is on for the top layer.</span></div></div>
    </div>`,
    b: `<div class="group">
      <div class="setrow"><div class="grow"><b>Default branch · main</b><span>Start fresh from the latest main.</span></div>${ic("check", 20, "tick")}</div>
      <div class="setrow"><div class="grow"><b>On top of PR #42</b><span>Build on an open pull request.</span></div></div>
      <div class="setrow off"><div class="grow"><b>Stack #3</b><span>Can’t use: auto-merge is on for the top layer.</span></div></div>
    </div>`,
  },
  {
    title: "The ⋯ menu on a phone",
    o1: ["Pop-up menu", "drops down from the button"],
    o2: ["Bottom sheet", "slides up, like iPhone"],
    a: `<div class="menu">
      <a href="#">${ic("external", 18)}Open Spec on GitHub</a>
      <a href="#">${ic("refresh", 18)}Check again now</a>
      <hr>
      <a href="#" class="red">${ic("x", 18)}Remove from Atlas…</a>
    </div>`,
    b: `<div class="dim"><div class="sheet">
      <div class="grab"></div><div class="sh-t">Retry failed webhooks with backoff</div>
      <div class="group"><div class="setrow">Open Spec on GitHub</div><div class="setrow">Check again now</div><div class="setrow red">Remove from Atlas…</div></div>
      <div class="group cancel"><div class="setrow">Cancel</div></div>
    </div></div>`,
  },
  {
    title: "System warnings (backup, storage)",
    o1: ["Pill in the top bar", "tap to see details"],
    o2: ["Thin strip", "under the top bar, always readable"],
    a: `<div class="fakebar"><b>Inbox</b><span class="pill warn">${ic("warn", 16)}2 warnings</span></div>
      <div class="panel-open">${warnings.map((w) => `<div><b>${w.title}</b><span>${w.body}</span></div>`).join("")}</div>`,
    b: `<div class="fakebar"><b>Inbox</b></div>
      <div class="strip">${ic("warn", 18)}<span>Backup and storage status unknown</span><a href="#">Details</a></div>`,
  },
  {
    title: "While something loads",
    o1: ["Grey placeholders", "shimmering shapes"],
    o2: ["Spinner", "a turning circle"],
    a: `<div class="group">${[0, 1, 2].map(() => `<div class="row"><span class="tile sk"></span><span class="row-main"><span class="sk" style="height:14px;width:70%"></span><span class="sk" style="height:11px;width:45%;margin-top:6px"></span></span></div>`).join("")}</div>`,
    b: `<div class="group" style="padding:12px 0 18px;text-align:center;color:var(--sec)"><div class="spin"></div>Loading Sessions…</div>`,
  },
  {
    title: "The Agent’s live output",
    o1: ["Terminal box", "always dark"],
    o2: ["Matches the page", "light in light mode"],
    a: `<div class="well term"><span class="dimt">$</span> bun test webhooks<br><span class="ok">✓</span> retry schedule doubles each attempt<br><span class="ok">✓</span> jitter stays within 20%<br><span class="dimt">running</span> gives up after 24 hours <span class="cursor"></span></div>`,
    b: `<div class="well page"><span class="dimt">$</span> bun test webhooks<br><span class="ok">✓</span> retry schedule doubles each attempt<br><span class="ok">✓</span> jitter stays within 20%<br><span class="dimt">running</span> gives up after 24 hours <span class="cursor"></span></div>`,
  },
];

const opt = (n: 1 | 2, [name, note]: [string, string], inner: string) =>
  `<div class="opt"><div class="lab"><span>${n}</span>${name} <em>${note}</em></div>${inner}</div>`;

const pickHtml = (p: Pick, i: number) => `<section class="q">
  <h2><span class="num">${i + 1}</span>${p.title}</h2>
  <div class="switch" role="radiogroup" aria-label="Choice ${i + 1}">
    <label><input class="o1" type="radio" name="q${i}" checked><span>1 · ${p.o1[0]}</span></label>
    <label><input class="o2" type="radio" name="q${i}"><span>2 · ${p.o2[0]}</span></label>
  </div>
  <div class="pair">${opt(1, p.o1, p.a)}${opt(2, p.o2, p.b)}</div>
</section>`;

type Check = { title: string; body: string };
const checks: Check[] = [
  {
    title: "Every status",
    body: `<div class="group">${states.map((s) => listRow(`${stateLabel[s]}`, s === "idle" ? "Idle doesn’t mean done; nothing has been confirmed" : s === "queued" ? "Waiting for a free slot" : "Example Session", s, `<span class="row-end"><span class="st t-${s}">${stateLabel[s]}</span></span>`)).join("")}
      ${listRow("Running, but Atlas lost touch", "Shown when the live connection drops. The real state may have changed.", "running", `<span class="row-end"><span class="st t-running">Running</span><span class="stale">${ic("warn", 13)}Not live</span></span>`)}
    </div>`,
  },
  {
    title: "Buttons, from loudest to quietest",
    body: `<div class="wrap"><a class="btn">Start Session</a><a class="btn sec">View Spec</a><a class="btn quiet">Show all</a><a class="btn danger">Remove…</a></div><p class="cap-note" style="margin-top:10px">Red actions live inside the ⋯ menu, never next to everyday buttons.</p>`,
  },
  {
    title: "Nothing here yet",
    body: `<div class="group"><div class="empty"><span class="tile lg">${ic("inbox", 26)}</span><b>No Specs yet</b><p>Label a GitHub issue <code>spec</code> in this Repository and it shows up here.</p><a class="btn sec">${ic("refresh", 16)}Check again</a></div></div>`,
  },
  {
    title: "Something went wrong",
    body: `<div class="err">${ic("warn", 20)}<div><b>Couldn’t reach GitHub</b><span>Showing what Atlas saw 5 minutes ago.</span></div></div>`,
  },
  {
    title: "Quick confirmation",
    body: `<div class="toast">${ic("check", 18)}Session queued</div>`,
  },
  {
    title: "Times",
    body: `<p style="margin:28px 0 0">Started <span class="time-tip">12 minutes ago<i>18 Nov 2026, 14:02 your time</i></span>. Tap or hover any time to see the exact moment.</p>`,
  },
  {
    title: "Spec text",
    body: `<div class="prose"><h3>Goal</h3><p>Webhook deliveries that fail are dropped after one attempt. Retry them with exponential backoff.</p><h3>Acceptance</h3><ul><li>Retries at 1s, 2s, 4s … capped at 5 minutes</li><li>Gives up after 24 hours</li></ul><p>Touches <code>src/webhooks/dispatch.ts</code>.</p></div>`,
  },
  {
    title: "Wide lists (desktop table)",
    body: `<table class="tbl"><thead><tr><th>Pull request</th><th>Status</th><th class="hide-sm">Branch</th><th>Updated</th></tr></thead><tbody>
      <tr><td>#43 Migrate ledger ids</td><td><span class="st t-succeeded" style="font-weight:600">Open</span></td><td class="hide-sm mono">atlas/spec-12</td><td>1h ago</td></tr>
      <tr><td>#42 Refund idempotency</td><td><span class="st t-waiting" style="font-weight:600">Draft</span></td><td class="hide-sm mono">atlas/spec-10</td><td>3h ago</td></tr>
    </tbody></table>`,
  },
];

const body = `<main class="tile-page">
  <h1>Building blocks</h1>
  <p class="how">Everything here uses your picks. <span class="phone-only">Tap <b>1</b> / <b>2</b> to flip.</span> Try <b>Light / Dark</b> in the bottom bar too.<br>
  Reply with <b>8 numbers</b> for part 1, and name anything in part 2 that looks wrong.</p>
  <div class="part-h">Part 1 · Pick one</div>
  ${picks.map(pickHtml).join("")}
  <div class="part-h">Part 2 · Just check, nothing to pick</div>
  ${checks.map((c, i) => `<section class="q"><h2><span class="num check">${String.fromCharCode(65 + i)}</span>${c.title}</h2><div class="solo">${c.body}</div></section>`).join("")}
</main>`;

export const parts = page({ look: { id: "a", name: "Building blocks" }, screen: "inbox", title: "Building blocks", fonts: ["Inter", "Geist Mono"], css, body });
