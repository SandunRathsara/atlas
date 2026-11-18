import { ic, inbox, logo, page, session, stateLabel, warnings, type Row, type State } from "./shared.ts";

const look = { id: "c", name: "Warm" } as const;

const css = `
[data-mode=light]{color-scheme:light;--bg:#FAF9F5;--side:#F1EEE6;--card:#FFFFFF;--line:#E6E1D5;--hover:#F4F1EA;--text:#2A2925;--sec:#6B675D;--faint:#948F84;
  --btn:#012B68;--btnt:#fff;--tint:#1B4C9C;--accent:#B8682C;--accent-bg:#FBEBDC;--bubble:#F0ECE2;
  --p-running:#E1EDF7;--c-running:#1F6390;--p-waiting:#FBE9D4;--c-waiting:#9A5309;--p-succeeded:#E3F0E1;--c-succeeded:#2F6B37;--p-failed:#F8E0DD;--c-failed:#A63B32;--p-idle:#EFECE5;--c-idle:#6B675D;--p-queued:#EFECE5;--c-queued:#6B675D;--p-none:#EFECE5;--c-none:#6B675D}
[data-mode=dark]{color-scheme:dark;--bg:#262624;--side:#1E1E1C;--card:#30302D;--line:#3E3D39;--hover:#2C2C29;--text:#F2EFE8;--sec:#ADA99F;--faint:#7F7B72;
  --btn:#3A66B0;--btnt:#fff;--tint:#93B5EE;--accent:#E19D63;--accent-bg:rgb(225 157 99/.13);--bubble:#383835;
  --p-running:rgb(91 168 230/.16);--c-running:#8CC6F0;--p-waiting:rgb(225 157 99/.18);--c-waiting:#F0B07A;--p-succeeded:rgb(110 190 125/.16);--c-succeeded:#93CF9C;--p-failed:rgb(240 120 110/.16);--c-failed:#F0948C;--p-idle:rgb(255 255 255/.07);--c-idle:#ADA99F;--p-queued:rgb(255 255 255/.07);--c-queued:#ADA99F;--p-none:rgb(255 255 255/.07);--c-none:#ADA99F}
body{background:var(--bg);color:var(--text);font:400 15.5px/1.55 Figtree,system-ui,sans-serif;-webkit-font-smoothing:antialiased}
.mono{font-family:"Geist Mono",ui-monospace,monospace;font-size:.86em}
.app{display:grid;grid-template-columns:268px minmax(0,1fr);min-height:100vh;background:linear-gradient(to right,var(--side) 268px,transparent 268px)}
.side{position:sticky;top:0;height:100vh;display:flex;flex-direction:column;gap:4px;padding:16px 12px}
.brand{display:flex;align-items:center;gap:10px;padding:4px 8px 16px;font-size:18px;font-weight:650;letter-spacing:-.01em}
.nav a{display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:10px;color:var(--text);font-weight:500;font-size:15px}
.nav a .ic{color:var(--sec)}
.nav a:hover{background:var(--hover)}
.nav a[aria-current]{background:var(--card);box-shadow:0 1px 2px rgb(0 0 0/.06),0 0 0 1px var(--line)}
.nav .n{margin-left:auto;font-size:13px;color:var(--faint)}
.recents{margin-top:18px}
.recents .h{font-size:12.5px;color:var(--faint);font-weight:600;padding:0 10px 6px}
.recents a{display:flex;align-items:center;gap:8px;padding:6px 10px;border-radius:8px;font-size:14px;color:var(--sec)}
.recents a span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.recents a:hover{background:var(--hover);color:var(--text)}
.recents i{width:7px;height:7px;border-radius:50%;flex-shrink:0}
.who{margin-top:auto;display:flex;align-items:center;gap:10px;padding:10px;border-top:1px solid var(--line);font-size:14px}
.who .av{width:30px;height:30px;border-radius:50%;background:var(--accent-bg);color:var(--accent);display:grid;place-items:center;font-weight:700;font-size:13px}
.who .sub{color:var(--faint);font-size:12.5px}
.topbar{display:none}
.col{max-width:780px;margin:0 auto;padding:56px 32px 140px}
.hello{display:flex;align-items:center;gap:14px;font-size:34px;font-weight:600;letter-spacing:-.02em;margin:0}
.hello .ic{color:var(--accent)}
.sum{color:var(--sec);font-size:17px;margin:8px 0 6px}
.note{display:inline-flex;align-items:center;gap:8px;color:var(--accent);font-size:14px;font-weight:500;margin-bottom:28px}
.note u{text-underline-offset:3px}
.card{background:var(--card);border-radius:16px;box-shadow:0 1px 2px rgb(0 0 0/.04),0 0 0 1px var(--line)}
.need{padding:20px 22px;display:flex;flex-direction:column;gap:6px;border-left:4px solid var(--accent)}
.need .t{font-size:19px;font-weight:650;letter-spacing:-.01em}
.need .s{color:var(--sec);font-size:14.5px}
.need .acts{display:flex;gap:10px;margin-top:10px;align-items:center}
.btn{height:38px;padding:0 16px;border-radius:10px;background:var(--btn);color:var(--btnt);font-weight:600;font-size:14.5px;display:inline-flex;align-items:center;gap:8px}
.btn.soft{background:transparent;color:var(--text);box-shadow:inset 0 0 0 1px var(--line)}
.btn.soft:hover{background:var(--hover)}
h2{font-size:15px;font-weight:650;color:var(--sec);margin:36px 0 12px;display:flex;gap:8px;align-items:baseline}
h2 .x{color:var(--accent);font-weight:600;font-size:13.5px}
.r{display:flex;gap:14px;align-items:center;padding:14px 18px}
.r+.r{border-top:1px solid var(--line)}
a.r:hover{background:var(--hover)}
.card>.r:first-child{border-radius:16px 16px 0 0}.card>.r:last-child{border-radius:0 0 16px 16px}
.r .m{flex:1;min-width:0}
.r .t{font-weight:600;font-size:15.5px}
.r .s{color:var(--sec);font-size:13.5px}
.r .w{color:var(--faint);font-size:13px;white-space:nowrap}
.pill{display:inline-flex;align-items:center;gap:6px;height:26px;padding:0 10px;border-radius:999px;font-size:13px;font-weight:600;white-space:nowrap}
.pill i{width:6px;height:6px;border-radius:50%;background:currentColor}
.p-running{background:var(--p-running);color:var(--c-running)}.p-waiting{background:var(--p-waiting);color:var(--c-waiting)}.p-succeeded{background:var(--p-succeeded);color:var(--c-succeeded)}.p-failed{background:var(--p-failed);color:var(--c-failed)}.p-idle{background:var(--p-idle);color:var(--c-idle)}.p-queued{background:var(--p-queued);color:var(--c-queued)}.p-none{background:var(--p-none);color:var(--c-none)}
.new{width:8px;height:8px;border-radius:50%;background:var(--accent);flex-shrink:0}.new.off{background:none}.card:not(:has(.new:not(.off))) .new.off{display:none}
.start{color:var(--tint);font-weight:600;font-size:14px;display:inline-flex;gap:6px;align-items:center}
/* session */
.crumb{display:inline-flex;align-items:center;gap:4px;color:var(--sec);font-size:14px;margin-bottom:20px}
h1{font-size:30px;line-height:1.2;font-weight:650;letter-spacing:-.02em;margin:10px 0 8px}
.meta{color:var(--sec);font-size:14.5px;display:flex;flex-wrap:wrap;gap:6px 14px}
.meta span{display:inline-flex;gap:6px;align-items:center}
details.info{margin:22px 0 34px}
details.info summary{list-style:none;cursor:pointer;padding:14px 18px;display:flex;align-items:center;gap:10px;font-weight:600;font-size:14.5px}
details.info summary::-webkit-details-marker{display:none}
details.info summary .chev{margin-left:auto;color:var(--faint)}
details.info[open] summary .chev{transform:rotate(90deg)}
.kv{display:grid;grid-template-columns:160px minmax(0,1fr);gap:8px 16px;padding:4px 18px 18px;font-size:14px}
.kv .l{color:var(--faint)}
.kv .v{overflow-wrap:anywhere}
.kv hr{grid-column:1/-1;border:0;border-top:1px solid var(--line);margin:6px 0}
.you{display:flex;flex-direction:column;align-items:flex-end;gap:6px;margin-bottom:28px}
.you .who2{font-size:13px;color:var(--faint)}
.bubble{background:var(--bubble);border-radius:18px 18px 4px 18px;padding:12px 16px;max-width:85%}
.spec-ref{font-size:13.5px;color:var(--sec);display:inline-flex;gap:6px;align-items:center}
.agent{display:grid;grid-template-columns:32px minmax(0,1fr);gap:14px;margin-bottom:22px}
.agent .av{width:32px;height:32px;border-radius:50%;display:grid;place-items:center;background:var(--accent-bg);color:var(--accent)}
.agent p{margin:4px 0 12px;font-size:16px;line-height:1.65}
.chips{display:flex;flex-direction:column;gap:8px;margin-bottom:6px}
details.chip{border-radius:12px;box-shadow:0 0 0 1px var(--line);background:var(--card);width:fit-content;max-width:100%}
details.chip summary{list-style:none;cursor:pointer;padding:8px 14px;display:flex;align-items:center;gap:8px;font-size:14px;color:var(--sec);font-weight:500}
details.chip summary::-webkit-details-marker{display:none}
details.chip summary .add{color:var(--c-succeeded)}
details.chip .files{padding:0 14px 10px 36px;font-size:13.5px;color:var(--sec);display:flex;flex-direction:column;gap:4px}
.working{margin-top:10px;display:flex;align-items:center;gap:10px;color:var(--sec);font-size:15px}
.shimmer{background:linear-gradient(90deg,var(--sec) 0%,var(--text) 50%,var(--sec) 100%);background-size:200% 100%;-webkit-background-clip:text;background-clip:text;color:transparent;animation:sh 2s linear infinite;font-weight:500}
@keyframes sh{to{background-position:-200% 0}}
.dock{position:fixed;bottom:0;left:268px;right:0;padding:16px 32px 24px;background:linear-gradient(transparent,var(--bg) 40%)}
.dock div{max-width:716px;margin:0 auto;border-radius:16px;padding:14px 18px;display:flex;align-items:center;gap:10px;color:var(--sec);font-size:14px;background:var(--card);box-shadow:0 0 0 1px var(--line),0 8px 30px rgb(0 0 0/.08)}
.dock a{margin-left:auto;color:var(--tint);font-weight:600;white-space:nowrap}
@media (max-width:820px){
  .app{grid-template-columns:1fr;background:none}
  .side{display:none}
  .topbar{display:flex;align-items:center;gap:10px;height:56px;padding:0 16px;position:sticky;top:0;background:color-mix(in srgb,var(--bg) 88%,transparent);backdrop-filter:blur(12px);z-index:4;font-weight:650;font-size:17px}
  .topbar .sp{flex:1}
  .topbar .ic{color:var(--sec)}
  .col{padding:20px 18px 160px}
  .hello{font-size:28px}
  .r{padding:14px}
  .r .w{display:none}
  .kv{grid-template-columns:1fr;gap:0}.kv .v{margin-bottom:8px}
  .dock{left:0;padding:12px 12px 18px}
  .need .acts .soft{display:none}
}
`;

const pill = (s: State) => `<span class="pill p-${s}"><i></i>${stateLabel[s]}</span>`;
const dotColor: Record<State, string> = { running: "var(--c-running)", waiting: "var(--c-waiting)", queued: "var(--c-idle)", idle: "var(--c-idle)", succeeded: "var(--c-succeeded)", failed: "var(--c-failed)", none: "var(--c-idle)" };

const shell = (current: "inbox" | "sessions", inner: string, extra = "") => `
<div class="app">
  <aside class="side" aria-label="Navigation">
    <div class="brand">${logo(30, 9)}Atlas</div>
    <nav class="nav" aria-label="Main">
      <a href="c-inbox.html" ${current === "inbox" ? 'aria-current="page"' : ""}>${ic("inbox", 20)}Inbox<span class="n">7</span></a>
      <a href="c-session.html" ${current === "sessions" ? 'aria-current="page"' : ""}>${ic("sparkle", 20)}Sessions</a>
      <a href="#">${ic("pr", 20)}Pull requests</a>
      <a href="#">${ic("folder", 20)}Repositories</a>
      <a href="#">${ic("refresh", 20)}Updates</a>
    </nav>
    <div class="recents">
      <div class="h">Recent Sessions</div>
      ${[...inbox.needs, ...inbox.progress, ...inbox.settled.slice(0, 2)].map((r) => `<a href="c-session.html"><i style="background:${dotColor[r.state]}"></i><span>${r.title}</span></a>`).join("")}
    </div>
    <div class="who"><span class="av">A</span><div>Acme team<div class="sub">Signed in · Sign out</div></div></div>
  </aside>
  <main id="main">
    <div class="topbar">${ic("list", 22)}${logo(26, 8)}Atlas<span class="sp"></span>${ic("warn", 20)}</div>
    ${inner}
  </main>
  ${extra}
</div>`;

const row = (r: Row, end: string) => `
<a class="r" href="c-session.html">
  ${r.unread ? '<span class="new" title="New"></span>' : '<span class="new off"></span>'}
  <div class="m"><div class="t">${r.title}</div><div class="s">${r.repo} · Spec #${r.spec} · ${r.note}</div></div>
  ${end}
</a>`;

const inboxBody = shell(
  "inbox",
  `<div class="col">
  <h1 class="hello">${ic("sparkle", 30)}Good afternoon</h1>
  <p class="sum">One Session needs you. Two are working, and three Specs haven't started.</p>
  <div class="note">${ic("warn", 16)}<span>2 system notices · <u>View</u></span></div>

  <div class="card need">
    <div>${pill("waiting")} <span style="color:var(--faint);font-size:13px;margin-left:6px">4 minutes ago</span></div>
    <div class="t">${inbox.needs[0]!.title}</div>
    <div class="s">The Agent asked a question in OpenCode. payments-api · Spec #10</div>
    <div class="acts"><a class="btn" href="c-session.html">Open Session</a><a class="btn soft" href="#">View Spec</a></div>
  </div>

  <h2>In progress</h2>
  <div class="card">${inbox.progress.map((r) => row(r, `${pill(r.state)}<span class="w">${r.when}</span>`)).join("")}</div>

  <h2>Ready to start</h2>
  <div class="card">${inbox.notStarted.map((r) => row(r, `<span class="start">${ic("play", 14)}Start Session</span>`)).join("")}</div>

  <h2>Settled <span class="x">2 new</span></h2>
  <div class="card">${inbox.settled.map((r) => row(r, `${pill(r.state)}<span class="w">${r.when}</span>`)).join("")}</div>
</div>`,
);

const s = session;
const msgs = s.activity.filter((a) => a.kind === "msg");
const sessionBody = shell(
  "sessions",
  `<div class="col">
  <a class="crumb" href="c-inbox.html">${ic("back", 16)}Inbox</a>
  <div>${pill("running")} <span style="color:var(--faint);font-size:13.5px;margin-left:6px">for 12 minutes</span></div>
  <h1>${s.title}</h1>
  <div class="meta"><span>${ic("folder", 16)}${s.fullRepo}</span><span>${ic("doc", 16)}Spec #${s.spec}</span><span>${ic("branch", 16)}<span class="mono">${s.branch}</span></span></div>

  <details class="card info">
    <summary>${ic("sliders", 18)}Session details${ic("chevron", 16, "chev")}</summary>
    <div class="kv">
      <span class="l">Based on</span><span class="v">Default branch · <span class="mono">${s.base}</span></span>
      <span class="l">Pull request</span><span class="v">Not opened yet</span>
      <hr>
      ${s.technical.map(([l, v, m]) => `<span class="l">${l}</span><span class="v ${m ? "mono" : ""}">${v}</span>`).join("")}
    </div>
  </details>

  <div class="you">
    <span class="who2">Your prompt</span>
    <div class="bubble">${s.prompt}</div>
    <span class="spec-ref">${ic("doc", 14)}With Spec #11 attached</span>
  </div>

  <div class="agent"><span class="av">${ic("sparkle", 18)}</span><div>
    <p>${msgs[0]!.text}</p>
    <div class="chips">
      <details class="chip"><summary>${ic("eye", 16)}Read 1 file, searched the code${ic("chevron", 14)}</summary><div class="files"><span class="mono">src/webhooks/dispatch.ts</span><span>“deliverWebhook” · 6 matches</span></div></details>
    </div>
  </div></div>

  <div class="agent"><span class="av">${ic("sparkle", 18)}</span><div>
    <p>${msgs[1]!.text}</p>
    <div class="chips">
      <details class="chip" open><summary>${ic("pencil", 16)}Changed 3 files <span class="add">+157</span> <span style="color:var(--c-failed)">−3</span>${ic("chevron", 14)}</summary><div class="files"><span class="mono">src/webhooks/retry.ts</span><span class="mono">src/webhooks/dispatch.ts</span><span class="mono">src/webhooks/retry.test.ts</span></div></details>
    </div>
    <div class="working">${ic("terminal", 18)}<span class="shimmer">Running tests…</span></div>
  </div></div>
</div>`,
  `<div class="dock"><div>${ic("eye", 18)}Atlas is watching this Session. Atlas can’t reply; answer the Agent in OpenCode.</div></div>`,
);

export const lookC = {
  inbox: page({ look, screen: "inbox", title: "Inbox", fonts: ["Figtree", "Geist Mono"], css, body: inboxBody }),
  session: page({ look, screen: "session", title: s.title, fonts: ["Figtree", "Geist Mono"], css, body: sessionBody }),
};
