// Phase 5.4: Repositories list, one Repository, Add Repository. Throwaway.
import { frameCss } from "./frame.ts";
import { ic, page } from "./shared.ts";

const css = `${frameCss}
.pair.phones .scalebox.phone{max-width:320px}
.ph-bar{position:relative}
.ph-bar .bk{display:flex;align-items:center;gap:2px;color:var(--link);font-size:16px}
.ph-bar .ct{position:absolute;left:0;right:0;text-align:center;font-weight:650;font-size:17px;pointer-events:none}
.ph-bar .lnk{color:var(--link);font-size:16px}
.ph-content{overflow:hidden}
.ph h1.big{font-size:32px;margin:0 0 12px;letter-spacing:-.028em;display:flex;align-items:center;justify-content:space-between}
.ph h1.st{font-size:26px;margin:0 0 4px;letter-spacing:-.022em;display:block}
.desc{color:var(--sec);font-size:14.5px;margin:0 0 14px}
.ph .row{padding:10px 12px;gap:12px;min-height:58px}
.ph .row+.row::before{left:60px}
.chev{color:var(--ter)}
.rtile{width:36px;height:36px;border-radius:10px;display:grid;place-items:center;color:#fff;font-weight:750;font-size:15px;flex-shrink:0}
.c1{background:#5E5CE6}.c2{background:#0A84FF}.c3{background:#30B0C7}.c4{background:#8E8E93}
.rcards{display:flex;flex-direction:column;gap:10px}
.rcard{background:var(--card);border-radius:16px;padding:14px;display:flex;flex-direction:column;gap:8px}
.rcard .top{display:flex;align-items:center;gap:12px}
.rcard .nm{font-weight:650;font-size:16px}.rcard .fn{font-size:12.5px;color:var(--ter)}
.rcard .d{font-size:14px;color:var(--sec)}
.rcard .rstat{display:flex;gap:14px;font-size:13px;color:var(--sec);padding-top:8px;border-top:1px solid var(--sep)}
.rcard .rstat b{color:var(--text);font-weight:650}
.warnt{color:var(--t-waiting);font-size:12.5px;font-weight:600}
.segtabs{display:flex;background:var(--fill);border-radius:10px;padding:2px;margin:4px 0 14px}
.segtabs span{flex:1;text-align:center;padding:7px 0;border-radius:8px;font-size:13.5px;font-weight:600;color:var(--sec)}
.segtabs span.on{background:var(--card);color:var(--text);box-shadow:0 1px 2px rgb(0 0 0/.15)}
.navrows{margin-bottom:16px}
.navrows .row{min-height:50px}
.navrows .ri{width:30px;height:30px;border-radius:8px;display:grid;place-items:center;color:#fff}
.sh{margin:6px 0 8px;font-size:17px;font-weight:700;display:flex;align-items:baseline;gap:8px}
.sh .n{font-size:13px;font-weight:500;color:var(--sec)}
.fresh{font-size:12.5px;color:var(--ter);margin:10px 4px 0}
.srch{display:flex;align-items:center;gap:8px;height:40px;padding:0 12px;border-radius:12px;background:var(--card);box-shadow:inset 0 0 0 1.5px var(--sep);color:var(--ter);font-size:15px;margin:4px 0 14px}
.addb{height:30px;padding:0 14px;border-radius:999px;display:inline-flex;align-items:center;font-size:14px;font-weight:650;color:var(--link);box-shadow:inset 0 0 0 1.5px var(--sep)}
.addb.done{box-shadow:none;color:var(--ter);font-weight:500}
.fh{font-size:13px;color:var(--sec);margin:8px 4px 0;line-height:1.4}
.ph-sheet .group{background:var(--fill2);border-radius:14px;overflow:hidden}
.ph-sheet .group a{padding:13px 12px;justify-content:center;color:var(--link);font-weight:500;border-radius:0}
.ph-sheet .group a+a{border-top:1px solid var(--sep)}
.ph-sheet .group a.red{color:var(--t-failed);font-weight:650}
.ph-sheet .shnote{font-size:13px;color:var(--sec);text-align:center;padding:4px 14px 12px;line-height:1.4}
.ph-sheet .shnote b{display:block;color:var(--text);font-size:15px;margin-bottom:4px}
.ph-sheet .cancelg{margin-top:10px}.ph-sheet .cancelg a{font-weight:650}
`;

const tabs = `<nav class="ph-tabs"><a>${ic("inbox", 25)}Inbox</a><a>${ic("sparkle", 25)}Sessions</a><a>${ic("pr", 25)}PRs</a><a class="on">${ic("folder", 25)}Repos</a><a>${ic("more", 25)}More</a></nav>`;
const phone = (bar: string, inner: string, h = 780, overlay = "") => `
<div class="scalebox phone" data-w="375" data-h="${h}"><div class="screen ph mock">
  <div class="ph-status"></div><div class="ph-bar">${bar}</div>
  <div class="ph-content">${inner}</div>${tabs}${overlay}
</div></div>`;

type Repo = { n: string; full: string; d: string; c: string; specs: number; working: number; warn?: string };
const repos: Repo[] = [
  { n: "payments-api", full: "Acme/payments-api", d: "Charges, refunds and webhooks", c: "c1", specs: 6, working: 2 },
  { n: "web-dashboard", full: "Acme/web-dashboard", d: "Customer dashboard (Next.js)", c: "c2", specs: 4, working: 1 },
  { n: "ledger", full: "Acme/ledger", d: "Double-entry ledger service", c: "c3", specs: 2, working: 0 },
  { n: "legacy-billing", full: "Acme/legacy-billing", d: "Old billing system", c: "c4", specs: 1, working: 0, warn: "Archived · can’t start Sessions" },
];
const rt = (r: Repo, s = 36) => `<span class="rtile ${r.c}" style="width:${s}px;height:${s}px">${r.n[0]!.toUpperCase()}</span>`;
const listBar = `<span class="sp"></span><span class="ib">${ic("more", 24)}</span><span class="ib">${ic("plus", 24)}</span>`;

const listA = phone(
  listBar,
  `<h1 class="big">Repositories</h1><div class="group">${repos
    .map(
      (r) => `<div class="row">${rt(r)}<span class="row-main"><span class="row-title">${r.n}</span><span class="row-sub">${r.warn ? `<span class="warnt">${r.warn}</span>` : r.d}</span></span>
      <span class="row-end"><span class="time">${r.working ? `${r.working} working` : `${r.specs} Spec${r.specs === 1 ? "" : "s"}`}</span></span>${ic("chevron", 15, "chev")}</div>`,
    )
    .join("")}</div>`,
);
const listB = phone(
  listBar,
  `<h1 class="big">Repositories</h1><div class="rcards">${repos
    .slice(0, 3)
    .map(
      (r) => `<div class="rcard"><div class="top">${rt(r, 40)}<div><div class="nm">${r.n}</div><div class="fn">${r.full}</div></div></div>
      <div class="d">${r.d}</div><div class="rstat"><span><b>${r.specs}</b> Specs</span><span><b>${r.working}</b> working</span></div></div>`,
    )
    .join("")}</div>`,
);

const specRows = (withState: boolean) => {
  const rows: [string, number, string, string, string][] = [
    ["Retry failed webhooks with backoff", 11, "running", "Running", "1d"],
    ["Add idempotency keys to refund endpoint", 10, "waiting", "Waiting", "2d"],
    ["Sign outgoing webhooks", 16, "failed", "Failed", "2d"],
    ["Remove legacy v1 charge route", 14, "none", "", "3d"],
    ["Rate limit card tokenization", 15, "none", "", "4d"],
  ];
  return `<div class="group">${rows
    .map(
      ([t, n, s, l, w]) => `<div class="row"><span class="tile f-none">${ic("doc", 17)}</span><span class="row-main"><span class="row-title">${t}</span><span class="row-sub">Spec #${n} · updated ${w} ago</span></span>
      ${withState ? `<span class="row-end">${l ? `<span class="chip p-${s}">${l}</span>` : `<span class="time">Not started</span>`}</span>` : ""}</div>`,
    )
    .join("")}</div>`;
};

const repoBar = `<span class="bk">${ic("back", 22)}Repos</span><span class="sp"></span><span class="ib">${ic("more", 24)}</span>`;
const repoHead = `<h1 class="st">payments-api</h1><p class="desc">Charges, refunds and webhooks</p>`;
const insideA = phone(repoBar, `${repoHead}<div class="segtabs"><span class="on">Specs</span><span>Pull requests</span><span>Sessions</span></div>${specRows(true)}<p class="fresh">Specs checked 2 min ago</p>`, 760);
const insideB = phone(
  repoBar,
  `${repoHead}<div class="group navrows">
    <div class="row"><span class="ri" style="background:#30B0C7">${ic("pr", 17)}</span><span class="row-main"><span class="row-title">Pull requests</span></span><span class="time">5</span>${ic("chevron", 15, "chev")}</div>
    <div class="row"><span class="ri" style="background:#0A84FF">${ic("sparkle", 17)}</span><span class="row-main"><span class="row-title">Sessions</span></span><span class="time">2 working</span>${ic("chevron", 15, "chev")}</div>
  </div><div class="sh">Specs <span class="n">6</span></div>${specRows(true)}`,
  760,
);

const rowsState = phone(repoBar, `${repoHead}<div class="segtabs"><span class="on">Specs</span><span>Pull requests</span><span>Sessions</span></div>${specRows(true)}`, 640);
const rowsPlain = phone(repoBar, `${repoHead}<div class="segtabs"><span class="on">Specs</span><span>Pull requests</span><span>Sessions</span></div>${specRows(false)}`, 640);

// Part 2
const add = phone(
  `<span class="lnk">Done</span><span class="ct">Add Repository</span><span class="sp"></span>`,
  `<div class="srch">${ic("search", 17)}Filter Repositories</div>
  <div class="group">
    <div class="row">${rt({ n: "notifications", c: "c2" } as Repo)}<span class="row-main"><span class="row-title">notifications</span><span class="row-sub">Email and SMS sender</span></span><span class="addb">Add</span></div>
    <div class="row">${rt({ n: "payments-api", c: "c1" } as Repo)}<span class="row-main"><span class="row-title">payments-api</span><span class="row-sub">Already added</span></span><span class="addb done">Added</span></div>
    <div class="row">${rt({ n: "search", c: "c3" } as Repo)}<span class="row-main"><span class="row-title">search-indexer</span><span class="row-sub"><span class="warnt">Removed earlier · history kept</span></span></span><span class="addb">Re-add</span></div>
    <div class="row">${rt({ n: "wiki", c: "c4" } as Repo)}<span class="row-main"><span class="row-title">wiki</span><span class="row-sub"><span class="warnt">Archived · browsing only</span></span></span><span class="addb">Add</span></div>
  </div>
  <p class="fh">Only Repositories the Atlas GitHub App can see are listed. Adding one doesn’t change anything on GitHub.</p>`,
  640,
);
const remove = phone(
  repoBar,
  `${repoHead}<div class="segtabs"><span class="on">Specs</span><span>Pull requests</span><span>Sessions</span></div>${specRows(true)}`,
  760,
  `<div class="ph-dim"></div><div class="ph-sheet"><div class="grab"></div>
   <div class="shnote"><b>Remove payments-api from Atlas?</b>It leaves your lists and can’t start new Sessions. Its history is kept, and you can re-add it later.</div>
   <div class="group"><a class="red">Remove from Atlas</a></div>
   <div class="group cancelg"><a>Cancel</a></div></div>`,
);

type Pick = { title: string; o1: [string, string]; o2: [string, string]; a: string; b: string };
const picks: Pick[] = [
  { title: "Your Repositories", o1: ["Simple list", "like Settings"], o2: ["Cards", "with Spec and working counts"], a: listA, b: listB },
  { title: "Inside a Repository", o1: ["Tabs", "Specs · Pull requests · Sessions"], o2: ["Links on top", "then the Specs"], a: insideA, b: insideB },
  { title: "Each Spec in the list", o1: ["Show its Session status", "Running, Failed, Not started"], o2: ["Plain", "just the title"], a: rowsState, b: rowsPlain },
];

const opt = (n: 1 | 2, [name, note]: [string, string], inner: string) =>
  `<div class="opt"><div class="lab"><span>${n}</span>${name} <em>${note}</em></div>${inner}</div>`;

const checks = [
  { title: "Adding a Repository (the + button)", body: add },
  { title: "Removing a Repository (from its ⋯ menu, now asks first)", body: remove },
];

const body = `<main class="tile-page">
  <h1>Repositories</h1>
  <p class="how">Where your GitHub Repositories and their Specs live. <span class="phone-only">Tap <b>1</b> / <b>2</b> to flip.</span><br>
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
    const cw = +box.dataset.w, ch = +box.dataset.h, sc = box.clientWidth / cw;
    box.style.height = ch * sc + "px";
    box.querySelector(".screen").style.transform = "scale(" + sc + ")";
  };
  const ro = new ResizeObserver((es) => es.forEach((e) => fit(e.target)));
  document.querySelectorAll(".scalebox").forEach((b) => { const sc = b.querySelector(".screen"); sc.style.width = b.dataset.w + "px"; sc.style.height = b.dataset.h + "px"; ro.observe(b); });
})();
</script>`;

export const reposPage = page({ look: { id: "a", name: "Repositories" }, screen: "inbox", title: "Repositories — pick", fonts: ["Inter", "Geist Mono"], css, body });
