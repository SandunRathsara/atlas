// bun prototypes/taste/build.ts  → writes prototypes/taste/out/*.html
import { lookA } from "./a.ts";
import { lookB } from "./b.ts";
import { lookC } from "./c.ts";
import { logo } from "./shared.ts";
import { tile } from "./tile.ts";
import { parts } from "./parts.ts";
import { frame } from "./frame.ts";
import { inboxPage } from "./inbox.ts";
import { sessionPage } from "./session.ts";
import { specPage } from "./spec.ts";
import { reposPage } from "./repos.ts";
import { prsPage } from "./prs.ts";
import { allSessionsPage } from "./allsessions.ts";
import { updatesPage } from "./updates.ts";

const dir = new URL("./out/", import.meta.url).pathname;
const looks = [
  { id: "a", name: "Health", pages: lookA, blurb: "Apple-app feel. Big bold titles, rounded grouped lists, coloured icon tiles, a tab bar on phones." },
  { id: "b", name: "Rex", pages: lookB, blurb: "Native-tool feel. The sidebar is the inbox with activity dots; the main area shows the selected item. Quiet, few borders." },
  { id: "c", name: "Warm", pages: lookC, blurb: "Claude-like feel. Warm neutrals, a calm centred column, and Sessions read like a conversation." },
];

for (const l of looks) {
  await Bun.write(`${dir}${l.id}-inbox.html`, l.pages.inbox);
  await Bun.write(`${dir}${l.id}-session.html`, l.pages.session);
}

await Bun.write(`${dir}a-tune.html`, tile);
await Bun.write(`${dir}parts.html`, parts);
await Bun.write(`${dir}frame.html`, frame);
await Bun.write(`${dir}inbox.html`, inboxPage);
await Bun.write(`${dir}session.html`, sessionPage);
await Bun.write(`${dir}spec.html`, specPage);
await Bun.write(`${dir}repos.html`, reposPage);
await Bun.write(`${dir}prs.html`, prsPage);
await Bun.write(`${dir}sessions.html`, allSessionsPage);
await Bun.write(`${dir}updates.html`, updatesPage);

await Bun.write(
  `${dir}index.html`,
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Atlas — pick a look</title>
<style>
@font-face{font-family:Inter;src:url("../fonts/inter.woff2") format("woff2");font-weight:100 900}
body{margin:0;background:#101114;color:#ECECEE;font:400 16px/1.5 Inter,system-ui,sans-serif;-webkit-font-smoothing:antialiased}
.wrap{max-width:1000px;margin:0 auto;padding:56px 24px}
h1{display:flex;align-items:center;gap:12px;font-size:30px;letter-spacing:-.02em;margin:0 0 6px}
p.lede{color:#9B9CA3;margin:0 0 36px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px}
.card{background:#1A1B1F;border:1px solid #2A2B31;border-radius:14px;padding:20px;display:flex;flex-direction:column;gap:10px}
.card .k{color:#E19D63;font-weight:700;font-size:13px;letter-spacing:.04em;text-transform:uppercase}
.card h2{margin:0;font-size:22px;letter-spacing:-.02em}
.card p{margin:0;color:#B3B4BA;font-size:15px;flex:1}
.links{display:flex;gap:8px;margin-top:8px}
.links a{flex:1;text-align:center;padding:10px;border-radius:10px;background:#2D63C0;color:#fff;text-decoration:none;font-weight:600;font-size:14px}
.links a+a{background:#26272D}
ul{color:#9B9CA3;font-size:14.5px;padding-left:18px;margin-top:36px}
</style></head><body><div class="wrap">
<h1>${logo(34, 9)}Pick a look</h1>
<p class="lede">Three directions for Atlas, each showing the Inbox and a running Session. Use the bar at the bottom right of every page to switch light and dark. Resize the window narrow to see the phone layout.</p>
<div class="grid">
${looks.map((l) => `<div class="card"><span class="k">Look ${l.id.toUpperCase()}</span><h2>${l.name}</h2><p>${l.blurb}</p><div class="links"><a href="${l.id}-inbox.html">Inbox</a><a href="${l.id}-session.html">Session</a></div></div>`).join("")}
</div>
<ul>
<li>Judge the overall feel: colours, fonts, spacing, shapes. Details and wording get refined later.</li>
<li>Mixing is fine, e.g. “A’s colours with B’s sidebar”.</li>
<li>Data is fake. Keyboard hints, search and filters are ideas only; they don’t work yet.</li>
</ul>
</div></body></html>`,
);
console.log("built", looks.length * 2 + 1, "pages in", dir);
