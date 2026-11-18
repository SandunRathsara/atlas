// Phase 5.2: the Session screen with the locked frame. Throwaway.
import { frameCss } from "./frame.ts";
import { ic, inbox, logo, page, session as s, stateIcon, type Row } from "./shared.ts";

const css = `${frameCss}
.scalebox.scroll{overflow-x:auto;-webkit-overflow-scrolling:touch}
.swipe{display:none;font-size:13px;color:var(--ter);margin:8px 0 0;text-align:center}
@media (max-width:760px){.swipe{display:block}}
.pair.phones .scalebox.phone{max-width:320px}
.ph-bar .bk{display:flex;align-items:center;gap:2px;color:var(--link);font-size:16px}
.ph-content{overflow:hidden}
.ph .eyebrow{margin:6px 0 2px}
.ph h1.st{font-size:24px;line-height:1.2;letter-spacing:-.022em;margin:0 0 14px;display:block}
.stc{background:var(--card);border-radius:18px;padding:14px;display:flex;gap:12px;align-items:center}
.stc .tile{width:44px;height:44px;border-radius:12px}
.stc .grow{flex:1;min-width:0}
.stc .big{font-size:18px;font-weight:750;letter-spacing:-.015em;display:flex;align-items:center;gap:8px}
.stc .sub{color:var(--sec);font-size:13.5px;margin-top:1px}
.livetag{display:inline-flex;align-items:center;gap:5px;font-size:12px;font-weight:650;color:var(--t-succeeded)}
.livetag i{width:7px;height:7px;border-radius:50%;background:var(--f-succeeded);animation:pulse 1.6s ease-in-out infinite}
.stc .meta{display:flex;flex-direction:column;gap:2px;margin-top:10px;padding-top:10px;border-top:1px solid var(--sep);font-size:13px;color:var(--sec)}
.stc .meta b{color:var(--text);font-weight:600}
.stc.col{flex-direction:column;align-items:stretch}
.stc.col .hd{display:flex;gap:12px;align-items:center}
.prline{display:flex;align-items:center;gap:10px;margin-top:12px;padding:10px 12px;border-radius:12px;background:var(--fill2);font-size:14px}
.prline .ic{color:var(--t-succeeded)}
.prline b{font-weight:600}
.prline .go{margin-left:auto;color:var(--link);font-weight:600;white-space:nowrap}
.prcard{background:var(--card);border-radius:18px;padding:16px;box-shadow:inset 0 0 0 1.5px color-mix(in srgb,var(--f-succeeded) 45%,transparent);margin-bottom:12px}
.prcard .k{font-size:12px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--t-succeeded);display:flex;align-items:center;gap:6px}
.prcard .t{font-size:17px;font-weight:700;margin:6px 0 2px;letter-spacing:-.012em}
.prcard .s{font-size:13.5px;color:var(--sec)}
.prcard .s .mono{font-size:12.5px}
.prcard .acts{display:flex;gap:8px;margin-top:12px}
.prcard .btn{flex:1;justify-content:center;height:40px;font-size:14px}
.btn.outline{background:none;color:var(--text);box-shadow:inset 0 0 0 1.5px var(--sep)}
.sh{margin:20px 0 8px;font-size:17px;font-weight:700;letter-spacing:-.012em;display:flex;align-items:baseline;gap:8px}
.sh .n{font-size:13px;font-weight:500;color:var(--sec)}
.ph .act{padding:10px 12px;gap:10px;font-size:14px}
.ph .act+.act::before{left:50px}
.ph .act .tile{width:28px;height:28px}
.ph .act .mono{font-size:12.5px;word-break:break-all}
.runchip{display:inline-flex;margin-left:6px;font-size:11.5px;font-weight:650;color:var(--t-running);background:color-mix(in srgb,var(--f-running) 16%,transparent);padding:1px 7px;border-radius:999px}
.fold{display:flex;align-items:center;gap:10px;padding:10px 12px;position:relative;font-size:14px;color:var(--sec)}
.fold+.act::before,.act+.fold::before{content:"";position:absolute;top:0;left:50px;right:0;border-top:1px solid var(--sep)}
.fold .tile{width:28px;height:28px;border-radius:8px;background:var(--fill);color:var(--sec)}
.fold b{color:var(--text);font-weight:600}
.fold .chev{margin-left:auto;color:var(--ter)}
.segtabs{display:flex;background:var(--fill);border-radius:10px;padding:2px;margin:14px 0 4px}
.segtabs span{flex:1;text-align:center;padding:7px 0;border-radius:8px;font-size:13.5px;font-weight:600;color:var(--sec)}
.segtabs span.on{background:var(--card);color:var(--text);box-shadow:0 1px 2px rgb(0 0 0/.15)}
.pcard{background:var(--card);border-radius:14px;padding:14px;font-size:14px;line-height:1.5}
.pcard h4{margin:0 0 4px;font-size:14px}.pcard p{margin:0 0 10px;color:var(--sec)}.pcard ul{margin:0;padding-left:18px;color:var(--sec)}
.pcard .quote{border-left:3px solid var(--sep);padding-left:10px;color:var(--text)}
.discrow{display:flex;align-items:center;gap:10px;padding:13px 12px;font-size:15px;font-weight:600}
.discrow .ic{color:var(--sec)}.discrow .chev{margin-left:auto;color:var(--ter)}
.kv2{display:flex;justify-content:space-between;gap:12px;padding:10px 12px;position:relative;font-size:13.5px}
.kv2+.kv2::before{content:"";position:absolute;top:0;left:12px;right:0;border-top:1px solid var(--sep)}
.kv2 .l{color:var(--sec)}.kv2 .v{text-align:right;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.askq{background:var(--card);border-radius:14px;padding:14px;margin-top:12px;box-shadow:inset 0 0 0 1.5px color-mix(in srgb,var(--f-waiting) 45%,transparent)}
.askq .k{font-size:12px;font-weight:700;color:var(--t-waiting);text-transform:uppercase;letter-spacing:.04em}
.askq p{margin:6px 0 8px;font-size:15px}
.askq .note{font-size:13px;color:var(--sec);display:flex;gap:6px;align-items:center}
.notlive{display:flex;gap:10px;align-items:flex-start;padding:10px 12px;border-radius:12px;background:color-mix(in srgb,var(--f-waiting) 14%,transparent);font-size:13.5px;margin:0 0 12px}
.notlive .ic{color:var(--t-waiting);flex-shrink:0;margin-top:1px}
.notlive b{display:block}
.dimmed{opacity:.6}
.ph-sheet .group a{padding:13px 12px;border-radius:0;justify-content:center;color:var(--link);font-weight:500}
.ph-sheet .group a.red{color:var(--t-failed)}
.ph-sheet .group a+a{border-top:1px solid var(--sep)}
.ph-sheet .group{background:var(--fill2);border-radius:14px;overflow:hidden}
.ph-sheet .shnote{font-size:12.5px;color:var(--sec);text-align:center;padding:4px 10px 10px}
.ph-sheet .cancelg{margin-top:10px}
.ph-sheet .cancelg a{font-weight:650}
/* desktop pane */
.desk{width:1180px;height:760px}
.d-content{overflow:hidden;flex:1}
.d-content .title-row{display:flex;justify-content:space-between;gap:16px;align-items:flex-start;margin-bottom:16px}
.d-content .title-row h1{font-size:28px;line-height:1.15;margin:0}
.icon-btn{width:40px;height:40px;border-radius:12px;box-shadow:inset 0 0 0 1.5px var(--sep);display:grid;place-items:center;flex-shrink:0}
.d-content .stc .meta{flex-direction:row;gap:24px}
`;

const stateCard = (opts: { meta?: boolean; live?: boolean } = {}) => `
<div class="stc col"><div class="hd"><span class="tile f-running">${ic("sparkle", 22)}</span>
  <div class="grow"><div class="big t-running">Running ${opts.live === false ? "" : `<span class=\"livetag\"><i></i>Live</span>`}</div><div class="sub">Started ${s.started} · running tests</div></div></div>
  ${opts.meta === false ? "" : `<div class="meta"><span>Branch <b class="mono">${s.branch}</b></span><span>Based on <b>main</b></span></div>`}
</div>`;

const steps = s.activity.filter((a) => a.kind === "tool");
const act = (a: (typeof s.activity)[number]) => {
  if (a.kind === "msg") return `<div class="act msg"><span class="tile">${ic("sparkle", 15)}</span><div class="body"><b>Agent</b><p>${a.text}</p></div><span class="time">${a.t}</span></div>`;
  if (a.kind === "live") return `<div class="act live-row"><span class="tile">${ic(a.icon!, 15)}</span><div class="body"><b>${a.verb}</b> <span class="mono">${a.target}</span><span class="runchip">now</span></div></div>`;
  return `<div class="act"><span class="tile">${ic(a.icon!, 15)}</span><div class="body"><b>${a.verb}</b> <span class="mono">${a.target}</span>${a.extra ? `<span class="extra">${a.extra}</span>` : ""}</div><span class="time">${a.t}</span></div>`;
};
const allSteps = `<div class="group">${s.activity.map(act).join("")}</div>`;
const fold = (n: number, what: string) => `<div class="fold"><span class="tile">${ic("list", 15)}</span><span><b>${n} steps</b> · ${what}</span>${ic("chevron", 15, "chev")}</div>`;
const folded = `<div class="group">${act(s.activity[0]!)}${fold(2, "read 1 file, searched")}${act(s.activity[3]!)}${fold(3, "changed 3 files")}${act(s.activity[7]!)}</div>`;

const specCard = `<div class="pcard"><h4>Goal</h4><p>${s.specBody.goal}</p><h4>Acceptance</h4><ul>${s.specBody.acceptance.map((x) => `<li>${x}</li>`).join("")}</ul></div>`;
const promptCard = `<div class="pcard"><div class="quote">${s.prompt}</div></div>`;
const techRow = `<div class="group"><div class="discrow">${ic("sliders", 18)}Technical details${ic("chevron", 15, "chev")}</div></div>`;
const tech = `<div class="group">${s.technical.slice(0, 6).map(([l, v, m]) => `<div class="kv2"><span class="l">${l}</span><span class="v ${m ? "mono" : ""}">${v}</span></div>`).join("")}</div>`;

const tabs = `<nav class="ph-tabs"><a class="on">${ic("inbox", 25)}Inbox</a><a>${ic("sparkle", 25)}Sessions</a><a>${ic("pr", 25)}PRs</a><a>${ic("folder", 25)}Repos</a><a>${ic("more", 25)}More</a></nav>`;

const phone = (inner: string, h = 780, overlay = "") => `
<div class="scalebox phone" data-w="375" data-h="${h}"><div class="screen ph mock">
  <div class="ph-status"></div>
  <div class="ph-bar"><span class="bk">${ic("back", 22)}Inbox</span><span class="sp"></span><span class="ib">${ic("more", 24)}</span></div>
  <div class="ph-content">
    <p class="eyebrow">${s.repo} · Spec #${s.spec}</p>
    <h1 class="st">${s.title}</h1>
    ${inner}
  </div>
  ${tabs}
  ${overlay}
</div></div>`;

// Q1 layouts
const longPage = phone(
  `${stateCard()}
  <div class="sh">Activity</div>${allSteps}
  <div class="sh">Spec</div>${specCard}
  <div class="sh">Your prompt</div>${promptCard}
  <div class="sh"></div>${techRow}`,
  1640,
);
const tabbed = phone(
  `${stateCard()}
  <div class="segtabs"><span class="on">Activity</span><span>Spec</span><span>Details</span></div>
  <div class="sh" style="margin-top:12px"></div>${allSteps}`,
  1000,
);

// Q2 steps
const stepsAll = phone(`${stateCard({ meta: false })}<div class="sh">Activity <span class="n">${steps.length + 1} steps</span></div>${allSteps}`, 960);
const stepsFolded = phone(`${stateCard({ meta: false })}<div class="sh">Activity</div>${folded}`, 960);

// Q3 PR result
const doneHead = (extra = "") => `<div class="stc col"><div class="hd"><span class="tile f-succeeded">${ic("check", 22)}</span>
  <div class="grow"><div class="big t-succeeded">Succeeded</div><div class="sub">Finished 8 min ago · took 34 min</div></div></div>${extra}</div>`;
const prBig = phone(
  `<div class="prcard"><div class="k">${ic("pr", 15)}Pull request opened</div><div class="t">#44 Retry failed webhooks with backoff</div>
   <div class="s">Into <span class="mono">main</span> · 3 files · +157 −3</div>
   <div class="acts"><a class="btn">${ic("external", 16)}Open on GitHub</a></div></div>
   ${doneHead()}<div class="sh">Activity</div>${folded}`,
  900,
);
const prLine = phone(
  `${doneHead(`<div class="prline">${ic("pr", 18)}<span><b>PR #44</b> opened into <span class="mono">main</span></span><span class="go">GitHub ›</span></div>`)}
   <div class="sh">Activity</div>${folded}`,
  900,
);

// Part 2 checks
const waiting = phone(
  `<div class="stc col"><div class="hd"><span class="tile f-waiting">${ic("question", 22)}</span>
   <div class="grow"><div class="big t-waiting">Waiting for an answer</div><div class="sub">Asked 4 min ago</div></div></div>
   <div class="askq"><div class="k">The Agent asks</div><p>Should refunds without a key be rejected, or should a key be generated?</p>
   <div class="note">${ic("terminal", 15)}Answer it in OpenCode. Atlas can’t reply.</div></div></div>
   <div class="sh">Activity</div>${folded}`,
  860,
);
const stale = phone(
  `<div class="notlive">${ic("warn", 17)}<div><b>Not live</b>Atlas lost touch with OpenCode 2 min ago. This is what it last saw; the real state may have changed.</div></div>
   <div class="dimmed">${stateCard({ meta: false, live: false })}<div class="sh">Activity</div>${folded}</div>`,
  860,
);
const sheet = phone(
  `${stateCard()}<div class="sh">Activity</div>${folded}`,
  780,
  `<div class="ph-dim"></div><div class="ph-sheet"><div class="grab"></div>
   <div class="shnote">Retry failed webhooks with exponential backoff</div>
   <div class="group"><a>Spec on GitHub</a><a>Spec in Atlas</a><a>All Sessions for payments-api</a><a>Review current target</a><a class="red">Release stack reservation…</a></div>
   <div class="shnote" style="padding-top:8px">The last two only appear when they apply.</div>
   <div class="group cancelg"><a>Cancel</a></div></div>`,
);

const live = (r: Row, sel: string) =>
  `<a class="${r.title.startsWith(sel) ? "on" : ""}"><span class="mt f-${r.state}">${ic(stateIcon[r.state], 13)}</span><span class="t">${r.title}</span><span class="w">${r.when}</span></a>`;
const desk = `
<div class="scalebox" data-w="1180" data-h="760" data-min="0.62"><div class="screen desk mock">
  <aside class="d-side">
    <div class="d-brand">${logo(28, 8)}Atlas</div>
    <div class="d-search">${ic("search", 15)}Search<kbd>⌘K</kbd></div>
    <div class="seg"><span class="on">Inbox</span><span>Sessions</span><span>PRs</span><span>Repos</span></div>
    <nav class="lvl">
      <div class="h">Needs you</div>${inbox.needs.map((r) => live(r, "Retry")).join("")}
      <div class="h">Working</div>${inbox.progress.map((r) => live(r, "Retry")).join("")}
      <div class="h">Not started</div>${inbox.notStarted.map((r) => live(r, "Retry")).join("")}
      <div class="h">Settled</div>${inbox.settled.map((r) => live(r, "Retry")).join("")}
    </nav>
    <div class="d-foot"><span class="av">A</span>Acme team${ic("chevron", 14, "chev")}</div>
  </aside>
  <div class="d-main">
    <div class="d-bar"><span class="fpill">All Repositories ${ic("chevron", 13)}</span><span class="sp"></span></div>
    <div class="d-content">
      <p class="eyebrow">${s.repo} · Spec #${s.spec}</p>
      <div class="title-row"><h1>${s.title}</h1><span class="icon-btn">${ic("more", 20)}</span></div>
      ${stateCard()}
      <div class="sh">Activity</div>${folded}
    </div>
  </div>
</div></div>
<p class="swipe">Swipe sideways to see the whole screen →</p>`;

type Pick = { title: string; o1: [string, string]; o2: [string, string]; a: string; b: string };
const picks: Pick[] = [
  { title: "How the page is organised", o1: ["One long page", "scroll down for Spec, prompt, details"], o2: ["Tabs", "Activity · Spec · Details"], a: longPage, b: tabbed },
  { title: "The Agent’s steps", o1: ["Show every step", "one line each"], o2: ["Fold steps", "“3 steps” between messages, tap to open"], a: stepsAll, b: stepsFolded },
  { title: "When the Agent opens a pull request", o1: ["Big card on top", "with an Open on GitHub button"], o2: ["One line", "inside the status card"], a: prBig, b: prLine },
];

const opt = (n: 1 | 2, [name, note]: [string, string], inner: string) =>
  `<div class="opt"><div class="lab"><span>${n}</span>${name} <em>${note}</em></div>${inner}</div>`;

const checks = [
  { title: "The Agent asked a question", body: waiting },
  { title: "Atlas lost touch with OpenCode", body: stale },
  { title: "The ⋯ menu", body: sheet },
  { title: "On a computer (inside the Inbox, Mail-style)", body: desk },
];

const body = `<main class="tile-page">
  <h1>Session</h1>
  <p class="how">The page for one Session: what the Agent is doing and what it made. <span class="phone-only">Tap <b>1</b> / <b>2</b> to flip.</span><br>
  Reply with <b>3 numbers</b>, plus any letters in part 2 that look wrong.</p>
  <div class="part-h">Part 1 · Pick one</div>
  ${picks
    .map(
      (p, i) => `<section class="q">
  <h2><span class="num">${i + 1}</span>${p.title}</h2>
  <div class="switch" role="radiogroup" aria-label="Choice ${i + 1}">
    <label><input class="o1" type="radio" name="q${i}" checked><span>1 · ${p.o1[0]}</span></label>
    <label><input class="o2" type="radio" name="q${i}"><span>2 · ${p.o2[0]}</span></label>
  </div>
  <div class="pair phones">${opt(1, p.o1, p.a)}${opt(2, p.o2, p.b)}</div>
</section>`,
    )
    .join("")}
  <div class="part-h">Part 2 · Just check</div>
  ${checks.map((c, i) => `<section class="q"><h2><span class="num check">${String.fromCharCode(65 + i)}</span>${c.title}</h2><div class="solo">${c.body}</div></section>`).join("")}
</main>
<script>
(() => {
  const fit = (box) => {
    const cw = +box.dataset.w, ch = +box.dataset.h, min = innerWidth <= 760 ? +(box.dataset.min || 0) : 0;
    let sc = box.clientWidth / cw;
    const scroll = sc < min; if (scroll) sc = min;
    box.classList.toggle("scroll", scroll);
    box.style.height = ch * sc + "px";
    box.querySelector(".screen").style.transform = "scale(" + sc + ")";
    let sizer = box.querySelector(".sizer");
    if (!sizer) { sizer = document.createElement("div"); sizer.className = "sizer"; sizer.style.height = "1px"; box.appendChild(sizer); }
    sizer.style.width = cw * sc + "px";
  };
  const ro = new ResizeObserver((es) => es.forEach((e) => fit(e.target)));
  document.querySelectorAll(".scalebox").forEach((b) => { const sc = b.querySelector(".screen"); sc.style.width = b.dataset.w + "px"; sc.style.height = b.dataset.h + "px"; ro.observe(b); });
})();
</script>`;

export const sessionPage = page({ look: { id: "a", name: "Session" }, screen: "session", title: "Session — pick a layout", fonts: ["Inter", "Geist Mono"], css, body });
