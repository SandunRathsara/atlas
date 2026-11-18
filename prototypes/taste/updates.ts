// Phase 5.7: Updates and Sign in. Throwaway.
import { frameCss } from "./frame.ts";
import { ic, logo, page } from "./shared.ts";

const css = `${frameCss}
.pair.phones .scalebox.phone{max-width:320px}
.ph-bar{position:relative}
.ph-bar .bk{display:flex;align-items:center;gap:2px;color:var(--link);font-size:16px}
.ph-content{overflow:hidden}
.ph h1.big{font-size:32px;margin:0 0 14px;letter-spacing:-.028em;display:block}
.uhero{background:var(--card);border-radius:18px;padding:18px;text-align:center}
.uhero .tile{width:56px;height:56px;border-radius:16px;margin:0 auto 10px}
.uhero b{display:block;font-size:19px;letter-spacing:-.015em}
.uhero .v{font:13px "Geist Mono",monospace;color:var(--sec);margin-top:4px}
.uhero .s{font-size:13.5px;color:var(--sec);margin-top:6px;line-height:1.4}
.uhero .bigbtn{margin-top:14px}
.bigbtn{display:flex;align-items:center;justify-content:center;gap:8px;height:46px;border-radius:14px;background:var(--btn);color:#fff;font-weight:650;font-size:16px}
.bigbtn.outline{background:none;color:var(--link);box-shadow:inset 0 0 0 1.5px var(--sep)}
.fl{font-size:13px;font-weight:600;color:var(--sec);text-transform:uppercase;letter-spacing:.04em;margin:20px 4px 6px}
.fh{font-size:13px;color:var(--sec);margin:6px 4px 0;line-height:1.4}
.setrow{display:flex;gap:12px;align-items:center;padding:12px 14px;position:relative;min-height:50px;font-size:15px}
.setrow+.setrow::before{content:"";position:absolute;top:0;left:14px;right:0;border-top:1px solid var(--sep)}
.setrow .grow{flex:1;min-width:0}.setrow .grow span{display:block;font-size:13px;color:var(--sec)}
.setrow .val{color:var(--sec);text-align:right;font-size:14px}
.setrow .val.mono{font:13px "Geist Mono",monospace}
.setrow .chev{color:var(--ter)}.setrow .tick{color:var(--btn)}
.tog{width:51px;height:31px;border-radius:999px;background:var(--fill);position:relative;flex-shrink:0}
.tog::after{content:"";position:absolute;top:2px;left:2px;width:27px;height:27px;border-radius:50%;background:#fff;box-shadow:0 2px 4px rgb(0 0 0/.25)}
.tog.on{background:#34C759}.tog.on::after{left:22px}
.chip.p-ok{background:color-mix(in srgb,var(--f-succeeded) 16%,transparent);color:var(--t-succeeded)}
.chip.p-new{background:color-mix(in srgb,var(--f-running) 16%,transparent);color:var(--t-running)}
.card2{background:var(--card);border-radius:14px;padding:14px;margin-bottom:10px}
.card2 .hd{display:flex;justify-content:space-between;align-items:center;font-weight:650;font-size:15px}
.card2 p{margin:6px 0 0;font-size:13.5px;color:var(--sec);line-height:1.4}
.card2 .mono{font-size:13px;color:var(--text)}
.prog{height:6px;border-radius:3px;background:var(--fill);overflow:hidden;margin-top:14px}
.prog i{display:block;height:100%;width:62%;background:var(--btn);border-radius:3px}
.steps{text-align:left;margin-top:14px;font-size:14px;display:flex;flex-direction:column;gap:8px}
.steps div{display:flex;gap:8px;align-items:center;color:var(--sec)}
.steps .done .ic{color:var(--t-succeeded)}.steps .now{color:var(--text);font-weight:600}
.steps .now i{width:16px;height:16px;border-radius:50%;border:2px solid var(--btn);border-right-color:transparent}
.steps .todo i{width:16px;height:16px;border-radius:50%;border:2px solid var(--sep)}
.redbox{display:flex;gap:10px;padding:12px 14px;border-radius:14px;background:color-mix(in srgb,var(--f-failed) 12%,var(--card));margin-top:12px;font-size:14px;line-height:1.4}
.redbox .ic{color:var(--t-failed);flex-shrink:0;margin-top:1px}.redbox b{display:block}
.infobox{display:flex;gap:10px;padding:12px 14px;border-radius:14px;background:color-mix(in srgb,var(--f-running) 12%,var(--card));margin:0 0 14px;font-size:14px;line-height:1.4;text-align:left}
.infobox .ic{color:var(--t-running);flex-shrink:0;margin-top:1px}
/* sign in */
.ph.login .ph-content{display:flex;flex-direction:column}
.lcard{margin-top:110px;text-align:center}
.lcard .lg{display:flex;justify-content:center;margin-bottom:16px}
.lcard h2{font-size:26px;margin:0 0 6px;letter-spacing:-.022em;display:block;text-align:center}
.lcard p.s{color:var(--sec);font-size:14.5px;margin:0 0 22px;line-height:1.4}
.field{height:50px;border-radius:12px;background:var(--card);box-shadow:inset 0 0 0 1.5px var(--sep);display:flex;align-items:center;padding:0 14px;font-size:20px;letter-spacing:3px;color:var(--text);text-align:left}
.field.err{box-shadow:inset 0 0 0 2px var(--t-failed)}
.field.empty{color:var(--ter);font-size:15px;letter-spacing:0}
.lab2{font-size:14px;font-weight:600;margin:0 0 6px;text-align:left}
.hint{font-size:13px;color:var(--sec);margin:6px 2px 18px;text-align:left}
.plain{margin-top:30px}
.plain .eb{font-size:12.5px;font-weight:700;color:var(--link);text-transform:uppercase;letter-spacing:.05em;margin:0 0 6px}
.plain h2{font-size:28px;margin:0 0 6px;letter-spacing:-.022em}
.plain p.s{color:var(--sec);font-size:14.5px;margin:0 0 22px;line-height:1.4}
.brandbar{display:flex;align-items:center;gap:8px;font-weight:700;font-size:16px}
`;

const tabs = `<nav class="ph-tabs"><a>${ic("inbox", 25)}Inbox</a><a>${ic("sparkle", 25)}Sessions</a><a>${ic("pr", 25)}PRs</a><a>${ic("folder", 25)}Repos</a><a class="on">${ic("more", 25)}More</a></nav>`;
const phone = (inner: string, h = 780, cls = "", bar = `<span class="bk">${ic("back", 22)}More</span>`, withTabs = true) => `
<div class="scalebox phone" data-w="375" data-h="${h}"><div class="screen ph mock ${cls}">
  <div class="ph-status"></div><div class="ph-bar">${bar}</div>
  <div class="ph-content">${inner}</div>${withTabs ? tabs : ""}
</div></div>`;

const upToDate = `<div class="uhero"><span class="tile f-succeeded">${ic("check", 28)}</span><b>Atlas is up to date</b><div class="v">v1.4.2 · build 31</div><div class="s">Checked 12 min ago</div><a class="bigbtn outline">${ic("refresh", 17)}Check now</a></div>`;
const policyToggle = `<div class="fl">Updates</div><div class="group"><div class="setrow"><div class="grow">Install small fixes automatically<span>Same version, newer build only</span></div><span class="tog on"></span></div></div>
<p class="fh">Bigger updates always wait for you to tap Install.</p>`;
const policyList = `<div class="fl">Install updates</div><div class="group">
<div class="setrow"><div class="grow">Ask me first</div></div>
<div class="setrow"><div class="grow">Small fixes automatically<span>Same version, newer build only</span></div>${ic("check", 20, "tick")}</div></div>
<p class="fh">Bigger updates always wait for you to tap Install.</p>`;

const simple = (policy = policyToggle) => phone(`<h1 class="big">Updates</h1>${upToDate}${policy}
<div class="group" style="margin-top:20px"><div class="setrow"><div class="grow">Technical details</div>${ic("chevron", 15, "chev")}</div></div>`, 780);
const full = phone(`<h1 class="big">Updates</h1>
<div class="card2"><div class="hd">Installed<span class="chip p-ok">Build 31</span></div><p><span class="mono">v1.4.2</span><br><span class="mono">8b75ac8f1517c4cddd82</span></p></div>
<div class="card2"><div class="hd">Available</div><p>No newer release found. Up to date as of the last check, 12 min ago.</p></div>
<div class="card2"><div class="hd">Staging<span class="chip p-idle">Not staged</span></div><p>Staging leaves the active release and Sessions unchanged.</p></div>
<div class="card2"><div class="hd">Activation<span class="chip p-idle">None</span></div><p>No activation result yet.</p></div>
<div class="card2"><div class="hd">Old releases<span class="chip p-ok">Cleaned</span></div><p>Removed v1.3.9.</p></div>`, 1000);

const available = phone(`<h1 class="big">Updates</h1><div class="uhero"><span class="tile f-running">${ic("sparkle", 28)}</span><b>v1.5.0 is ready</b><div class="v">build 4 · you have v1.4.2</div>
<div class="s">Atlas restarts for a moment. Queued Sessions are kept and OpenCode keeps running. If something goes wrong, the previous version comes back automatically.</div>
<a class="bigbtn">${ic("play", 17)}Install</a></div>${policyToggle}`, 760);
const installing = phone(`<h1 class="big">Updates</h1><div class="uhero"><span class="tile f-running">${ic("refresh", 28)}</span><b>Installing v1.5.0</b>
<div class="prog"><i></i></div>
<div class="steps"><div class="done">${ic("check", 16)}Downloaded and checked</div><div class="now"><i></i>Waiting for a safe moment to restart</div><div class="todo"><i></i>Restart and confirm</div></div></div>
<p class="fh" style="text-align:center;margin-top:10px">You can leave this page. Agents keep working.</p>`, 640);

const loginCard = (extra = "", err = false) => phone(
  `<div class="lcard"><div class="lg">${logo(64, 18)}</div><h2>Sign in to Atlas</h2><p class="s">Use the shared team credential from your Atlas operator.</p>
  ${extra}<div class="field${err ? " err" : ""}">••••••••••••</div>${err ? `<div class="redbox" style="text-align:left">${ic("warn", 18)}<div><b>That didn’t work</b>The shared credential was not accepted.</div></div><div style="height:14px"></div>` : `<div style="height:18px"></div>`}
  <a class="bigbtn">Sign in</a></div>`,
  700, "login", "", false,
);
const loginPlain = phone(
  `<div class="plain"><p class="eb">Private access</p><h2>Sign in to Atlas</h2><p class="s">Use the shared team credential to open Atlas.</p>
  <div class="lab2">Shared access credential</div><div class="field">••••••••••••</div><p class="hint">From your Atlas operator.</p>
  <a class="bigbtn" style="width:120px">Sign in</a></div>`,
  700, "login", `<span class="brandbar">${logo(26, 7)}Atlas</span>`, false,
);
const preserved = loginCard(`<div class="infobox">${ic("doc", 18)}<div>Your Start Session form is saved. Sign in, then check it and tap Start again. Atlas won’t send it on its own.</div></div>`);

type Pick = { title: string; o1: [string, string]; o2: [string, string]; a: string; b: string };
const picks: Pick[] = [
  { title: "The Updates page", o1: ["Simple", "one status card, details tucked away"], o2: ["Everything", "every step as its own card"], a: simple(), b: full },
  { title: "Automatic updates setting", o1: ["A switch", "on / off"], o2: ["Two choices", "tick one"], a: simple(policyToggle), b: simple(policyList) },
  { title: "Sign in", o1: ["Centred", "big logo, one field"], o2: ["Plain page", "like the rest of Atlas"], a: loginCard(), b: loginPlain },
];

const opt = (n: 1 | 2, [name, note]: [string, string], inner: string) =>
  `<div class="opt"><div class="lab"><span>${n}</span>${name} <em>${note}</em></div>${inner}</div>`;

const checks = [
  { title: "An update is ready", body: available },
  { title: "Installing", body: installing },
  { title: "Wrong credential", body: loginCard("", true) },
  { title: "Signed out while starting a Session", body: preserved },
];

const body = `<main class="tile-page">
  <h1>Updates &amp; Sign in</h1>
  <p class="how">The last two screens. Updates lives under More. <span class="phone-only">Tap <b>1</b> / <b>2</b> to flip.</span><br>
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

export const updatesPage = page({ look: { id: "a", name: "Updates & Sign in" }, screen: "inbox", title: "Updates & Sign in — pick", fonts: ["Inter", "Geist Mono"], css, body });
