// Phase 5.5: Pull requests and native PR stacks inside a Repository. Throwaway.
import { frameCss } from "./frame.ts";
import { ic, inbox, logo, page, stateIcon, type Row } from "./shared.ts";

const css = `${frameCss}
.scalebox.scroll{overflow-x:auto;-webkit-overflow-scrolling:touch}
.swipe{display:none;font-size:13px;color:var(--ter);margin:8px 0 0;text-align:center}
@media (max-width:760px){.swipe{display:block}}
.pair.phones .scalebox.phone{max-width:320px}
.ph-bar{position:relative}
.ph-bar .bk{display:flex;align-items:center;gap:2px;color:var(--link);font-size:16px}
.ph-content{overflow:hidden}
.ph h1.st{font-size:26px;margin:0 0 4px;letter-spacing:-.022em;display:block}
.desc{color:var(--sec);font-size:14.5px;margin:0 0 14px}
.segtabs{display:flex;background:var(--fill);border-radius:10px;padding:2px;margin:4px 0 16px}
.segtabs span{flex:1;text-align:center;padding:7px 0;border-radius:8px;font-size:13.5px;font-weight:600;color:var(--sec)}
.segtabs span.on{background:var(--card);color:var(--text);box-shadow:0 1px 2px rgb(0 0 0/.15)}
.sh{margin:18px 0 8px;font-size:17px;font-weight:700;display:flex;align-items:baseline;gap:8px}
.sh:first-of-type{margin-top:0}
.sh .n{font-size:13px;font-weight:500;color:var(--sec)}
.ph .row{padding:10px 12px;gap:12px;min-height:56px}
.ph .row+.row::before{left:56px}
.prt{width:32px;height:32px;border-radius:9px;display:grid;place-items:center;background:var(--fill);color:var(--sec);flex-shrink:0}
.prt.open{background:color-mix(in srgb,var(--f-succeeded) 18%,transparent);color:var(--t-succeeded)}
.prt.merged{background:color-mix(in srgb,#AF52DE 20%,transparent);color:#BF5AF2}
.chip.p-merged{background:color-mix(in srgb,#AF52DE 18%,transparent);color:#BF5AF2}
.chip.p-open{background:color-mix(in srgb,var(--f-succeeded) 16%,transparent);color:var(--t-succeeded)}
.chip.p-closed{background:color-mix(in srgb,var(--f-failed) 14%,transparent);color:var(--t-failed)}
.stop .dot i.closed{box-shadow:inset 0 0 0 2.5px var(--t-failed)}
.chip.p-draft{background:var(--fill);color:var(--sec)}
.num2{font:600 12.5px "Geist Mono",monospace;color:var(--ter)}
/* stack: connected line */
.train{background:var(--card);border-radius:16px;padding:12px 12px 4px}
.train .th{display:flex;align-items:center;gap:8px;font-weight:650;font-size:15px;margin:0 0 6px}
.train .th .ic{color:var(--sec)}.train .th .n{margin-left:auto;font-weight:500;font-size:13px;color:var(--sec)}
.stop{display:flex;gap:12px;align-items:center;position:relative;padding:8px 0;min-height:50px}
.stop .dot{width:22px;display:flex;justify-content:center;flex-shrink:0;align-self:stretch;position:relative}
.stop::before{content:"";position:absolute;top:0;bottom:0;left:10px;width:2px;background:var(--sep)}
.stop.first::before{top:50%}.stop.last::before{bottom:50%}
.stop .dot i{position:relative;align-self:center;width:12px;height:12px;border-radius:50%;background:var(--card);box-shadow:inset 0 0 0 2.5px var(--ter)}
.stop .dot i.merged{background:#BF5AF2;box-shadow:none}.stop .dot i.open{box-shadow:inset 0 0 0 2.5px var(--t-succeeded)}
.stop .grow{flex:1;min-width:0}.stop b{font-weight:500;font-size:15px;display:block}.stop span.s{font-size:12.5px;color:var(--sec)}
.toptag{font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--link);margin-left:6px}
/* stack: plain group */
.ghead{display:flex;align-items:center;gap:12px;padding:12px;font-weight:650}
.ghead .n{margin-left:auto;font-weight:500;font-size:13px;color:var(--sec)}
.ghead+.row::before{content:"";position:absolute;top:0;left:12px;right:0;border-top:1px solid var(--sep)}
.elig{display:flex;gap:8px;align-items:flex-start;font-size:13px;line-height:1.35;padding:10px 12px;color:var(--sec);border-top:1px solid var(--sep);margin:6px -12px 0}
.elig .ic{flex-shrink:0;margin-top:1px}
.elig.ok .ic{color:var(--t-succeeded)}.elig.no .ic{color:var(--ter)}
.rowelig{font-size:12.5px;display:flex;gap:4px;align-items:center;margin-top:2px}
.rowelig.ok{color:var(--t-succeeded)}.rowelig.no{color:var(--ter)}
.amber{display:flex;gap:10px;align-items:flex-start;padding:10px 12px;border-radius:12px;background:color-mix(in srgb,var(--f-waiting) 14%,transparent);font-size:13.5px;margin:0 0 14px;line-height:1.4}
.amber .ic{color:var(--t-waiting);flex-shrink:0;margin-top:1px}.amber b{display:block}
.empty{text-align:center;padding:40px 20px;color:var(--sec);font-size:14.5px;line-height:1.45}
.empty .tile{width:56px;height:56px;border-radius:16px;margin:0 auto 12px;background:var(--fill);color:var(--sec)}
.empty b{display:block;color:var(--text);font-size:17px;margin-bottom:4px}
.fresh{font-size:12.5px;color:var(--ter);margin:12px 4px 0}
/* desktop */
.desk{width:1180px;height:760px}
.d-content{overflow:hidden;flex:1}
.d-content h1{font-size:30px;margin:0 0 2px}
.d-content .segtabs{max-width:420px}
.dcols{display:grid;grid-template-columns:1fr 1fr;gap:24px}
`;

type Pr = { n: number; t: string; st: "merged" | "open" | "draft" | "closed"; base: string; when: string };
const stack: Pr[] = [
  { n: 40, t: "Extract webhook signer", st: "merged", base: "main", when: "3d" },
  { n: 42, t: "Refund idempotency keys", st: "open", base: "#40", when: "1d" },
  { n: 45, t: "Idempotency for partial refunds", st: "draft", base: "#42", when: "2h" },
];
const solo: (Pr & { ok: boolean; why: string })[] = [
  { n: 44, t: "Retry failed webhooks with backoff", st: "open", base: "main", when: "8m", ok: true, why: "Can start a Session on top" },
  { n: 47, t: "Bump card SDK to v12", st: "draft", base: "release/2.x", when: "5h", ok: false, why: "Based on release/2.x, not main" },
];
const label = { merged: "Merged", open: "Open", draft: "Draft", closed: "Closed" };

const tabs = `<nav class="ph-tabs"><a>${ic("inbox", 25)}Inbox</a><a>${ic("sparkle", 25)}Sessions</a><a>${ic("pr", 25)}PRs</a><a class="on">${ic("folder", 25)}Repos</a><a>${ic("more", 25)}More</a></nav>`;
const phone = (inner: string, h = 780) => `
<div class="scalebox phone" data-w="375" data-h="${h}"><div class="screen ph mock">
  <div class="ph-status"></div><div class="ph-bar"><span class="bk">${ic("back", 22)}Repos</span><span class="sp"></span><span class="ib">${ic("more", 24)}</span></div>
  <div class="ph-content"><h1 class="st">payments-api</h1><p class="desc">Charges, refunds and webhooks</p>
  <div class="segtabs"><span>Specs</span><span class="on">Pull requests</span><span>Sessions</span></div>${inner}</div>${tabs}
</div></div>`;

const okLine = `<div class="elig ok">${ic("check", 16)}<span>Can start a Session as the next layer</span></div>`;
const noLine = `<div class="elig no">${ic("x", 16)}<span>Can’t build on this: a closed layer blocks the stack</span></div>`;

const train = (order: Pr[], elig = "") => `<div class="train"><div class="th">${ic("stack", 18)}Stack #3<span class="n">${stack.length} layers</span></div>
${order
  .map(
    (p, i) => `<div class="stop${i === 0 ? " first" : ""}${i === order.length - 1 ? " last" : ""}"><span class="dot"><i class="${p.st}"></i></span><div class="grow"><b>${p.t}${p === stack[stack.length - 1] ? `<span class="toptag">Top</span>` : ""}</b><span class="s"><span class="num2">#${p.n}</span> · ${p.when} ago</span></div><span class="chip p-${p.st}">${label[p.st]}</span></div>`,
  )
  .join("")}${elig}</div>`;

const grouped = `<div class="group"><div class="ghead">${ic("stack", 18)}Stack #3<span class="n">${stack.length} layers</span></div>
${stack
  .map(
    (p, i) => `<div class="row"><span class="num2" style="width:20px;text-align:center">${i + 1}.</span><span class="row-main"><span class="row-title">${p.t}</span><span class="row-sub">#${p.n} · into ${p.base}${i === stack.length - 1 ? " · top" : ""}</span></span><span class="row-end"><span class="chip p-${p.st}">${label[p.st]}</span></span></div>`,
  )
  .join("")}</div>`;

const soloRows = (elig: boolean) => `<div class="group">${solo
  .map(
    (p) => `<div class="row"><span class="prt ${p.st}">${ic("pr", 17)}</span><span class="row-main"><span class="row-title">${p.t}</span><span class="row-sub">#${p.n} · into ${p.base} · ${p.when} ago</span>${
      elig ? `<span class="rowelig ${p.ok ? "ok" : "no"}">${ic(p.ok ? "check" : "x", 13)}${p.why}</span>` : ""
    }</span><span class="row-end"><span class="chip p-${p.st}">${label[p.st]}</span></span></div>`,
  )
  .join("")}</div>`;

const content = (o: { stack: string; elig?: boolean }) =>
  `<div class="sh">Stacks <span class="n">1</span></div>${o.stack}<div class="sh">Pull requests <span class="n">${solo.length}</span></div>${soloRows(!!o.elig)}<p class="fresh">Checked GitHub 2 min ago</p>`;

// Q1: stack look (no eligibility shown)
const q1a = phone(content({ stack: train(stack) }), 820);
const q1b = phone(content({ stack: grouped }), 820);
// Q2: layer order
const q2a = phone(content({ stack: train(stack) }), 820);
const q2b = phone(content({ stack: train([...stack].reverse()) }), 820);
// Q3: whether "can start here" is shown
const q3a = phone(content({ stack: train(stack, okLine), elig: true }), 900);
const q3b = phone(content({ stack: train(stack) }), 900);

// Part 2
const unverified = phone(
  `<div class="amber">${ic("warn", 17)}<div><b>Couldn’t check GitHub just now</b>Showing what Atlas last saw. Starting on these waits until GitHub can be checked.</div></div>
  <div class="sh">Stacks <span class="n">1</span></div>${train(stack)}`,
  760,
);
const blocked = phone(`<div class="sh">Stacks <span class="n">1</span></div>${train([stack[0]!, { ...stack[1]!, st: "closed" }, stack[2]!], noLine)}`, 640);
const empty = phone(
  `<div class="empty"><div class="tile">${ic("pr", 26)}</div><b>No open pull requests</b>Open pull requests and GitHub stacks for this Repository show up here.</div>`,
  640,
);

const live = (r: Row) => `<a><span class="mt f-${r.state}">${ic(stateIcon[r.state], 13)}</span><span class="t">${r.title}</span><span class="w">${r.when}</span></a>`;
const desk = `
<div class="scalebox" data-w="1180" data-h="760" data-min="0.62"><div class="screen desk mock">
  <aside class="d-side">
    <div class="d-brand">${logo(28, 8)}Atlas</div>
    <div class="d-search">${ic("search", 15)}Search<kbd>⌘K</kbd></div>
    <div class="seg"><span>Inbox</span><span>Sessions</span><span>PRs</span><span class="on">Repos</span></div>
    <nav class="lvl"><div class="h">Needs you</div>${inbox.needs.map(live).join("")}<div class="h">Working</div>${inbox.progress.map(live).join("")}</nav>
    <div class="d-foot"><span class="av">A</span>Acme team${ic("chevron", 14, "chev")}</div>
  </aside>
  <div class="d-main">
    <div class="d-bar"><span class="fpill">payments-api ${ic("chevron", 13)}</span><span class="sp"></span></div>
    <div class="d-content"><h1>payments-api</h1><p class="desc">Charges, refunds and webhooks</p>
      <div class="segtabs"><span>Specs</span><span class="on">Pull requests</span><span>Sessions</span></div>
      <div class="dcols"><div><div class="sh">Stacks <span class="n">1</span></div>${train(stack)}</div><div><div class="sh">Pull requests <span class="n">${solo.length}</span></div>${soloRows(false)}</div></div>
    </div>
  </div>
</div></div>
<p class="swipe">Swipe sideways to see the whole screen →</p>`;

type Pick = { title: string; o1: [string, string]; o2: [string, string]; a: string; b: string };
const picks: Pick[] = [
  { title: "How a stack looks", o1: ["Connected line", "layers joined like a timeline"], o2: ["Numbered list", "1, 2, 3 rows"], a: q1a, b: q1b },
  { title: "Stack order", o1: ["Oldest on top", "base layer first, like GitHub"], o2: ["Newest on top", "the top layer first"], a: q2a, b: q2b },
  { title: "“Can I start a Session here?”", o1: ["Show it here", "a line under each stack and PR"], o2: ["Only when starting", "in the Start Session form"], a: q3a, b: q3b },
];

const opt = (n: 1 | 2, [name, note]: [string, string], inner: string) =>
  `<div class="opt"><div class="lab"><span>${n}</span>${name} <em>${note}</em></div>${inner}</div>`;

const checks = [
  { title: "Atlas couldn’t check GitHub", body: unverified },
  { title: "A stack you can’t build on", body: blocked },
  { title: "No pull requests yet", body: empty },
  { title: "On a computer", body: desk },
];

const body = `<main class="tile-page">
  <h1>Pull requests</h1>
  <p class="how">A Repository’s open pull requests and GitHub stacks. Atlas only reads these; it never changes them. <span class="phone-only">Tap <b>1</b> / <b>2</b> to flip.</span><br>
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

export const prsPage = page({ look: { id: "a", name: "Pull requests" }, screen: "inbox", title: "Pull requests — pick", fonts: ["Inter", "Geist Mono"], css, body });
