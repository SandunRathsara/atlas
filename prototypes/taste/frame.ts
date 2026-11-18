// Phase 4: the app frame (sidebar, top bar, phone navigation). Throwaway.
import { cssA } from "./a.ts";
import { ic, logo, page, stateIcon, stateLabel, type State } from "./shared.ts";

export const frameCss = `${cssA}
/* locked picks from Phases 2–3 */
.chip{display:inline-flex;align-items:center;height:24px;padding:0 9px;border-radius:999px;font-size:12.5px;font-weight:650;white-space:nowrap}
.chip.p-running{background:color-mix(in srgb,var(--f-running) 16%,transparent);color:var(--t-running)}
.chip.p-waiting{background:color-mix(in srgb,var(--f-waiting) 18%,transparent);color:var(--t-waiting)}
.chip.p-succeeded{background:color-mix(in srgb,var(--f-succeeded) 16%,transparent);color:var(--t-succeeded)}
.chip.p-failed{background:color-mix(in srgb,var(--f-failed) 14%,transparent);color:var(--t-failed)}
.chip.p-idle,.chip.p-queued{background:var(--fill);color:var(--sec)}
.strip{display:flex;align-items:center;gap:10px;padding:9px 14px;border-radius:12px;background:color-mix(in srgb,var(--f-waiting) 14%,transparent);font-size:14px}
.strip .ic{color:var(--t-waiting)}.strip a{margin-left:auto;color:var(--link);font-weight:600}
/* page */
.tile-page{max-width:1180px;margin:0 auto;padding:40px 28px 140px}
.tile-page>h1{margin:0 0 6px;font-size:34px;font-weight:750;letter-spacing:-.028em}
.tile-page>p.how{margin:0 0 40px;color:var(--sec);font-size:16px}
.tile-page>p.how b{color:var(--text)}
.part-h{margin:56px 0 6px;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--sec)}
.q{margin:0 0 48px}
.q h2{margin:0 0 14px;font-size:19px;font-weight:650;letter-spacing:-.015em;display:flex;align-items:center;gap:10px}
.q .num{display:inline-grid;place-items:center;width:28px;height:28px;border-radius:50%;background:var(--btn);color:#fff;font-size:15px;flex-shrink:0}
.q .num.check{background:var(--f-succeeded)}
.switch,.phone-only{display:none}
.pair{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.opt,.solo{border-radius:18px;padding:16px;background:var(--bg);box-shadow:0 0 0 1px var(--sep);min-width:0}
.opt .lab{display:flex;align-items:center;gap:8px;font-weight:700;margin-bottom:12px}
.opt .lab span{display:inline-grid;place-items:center;width:24px;height:24px;border-radius:7px;background:var(--fill);font-size:13px}
.opt .lab em{font-style:normal;font-weight:500;color:var(--sec);font-size:14px}
/* scaled mock screens */
.scalebox{position:relative;width:100%;overflow:hidden;border-radius:14px;box-shadow:0 0 0 1px var(--sep),0 10px 30px rgb(0 0 0/.12)}
.scalebox.phone{max-width:300px;margin:0 auto;border-radius:30px;box-shadow:0 0 0 6px var(--fill),0 10px 30px rgb(0 0 0/.15)}
.scalebox>.screen{position:absolute;top:0;left:0;transform-origin:0 0;background:var(--bg);color:var(--text);overflow:hidden}
/* desktop mock */
.desk{width:1100px;height:660px;display:flex}
.d-side{width:248px;flex-shrink:0;background:var(--side);border-right:1px solid var(--sep);padding:14px 12px;display:flex;flex-direction:column;gap:14px;position:relative}
.d-brand{display:flex;align-items:center;gap:10px;padding:2px 6px;font-weight:700;font-size:17px;letter-spacing:-.02em}
.d-search{display:flex;align-items:center;gap:8px;background:var(--card);box-shadow:inset 0 0 0 1.5px var(--sep);border-radius:10px;padding:8px 10px;color:var(--ter);font-size:14px}
.d-search kbd{margin-left:auto;font:500 11px Inter;color:var(--ter);background:var(--fill);padding:2px 6px;border-radius:5px}
.d-nav{display:flex;flex-direction:column;gap:2px}
.d-nav .h{font-size:12px;font-weight:600;color:var(--ter);padding:8px 10px 4px}
.d-nav a{display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:9px;font-size:14px;font-weight:500}
.d-nav a .ic{color:var(--link)}
.d-nav a.on{background:var(--sel)}
.d-nav .n{margin-left:auto;font-size:13px;color:var(--sec)}
.d-nav .dot{width:10px;height:10px;border-radius:50%;margin:0 5px}
.seg{display:flex;background:var(--fill);border-radius:9px;padding:2px}
.seg span{flex:1;text-align:center;padding:5px 0;border-radius:7px;font-size:12.5px;font-weight:600;color:var(--sec)}
.seg span.on{background:var(--card);color:var(--text);box-shadow:0 1px 2px rgb(0 0 0/.15)}
.lvl{display:flex;flex-direction:column;gap:1px;overflow:hidden}
.lvl .h{font-size:11.5px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--ter);padding:10px 8px 4px}
.lvl a{display:grid;grid-template-columns:22px minmax(0,1fr) auto;gap:9px;align-items:center;padding:7px 8px;border-radius:9px}
.lvl a.on{background:var(--sel)}
.lvl .mt{width:22px;height:22px;border-radius:6px;display:grid;place-items:center;color:#fff}
.lvl .t{font-size:13.5px;font-weight:550;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lvl .w{font-size:12px;color:var(--ter)}
.d-foot{margin-top:auto;display:flex;align-items:center;gap:10px;padding:10px 8px 2px;border-top:1px solid var(--sep);font-size:14px;font-weight:500}
.av{width:28px;height:28px;border-radius:50%;background:var(--sel);color:var(--link);display:grid;place-items:center;font-weight:700;font-size:13px}
.d-foot .chev{margin-left:auto}
.acct-menu{position:absolute;left:12px;right:12px;bottom:60px;background:var(--card);border-radius:14px;padding:6px;box-shadow:0 12px 40px rgb(0 0 0/.25),0 0 0 1px var(--sep);font-size:14px}
.acct-menu .lbl{padding:8px 10px 6px;color:var(--sec);font-size:12.5px;font-weight:600}
.acct-menu .seg{margin:0 6px 6px}
.acct-menu a{display:flex;gap:10px;align-items:center;padding:9px 10px;border-radius:9px}
.acct-menu hr{border:0;border-top:1px solid var(--sep);margin:4px 6px}
.d-main{flex:1;min-width:0;display:flex;flex-direction:column}
.d-bar{height:54px;display:flex;align-items:center;gap:10px;padding:0 28px;flex-shrink:0}
.d-bar .sp{flex:1}
.icon-b{width:36px;height:36px;border-radius:10px;display:grid;place-items:center;box-shadow:inset 0 0 0 1.5px var(--sep)}
.search-b{display:inline-flex;align-items:center;gap:8px;height:36px;padding:0 12px;border-radius:10px;box-shadow:inset 0 0 0 1.5px var(--sep);color:var(--sec);font-size:14px}
.search-b kbd{font:500 11px Inter;background:var(--fill);padding:2px 6px;border-radius:5px}
.fpill{display:inline-flex;align-items:center;gap:6px;height:34px;padding:0 12px;border-radius:999px;box-shadow:inset 0 0 0 1.5px var(--sep);font-size:13.5px;font-weight:600}
.d-content{padding:6px 28px 0}
.d-content .strip{margin-bottom:18px}
.d-content h1{margin:0 0 16px;font-size:34px;font-weight:750;letter-spacing:-.028em}
.chips{display:flex;gap:8px;margin:0 0 16px;overflow:hidden}
.chips span{height:32px;padding:0 14px;border-radius:999px;display:inline-flex;align-items:center;font-size:14px;font-weight:600;box-shadow:inset 0 0 0 1.5px var(--sep);white-space:nowrap}
.chips span.on{background:var(--text);color:var(--bg);box-shadow:none}
.mock .row{min-height:60px}
.mock .row-title{font-size:15px}
.mock .row-end{align-items:flex-end}
/* phone mock */
.ph{width:375px;height:780px;display:flex;flex-direction:column;position:relative}
.ph-status{height:44px;flex-shrink:0}
.ph-bar{height:48px;display:flex;align-items:center;gap:10px;padding:0 16px;flex-shrink:0}
.ph-bar b{font-size:17px}
.ph-bar .sp{flex:1}
.ph-bar .ib{width:36px;height:36px;display:grid;place-items:center;color:var(--link)}
.ph-content{padding:0 16px;flex:1;overflow:hidden}
.ph-content .strip{font-size:13px;padding:8px 12px;margin:4px 0 12px}
.ph-content h1{margin:0 0 12px;font-size:32px;font-weight:750;letter-spacing:-.028em;display:flex;align-items:center;justify-content:space-between}
.ph-content h1 .fpill{font-size:13px;height:32px;letter-spacing:0}
.ph .row{padding:10px 12px;gap:12px;min-height:58px}
.ph .row-title{font-size:15px}
.ph .row-sub{font-size:12.5px}
.ph .row+.row::before{left:56px}
.ph-tabs{display:flex;height:84px;padding:8px 6px 28px;border-top:1px solid var(--sep);background:var(--bar);backdrop-filter:blur(20px);flex-shrink:0}
.ph-tabs a{flex:1;display:flex;flex-direction:column;align-items:center;gap:3px;font-size:10.5px;font-weight:600;color:var(--ter)}
.ph-tabs a.on{color:var(--link)}
.ph-dim{position:absolute;inset:0;background:rgb(0 0 0/.4)}
.ph-sheet{position:absolute;left:0;right:0;bottom:0;background:var(--card);border-radius:22px 22px 0 0;padding:8px 14px 30px}
.ph-sheet .grab{width:38px;height:5px;border-radius:3px;background:var(--fill);margin:0 auto 12px}
.ph-sheet a{display:flex;align-items:center;gap:12px;padding:12px 8px;font-size:16px;font-weight:500;border-radius:10px}
.ph-sheet a .ic{color:var(--link)}
.ph-sheet a.on{background:var(--sel)}
/* quick search */
.qs-dim{position:absolute;inset:0;background:rgb(0 0 0/.35);display:flex;justify-content:center;padding-top:90px}
.qs{width:600px;align-self:flex-start;background:var(--card);border-radius:18px;box-shadow:0 20px 60px rgb(0 0 0/.35),0 0 0 1px var(--sep);overflow:hidden}
.qs-in{display:flex;align-items:center;gap:10px;padding:16px 18px;font-size:18px;border-bottom:1px solid var(--sep)}
.qs-in .ic{color:var(--ter)}
.caret{display:inline-block;width:2px;height:20px;background:var(--btn);vertical-align:-3px;animation:pulse 1s steps(2) infinite}
.qs-h{padding:12px 18px 4px;font-size:12px;font-weight:700;color:var(--ter);text-transform:uppercase;letter-spacing:.04em}
.qs .row{min-height:52px;padding:8px 18px}
.qs .row.on{background:var(--sel)}
.qs .row+.row::before{display:none}
.qs-foot{display:flex;gap:16px;padding:10px 18px;border-top:1px solid var(--sep);font-size:12.5px;color:var(--ter)}
.qs-foot kbd{font:500 11px Inter;background:var(--fill);padding:2px 6px;border-radius:5px;color:var(--sec)}
.qs-ph{position:absolute;inset:0;background:var(--bg);display:flex;flex-direction:column}
.qs-ph .top{display:flex;align-items:center;gap:10px;padding:52px 16px 10px}
.qs-ph .field{flex:1;display:flex;align-items:center;gap:8px;height:40px;padding:0 12px;border-radius:12px;background:var(--card);box-shadow:inset 0 0 0 1.5px var(--sep);font-size:16px}
.qs-ph .field .ic{color:var(--ter)}
.qs-ph .cancel{color:var(--link);font-size:16px}
.qs-ph .group{margin:0 16px}
.qs-ph .qs-h{padding:14px 20px 6px}
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
  .opt,.solo{padding:12px}.opt .lab{display:none}
  .tile-page~.proto{left:12px;right:12px;bottom:calc(12px + env(safe-area-inset-bottom));justify-content:space-between;font-size:14px}
  .tile-page~.proto button{padding:10px 14px}
}
`;

type R = { title: string; sub: string; s: State; w: string };
const rows: R[] = [
  { title: "Add idempotency keys to refund endpoint", sub: "payments-api · Asked a question", s: "waiting", w: "4m" },
  { title: "Retry failed webhooks with backoff", sub: "payments-api · Running tests", s: "running", w: "12m" },
  { title: "Paginate invoices list", sub: "web-dashboard · Waiting for a free slot", s: "queued", w: "3m" },
  { title: "Dark mode toggle in account settings", sub: "web-dashboard · No activity for 40 minutes", s: "idle", w: "40m" },
  { title: "Migrate ledger table to bigint ids", sub: "payments-api · Pull request #43 opened", s: "succeeded", w: "1h" },
  { title: "Expose settlement report CSV export", sub: "payments-api · Tests failed", s: "failed", w: "3h" },
];

const row = (r: R, cls = "") => `<div class="row ${cls}"><span class="tile f-${r.s}">${ic(stateIcon[r.s], 18)}</span>
<span class="row-main"><span class="row-title">${r.title}</span><span class="row-sub">${r.sub}</span></span>
<span class="row-end"><span class="chip p-${r.s}">${stateLabel[r.s]}</span><span class="time">${r.w} ago</span></span></div>`;

const strip = (short = false) =>
  `<div class="strip">${ic("warn", 17)}<span>${short ? "Backup status unknown" : "Backup and storage status unknown"}</span><a>Details</a></div>`;
const chips = `<div class="chips"><span class="on">All</span><span>payments-api</span><span>web-dashboard</span></div>`;
const fpill = `<span class="fpill">All Repositories ${ic("chevron", 13)}</span>`;

type Desk = { side: "sections" | "live"; search: "side" | "bar"; filter: "pill" | "chips"; theme: "menu" | "button"; menuOpen?: boolean; crop?: [number, number, number, number]; overlay?: string };
const desk = (o: Desk) => `
<div class="scalebox" data-w="1100" data-h="660" ${o.crop ? `data-crop="${o.crop.join(",")}"` : ""}><div class="screen desk mock">
  <aside class="d-side">
    <div class="d-brand">${logo(28, 8)}Atlas</div>
    ${o.search === "side" ? `<div class="d-search">${ic("search", 15)}Search<kbd>⌘K</kbd></div>` : ""}
    ${
      o.side === "sections"
        ? `<nav class="d-nav">
        <a class="on">${ic("inbox", 19)}Inbox<span class="n">7</span></a>
        <a>${ic("sparkle", 19)}Sessions<span class="n">4</span></a>
        <a>${ic("pr", 19)}Pull requests</a>
        <a>${ic("folder", 19)}Repositories</a>
        <a>${ic("refresh", 19)}Updates</a>
        ${o.filter === "pill" ? "" : ""}
      </nav>`
        : `<div class="seg"><span class="on">Inbox</span><span>Sessions</span><span>PRs</span><span>Repos</span></div>
      <nav class="lvl">
        <div class="h">Needs you</div>
        ${rows.slice(0, 1).map((r) => `<a><span class="mt f-${r.s}">${ic(stateIcon[r.s], 13)}</span><span class="t">${r.title}</span><span class="w">${r.w}</span></a>`).join("")}
        <div class="h">Working</div>
        ${rows.slice(1, 4).map((r, i) => `<a class="${i === 0 ? "on" : ""}"><span class="mt f-${r.s}">${ic(stateIcon[r.s], 13)}</span><span class="t">${r.title}</span><span class="w">${r.w}</span></a>`).join("")}
        <div class="h">Settled</div>
        ${rows.slice(4).map((r) => `<a><span class="mt f-${r.s}">${ic(stateIcon[r.s], 13)}</span><span class="t">${r.title}</span><span class="w">${r.w}</span></a>`).join("")}
      </nav>`
    }
    <div class="d-foot"><span class="av">A</span>Acme team${ic("chevron", 14, "chev")}</div>
    ${
      o.theme === "menu" && o.menuOpen
        ? `<div class="acct-menu"><div class="lbl">Appearance</div><div class="seg"><span class="on">Auto</span><span>Light</span><span>Dark</span></div><hr><a>${ic("refresh", 17)}Updates</a><a>${ic("external", 17)}Sign out</a></div>`
        : ""
    }
  </aside>
  <div class="d-main">
    <div class="d-bar">${o.filter === "pill" ? fpill : ""}<span class="sp"></span>${o.search === "bar" ? `<span class="search-b">${ic("search", 15)}Search<kbd>⌘K</kbd></span>` : ""}${o.theme === "button" ? `<span class="icon-b">${ic("moon", 18)}</span>` : ""}</div>
    <div class="d-content">
      ${strip()}
      <h1>Inbox</h1>
      ${o.filter === "chips" ? chips : ""}
      <div class="group">${rows.slice(0, 5).map((r) => row(r)).join("")}</div>
    </div>
  </div>
  ${o.overlay ?? ""}
</div></div>`;

type Phone = { nav: "tabs" | "menu"; filter: "pill" | "chips"; open?: boolean; overlay?: string };
const phone = (o: Phone) => `
<div class="scalebox phone" data-w="375" data-h="780"><div class="screen ph mock">
  <div class="ph-status"></div>
  <div class="ph-bar">${o.nav === "menu" ? `<span class="ib">${ic("list", 24)}</span>` : ""}${logo(26, 7)}<b>Atlas</b><span class="sp"></span><span class="ib">${ic("search", 22)}</span></div>
  <div class="ph-content">
    ${strip(true)}
    <h1>Inbox${o.filter === "pill" ? `<span class="fpill">All ${ic("chevron", 12)}</span>` : ""}</h1>
    ${o.filter === "chips" ? chips : ""}
    <div class="group">${rows.slice(0, 6).map((r) => row(r)).join("")}</div>
  </div>
  ${o.nav === "tabs" ? `<nav class="ph-tabs"><a class="on">${ic("inbox", 25)}Inbox</a><a>${ic("sparkle", 25)}Sessions</a><a>${ic("pr", 25)}PRs</a><a>${ic("folder", 25)}Repos</a><a>${ic("more", 25)}More</a></nav>` : ""}
  ${
    o.open
      ? `<div class="ph-dim"></div><div class="ph-sheet"><div class="grab"></div>
    <a class="on">${ic("inbox", 22)}Inbox</a><a>${ic("sparkle", 22)}Sessions</a><a>${ic("pr", 22)}Pull requests</a><a>${ic("folder", 22)}Repositories</a><a>${ic("refresh", 22)}Updates</a><a>${ic("sun", 22)}Appearance</a></div>`
      : ""
  }
  ${o.overlay ?? ""}
</div></div>`;

const base: Desk = { side: "sections", search: "side", filter: "chips", theme: "menu" };

type Pick = { title: string; o1: [string, string]; o2: [string, string]; a: string; b: string };
const picks: Pick[] = [
  {
    title: "Computer: what the sidebar shows",
    o1: ["Sections", "Inbox, Sessions, PRs…"],
    o2: ["Live list", "every Spec, needs-you first"],
    a: desk({ ...base, crop: [0, 0, 640, 560] }),
    b: desk({ ...base, side: "live", crop: [0, 0, 640, 560] }),
  },
  {
    title: "Phone: how you get around",
    o1: ["Tabs at the bottom", "like Health"],
    o2: ["Menu button", "opens a sheet"],
    a: phone({ nav: "tabs", filter: "chips" }),
    b: phone({ nav: "menu", filter: "chips", open: true }),
  },
  {
    title: "Computer: where quick search lives",
    o1: ["Top of the sidebar", "top-left, always visible"],
    o2: ["Top-right button", "out of the way"],
    a: desk({ ...base, crop: [0, 0, 560, 300] }),
    b: desk({ ...base, search: "bar", crop: [540, 0, 560, 300] }),
  },
  {
    title: "Showing one Repository only",
    o1: ["Chips under the title", "tap to switch"],
    o2: ["Dropdown button", "one tidy button"],
    a: phone({ nav: "tabs", filter: "chips" }),
    b: phone({ nav: "tabs", filter: "pill" }),
  },
  {
    title: "Light / dark switch",
    o1: ["In your account menu", "bottom-left; follows your device by default"],
    o2: ["Moon button", "top-right, always visible"],
    a: desk({ ...base, menuOpen: true, crop: [0, 300, 560, 360] }),
    b: desk({ ...base, theme: "button", crop: [540, 0, 560, 360] }),
  },
];

const qsDesk = `<div class="qs-dim"><div class="qs">
  <div class="qs-in">${ic("search", 20)}<span>webh<span class="caret"></span></span></div>
  <div class="qs-h">Sessions</div>
  <div class="row on"><span class="tile f-running">${ic("sparkle", 16)}</span><span class="row-main"><span class="row-title">Retry failed webhooks with backoff</span><span class="row-sub">payments-api · Spec #11</span></span><span class="chip p-running">Running</span></div>
  <div class="qs-h">Specs</div>
  <div class="row"><span class="tile f-none">${ic("doc", 16)}</span><span class="row-main"><span class="row-title">Sign outgoing webhooks</span><span class="row-sub">payments-api · Spec #16 · Not started</span></span></div>
  <div class="qs-foot"><span><kbd>↑</kbd> <kbd>↓</kbd> move</span><span><kbd>⏎</kbd> open</span><span><kbd>esc</kbd> close</span></div>
</div></div>`;

const qsPhone = `<div class="qs-ph">
  <div class="top"><div class="field">${ic("search", 18)}<span>webh<span class="caret"></span></span></div><span class="cancel">Cancel</span></div>
  <div class="qs-h">Sessions</div>
  <div class="group"><div class="row"><span class="tile f-running">${ic("sparkle", 16)}</span><span class="row-main"><span class="row-title">Retry failed webhooks with backoff</span><span class="row-sub">payments-api · Spec #11</span></span><span class="chip p-running">Running</span></div></div>
  <div class="qs-h">Specs</div>
  <div class="group"><div class="row"><span class="tile f-none">${ic("doc", 16)}</span><span class="row-main"><span class="row-title">Sign outgoing webhooks</span><span class="row-sub">payments-api · Spec #16</span></span></div></div>
</div>`;

const checks = [
  { title: "Quick search on a computer (press ⌘K)", body: desk({ ...base, overlay: qsDesk }) },
  { title: "Quick search on a phone (tap the magnifier)", body: phone({ nav: "tabs", filter: "chips", overlay: qsPhone }) },
];

const opt = (n: 1 | 2, [name, note]: [string, string], inner: string) =>
  `<div class="opt"><div class="lab"><span>${n}</span>${name} <em>${note}</em></div>${inner}</div>`;

const body = `<main class="tile-page">
  <h1>The frame</h1>
  <p class="how">The parts around every page: sidebar, top bar, phone navigation. Everything uses your earlier picks. <span class="phone-only">Tap <b>1</b> / <b>2</b> to flip.</span><br>
  Reply with <b>5 numbers</b>, and say if anything in part 2 looks wrong.</p>
  <div class="part-h">Part 1 · Pick one</div>
  ${picks
    .map(
      (p, i) => `<section class="q">
  <h2><span class="num">${i + 1}</span>${p.title}</h2>
  <div class="switch" role="radiogroup" aria-label="Choice ${i + 1}">
    <label><input class="o1" type="radio" name="q${i}" checked><span>1 · ${p.o1[0]}</span></label>
    <label><input class="o2" type="radio" name="q${i}"><span>2 · ${p.o2[0]}</span></label>
  </div>
  <div class="pair">${opt(1, p.o1, p.a)}${opt(2, p.o2, p.b)}</div>
</section>`,
    )
    .join("")}
  <div class="part-h">Part 2 · Just check: quick search</div>
  ${checks.map((c, i) => `<section class="q"><h2><span class="num check">${String.fromCharCode(65 + i)}</span>${c.title}</h2><div class="solo">${c.body}</div></section>`).join("")}
</main>
<script>
(() => {
  const fit = (box) => {
    const [cx, cy, cw, ch] = box.dataset.crop ? box.dataset.crop.split(",").map(Number) : [0, 0, +box.dataset.w, +box.dataset.h];
    const s = box.clientWidth / cw;
    box.style.height = ch * s + "px";
    box.firstElementChild.style.transform = "scale(" + s + ") translate(" + -cx + "px," + -cy + "px)";
  };
  const ro = new ResizeObserver((es) => es.forEach((e) => fit(e.target)));
  document.querySelectorAll(".scalebox").forEach((b) => { b.firstElementChild.style.width = b.dataset.w + "px"; b.firstElementChild.style.height = b.dataset.h + "px"; ro.observe(b); });
})();
</script>`;

export const frame = page({ look: { id: "a", name: "The frame" }, screen: "inbox", title: "The frame", fonts: ["Inter", "Geist Mono"], css: frameCss, body });
