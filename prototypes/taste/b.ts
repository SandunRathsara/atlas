import { ic, inbox, logo, page, session, stateLabel, warnings, type Row, type State } from "./shared.ts";

const look = { id: "b", name: "Rex" } as const;

const css = `
[data-mode=dark]{color-scheme:dark;--win:#141518;--main:#1A1B1F;--raised:#222328;--hover:#1F2025;--text:#ECECEE;--sec:#9B9CA3;--faint:#6A6B72;--line:rgb(255 255 255/.07);
  --sel:#1C2A44;--tint:#7FA8EE;--btn:#2F62B8;--btnt:#fff;--kbd:#2A2B31;
  --running:#5BBDEB;--waiting:#EBA941;--succeeded:#5EC27A;--failed:#F0716A;--idle:#7D7E86}
[data-mode=light]{color-scheme:light;--win:#EDEAE4;--main:#F9F8F5;--raised:#FFFFFF;--hover:#E5E1DA;--text:#1D1C1A;--sec:#69655D;--faint:#8F8A80;--line:rgb(0 0 0/.08);
  --sel:#D6E0F1;--tint:#0F3F8C;--btn:#012B68;--btnt:#fff;--kbd:#E2DED6;
  --running:#1D8CC4;--waiting:#C47A0E;--succeeded:#2E8A4A;--failed:#C9372F;--idle:#8F8A80}
body{background:var(--main);color:var(--text);font:400 14px/1.5 Geist,system-ui,sans-serif;-webkit-font-smoothing:antialiased}
.mono{font-family:"Geist Mono",ui-monospace,monospace;font-size:13px}
.app{display:grid;grid-template-columns:320px minmax(0,1fr);min-height:100vh;background:linear-gradient(to right,var(--win) 320px,transparent 320px)}
.side{position:sticky;top:0;height:100vh;display:flex;flex-direction:column;padding:12px 10px 10px;gap:12px;border-right:1px solid var(--line)}
.top{display:flex;align-items:center;gap:10px;padding:2px 6px}
.top b{font-weight:600;font-size:14px;letter-spacing:-.01em}
.top .icon-btn{margin-left:auto}
.jump{display:flex;align-items:center;gap:8px;height:34px;padding:0 10px;border-radius:8px;background:var(--main);color:var(--faint);box-shadow:inset 0 0 0 1px var(--line)}
kbd{font:500 11px "Geist Mono",monospace;background:var(--kbd);color:var(--sec);border-radius:5px;padding:2px 5px}
.jump kbd{margin-left:auto}
.seg{display:flex;background:var(--hover);border-radius:8px;padding:2px}
.seg span{flex:1;text-align:center;padding:5px 0;border-radius:6px;font-size:12.5px;font-weight:500;color:var(--sec)}
.seg span.on{background:var(--raised);color:var(--text);box-shadow:0 1px 2px rgb(0 0 0/.12)}
.list{flex:1;overflow:auto;margin:0 -4px;padding:0 4px}
.gh{display:flex;align-items:center;gap:6px;font-size:11.5px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--faint);padding:14px 8px 6px}
.gh .n{margin-left:auto;font-variant-numeric:tabular-nums;letter-spacing:0}
.gh .new{color:var(--tint);text-transform:none;letter-spacing:0;font-weight:500}
.it{display:grid;grid-template-columns:18px minmax(0,1fr) auto;column-gap:10px;align-items:center;padding:8px;border-radius:8px}
.it:hover{background:var(--hover)}
.it[aria-current]{background:var(--sel)}
.it .t{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:500}
.it .w{font-size:12px;color:var(--faint);font-variant-numeric:tabular-nums}
.it .m{grid-column:2/4;font-size:12.5px;color:var(--faint);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.it.dim .t{color:var(--sec);font-weight:400}
.ind{width:18px;height:18px;display:grid;place-items:center}
.ind .d{width:8px;height:8px;border-radius:50%}
.ind.waiting .d{background:var(--waiting);box-shadow:0 0 0 3px color-mix(in srgb,var(--waiting) 25%,transparent)}
.ind.failed .d{background:var(--failed)}
.ind.idle .d{background:transparent;box-shadow:inset 0 0 0 1.5px var(--idle)}
.ind.queued .d{background:transparent;border:1.5px dashed var(--idle);width:10px;height:10px}
.ind.none .d{width:6px;height:6px;background:var(--line);box-shadow:inset 0 0 0 1px var(--faint)}
.ind.succeeded{color:var(--succeeded)}
.ind.running{gap:2px;display:flex;align-items:center;justify-content:center}
.ind.running i{width:3.5px;height:3.5px;border-radius:50%;background:var(--running);animation:blink 1.2s infinite}
.ind.running i:nth-child(2){animation-delay:.2s}.ind.running i:nth-child(3){animation-delay:.4s}
@keyframes blink{50%{opacity:.25}}
.foot{display:flex;gap:2px;border-top:1px solid var(--line);padding-top:8px}
.icon-btn{width:32px;height:32px;border-radius:8px;display:grid;place-items:center;color:var(--sec);position:relative}
.icon-btn:hover{background:var(--hover);color:var(--text)}
.icon-btn .badge{position:absolute;top:6px;right:6px;width:7px;height:7px;border-radius:50%;background:var(--waiting)}
.foot .grow{flex:1}
main{min-width:0;display:flex;flex-direction:column}
.crumbs{height:48px;display:flex;align-items:center;gap:8px;padding:0 28px;color:var(--faint);font-size:13px;border-bottom:1px solid var(--line);position:sticky;top:0;background:color-mix(in srgb,var(--main) 85%,transparent);backdrop-filter:blur(12px);z-index:3}
.crumbs b{color:var(--text);font-weight:500}
.crumbs .sp{flex:1}
.crumbs .phone-back{display:none}
.pane{padding:28px 28px 120px;max-width:1120px;width:100%}
.btn{height:32px;padding:0 12px;border-radius:7px;background:var(--btn);color:var(--btnt);font-weight:500;display:inline-flex;align-items:center;gap:8px}
.btn kbd{background:rgb(255 255 255/.16);color:#fff}
.btn.ghost{background:transparent;color:var(--text);box-shadow:inset 0 0 0 1px var(--line)}
.btn.ghost:hover{background:var(--hover)}
h1{margin:0;font-size:22px;font-weight:600;letter-spacing:-.02em;line-height:1.25}
.lede{color:var(--sec);margin:6px 0 24px}
.lede b{color:var(--text);font-weight:500}
.panel{background:var(--raised);border-radius:10px;box-shadow:0 0 0 1px var(--line)}
.focus{padding:18px;display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:14px;align-items:center;box-shadow:0 0 0 1px color-mix(in srgb,var(--waiting) 45%,transparent)}
.focus .k{font-size:12px;color:var(--waiting);font-weight:600}
.focus .t{font-size:16px;font-weight:600;margin:2px 0}
.focus .s{color:var(--sec);font-size:13px}
h2{font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:var(--faint);font-weight:600;margin:32px 0 10px}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.line{display:grid;grid-template-columns:18px minmax(0,1fr) auto;gap:10px;align-items:center;padding:10px 14px}
.line+.line{border-top:1px solid var(--line)}
.line .s{color:var(--faint);font-size:12.5px}
.sys{padding:10px 14px;display:flex;gap:10px}
.sys+.sys{border-top:1px solid var(--line)}
.sys .ic{color:var(--waiting);margin-top:2px}
.sys .b{color:var(--sec);font-size:13px}
.hints{display:flex;gap:18px;margin-top:36px;color:var(--faint);font-size:12.5px}
.hints span{display:flex;gap:6px;align-items:center}
/* session */
.head{display:flex;gap:16px;align-items:flex-start;justify-content:space-between}
.state{display:inline-flex;align-items:center;gap:8px;font-size:13px;font-weight:500;color:var(--running);margin-bottom:8px}
.tabs{display:flex;gap:2px;margin:20px 0 0;border-bottom:1px solid var(--line)}
.tabs span{padding:8px 12px;color:var(--sec);font-weight:500;border-bottom:2px solid transparent;margin-bottom:-1px}
.tabs span.on{color:var(--text);border-color:var(--tint)}
.split{display:grid;grid-template-columns:minmax(0,1fr) 280px;gap:28px;margin-top:20px}
.log{display:flex;flex-direction:column}
.ev{display:grid;grid-template-columns:48px 20px minmax(0,1fr);gap:10px;padding:9px 0}
.ev .tm{font:12px "Geist Mono",monospace;color:var(--faint);padding-top:2px}
.ev .ic{color:var(--faint);margin-top:1px}
.ev.msg .ic{color:var(--tint)}
.ev.msg .tx{font-size:14.5px;line-height:1.55}
.ev.tool .tx{font:13px "Geist Mono",monospace;color:var(--sec)}
.ev.tool .tx b{color:var(--text);font-weight:500;display:inline-block;min-width:64px}
.ev.tool .x{color:var(--faint);margin-left:8px}
.ev.live .tx{color:var(--text)}
.ev.live .ic{color:var(--running)}
.cursor{display:inline-block;width:7px;height:14px;background:var(--running);vertical-align:-2px;margin-left:6px;animation:blink 1s steps(2) infinite}
.insp{display:flex;flex-direction:column;gap:16px}
.kv{display:grid;grid-template-columns:110px minmax(0,1fr);gap:4px 12px;padding:14px;font-size:13px}
.kv .l{color:var(--faint)}
.kv .v{overflow-wrap:anywhere}
.insp h3{margin:0;padding:12px 14px 0;font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:var(--faint);font-weight:600}
details.adv summary{list-style:none;cursor:pointer;padding:12px 14px;display:flex;align-items:center;gap:8px;color:var(--sec);font-size:13px;font-weight:500}
details.adv summary::-webkit-details-marker{display:none}
details.adv[open] summary .ic{transform:rotate(90deg)}
@media (max-width:860px){
  .app{grid-template-columns:1fr;background:none}
  .side{position:static;height:auto;border:0;padding:12px}
  .app.detail .side{display:none}
  .app.list main{display:none}
  .app.list .side{min-height:100vh;background:var(--win)}
  .crumbs{padding:0 12px}
  .crumbs .phone-back{display:inline-flex;align-items:center;color:var(--tint);gap:2px;font-weight:500}
  .crumbs .path{display:none}
  .pane{padding:20px 16px 120px}
  .split,.grid2{grid-template-columns:1fr}
  .ev{grid-template-columns:20px minmax(0,1fr)}
  .ev .tm{display:none}
  .head .btn{display:none}
}
`;

const indicator = (s: State) =>
  s === "running"
    ? `<span class="ind running" title="Running"><i></i><i></i><i></i></span>`
    : s === "succeeded"
      ? `<span class="ind succeeded" title="Succeeded">${ic("check", 15)}</span>`
      : `<span class="ind ${s}" title="${stateLabel[s]}"><span class="d"></span></span>`;

const item = (r: Row, selected = false) => `
<a class="it ${r.state === "none" ? "dim" : ""}" href="b-session.html" ${selected ? 'aria-current="page"' : ""}>
  ${indicator(r.state)}
  <span class="t">${r.title}</span>
  <span class="w">${r.when}</span>
  <span class="m">${r.repo} · #${r.spec} · ${r.state === "none" ? "Not started" : r.note}</span>
</a>`;

const sidebar = (selectedTitle?: string) => `
<aside class="side" aria-label="Inbox">
  <div class="top">${logo(24, 6)}<b>Atlas</b><button class="icon-btn" aria-label="Filter Repositories">${ic("sliders", 18)}</button></div>
  <div class="jump">${ic("search", 16)}Jump to a Spec or Session<kbd>⌘K</kbd></div>
  <div class="seg" role="tablist"><span class="on">Inbox</span><span>Sessions</span><span>PRs</span></div>
  <nav class="list" aria-label="Spec inbox">
    <div class="gh">Needs you<span class="n">1</span></div>
    ${inbox.needs.map((r) => item(r, r.title === selectedTitle)).join("")}
    <div class="gh">Working<span class="n">3</span></div>
    ${inbox.progress.map((r) => item(r, r.title === selectedTitle)).join("")}
    <div class="gh">Not started<span class="n">3</span></div>
    ${inbox.notStarted.map((r) => item(r)).join("")}
    <div class="gh">Settled<span class="new">· 2 new</span><span class="n">3</span></div>
    ${inbox.settled.map((r) => item(r)).join("")}
  </nav>
  <div class="foot">
    <button class="icon-btn" aria-label="Repositories">${ic("folder", 18)}</button>
    <button class="icon-btn" aria-label="Updates">${ic("refresh", 18)}</button>
    <button class="icon-btn" aria-label="2 system warnings">${ic("warn", 18)}<span class="badge"></span></button>
    <span class="grow"></span>
    <button class="icon-btn" aria-label="Sign out">${ic("external", 18)}</button>
  </div>
</aside>`;

const inboxBody = `
<div class="app list">
  ${sidebar()}
  <main id="main">
    <div class="crumbs"><span class="path"><b>Inbox</b> · All Repositories</span><span class="sp"></span></div>
    <div class="pane">
      <h1>Inbox</h1>
      <p class="lede"><b>1</b> needs you · <b>2</b> working · <b>1</b> idle · <b>3</b> not started</p>

      <div class="panel focus">
        ${indicator("waiting")}
        <div>
          <div class="k">Needs you · 4m</div>
          <div class="t">${inbox.needs[0]!.title}</div>
          <div class="s">payments-api · Spec #10 · The Agent asked a question in OpenCode</div>
        </div>
        <a class="btn" href="b-session.html">Open Session <kbd>⏎</kbd></a>
      </div>

      <div class="grid2">
        <section>
          <h2>Recently settled</h2>
          <div class="panel">
            ${inbox.settled
              .slice(0, 2)
              .map((r) => `<a class="line" href="b-session.html">${indicator(r.state)}<span>${r.title}<div class="s">${r.repo} · ${r.note}</div></span><span class="s">${r.when}</span></a>`)
              .join("")}
          </div>
        </section>
        <section>
          <h2>System</h2>
          <div class="panel">
            ${warnings.map((w) => `<div class="sys">${ic("warn", 16)}<div>${w.title}<div class="b">${w.body}</div></div></div>`).join("")}
          </div>
        </section>
      </div>

      <div class="hints"><span><kbd>⌘K</kbd> jump</span><span><kbd>J</kbd><kbd>K</kbd> move</span><span><kbd>⏎</kbd> open</span><span><kbd>S</kbd> start Session</span></div>
    </div>
  </main>
</div>`;

const s = session;
const log = s.activity
  .map((a) => {
    if (a.kind === "msg") return `<div class="ev msg"><span class="tm">${a.t}</span>${ic("sparkle", 18)}<div class="tx">${a.text}</div></div>`;
    if (a.kind === "live")
      return `<div class="ev tool live"><span class="tm">${a.t}</span>${ic("terminal", 18)}<div class="tx"><b>run</b>${a.target}<span class="cursor"></span></div></div>`;
    const verb = a.verb === "Read" ? "read" : a.verb === "Searched" ? "search" : a.verb === "Created" ? "create" : "edit";
    return `<div class="ev tool"><span class="tm">${a.t}</span>${ic(a.icon!, 18)}<div class="tx"><b>${verb}</b>${a.target}${a.extra ? `<span class="x">${a.extra}</span>` : ""}</div></div>`;
  })
  .join("");

const sessionBody = `
<div class="app detail">
  ${sidebar(s.title)}
  <main id="main">
    <div class="crumbs"><a class="phone-back" href="b-inbox.html">${ic("back", 18)}Inbox</a><span class="path">payments-api / Spec #11 / <b>Session</b></span><span class="sp"></span><button class="icon-btn" aria-label="More actions">${ic("more", 18)}</button></div>
    <div class="pane">
      <div class="head">
        <div>
          <div class="state">${indicator("running")}Running · 12m</div>
          <h1>${s.title}</h1>
        </div>
        <a class="btn ghost" href="#">${ic("external", 15)}Spec on GitHub</a>
      </div>
      <div class="tabs"><span class="on">Activity</span><span>Spec</span><span>Prompt</span></div>
      <div class="split">
        <div class="log">${log}</div>
        <aside class="insp">
          <div class="panel">
            <div class="kv">
              <span class="l">State</span><span class="v" style="color:var(--running)">Running</span>
              <span class="l">Started</span><span class="v">${s.started}</span>
              <span class="l">Repository</span><span class="v">${s.fullRepo}</span>
              <span class="l">Based on</span><span class="v">Default branch · <span class="mono">${s.base}</span></span>
              <span class="l">Branch</span><span class="v mono">${s.branch}</span>
              <span class="l">Pull request</span><span class="v" style="color:var(--faint)">Not opened yet</span>
            </div>
          </div>
          <div class="panel">
            <details class="adv">
              <summary>${ic("chevron", 14)}Technical details</summary>
              <div class="kv" style="padding-top:0">${s.technical.map(([l, v, m]) => `<span class="l">${l}</span><span class="v ${m ? "mono" : ""}">${v}</span>`).join("")}</div>
            </details>
          </div>
        </aside>
      </div>
    </div>
  </main>
</div>`;

export const lookB = {
  inbox: page({ look, screen: "inbox", title: "Inbox", fonts: ["Geist", "Geist Mono"], css, body: inboxBody }),
  session: page({ look, screen: "session", title: s.title, fonts: ["Geist", "Geist Mono"], css, body: sessionBody }),
};
