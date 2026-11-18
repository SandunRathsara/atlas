// Phase 5.6: All Sessions list (phone Sessions tab). Throwaway.
import { frameCss } from "./frame.ts";
import { ic, inbox, logo, page, stateIcon, stateLabel, type Row, type State } from "./shared.ts";

const css = `${frameCss}
.scalebox.scroll{overflow-x:auto;-webkit-overflow-scrolling:touch}
.swipe{display:none;font-size:13px;color:var(--ter);margin:8px 0 0;text-align:center}
@media (max-width:760px){.swipe{display:block}}
.pair.phones .scalebox.phone{max-width:320px}
.ph-content{overflow:hidden}
.ph h1.big{font-size:32px;margin:0 0 10px;letter-spacing:-.028em;display:flex;align-items:center;justify-content:space-between}
.ph .row{padding:10px 12px;gap:12px;min-height:58px}
.ph .row+.row::before{left:56px}
.ph .row .tile{width:32px;height:32px;border-radius:9px}
.chips{margin:0 0 14px}
.chips span{height:30px;font-size:13.5px;padding:0 12px}
.menubtn{display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 12px;border-radius:999px;box-shadow:inset 0 0 0 1.5px var(--sep);font-size:14px;font-weight:600;margin:0 0 14px}
.menubtn .ic{color:var(--sec);transform:rotate(90deg)}
.fbar{display:flex;gap:8px;align-items:center}
.gh{font-size:13px;font-weight:600;color:var(--sec);text-transform:uppercase;letter-spacing:.04em;margin:16px 4px 6px}
.gh:first-child{margin-top:0}
.pv{font-size:13px;color:var(--ter);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:block;margin-top:1px}
.reason{font-size:13px;color:var(--t-failed);display:block;margin-top:2px}
.prl{font-size:13px;color:var(--t-succeeded);display:flex;gap:4px;align-items:center;margin-top:2px;font-weight:600}
.menu{position:absolute;top:150px;left:16px;width:230px;background:var(--side);border-radius:14px;box-shadow:0 20px 50px rgb(0 0 0/.45),0 0 0 1px var(--sep);overflow:hidden}
.menu a{display:flex;align-items:center;justify-content:space-between;padding:11px 14px;font-size:15px}
.menu a+a{border-top:1px solid var(--sep)}
.menu a .ic{color:var(--link)}
.empty{text-align:center;padding:36px 20px;color:var(--sec);font-size:14.5px;line-height:1.45}
.empty .tile{width:56px;height:56px;border-radius:16px;margin:0 auto 12px;background:var(--fill);color:var(--sec)}
.empty b{display:block;color:var(--text);font-size:17px;margin-bottom:4px}
.empty a{display:inline-block;margin-top:12px;color:var(--link);font-weight:600}
/* desktop */
.desk{width:1180px;height:760px}
.d-content{overflow:hidden;flex:1}
.d-content h1{font-size:30px;margin:0 0 14px}
.d-content .row .tile{width:32px;height:32px;border-radius:9px}
`;

type S = Row & { prompt: string; reason?: string; pr?: string };
const P = "Implement the Spec. Keep the diff small and add tests.";
const running: S[] = [
  { ...inbox.needs[0]!, prompt: "Use the existing keys table; don't add a migration." },
  { ...inbox.progress[0]!, prompt: P },
  { ...inbox.progress[2]!, prompt: "Follow the settings page pattern." },
  { ...inbox.progress[1]!, prompt: P },
];
const done: S[] = [
  { ...inbox.settled[0]!, prompt: P, pr: "PR #43 opened" },
  { ...inbox.settled[1]!, prompt: P, reason: "Tests failed in settlement_export_test" },
];

const row = (r: S, o: { preview?: boolean; time?: boolean } = {}) => `<div class="row"><span class="tile f-${r.state}">${ic(stateIcon[r.state], 16)}</span>
  <span class="row-main"><span class="row-title">${r.title}</span><span class="row-sub">${r.repo} · ${r.when} ago</span>${
    r.reason ? `<span class="reason">${r.reason}</span>` : r.pr ? `<span class="prl">${ic("pr", 13)}${r.pr}</span>` : ""
  }${o.preview ? `<span class="pv">“${r.prompt}”</span>` : ""}</span>
  ${o.time === false ? "" : `<span class="row-end"><span class="chip p-${r.state}">${stateLabel[r.state as State]}</span></span>`}</div>`;
const list = (rs: S[], o = {}) => `<div class="group">${rs.map((r) => row(r, o)).join("")}</div>`;

const grouped = (preview = false) => {
  const by: [string, S[]][] = [
    ["Waiting for an answer", running.filter((r) => r.state === "waiting")],
    ["Running", running.filter((r) => r.state === "running")],
    ["Idle", running.filter((r) => r.state === "idle")],
    ["Queued", running.filter((r) => r.state === "queued")],
  ];
  return by.map(([h, rs]) => `<div class="gh">${h}</div>${list(rs, { preview, time: false })}`).join("");
};

const tabs = `<nav class="ph-tabs"><a>${ic("inbox", 25)}Inbox</a><a class="on">${ic("sparkle", 25)}Sessions</a><a>${ic("pr", 25)}PRs</a><a>${ic("folder", 25)}Repos</a><a>${ic("more", 25)}More</a></nav>`;
const phone = (inner: string, h = 780, overlay = "") => `
<div class="scalebox phone" data-w="375" data-h="${h}"><div class="screen ph mock">
  <div class="ph-status"></div><div class="ph-bar"><span class="sp"></span><span class="ib">${ic("search", 22)}</span></div>
  <div class="ph-content"><h1 class="big">Sessions</h1>${inner}</div>${tabs}${overlay}
</div></div>`;

const chips = `<div class="chips"><span class="on">Active</span><span>All</span><span>Running</span><span>Waiting</span><span>Queued</span><span>Failed</span></div>`;
const menuBtn = (label = "Active") => `<div class="fbar"><span class="menubtn">${label} ${ic("chevron", 13)}</span></div>`;

// Q1 filters
const q1a = phone(`${chips}${list(running)}`, 640);
const q1b = phone(`${menuBtn()}${list(running)}`, 640);
// Q2 grouping
const q2a = phone(`${chips}${list(running)}`, 700);
const q2b = phone(`${chips}${grouped()}`, 700);
// Q3 prompt preview
const q3a = phone(`${chips}${list(running)}`, 700);
const q3b = phone(`${chips}${list(running, { preview: true })}`, 700);

// Part 2
const allTab = phone(`<div class="chips"><span>Active</span><span class="on">All</span><span>Running</span><span>Waiting</span><span>Queued</span></div>${list([...running.slice(0, 2), ...done])}`, 720);
const emptyA = phone(`${chips}<div class="empty"><div class="tile">${ic("sparkle", 26)}</div><b>Nothing running</b>No unfinished Sessions in your Repositories.<br><a>See all Sessions ›</a></div>`, 620);

const live = (r: Row) => `<a><span class="mt f-${r.state}">${ic(stateIcon[r.state], 13)}</span><span class="t">${r.title}</span><span class="w">${r.when}</span></a>`;
const desk = `
<div class="scalebox" data-w="1180" data-h="760" data-min="0.62"><div class="screen desk mock">
  <aside class="d-side">
    <div class="d-brand">${logo(28, 8)}Atlas</div>
    <div class="d-search">${ic("search", 15)}Search<kbd>⌘K</kbd></div>
    <div class="seg"><span>Inbox</span><span class="on">Sessions</span><span>PRs</span><span>Repos</span></div>
    <nav class="lvl"><div class="h">Needs you</div>${inbox.needs.map(live).join("")}<div class="h">Working</div>${inbox.progress.map(live).join("")}</nav>
    <div class="d-foot"><span class="av">A</span>Acme team${ic("chevron", 14, "chev")}</div>
  </aside>
  <div class="d-main">
    <div class="d-bar"><span class="fpill">All Repositories ${ic("chevron", 13)}</span><span class="sp"></span></div>
    <div class="d-content"><h1>Sessions</h1>${chips}${list([...running, ...done])}</div>
  </div>
</div></div>
<p class="swipe">Swipe sideways to see the whole screen →</p>`;

type Pick = { title: string; o1: [string, string]; o2: [string, string]; a: string; b: string };
const picks: Pick[] = [
  { title: "Filtering by status", o1: ["Chips", "swipe a row of buttons"], o2: ["Menu button", "tap “Active ▾” to choose"], a: q1a, b: q1b },
  { title: "The list", o1: ["One list", "newest first, status on the right"], o2: ["Grouped", "Waiting · Running · Queued headings"], a: q2a, b: q2b },
  { title: "Your prompt in each row", o1: ["Hide it", "shorter rows"], o2: ["Show one line", "of what you asked"], a: q3a, b: q3b },
];

const opt = (n: 1 | 2, [name, note]: [string, string], inner: string) =>
  `<div class="opt"><div class="lab"><span>${n}</span>${name} <em>${note}</em></div>${inner}</div>`;

const checks = [
  { title: "“All”: finished Sessions show the PR or why it failed", body: allTab },
  { title: "Nothing running", body: emptyA },
  { title: "On a computer", body: desk },
];

const body = `<main class="tile-page">
  <h1>Sessions</h1>
  <p class="how">Every Session across your Repositories (the Sessions tab). <span class="phone-only">Tap <b>1</b> / <b>2</b> to flip.</span><br>
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

export const allSessionsPage = page({ look: { id: "a", name: "Sessions" }, screen: "inbox", title: "Sessions — pick", fonts: ["Inter", "Geist Mono"], css, body });
