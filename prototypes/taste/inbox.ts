// Phase 5.1: the Inbox screen with the locked frame. Throwaway.
import { frameCss } from "./frame.ts";
import { ic, inbox, logo, page, session, stateIcon, stateLabel, type Row, type State } from "./shared.ts";

const css = `${frameCss}
.scalebox.scroll{overflow-x:auto;-webkit-overflow-scrolling:touch}
.swipe{display:none;font-size:13px;color:var(--ter);margin:8px 0 0;text-align:center}
.desk{width:1180px;height:760px}
.d-content{overflow:hidden;flex:1}
.d-content .eyebrow{margin:0 0 2px}
.d-head{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;margin-bottom:6px}
.d-head h1{margin:0}
.lede{color:var(--sec);font-size:15.5px;margin:0 0 22px}
.lede b{color:var(--text);font-weight:600}
.need{display:flex;gap:16px;align-items:center;padding:18px 20px;border-radius:18px;background:var(--card);box-shadow:inset 0 0 0 1.5px color-mix(in srgb,var(--f-waiting) 45%,transparent)}
.need .grow{flex:1;min-width:0}
.need .k{font-size:12.5px;font-weight:700;color:var(--t-waiting);text-transform:uppercase;letter-spacing:.04em}
.need .t{font-size:19px;font-weight:700;letter-spacing:-.018em;margin:3px 0 2px}
.need .s{color:var(--sec);font-size:14px}
.need .acts{display:flex;gap:8px;flex-shrink:0}
.btn.outline{background:none;color:var(--text);box-shadow:inset 0 0 0 1.5px var(--sep)}
.sec-h{display:flex;align-items:baseline;gap:8px;margin:26px 0 10px;font-size:18px;font-weight:700;letter-spacing:-.015em}
.sec-h .n{font-size:14px;font-weight:500;color:var(--sec)}
.sec-h .more{margin-left:auto;font-size:14px;font-weight:500;color:var(--link)}
.cards3{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}
.wcard{background:var(--card);border-radius:16px;padding:14px;display:flex;flex-direction:column;gap:8px;min-width:0}
.wcard .top{display:flex;align-items:center;justify-content:space-between}
.wcard .tile{width:28px;height:28px;border-radius:8px}
.wcard .t{font-weight:600;font-size:15px;line-height:1.3;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.wcard .s{font-size:13px;color:var(--sec)}
.bar-p{height:4px;border-radius:2px;background:var(--fill);overflow:hidden}
.bar-p i{display:block;height:100%;width:40%;border-radius:2px;background:var(--f-running);animation:slide 1.6s ease-in-out infinite}
@keyframes slide{0%{transform:translateX(-100%)}100%{transform:translateX(250%)}}
.unread{position:absolute;left:5px;top:50%;width:8px;height:8px;margin-top:-4px;border-radius:50%;background:var(--link)}
.ready{display:flex;align-items:center;gap:12px;padding:14px 16px;border-radius:14px;background:var(--card);font-size:15px}
.ready .tile{background:var(--f-none)}
.ready .grow{flex:1}.ready a{color:var(--link);font-weight:600}
/* session-in-pane */
.sum{background:var(--card);border-radius:18px;padding:18px 20px;display:flex;gap:16px;align-items:flex-start;margin-bottom:6px}
.sum .big{font-size:20px;font-weight:750;letter-spacing:-.02em}
.sum p{margin:4px 0 0;color:var(--sec)}
.sum .acts{display:flex;gap:8px;margin-top:14px}
.title-row{display:flex;justify-content:space-between;gap:16px;align-items:flex-start;margin-bottom:18px}
.title-row h1{font-size:28px!important;line-height:1.15;margin:0!important}
.icon-btn{width:40px;height:40px;border-radius:12px;box-shadow:inset 0 0 0 1.5px var(--sep);display:grid;place-items:center;flex-shrink:0}
.act{display:flex;gap:12px;padding:11px 16px;position:relative;font-size:14.5px}
.act+.act::before{content:"";position:absolute;top:0;left:56px;right:0;border-top:1px solid var(--sep)}
.act .tile{width:28px;height:28px;border-radius:8px;background:var(--fill);color:var(--sec)}
.act.msg .tile{background:var(--f-none);color:#fff}
.act .body{flex:1;min-width:0}.act .time{font-size:12.5px;color:var(--ter);padding-top:4px}
.act .x{color:var(--sec);font-size:13px;margin-left:6px}
/* phone list */
.ph-content{overflow:hidden}
.ph .sec-h{font-size:17px;margin:18px 0 8px}
.ph .need{padding:14px;gap:12px;flex-wrap:wrap}
.ph .need .t{font-size:16px}
.ph .need .acts{width:100%}.ph .need .acts .btn{flex:1;justify-content:center;height:38px;font-size:14px}
.ph .tile.lg{width:40px;height:40px;border-radius:11px}
.ph .unread{left:4px}
.hint{font-size:13px;color:var(--ter);text-align:center;margin:10px 0 0}
@media (max-width:760px){.swipe{display:block}}
`;

const chip = (s: State) => `<span class="chip p-${s}">${stateLabel[s]}</span>`;

const liveList = (selected?: string) => {
  const it = (r: Row) =>
    `<a class="${r.title === selected ? "on" : ""}"><span class="mt f-${r.state}">${ic(stateIcon[r.state], 13)}</span><span class="t">${r.title}</span><span class="w">${r.when}</span></a>`;
  return `<div class="seg"><span class="on">Inbox</span><span>Sessions</span><span>PRs</span><span>Repos</span></div>
  <nav class="lvl">
    <div class="h">Needs you</div>${inbox.needs.map(it).join("")}
    <div class="h">Working</div>${inbox.progress.map(it).join("")}
    <div class="h">Not started</div>${inbox.notStarted.map(it).join("")}
    <div class="h">Settled</div>${inbox.settled.map(it).join("")}
  </nav>`;
};

const desk = (main: string, selected?: string) => `
<div class="scalebox" data-w="1180" data-h="760" data-min="0.62"><div class="screen desk mock">
  <aside class="d-side">
    <div class="d-brand">${logo(28, 8)}Atlas</div>
    <div class="d-search">${ic("search", 15)}Search<kbd>⌘K</kbd></div>
    ${liveList(selected)}
    <div class="d-foot"><span class="av">A</span>Acme team${ic("chevron", 14, "chev")}</div>
  </aside>
  <div class="d-main">
    <div class="d-bar"><span class="fpill">All Repositories ${ic("chevron", 13)}</span><span class="sp"></span></div>
    <div class="d-content">
      <div class="strip">${ic("warn", 17)}<span>Backup and storage status unknown</span><a>Details</a></div>
      ${main}
    </div>
  </div>
</div></div>
<p class="swipe">Swipe sideways to see the whole screen →</p>`;

const need = inbox.needs[0]!;

const overview = desk(`
  <p class="eyebrow">Wednesday, 18 November</p>
  <h1>Inbox</h1>
  <p class="lede"><b>1</b> needs you · <b>3</b> working · <b>2</b> new results</p>
  <div class="need">
    <span class="tile lg f-waiting">${ic("question", 26)}</span>
    <div class="grow"><div class="k">Needs you · 4m ago</div><div class="t">${need.title}</div><div class="s">${need.repo} · Spec #${need.spec} · The Agent asked a question. Answer it in OpenCode.</div></div>
    <div class="acts"><a class="btn">Open Session</a></div>
  </div>
  <div class="sec-h">Working now <span class="n">3</span></div>
  <div class="cards3">${inbox.progress
    .map(
      (r) => `<div class="wcard"><div class="top"><span class="tile f-${r.state}">${ic(stateIcon[r.state], 15)}</span>${chip(r.state)}</div>
      <div class="t">${r.title}</div><div class="s">${r.repo} · ${r.note}</div>${r.state === "running" ? `<div class="bar-p"><i></i></div>` : ""}</div>`,
    )
    .join("")}</div>
  <div class="sec-h">New results <span class="n">2</span><span class="more">See all settled</span></div>
  <div class="group">${inbox.settled
    .filter((r) => r.unread)
    .map(
      (r) => `<div class="row"><span class="unread"></span><span class="tile f-${r.state}">${ic(stateIcon[r.state], 18)}</span>
      <span class="row-main"><span class="row-title">${r.title}</span><span class="row-sub">${r.repo} · ${r.note}</span></span>
      <span class="row-end">${chip(r.state)}<span class="time">${r.when} ago</span></span></div>`,
    )
    .join("")}</div>
`);

const openItem = desk(
  `
  <p class="eyebrow">${need.repo} · Spec #${need.spec}</p>
  <div class="title-row"><h1>${need.title}</h1><span class="icon-btn">${ic("more", 20)}</span></div>
  <div class="sum">
    <span class="tile lg f-waiting">${ic("question", 26)}</span>
    <div><div class="big t-waiting">Waiting for an answer</div>
    <p>The Agent asked a question 4 minutes ago. Answer it in OpenCode; Atlas can’t reply.</p>
    <div class="acts"><a class="btn outline">${ic("external", 16)}Spec on GitHub</a></div></div>
  </div>
  <div class="sec-h">Activity</div>
  <div class="group">
    <div class="act msg"><span class="tile">${ic("sparkle", 15)}</span><div class="body"><b>Agent</b><div>Should refunds without a key be rejected, or should Atlas generate one?</div></div><span class="time">10:41</span></div>
    <div class="act"><span class="tile">${ic("eye", 15)}</span><div class="body"><b>Read</b> <span class="mono">src/refunds/create.ts</span></div><span class="time">10:39</span></div>
    <div class="act"><span class="tile">${ic("search", 15)}</span><div class="body"><b>Searched</b> <span class="mono">idempotency</span><span class="x">3 matches</span></div><span class="time">10:38</span></div>
  </div>
`,
  need.title,
);

// Phone: the Inbox tab is the list itself.
const phRow = (r: Row) => `<div class="row">${r.unread ? '<span class="unread"></span>' : ""}<span class="tile f-${r.state}">${ic(stateIcon[r.state], 17)}</span>
<span class="row-main"><span class="row-title">${r.title}</span><span class="row-sub">${r.repo} · ${r.state === "none" ? "Not started" : r.note}</span></span>
<span class="row-end">${r.state === "none" ? "" : chip(r.state)}<span class="time">${r.when}</span></span></div>`;

const phone = `
<div class="scalebox phone" data-w="375" data-h="1180"><div class="screen ph mock">
  <div class="ph-status"></div>
  <div class="ph-bar">${logo(26, 7)}<b>Atlas</b><span class="sp"></span><span class="ib">${ic("search", 22)}</span></div>
  <div class="ph-content">
    <div class="strip">${ic("warn", 16)}<span>Backup status unknown</span><a>Details</a></div>
    <h1>Inbox<span class="fpill">All ${ic("chevron", 12)}</span></h1>
    <div class="need">
      <span class="tile lg f-waiting">${ic("question", 22)}</span>
      <div class="grow"><div class="k">Needs you · 4m</div><div class="t">${need.title}</div><div class="s">${need.repo} · Answer the Agent in OpenCode</div></div>
      <div class="acts"><a class="btn">Open Session</a></div>
    </div>
    <div class="sec-h">Working <span class="n">3</span></div>
    <div class="group">${inbox.progress.map(phRow).join("")}</div>
    <div class="sec-h">Not started <span class="n">3</span></div>
    <div class="group">${inbox.notStarted.map(phRow).join("")}</div>
    <div class="sec-h">Settled <span class="n">2 new</span></div>
    <div class="group">${inbox.settled.map(phRow).join("")}</div>
  </div>
  <nav class="ph-tabs"><a class="on">${ic("inbox", 25)}Inbox</a><a>${ic("sparkle", 25)}Sessions</a><a>${ic("pr", 25)}PRs</a><a>${ic("folder", 25)}Repos</a><a>${ic("more", 25)}More</a></nav>
</div></div>`;

const opt = (n: 1 | 2, name: string, note: string, inner: string) =>
  `<div class="opt"><div class="lab"><span>${n}</span>${name} <em>${note}</em></div>${inner}</div>`;

const body = `<main class="tile-page">
  <h1>Inbox</h1>
  <p class="how">On a computer, the sidebar already lists every Spec. So what should the big area show when you open the Inbox? <span class="phone-only">Tap <b>1</b> / <b>2</b> to flip.</span><br>
  Reply with <b>1 or 2</b>, and say if anything on the phone Inbox (part 2) looks wrong.</p>
  <div class="part-h">Part 1 · Pick one</div>
  <section class="q">
    <h2><span class="num">1</span>Computer: the main area of the Inbox</h2>
    <div class="switch" role="radiogroup" aria-label="Choice 1">
      <label><input class="o1" type="radio" name="q0" checked><span>1 · Today overview</span></label>
      <label><input class="o2" type="radio" name="q0"><span>2 · Open top item</span></label>
    </div>
    <div class="pair">
      ${opt(1, "Today overview", "what needs you, what’s working, new results", overview)}
      ${opt(2, "Open the top item", "like Mail: the first Session that needs you opens", openItem)}
    </div>
  </section>
  <div class="part-h">Part 2 · Just check: the Inbox on a phone</div>
  <section class="q"><h2><span class="num check">A</span>Phone Inbox (the whole list)</h2><div class="solo">${phone}</div></section>
</main>
<script>
(() => {
  const fit = (box) => {
    const cw = +box.dataset.w, ch = +box.dataset.h, min = innerWidth <= 760 ? +(box.dataset.min || 0) : 0;
    let s = box.clientWidth / cw;
    const scroll = s < min; if (scroll) s = min;
    box.classList.toggle("scroll", scroll);
    box.style.height = ch * s + "px";
    const sc = box.querySelector(".screen");
    sc.style.transform = "scale(" + s + ")";
    let sizer = box.querySelector(".sizer");
    if (!sizer) { sizer = document.createElement("div"); sizer.className = "sizer"; sizer.style.height = "1px"; box.appendChild(sizer); }
    sizer.style.width = cw * s + "px";
  };
  const ro = new ResizeObserver((es) => es.forEach((e) => fit(e.target)));
  document.querySelectorAll(".scalebox").forEach((b) => { const sc = b.querySelector(".screen"); sc.style.width = b.dataset.w + "px"; sc.style.height = b.dataset.h + "px"; ro.observe(b); });
})();
</script>`;

void session;
export const inboxPage = page({ look: { id: "a", name: "Inbox" }, screen: "inbox", title: "Inbox — pick a layout", fonts: ["Inter", "Geist Mono"], css, body });
