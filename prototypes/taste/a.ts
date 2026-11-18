import { ic, inbox, logo, page, session, stateIcon, stateLabel, warnings, type Row } from "./shared.ts";

const look = { id: "a", name: "Health" } as const;

export const cssA = `
[data-mode=light]{color-scheme:light;--bg:#F2F2F7;--card:#FFFFFF;--side:#E9E9EE;--bar:rgb(242 242 247/.78);--text:#0B0B0D;--sec:#6C6C70;--ter:#8A8A8E;--sep:#E2E2E7;--fill:#E6E6EB;--fill2:#F2F2F7;
  --tint:#012B68;--link:#1450B8;--btn:#0A63D8;--btnt:#fff;--sel:#D9E3F4;--mono:#3C3C43;
  --t-running:#0B7FB0;--t-waiting:#C25E00;--t-succeeded:#248A3D;--t-failed:#D70015;--t-idle:#6C6C70;--t-queued:#6C6C70;--t-none:#6C6C70;
  --f-running:#32ADE6;--f-waiting:#FF9500;--f-succeeded:#34C759;--f-failed:#FF3B30;--f-idle:#8E8E93;--f-queued:#AEAEB2;--f-none:#012B68;--hero:linear-gradient(180deg,#FFF4E5,#FFFFFF 70%)}
[data-mode=dark]{color-scheme:dark;--bg:#000000;--card:#1C1C1E;--side:#121214;--bar:rgb(0 0 0/.72);--text:#FFFFFF;--sec:#98989F;--ter:#6E6E73;--sep:#2E2E31;--fill:#2C2C2E;--fill2:#242426;
  --tint:#7AA7F2;--link:#7AA7F2;--btn:#0A6CF0;--btnt:#fff;--sel:#1C2A44;--mono:#D1D1D6;
  --t-running:#64D2FF;--t-waiting:#FF9F0A;--t-succeeded:#30D158;--t-failed:#FF6961;--t-idle:#98989F;--t-queued:#98989F;--t-none:#98989F;
  --f-running:#0A9BD6;--f-waiting:#FF9F0A;--f-succeeded:#2DB84E;--f-failed:#FF453A;--f-idle:#636366;--f-queued:#48484A;--f-none:#2D63C0;--hero:linear-gradient(180deg,#2A1D0B,#1C1C1E 70%)}
body{background:var(--bg);color:var(--text);font:400 15px/1.45 Inter,system-ui,sans-serif;letter-spacing:-.006em;-webkit-font-smoothing:antialiased}
.mono{font-family:"Geist Mono",ui-monospace,monospace;font-size:.88em;letter-spacing:0;color:var(--mono)}
.app{display:flex;min-height:100vh;background:linear-gradient(to right,var(--side) 256px,transparent 256px)}
.side{width:256px;flex-shrink:0;background:var(--side);padding:14px 12px;position:sticky;top:0;height:100vh;display:flex;flex-direction:column;gap:18px;border-right:1px solid var(--sep)}
.brand{display:flex;align-items:center;gap:10px;padding:4px 6px;font-weight:700;font-size:17px;letter-spacing:-.02em}
.search{display:flex;align-items:center;gap:8px;background:var(--fill);border-radius:10px;padding:8px 10px;color:var(--sec);font-size:14px}
.search kbd{margin-left:auto;font:500 11px Inter;color:var(--ter)}
.nav{display:flex;flex-direction:column;gap:2px}
.nav-h{font-size:12px;font-weight:600;color:var(--ter);padding:0 10px 6px}
.nav a{display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:9px;font-size:14px;font-weight:500}
.nav a .ic{color:var(--tint)}
.nav a:hover{background:var(--fill)}
.nav a[aria-current]{background:var(--sel)}
.nav .count{margin-left:auto;font-size:13px;color:var(--sec);font-variant-numeric:tabular-nums}
.nav .dot{width:10px;height:10px;border-radius:50%;margin:0 4px}
.side-foot{margin-top:auto;font-size:12px;color:var(--ter);padding:0 10px}
.main{flex:1;min-width:0}
.bar{position:sticky;top:0;z-index:5;height:56px;display:flex;align-items:center;gap:10px;padding:0 32px;background:var(--bar);backdrop-filter:blur(20px) saturate(1.8);-webkit-backdrop-filter:blur(20px) saturate(1.8)}
.bar .phone-brand{display:none}
.bar .spacer{flex:1}
.pill{display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 12px;border-radius:999px;background:var(--card);font-size:13px;font-weight:500;box-shadow:0 0 0 1px var(--sep)}
.pill.warn{color:var(--t-waiting)}
details.pop{position:relative}
details.pop summary{list-style:none;cursor:pointer}
details.pop summary::-webkit-details-marker{display:none}
.pop-panel{position:absolute;right:0;top:40px;width:320px;background:var(--card);border-radius:14px;padding:6px;box-shadow:0 12px 40px rgb(0 0 0/.25),0 0 0 1px var(--sep)}
.pop-panel div{padding:10px 12px}
.pop-panel b{display:block;font-weight:600}
.pop-panel span{color:var(--sec);font-size:13px}
.content{max-width:1040px;padding:8px 40px 120px}
.eyebrow{margin:8px 0 2px;font-size:13px;font-weight:600;color:var(--sec);text-transform:uppercase;letter-spacing:.02em}
h1.large{margin:0 0 28px;font-size:34px;line-height:1.1;font-weight:750;letter-spacing:-.028em}
h2{display:flex;align-items:baseline;gap:8px;margin:32px 0 10px;font-size:21px;font-weight:700;letter-spacing:-.02em}
h2 .n{font-size:15px;font-weight:500;color:var(--sec)}
h2 .more{margin-left:auto;font-size:15px;font-weight:500;color:var(--link)}
.group{background:var(--card);border-radius:14px;overflow:hidden}
.row{display:flex;align-items:center;gap:14px;padding:12px 16px;position:relative;min-height:64px}
.row+.row::before{content:"";position:absolute;top:0;left:62px;right:0;border-top:1px solid var(--sep)}
a.row:hover{background:var(--fill2)}
.tile{width:32px;height:32px;border-radius:9px;display:grid;place-items:center;color:#fff}
.tile.lg{width:52px;height:52px;border-radius:14px}
.f-running{background:var(--f-running)}.f-waiting{background:var(--f-waiting)}.f-succeeded{background:var(--f-succeeded)}.f-failed{background:var(--f-failed)}.f-idle{background:var(--f-idle)}.f-queued{background:var(--f-queued)}.f-none{background:var(--f-none)}
.t-running{color:var(--t-running)}.t-waiting{color:var(--t-waiting)}.t-succeeded{color:var(--t-succeeded)}.t-failed{color:var(--t-failed)}.t-idle{color:var(--t-idle)}.t-queued{color:var(--t-queued)}.t-none{color:var(--t-none)}
.row-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.row-title{font-size:16px;font-weight:550;letter-spacing:-.012em}
.row-sub{font-size:13.5px;color:var(--sec)}
.row-end{display:flex;flex-direction:column;align-items:flex-end;gap:2px;font-size:13.5px;white-space:nowrap}
.row-end .st{font-weight:600}
.row-end .time{color:var(--ter);font-variant-numeric:tabular-nums}
.chev{color:var(--ter)}
.unread{position:absolute;left:5px;top:50%;width:8px;height:8px;margin-top:-4px;border-radius:50%;background:var(--link)}
.cap{height:30px;padding:0 14px;border-radius:999px;background:var(--fill);color:var(--link);font-size:14px;font-weight:650;display:inline-flex;align-items:center;gap:6px}
.btn{height:40px;padding:0 18px;border-radius:12px;background:var(--btn);color:var(--btnt);font-size:15px;font-weight:600;display:inline-flex;align-items:center;gap:8px}
.btn.sec{background:var(--fill);color:var(--text)}
.hero{background:var(--hero);border-radius:18px;padding:20px;display:flex;gap:16px;align-items:center}
.hero .k{font-size:13px;font-weight:700;color:var(--t-waiting);text-transform:uppercase;letter-spacing:.03em;display:flex;align-items:center;gap:6px}
.hero .t{font-size:20px;font-weight:700;letter-spacing:-.02em;margin:4px 0 2px}
.hero .s{color:var(--sec);font-size:14px}
.hero .grow{flex:1;min-width:0}
.tabbar{display:none}
/* Session */
.back{display:inline-flex;align-items:center;gap:2px;color:var(--link);font-size:16px;font-weight:500;margin:4px 0 14px -6px}
h1.title{margin:0 0 6px;font-size:30px;line-height:1.15;font-weight:750;letter-spacing:-.026em}
.title-row{display:flex;gap:16px;align-items:flex-start;justify-content:space-between;margin-bottom:22px}
.title-actions{display:flex;gap:8px;flex-shrink:0;padding-top:4px}
.icon-btn{width:40px;height:40px;border-radius:12px;background:var(--fill);display:grid;place-items:center}
.summary{background:var(--card);border-radius:18px;padding:20px;display:grid;grid-template-columns:auto 1fr;gap:18px;align-items:center}
.summary .big{font-size:24px;font-weight:750;letter-spacing:-.02em;display:flex;align-items:center;gap:10px}
.live{display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--t-running);background:color-mix(in srgb,var(--f-running) 16%,transparent);padding:3px 8px;border-radius:999px}
.live i{width:7px;height:7px;border-radius:50%;background:var(--f-running);animation:pulse 1.6s infinite}
@keyframes pulse{50%{opacity:.35}}
.stats{grid-column:1/-1;display:grid;grid-template-columns:repeat(3,1fr);gap:1px;background:var(--sep);border-radius:12px;overflow:hidden}
.stats>div{background:var(--card);padding:12px 14px 0 0}
.stats>div+div{padding-left:14px}
.stats .l{font-size:12.5px;color:var(--sec);font-weight:500}
.stats .v{font-size:15px;font-weight:600;margin-top:2px;overflow-wrap:anywhere}
.cols{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(0,1fr);gap:28px;align-items:start}
.act{display:flex;gap:12px;padding:12px 16px;position:relative}
.act+.act::before{content:"";position:absolute;top:0;left:56px;right:0;border-top:1px solid var(--sep)}
.act .tile{width:28px;height:28px;border-radius:8px;background:var(--fill);color:var(--sec)}
.act.msg .tile{background:var(--f-none);color:#fff}
.act .body{flex:1;min-width:0}
.act .time{font-size:12.5px;color:var(--ter);font-variant-numeric:tabular-nums;padding-top:4px}
.act.msg p{margin:3px 0 0}
.act .verb{font-weight:600}
.act .extra{color:var(--sec);font-size:13px;margin-left:6px}
.act.live-row .tile{background:color-mix(in srgb,var(--f-running) 18%,transparent);color:var(--t-running)}
.dots{display:inline-flex;gap:3px;margin-left:8px;vertical-align:middle}
.dots i{width:5px;height:5px;border-radius:50%;background:var(--t-running);animation:pulse 1.2s infinite}
.dots i:nth-child(2){animation-delay:.2s}.dots i:nth-child(3){animation-delay:.4s}
.card{background:var(--card);border-radius:14px;padding:16px}
.card h3{margin:0 0 8px;font-size:15px;font-weight:700}
.card p{margin:0 0 10px;color:var(--text)}
.card ul{margin:0;padding-left:18px;color:var(--text)}
.card li{margin:4px 0}
.quote{background:var(--fill2);border-radius:10px;padding:12px 14px;font-size:14.5px}
.kv{display:flex;justify-content:space-between;gap:12px;padding:11px 16px;position:relative;font-size:14px}
.kv+.kv::before{content:"";position:absolute;top:0;left:16px;right:0;border-top:1px solid var(--sep)}
.kv .l{color:var(--sec)}
.kv .v{text-align:right;overflow-wrap:anywhere;min-width:0}
details.disc>summary{list-style:none;display:flex;align-items:center;gap:10px;padding:14px 16px;cursor:pointer;font-weight:600}
details.disc>summary::-webkit-details-marker{display:none}
details.disc>summary .chev{margin-left:auto;transition:transform .2s}
details.disc[open]>summary .chev{transform:rotate(90deg)}
details.disc[open]>summary{border-bottom:1px solid var(--sep)}
@media (max-width:980px){.cols{grid-template-columns:1fr}}
@media (max-width:760px){
  .side{display:none}
  .bar{padding:0 16px}
  .bar .phone-brand{display:flex;align-items:center;gap:8px;font-weight:700;font-size:16px}
  .bar .filter{display:none}
  .content{padding:4px 16px 120px}
  h1.large{font-size:32px;margin-bottom:20px}
  h1.title{font-size:25px}
  .row-sub .hide-sm{display:none}
  .hero{flex-wrap:wrap}.hero .btn{width:100%;justify-content:center}
  .stats{grid-template-columns:1fr}
  .stats>div+div{padding-left:0}
  .stats>div{padding:10px 0}
  .title-actions .btn{display:none}
  .tabbar{display:flex;position:fixed;inset:auto 0 0 0;z-index:10;height:82px;padding:8px 8px 26px;background:var(--bar);backdrop-filter:blur(20px) saturate(1.8);-webkit-backdrop-filter:blur(20px) saturate(1.8);border-top:1px solid var(--sep)}
  .tabbar a{flex:1;display:flex;flex-direction:column;align-items:center;gap:3px;font-size:10.5px;font-weight:600;color:var(--ter)}
  .tabbar a[aria-current]{color:var(--tint)}
}
`;

const shell = (current: "inbox" | "sessions", inner: string) => `
<div class="app">
  <aside class="side" aria-label="Navigation">
    <div class="brand">${logo(30, 8)}Atlas</div>
    <div class="search">${ic("search", 16)}Search<kbd>⌘K</kbd></div>
    <nav class="nav" aria-label="Main">
      <a href="a-inbox.html" ${current === "inbox" ? 'aria-current="page"' : ""}>${ic("inbox", 20)}Inbox<span class="count">7</span></a>
      <a href="a-session.html" ${current === "sessions" ? 'aria-current="page"' : ""}>${ic("sparkle", 20)}Sessions<span class="count">4</span></a>
      <a href="#">${ic("pr", 20)}Pull requests</a>
      <a href="#">${ic("folder", 20)}Repositories</a>
      <a href="#">${ic("refresh", 20)}Updates</a>
    </nav>
    <nav class="nav" aria-label="Repositories">
      <div class="nav-h">Repositories</div>
      <a href="#"><span class="dot" style="background:#5E5CE6"></span>payments-api<span class="count">5</span></a>
      <a href="#"><span class="dot" style="background:#30B0C7"></span>web-dashboard<span class="count">4</span></a>
    </nav>
    <div class="side-foot">Atlas v0.4.0 · build 12</div>
  </aside>
  <main class="main" id="main">
    <div class="bar">
      <div class="phone-brand">${logo(26, 7)}Atlas</div>
      <div class="spacer"></div>
      <details class="pop">
        <summary class="pill warn">${ic("warn", 16)}2 warnings</summary>
        <div class="pop-panel">${warnings.map((w) => `<div><b>${w.title}</b><span>${w.body}</span></div>`).join("")}</div>
      </details>
      <span class="pill filter">All Repositories ${ic("chevron", 14, "chev")}</span>
    </div>
    ${inner}
  </main>
  <nav class="tabbar" aria-label="Tabs">
    <a href="a-inbox.html" ${current === "inbox" ? 'aria-current="page"' : ""}>${ic("inbox", 26)}Inbox</a>
    <a href="a-session.html" ${current === "sessions" ? 'aria-current="page"' : ""}>${ic("sparkle", 26)}Sessions</a>
    <a href="#">${ic("pr", 26)}PRs</a>
    <a href="#">${ic("folder", 26)}Repos</a>
  </nav>
</div>`;

const row = (r: Row, end: string) => `
<a class="row" href="a-session.html">
  ${r.unread ? '<span class="unread" title="New"></span>' : ""}
  <span class="tile f-${r.state}">${ic(stateIcon[r.state], 18)}</span>
  <span class="row-main"><span class="row-title">${r.title}</span><span class="row-sub">${r.repo}<span class="hide-sm"> · Spec #${r.spec}</span> · ${r.note}</span></span>
  ${end}
  ${ic("chevron", 16, "chev")}
</a>`;

const stateEnd = (r: Row) => `<span class="row-end"><span class="st t-${r.state}">${stateLabel[r.state]}</span><span class="time">${r.when} ago</span></span>`;

const inboxBody = shell(
  "inbox",
  `<div class="content">
  <p class="eyebrow">Wednesday, 18 November</p>
  <h1 class="large">Inbox</h1>

  <div class="hero">
    <span class="tile lg f-waiting">${ic("question", 26)}</span>
    <div class="grow">
      <div class="k">Needs you</div>
      <div class="t">${inbox.needs[0]!.title}</div>
      <div class="s">payments-api · Spec #10 · The Agent asked a question in OpenCode · 4m ago</div>
    </div>
    <a class="btn" href="a-session.html">Open Session</a>
  </div>

  <h2>In progress <span class="n">${inbox.progress.length}</span></h2>
  <div class="group">${inbox.progress.map((r) => row(r, stateEnd(r))).join("")}</div>

  <h2>Not started <span class="n">${inbox.notStarted.length}</span></h2>
  <div class="group">${inbox.notStarted.map((r) => row(r, `<span class="cap">${ic("play", 13)}Start</span>`)).join("")}</div>

  <h2>Settled <span class="n">2 new</span><a class="more" href="#">Show all</a></h2>
  <div class="group">${inbox.settled.map((r) => row(r, stateEnd(r))).join("")}</div>
</div>`,
);

const s = session;
const activity = s.activity
  .map((a) => {
    if (a.kind === "msg")
      return `<div class="act msg"><span class="tile">${ic("sparkle", 16)}</span><div class="body"><b>Agent</b><p>${a.text}</p></div><span class="time">${a.t}</span></div>`;
    if (a.kind === "live")
      return `<div class="act live-row"><span class="tile">${ic(a.icon!, 16)}</span><div class="body"><span class="verb">${a.verb}</span> <span class="mono">${a.target}</span><span class="dots"><i></i><i></i><i></i></span></div><span class="time">now</span></div>`;
    return `<div class="act"><span class="tile">${ic(a.icon!, 16)}</span><div class="body"><span class="verb">${a.verb}</span> <span class="mono">${a.target}</span>${a.extra ? `<span class="extra">${a.extra}</span>` : ""}</div><span class="time">${a.t}</span></div>`;
  })
  .join("");

const sessionBody = shell(
  "sessions",
  `<div class="content">
  <a class="back" href="a-inbox.html">${ic("back", 20)}Inbox</a>
  <p class="eyebrow">${s.repo} · Spec #${s.spec}</p>
  <div class="title-row">
    <h1 class="title">${s.title}</h1>
    <div class="title-actions">
      <a class="btn sec" href="#">${ic("external", 16)}GitHub</a>
      <button class="icon-btn" aria-label="More actions">${ic("more", 20)}</button>
    </div>
  </div>

  <div class="summary">
    <span class="tile lg f-running">${ic("sparkle", 26)}</span>
    <div>
      <div class="big t-running">Running <span class="live"><i></i>Live</span></div>
      <div style="color:var(--sec);margin-top:2px">Started ${s.started} · the Agent is running tests</div>
    </div>
    <div class="stats">
      <div><div class="l">Working branch</div><div class="v mono">${s.branch}</div></div>
      <div><div class="l">Based on</div><div class="v">Default branch · <span class="mono">${s.base}</span></div></div>
      <div><div class="l">Pull request</div><div class="v" style="color:var(--sec)">Not opened yet</div></div>
    </div>
  </div>

  <div class="cols">
    <section>
      <h2>Activity</h2>
      <div class="group">${activity}</div>
    </section>
    <section>
      <h2>Spec</h2>
      <div class="card">
        <h3>Goal</h3><p>${s.specBody.goal}</p>
        <h3>Acceptance</h3><ul>${s.specBody.acceptance.map((x) => `<li>${x}</li>`).join("")}</ul>
      </div>
      <h2>Your prompt</h2>
      <div class="card"><div class="quote">${s.prompt}</div></div>
      <h2>Details</h2>
      <div class="group">
        <details class="disc">
          <summary>${ic("sliders", 18)}Technical details${ic("chevron", 16, "chev")}</summary>
          ${s.technical.map(([l, v, m]) => `<div class="kv"><span class="l">${l}</span><span class="v ${m ? "mono" : ""}">${v}</span></div>`).join("")}
        </details>
      </div>
    </section>
  </div>
</div>`,
);

export const lookA = {
  inbox: page({ look, screen: "inbox", title: "Inbox", fonts: ["Inter", "Geist Mono"], css: cssA, body: inboxBody }),
  session: page({ look, screen: "session", title: s.title, fonts: ["Inter", "Geist Mono"], css: cssA, body: sessionBody }),
};
