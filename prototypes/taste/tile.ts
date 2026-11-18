// Phase 2: fine-tune Look A with five either/or choices. Throwaway.
import { cssA } from "./a.ts";
import { ic, page, stateIcon, stateLabel, type State } from "./shared.ts";

const css = `${cssA}
.tile-page{max-width:1120px;margin:0 auto;padding:40px 28px 140px}
.tile-page>h1{margin:0 0 6px;font-size:34px;font-weight:750;letter-spacing:-.028em}
.tile-page>p.how{margin:0 0 40px;color:var(--sec);font-size:16px}
.tile-page>p.how b{color:var(--text)}
.q{margin:0 0 44px}
.q h2{margin:0 0 14px;font-size:19px;font-weight:650;letter-spacing:-.015em;display:flex;align-items:center;gap:10px}
.q .num{display:inline-grid;place-items:center;width:28px;height:28px;border-radius:50%;background:var(--btn);color:#fff;font-size:15px}
.q .num{flex-shrink:0}
.switch,.phone-only{display:none}
.pair{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.opt{border-radius:18px;padding:18px;background:var(--bg);box-shadow:0 0 0 1px var(--sep);color:var(--text)}
.opt .lab{display:flex;align-items:center;gap:8px;font-weight:700;margin-bottom:14px}
.opt .lab span{display:inline-grid;place-items:center;width:24px;height:24px;border-radius:7px;background:var(--fill);font-size:13px}
.opt .lab em{font-style:normal;font-weight:500;color:var(--sec);font-size:14px}
.opt .mini-title{font-size:26px;font-weight:750;letter-spacing:-.025em;margin:0 0 12px}
.opt .acts{display:flex;gap:8px;margin-top:14px}
/* choice overrides */
.graphite[data-mode=dark]{--bg:#161618;--card:#232326;--sep:#36363A;--fill:#303034;--fill2:#2A2A2D}
.tight .group{border-radius:8px}.tight .tile{border-radius:6px}.tight .btn{border-radius:7px}.tight .cap{border-radius:6px}
.bright{--btn:#0A63D8}[data-mode=dark] .bright,.bright[data-mode=dark]{--btn:#0A84FF}
.dotmode .row .tile{width:10px;height:10px;border-radius:50%;margin:0 11px}.dotmode .row .tile svg{display:none}
.snug .row{min-height:50px;padding:8px 14px;gap:12px}.snug .row-title{font-size:14.5px}.snug .row-sub,.snug .row-end{font-size:12.5px}.snug .tile{width:26px;height:26px;border-radius:7px}.snug .tile svg{width:15px;height:15px}.snug .mini-title{font-size:22px}.snug .btn{height:34px;font-size:14px;padding:0 14px}
@media (max-width:760px){
  .tile-page{padding:20px 14px 120px}.tile-page>h1{font-size:30px}.tile-page>p.how{font-size:15px;margin-bottom:28px}
  .phone-only{display:inline}
  .q{margin-bottom:36px}.q h2{font-size:17px;align-items:flex-start}
  .switch{display:flex;margin:0 0 10px;padding:3px;border-radius:12px;background:var(--fill);box-shadow:0 2px 10px rgb(0 0 0/.12)}
  .switch label{flex:1;position:relative}
  .switch input{position:absolute;opacity:0;inset:0;margin:0}
  .switch span{display:block;text-align:center;padding:10px 6px;border-radius:9px;font-size:14px;font-weight:600;color:var(--sec)}
  .switch input:checked+span{background:var(--card);color:var(--text);box-shadow:0 1px 3px rgb(0 0 0/.18)}
  .switch input:focus-visible+span{outline:2px solid var(--link)}
  .pair{grid-template-columns:1fr}
  .q:has(.o1:checked) .opt:last-child,.q:has(.o2:checked) .opt:first-child{display:none}
  .opt{padding:14px 12px}.opt .lab{display:none}
  .opt .row{padding:12px}.opt .row+.row::before{left:56px}
  .tile-page~.proto{left:12px;right:12px;bottom:calc(12px + env(safe-area-inset-bottom));justify-content:space-between;font-size:14px}
  .tile-page~.proto button{padding:10px 14px}
}
`;

const rows: { title: string; repo: string; note: string; state: State; when: string }[] = [
  { title: "Add idempotency keys to refund endpoint", repo: "payments-api", note: "Asked a question", state: "waiting", when: "4m" },
  { title: "Retry failed webhooks with backoff", repo: "payments-api", note: "Running tests", state: "running", when: "12m" },
  { title: "Migrate ledger table to bigint ids", repo: "payments-api", note: "Pull request #43 opened", state: "succeeded", when: "1h" },
];

const snippet = () => `
<div class="mini-title">Inbox</div>
<div class="group">${rows
  .map(
    (r) => `<a class="row" href="#">
  <span class="tile f-${r.state}">${ic(stateIcon[r.state], 18)}</span>
  <span class="row-main"><span class="row-title">${r.title}</span><span class="row-sub">${r.repo} · ${r.note}</span></span>
  <span class="row-end"><span class="st t-${r.state}">${stateLabel[r.state]}</span><span class="time">${r.when} ago</span></span>
</a>`,
  )
  .join("")}</div>
<div class="acts"><a class="btn" href="#">Open Session</a><a class="btn sec" href="#">View Spec</a></div>`;

const opt = (n: 1 | 2, name: string, note: string, cls = "", dark = false) =>
  `<div class="opt ${cls}" ${dark ? 'data-mode="dark"' : ""}><div class="lab"><span>${n}</span>${name} <em>${note}</em></div>${snippet()}</div>`;

type Q = { ask: string; o1: [string, string]; o2: [string, string]; cls: string; dark?: boolean };
const questions: Q[] = [
  { ask: "Dark mode background. (Both shown in dark.)", o1: ["Pure black", "like iPhone"], o2: ["Soft graphite", "a bit lighter"], cls: "graphite", dark: true },
  { ask: "Corners.", o1: ["Round", "what you saw in A"], o2: ["Tighter", "less bubbly"], cls: "tight" },
  { ask: "Main button colour. The Atlas logo stays navy either way.", o1: ["Deep navy", "what you saw in A"], o2: ["Bright blue", "like Apple's default"], cls: "bright" },
  { ask: "Status markers.", o1: ["Coloured icons", "what you saw in A"], o2: ["Small dots", "quieter"], cls: "dotmode" },
  { ask: "Size and spacing.", o1: ["Roomy", "what you saw in A"], o2: ["Snug", "fits more on screen"], cls: "snug" },
];

const body = `<main class="tile-page">
  <h1>Fine-tune Look A</h1>
  <p class="how">Five quick choices, each showing the same bit of the Inbox two ways. <span class="phone-only">Tap <b>1</b> / <b>2</b> to flip between them.</span> Use <b>Light / Dark</b> in the bottom bar to check both modes.<br>
  Reply with five numbers, like <b>1, 2, 1, 1, 2</b>.</p>
  ${questions
    .map(
      (q, i) => `<section class="q">
  <h2><span class="num">${i + 1}</span>${q.ask}</h2>
  <div class="switch" role="radiogroup" aria-label="Choice ${i + 1}">
    <label><input class="o1" type="radio" name="q${i}" checked><span>1 · ${q.o1[0]}</span></label>
    <label><input class="o2" type="radio" name="q${i}"><span>2 · ${q.o2[0]}</span></label>
  </div>
  <div class="pair">${opt(1, q.o1[0], q.o1[1], "", q.dark)}${opt(2, q.o2[0], q.o2[1], q.cls, q.dark)}</div>
</section>`,
    )
    .join("")}
</main>`;

export const tile = page({ look: { id: "a", name: "Fine-tune" }, screen: "inbox", title: "Fine-tune Look A", fonts: ["Inter", "Geist Mono"], css, body });
