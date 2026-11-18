// Phase 5.3: Spec page + Start Session. Throwaway.
import { frameCss } from "./frame.ts";
import { ic, inbox, logo, page, stateIcon, type Row } from "./shared.ts";

const css = `${frameCss}
.scalebox.scroll{overflow-x:auto;-webkit-overflow-scrolling:touch}
.swipe{display:none;font-size:13px;color:var(--ter);margin:8px 0 0;text-align:center}
@media (max-width:760px){.swipe{display:block}}
.pair.phones .scalebox.phone{max-width:320px}
.ph-bar .bk{display:flex;align-items:center;gap:2px;color:var(--link);font-size:16px}
.ph-bar .ct{position:absolute;left:0;right:0;text-align:center;font-weight:650;font-size:17px;pointer-events:none}
.ph-bar{position:relative}
.ph-bar .lnk{color:var(--link);font-size:16px}
.ph-content{overflow:hidden}
.ph .eyebrow{margin:6px 0 2px}
.ph h1.st{font-size:26px;line-height:1.2;letter-spacing:-.022em;margin:0 0 10px;display:block}
.labels{display:flex;gap:6px;margin:0 0 14px}
.labels span{font-size:12.5px;font-weight:600;padding:3px 9px;border-radius:999px;background:var(--fill);color:var(--sec)}
.labels span.sp{background:color-mix(in srgb,var(--f-running) 16%,transparent);color:var(--t-running)}
.bigbtn{display:flex;align-items:center;justify-content:center;gap:8px;height:48px;border-radius:14px;background:var(--btn);color:#fff;font-weight:650;font-size:16px}
.bigbtn.off{background:var(--fill);color:var(--ter)}
.sh{margin:20px 0 8px;font-size:17px;font-weight:700;letter-spacing:-.012em;display:flex;align-items:baseline;gap:8px}
.sh .n{font-size:13px;font-weight:500;color:var(--sec)}
.prose2{background:var(--card);border-radius:14px;padding:14px;font-size:14.5px;line-height:1.55}
.prose2 h4{margin:0 0 4px;font-size:14.5px}.prose2 p{margin:0 0 10px;color:var(--sec)}.prose2 ul{margin:0;padding-left:18px;color:var(--sec)}
.prose2 code{font:12.5px "Geist Mono",monospace;background:var(--fill);padding:1px 5px;border-radius:5px}
.ph .row{padding:10px 12px;gap:12px;min-height:56px}
.sticky{position:absolute;left:0;right:0;bottom:84px;padding:12px 16px;background:var(--bar);backdrop-filter:blur(20px);border-top:1px solid var(--sep)}
.fl{font-size:13px;font-weight:600;color:var(--sec);text-transform:uppercase;letter-spacing:.04em;margin:18px 4px 6px}
.fh{font-size:13px;color:var(--sec);margin:6px 4px 0;line-height:1.4}
.setrow{display:flex;gap:12px;align-items:center;padding:12px 14px;position:relative;min-height:54px}
.setrow+.setrow::before{content:"";position:absolute;top:0;left:14px;right:0;border-top:1px solid var(--sep)}
.setrow .grow{flex:1;min-width:0}.setrow b{display:block;font-weight:500;font-size:15px}.setrow span{font-size:13px;color:var(--sec)}
.setrow .tick{color:var(--btn)}.setrow.off b{color:var(--ter)}
.setrow .val{color:var(--sec);font-size:15px;text-align:right}
.setrow .chev{color:var(--ter)}
.ta{border-radius:12px;background:var(--card);box-shadow:inset 0 0 0 1.5px var(--sep);padding:12px 14px;font-size:15px;line-height:1.45;min-height:130px;color:var(--text)}
.ta .cur{display:inline-block;width:2px;height:18px;background:var(--btn);vertical-align:-3px;animation:pulse 1s steps(2) infinite}
.ta.err{box-shadow:inset 0 0 0 2px var(--t-failed)}
.errbox{display:flex;gap:10px;padding:12px 14px;border-radius:14px;background:color-mix(in srgb,var(--f-failed) 12%,var(--card));margin-top:12px;font-size:14px}
.errbox .ic{color:var(--t-failed);flex-shrink:0;margin-top:1px}.errbox b{display:block}.errbox a{color:var(--link);font-weight:600;display:inline-block;margin-top:6px}
.note2{display:flex;gap:10px;padding:12px 14px;border-radius:14px;background:var(--card);font-size:14px;color:var(--sec)}
.note2 .ic{flex-shrink:0;margin-top:1px}.note2 b{color:var(--text);display:block}
.ph-sheet2{position:absolute;left:0;right:0;bottom:0;top:190px;background:var(--side);border-radius:22px 22px 0 0;padding:8px 16px 30px;box-shadow:0 -10px 40px rgb(0 0 0/.35)}
.ph-sheet2 .grab{width:38px;height:5px;border-radius:3px;background:var(--fill);margin:0 auto 6px}
.ph-sheet2 .hd{display:flex;align-items:center;justify-content:space-between;height:40px;position:relative}
.ph-sheet2 .hd b{position:absolute;left:0;right:0;text-align:center;font-size:17px;pointer-events:none}
.ph-sheet2 .hd a{color:var(--link);font-size:16px}
.mini{font-size:14px;color:var(--sec);margin:4px 4px 0}
.mini b{color:var(--text)}
/* desktop */
.desk{width:1180px;height:760px}
.d-content{overflow:hidden;flex:1}
.d-content .title-row{display:flex;justify-content:space-between;gap:16px;align-items:flex-start;margin-bottom:10px}
.d-content .title-row h1{font-size:30px;line-height:1.15;margin:0}
.d-content .acts{display:flex;gap:8px;flex-shrink:0}
.btn.outline{background:none;color:var(--text);box-shadow:inset 0 0 0 1.5px var(--sep)}
.dcols{display:grid;grid-template-columns:1fr 300px;gap:24px}
.modal-dim{position:absolute;inset:0;background:rgb(0 0 0/.4);display:flex;justify-content:center;align-items:flex-start;padding-top:60px}
.modal{width:520px;background:var(--bg);border-radius:20px;padding:18px 20px 20px;box-shadow:0 30px 80px rgb(0 0 0/.45),0 0 0 1px var(--sep)}
.modal .mh{display:flex;align-items:center;justify-content:space-between;margin-bottom:4px}
.modal .mh b{font-size:19px}
.modal .foot{display:flex;justify-content:flex-end;gap:8px;margin-top:16px}
`;

const tabs = `<nav class="ph-tabs"><a>${ic("inbox", 25)}Inbox</a><a>${ic("sparkle", 25)}Sessions</a><a>${ic("pr", 25)}PRs</a><a class="on">${ic("folder", 25)}Repos</a><a>${ic("more", 25)}More</a></nav>`;

const specText = `<div class="prose2"><h4>Goal</h4><p>Customers can’t tell our webhooks from forged ones. Sign every outgoing delivery.</p>
<h4>Acceptance</h4><ul><li>HMAC-SHA256 signature in an <code>Atlas-Signature</code> header</li><li>Secret is per endpoint and can be rotated</li><li>Docs show how to verify</li></ul></div>`;

const history = `<div class="group"><div class="row"><span class="tile f-failed">${ic("x", 17)}</span><span class="row-main"><span class="row-title">Attempt 1</span><span class="row-sub">Tests failed · 2 days ago</span></span><span class="row-end"><span class="chip p-failed">Failed</span></span></div></div>`;

const head = `<p class="eyebrow">payments-api · Spec #16</p><h1 class="st">Sign outgoing webhooks</h1>
<div class="labels"><span class="sp">spec</span><span>backend</span><span>security</span></div>`;

const phone = (bar: string, inner: string, h = 780, overlay = "", extra = "") => `
<div class="scalebox phone" data-w="375" data-h="${h}"><div class="screen ph mock">
  <div class="ph-status"></div>
  <div class="ph-bar">${bar}</div>
  <div class="ph-content">${inner}</div>
  ${extra}
  ${tabs}
  ${overlay}
</div></div>`;

const specBar = `<span class="bk">${ic("back", 22)}payments-api</span><span class="sp"></span><span class="ib">${ic("more", 24)}</span>`;
const startBtn = (off = false) => `<a class="bigbtn${off ? " off" : ""}">${ic("play", 18)}Start Session</a>`;

const targets = `<div class="group">
  <div class="setrow"><div class="grow"><b>Default branch · main</b><span>Start fresh from the latest main</span></div>${ic("check", 20, "tick")}</div>
  <div class="setrow"><div class="grow"><b>On top of PR #42</b><span>Refund idempotency keys</span></div></div>
  <div class="setrow off"><div class="grow"><b>Stack #3</b><span>Can’t use: auto-merge is on for the top layer</span></div></div>
</div>`;
const prompt = (err = false) => `<div class="ta${err ? " err" : ""}">Use the existing secrets table. Keep the diff small and add tests.<span class="cur"></span></div>
<p class="fh">Required. Tell the Agent what to do. Atlas sends it exactly as written.</p>`;

const startFormA = `<div class="fl">Start from</div>${targets}<div class="fl">Prompt</div>${prompt()}`;
const startFormB = `<div class="fl">Prompt</div>${prompt()}
<div class="group" style="margin-top:16px"><div class="setrow"><div class="grow"><b>Start from</b></div><span class="val">Default branch · main</span>${ic("chevron", 15, "chev")}</div></div>`;

// Q1: separate page vs sheet
const startPage = phone(
  `<span class="lnk">Cancel</span><span class="ct">Start Session</span><span class="sp"></span><span class="lnk" style="font-weight:650">Start</span>`,
  `<p class="mini" style="margin-top:8px">For <b>Sign outgoing webhooks</b> · Spec #16</p>${startFormA}`,
  780,
);
const startSheet = phone(
  specBar,
  `${head}${startBtn()}`,
  780,
  `<div class="ph-dim"></div><div class="ph-sheet2"><div class="grab"></div>
   <div class="hd"><a>Cancel</a><b>Start Session</b><a style="font-weight:650">Start</a></div>
   <p class="mini">For <b>Sign outgoing webhooks</b></p>${startFormA}</div>`,
);

// Q2: button placement on the Spec page
const btnTop = phone(specBar, `${head}${startBtn()}<div class="sh">Spec</div>${specText}<div class="sh">Sessions <span class="n">1</span></div>${history}`, 900);
const btnSticky = phone(specBar, `${head}<div class="sh" style="margin-top:6px">Spec</div>${specText}<div class="sh">Sessions <span class="n">1</span></div>${history}`, 900, "", `<div class="sticky">${startBtn()}</div>`);

// Q3: form order
const orderA = phone(`<span class="lnk">Cancel</span><span class="ct">Start Session</span><span class="sp"></span><span class="lnk" style="font-weight:650">Start</span>`, `<p class="mini" style="margin-top:8px">For <b>Sign outgoing webhooks</b></p>${startFormA}`, 700);
const orderB = phone(`<span class="lnk">Cancel</span><span class="ct">Start Session</span><span class="sp"></span><span class="lnk" style="font-weight:650">Start</span>`, `<p class="mini" style="margin-top:8px">For <b>Sign outgoing webhooks</b></p>${startFormB}`, 700);

// Part 2
const already = phone(
  `<span class="lnk">Cancel</span><span class="ct">Start Session</span><span class="sp"></span><span class="lnk" style="font-weight:650">Start</span>`,
  `<p class="mini" style="margin-top:8px">For <b>Sign outgoing webhooks</b></p>
   <div class="errbox">${ic("warn", 18)}<div><b>Session not queued</b>This Spec already has an unfinished Session. Only one at a time.<br><a>Open the existing Session ›</a></div></div>
   ${startFormA}`,
  860,
);
const cannot = phone(
  specBar,
  `${head}<div class="note2">${ic("warn", 18)}<div><b>Can’t start Sessions here</b>Archived Repositories are browsable but can’t start Sessions.</div></div>
   <div class="sh">Spec</div>${specText}`,
  760,
);

const live = (r: Row) => `<a><span class="mt f-${r.state}">${ic(stateIcon[r.state], 13)}</span><span class="t">${r.title}</span><span class="w">${r.when}</span></a>`;
const desk = `
<div class="scalebox" data-w="1180" data-h="760" data-min="0.62"><div class="screen desk mock">
  <aside class="d-side">
    <div class="d-brand">${logo(28, 8)}Atlas</div>
    <div class="d-search">${ic("search", 15)}Search<kbd>⌘K</kbd></div>
    <div class="seg"><span>Inbox</span><span>Sessions</span><span>PRs</span><span class="on">Repos</span></div>
    <nav class="lvl">
      <div class="h">Needs you</div>${inbox.needs.map(live).join("")}
      <div class="h">Working</div>${inbox.progress.map(live).join("")}
      <div class="h">Not started</div>${inbox.notStarted.map(live).join("")}
    </nav>
    <div class="d-foot"><span class="av">A</span>Acme team${ic("chevron", 14, "chev")}</div>
  </aside>
  <div class="d-main">
    <div class="d-bar"><span class="fpill">payments-api ${ic("chevron", 13)}</span><span class="sp"></span></div>
    <div class="d-content">
      <p class="eyebrow">payments-api · Spec #16</p>
      <div class="title-row"><h1>Sign outgoing webhooks</h1><div class="acts"><a class="btn outline">${ic("external", 16)}GitHub</a><a class="btn">${ic("play", 16)}Start Session</a></div></div>
      <div class="labels"><span class="sp">spec</span><span>backend</span><span>security</span></div>
      <div class="dcols"><div><div class="sh" style="margin-top:4px">Spec</div>${specText}</div><div><div class="sh" style="margin-top:4px">Sessions <span class="n">1</span></div>${history}</div></div>
    </div>
  </div>
  <div class="modal-dim"><div class="modal"><div class="mh"><b>Start Session</b>${ic("x", 20)}</div>
    <p class="mini" style="margin:0">For <b>Sign outgoing webhooks</b> · Spec #16</p>
    __FORM__
    <div class="foot"><a class="btn outline">Cancel</a><a class="btn">${ic("play", 16)}Start Session</a></div></div></div>
</div></div>
<p class="swipe">Swipe sideways to see the whole screen →</p>`;

type Pick = { title: string; o1: [string, string]; o2: [string, string]; a: string; b: string };
const picks: Pick[] = [
  { title: "Tapping Start Session opens…", o1: ["A new page", "full screen"], o2: ["A sheet", "slides up over the Spec"], a: startPage, b: startSheet },
  { title: "Where the Start Session button sits", o1: ["Under the title", "scrolls away"], o2: ["Pinned at the bottom", "always in reach"], a: btnTop, b: btnSticky },
  { title: "The start form", o1: ["Choose where first", "all options shown"], o2: ["Prompt first", "“Start from” is one row; tap to change"], a: orderA, b: orderB },
];

const opt = (n: 1 | 2, [name, note]: [string, string], inner: string) =>
  `<div class="opt"><div class="lab"><span>${n}</span>${name} <em>${note}</em></div>${inner}</div>`;

const checks = [
  { title: "The Spec already has a Session going", body: already },
  { title: "The Repository can’t start Sessions", body: cannot },
  { title: "On a computer (start form in a pop-up)", body: desk.replace("__FORM__", startFormA) },
];

const body = `<main class="tile-page">
  <h1>Spec &amp; Start Session</h1>
  <p class="how">A Spec’s page, and how you start the Agent on it. <span class="phone-only">Tap <b>1</b> / <b>2</b> to flip.</span><br>
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

export const specPage = page({ look: { id: "a", name: "Spec" }, screen: "session", title: "Spec & Start Session — pick", fonts: ["Inter", "Geist Mono"], css, body });
