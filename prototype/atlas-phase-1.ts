// Throwaway prototype: three complete Phase 1 UI variants, switchable with ?variant=A|B|C.

type Variant = "A" | "B" | "C"
type View = "specs" | "pulls" | "sessions"
type ViewState = "data" | "empty" | "loading" | "disconnected" | "failed"
type SessionMode = "live" | "disconnected" | "succeeded" | "failed" | "interrupted"

const variants: Record<Variant, string> = {
  A: "Operations rail",
  B: "Guided workspace",
  C: "Terminal desk",
}

const repositories = [
  { id: "atlas", name: "digis/atlas", description: "Autonomous implementation control plane", private: true },
  { id: "signal", name: "digis/signal", description: "Internal event and notification service", private: true },
  { id: "docs", name: "digis/engineering-handbook", description: "Team engineering playbook", private: false },
]

const specs = [
  {
    id: 142,
    title: "Add repository health summary",
    labels: ["spec", "dashboard"],
    updated: "8 min ago",
    sessions: [
      { id: "ses_health_live", status: "live", label: "Running · 18m" },
      { id: "ses_health_failed", status: "failed", label: "Failed · yesterday" },
    ],
  },
  {
    id: 138,
    title: "Reconcile webhook delivery gaps",
    labels: ["spec", "reliability"],
    updated: "42 min ago",
    sessions: [{ id: "ses_webhooks_done", status: "succeeded", label: "Succeeded · 2h 11m" }],
  },
  {
    id: 131,
    title: "Render tool calls in session detail",
    labels: ["spec", "observability"],
    updated: "yesterday",
    sessions: [],
  },
]

const pulls = [
  { id: 284, title: "feat: repository health summary", author: "maya", branch: "atlas/health-summary", checks: "4/5", draft: false, updated: "3 min ago" },
  { id: 281, title: "fix: recover missed webhook deliveries", author: "niko", branch: "fix/webhook-reconcile", checks: "6/6", draft: false, updated: "29 min ago" },
  { id: 279, title: "spike: compact session activity rows", author: "lee", branch: "spike/session-density", checks: "2/2", draft: true, updated: "1h ago" },
]

const sessions = [
  { id: "ses_health_live", spec: 142, title: "Add repository health summary", status: "live", elapsed: "18m", activity: "Running integration checks", updated: "now" },
  { id: "ses_tool_wait", spec: 131, title: "Render tool calls in session detail", status: "waiting", elapsed: "7m", activity: "Retry scheduled in 24s", updated: "4s ago" },
  { id: "ses_webhooks_done", spec: 138, title: "Reconcile webhook delivery gaps", status: "succeeded", elapsed: "2h 11m", activity: "Completed", updated: "38 min ago" },
  { id: "ses_health_failed", spec: 142, title: "Add repository health summary", status: "failed", elapsed: "31m", activity: "Tests failed", updated: "yesterday" },
  { id: "ses_old_stop", spec: 118, title: "Pin OpenCode client version", status: "interrupted", elapsed: "12m", activity: "Server shutdown", updated: "3 days ago" },
]

const icon = (name: "repo" | "spec" | "pr" | "session" | "pulse" | "branch" | "plus" | "arrow") => {
  const paths = {
    repo: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21.5v-16Z"/><path d="M4 18.5A2.5 2.5 0 0 1 6.5 16H20"/>',
    spec: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6M8 13h8M8 17h6"/>',
    pr: '<circle cx="6" cy="5" r="3"/><circle cx="18" cy="19" r="3"/><path d="M6 8v13M18 16V9a4 4 0 0 0-4-4h-3M14 2l-3 3 3 3"/>',
    session: '<rect width="18" height="14" x="3" y="5" rx="2"/><path d="m7 9 3 3-3 3M13 15h4"/>',
    pulse: '<path d="M3 12h4l2-6 4 12 2-6h6"/>',
    branch: '<circle cx="6" cy="4" r="2"/><circle cx="18" cy="6" r="2"/><circle cx="6" cy="20" r="2"/><path d="M6 6v12M8 8c4 0 5-2 8-2"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    arrow: '<path d="m9 18 6-6-6-6"/>',
  }
  return `<svg aria-hidden="true" viewBox="0 0 24 24">${paths[name]}</svg>`
}

const escapeHtml = (value: unknown) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")

const parseVariant = (url: URL): Variant => {
  const value = url.searchParams.get("variant")
  return value === "B" || value === "C" ? value : "A"
}

const route = (path: string, variant: Variant, values: Record<string, string> = {}) => {
  const query = new URLSearchParams({ variant, ...values })
  return `${path}?${query}`
}

const hxLink = (href: string, body: string, className = "") =>
  `<a class="${className}" href="${href}" hx-get="${href}" hx-target="#app" hx-push-url="true">${body}</a>`

const statusBadge = (status: string) => {
  const labels: Record<string, string> = {
    live: "Live",
    running: "Running",
    waiting: "Waiting · retry",
    succeeded: "Succeeded",
    failed: "Failed",
    interrupted: "Interrupted",
    disconnected: "Disconnected",
    draft: "Draft",
    open: "Open",
  }
  return `<span class="badge status-${status}"><span class="status-dot"></span>${labels[status] ?? escapeHtml(status)}</span>`
}

const repoNav = (repo: string, active: View, variant: Variant) => {
  const links: Array<[View, string, "spec" | "pr" | "session"]> = [
    ["specs", "Specs", "spec"],
    ["pulls", "Pull requests", "pr"],
    ["sessions", "Sessions", "session"],
  ]
  return `<nav class="repo-nav" aria-label="Repository">
    ${links.map(([view, label, symbol]) => hxLink(
      route(`/prototype/atlas/repositories/${repo}/${view}`, variant),
      `${icon(symbol)}<span>${label}</span>`,
      active === view ? "active" : "",
    )).join("")}
  </nav>`
}

const stateLab = (path: string, variant: Variant, current: ViewState, extra: Record<string, string> = {}) => {
  const states: Array<[ViewState, string]> = [
    ["data", "Data"],
    ["empty", "Empty"],
    ["loading", "Loading"],
    ["disconnected", "Disconnected"],
    ["failed", "Failed"],
  ]
  return `<aside class="state-lab" aria-label="Prototype state controls">
    <span>View state</span>
    <div>${states.map(([state, label]) => hxLink(
      route(path, variant, { ...extra, ...(state === "data" ? {} : { state }) }),
      label,
      current === state ? "active" : "",
    )).join("")}</div>
  </aside>`
}

const skeleton = () => `<div class="skeletons" role="status" aria-label="Loading">
  <div class="skeleton wide"></div><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton short"></div>
</div>`

const emptyState = (view: View) => {
  const copy = {
    specs: ["No open Specs", "Issues labelled spec will appear here after the next sync."],
    pulls: ["No active pull requests", "Open and draft pull requests will appear here."],
    sessions: ["No Sessions match", "Start a Session from a Spec or change the status filter."],
  }
  return `<section class="empty-state"><div class="empty-icon">${icon(view === "specs" ? "spec" : view === "pulls" ? "pr" : "session")}</div>
    <h2>${copy[view][0]}</h2><p>${copy[view][1]}</p></section>`
}

const failedState = (path: string, variant: Variant, view: View) => `<section class="error-state" role="alert">
  <span class="error-code">SYNC_FAILED</span><h2>Could not load ${view === "pulls" ? "pull requests" : view}</h2>
  <p>GitHub returned a temporary error. Existing Atlas data has not been changed.</p>
  ${hxLink(route(path, variant), "Try again", "button primary")}
</section>`

const disconnectedBanner = () => `<div class="connection-banner" role="status">
  ${statusBadge("disconnected")}<div><strong>Live updates paused</strong><span>Showing the last reconciled data from 48 seconds ago.</span></div>
  <button type="button" hx-get="${locationlessReconnect()}" hx-target="#app">Reconnect</button>
</div>`

// Replaced client-side before htmx sends the request; keeps the current path and variant.
const locationlessReconnect = () => "/prototype/reconnect"

const renderViewState = (
  state: ViewState,
  view: View,
  path: string,
  variant: Variant,
  data: string,
) => {
  if (state === "loading") return skeleton()
  if (state === "empty") return emptyState(view)
  if (state === "failed") return failedState(path, variant, view)
  return `${state === "disconnected" ? disconnectedBanner() : ""}${data}`
}

const pageHeading = (eyebrow: string, title: string, description: string, action = "") => `<header class="page-heading">
  <div><span class="eyebrow">${eyebrow}</span><h1>${title}</h1><p>${description}</p></div>${action}
</header>`

const specSessionLinks = (item: typeof specs[number], variant: Variant) => item.sessions.length
  ? `<div class="session-history" aria-label="Session history">${item.sessions.map((session) => hxLink(
      route(`/prototype/atlas/sessions/${session.id}`, variant),
      `${statusBadge(session.status)}<span>${session.label}</span>`,
      "session-chip",
    )).join("")}</div>`
  : `<span class="muted">No Sessions yet</span>`

const renderSpecsA = (variant: Variant) => `<div class="spec-list">
  ${specs.map((item) => `<article class="spec-row">
    <div class="spec-main"><span class="issue-number">#${item.id}</span><div><h2>${item.title}</h2>
      <div class="meta">${item.labels.map((label) => `<span class="label">${label}</span>`).join("")}<span>Updated ${item.updated}</span></div></div></div>
    <div class="spec-sessions"><span class="section-label">Session history</span>${specSessionLinks(item, variant)}</div>
    ${hxLink(route(`/prototype/atlas/specs/${item.id}/start`, variant), `${icon("plus")}Start Session`, "button secondary")}
  </article>`).join("")}
</div>`

const renderSpecsB = (variant: Variant) => `<div class="spec-board">
  <section><h2>Ready to start <span>${specs.filter((item) => !item.sessions.some((session) => session.status === "live")).length}</span></h2>
    ${specs.filter((item) => !item.sessions.some((session) => session.status === "live")).map((item) => `<article class="spec-card">
      <span class="issue-number">Spec #${item.id}</span><h3>${item.title}</h3><p>Updated ${item.updated}</p>
      <div class="card-actions">${specSessionLinks(item, variant)}${hxLink(route(`/prototype/atlas/specs/${item.id}/start`, variant), "Start Session", "button primary")}</div>
    </article>`).join("")}
  </section>
  <section><h2>In motion <span>1</span></h2>
    ${specs.filter((item) => item.sessions.some((session) => session.status === "live")).map((item) => `<article class="spec-card featured">
      ${statusBadge("live")}<span class="issue-number">Spec #${item.id}</span><h3>${item.title}</h3>
      ${specSessionLinks(item, variant)}
    </article>`).join("")}
  </section>
</div>`

const renderSpecsC = (variant: Variant) => `<div class="terminal-table" role="table" aria-label="Specs">
  <div class="terminal-row terminal-head" role="row"><span>ID</span><span>SPEC</span><span>LAST ACTIVITY</span><span>SESSION</span><span>ACTION</span></div>
  ${specs.map((item) => `<div class="terminal-row" role="row"><span>#${item.id}</span><strong>${item.title}</strong><span>${item.updated}</span>
    <span>${specSessionLinks(item, variant)}</span>${hxLink(route(`/prototype/atlas/specs/${item.id}/start`, variant), "+ start", "terminal-action")}</div>`).join("")}
</div>`

const renderSpecs = (variant: Variant) => variant === "A" ? renderSpecsA(variant) : variant === "B" ? renderSpecsB(variant) : renderSpecsC(variant)

const renderPullsA = () => `<div class="pr-list">${pulls.map((pull) => `<article class="pr-row">
  <div class="avatar">${pull.author.slice(0, 1).toUpperCase()}</div><div class="grow"><div class="title-line"><span class="issue-number">#${pull.id}</span><h2>${pull.title}</h2>${statusBadge(pull.draft ? "draft" : "open")}</div>
  <p>${icon("branch")}${pull.branch} · opened by ${pull.author} · updated ${pull.updated}</p></div>
  <div class="checks ${pull.checks.startsWith("6") || pull.draft ? "pass" : "pending"}">${pull.checks} checks</div>
</article>`).join("")}</div>`

const renderPullsB = () => `<div class="pr-board">
  <section><h2>Ready for review</h2>${pulls.filter((pull) => !pull.draft).map((pull) => `<article class="pr-card"><div>${statusBadge("open")}<span>#${pull.id}</span></div><h3>${pull.title}</h3><p>${pull.branch}</p><footer><span>@${pull.author}</span><strong>${pull.checks} checks</strong></footer></article>`).join("")}</section>
  <section><h2>Drafts</h2>${pulls.filter((pull) => pull.draft).map((pull) => `<article class="pr-card"><div>${statusBadge("draft")}<span>#${pull.id}</span></div><h3>${pull.title}</h3><p>${pull.branch}</p><footer><span>@${pull.author}</span><strong>${pull.checks} checks</strong></footer></article>`).join("")}</section>
</div>`

const renderPullsC = () => `<div class="terminal-table" role="table" aria-label="Pull requests">
  <div class="terminal-row pr terminal-head" role="row"><span>PR</span><span>STATE</span><span>TITLE</span><span>BRANCH</span><span>CHECKS</span><span>UPDATED</span></div>
  ${pulls.map((pull) => `<div class="terminal-row pr" role="row"><span>#${pull.id}</span><span>${statusBadge(pull.draft ? "draft" : "open")}</span><strong>${pull.title}</strong><span>${pull.branch}</span><span>${pull.checks}</span><span>${pull.updated}</span></div>`).join("")}
</div>`

const renderPulls = (variant: Variant) => variant === "A" ? renderPullsA() : variant === "B" ? renderPullsB() : renderPullsC()

const sessionFilter = (variant: Variant, selected: string) => {
  const filters = [["running", "Running"], ["all", "All"], ["succeeded", "Succeeded"], ["failed", "Failed"], ["interrupted", "Interrupted"]]
  return `<nav class="filters" aria-label="Session status">${filters.map(([value, label]) => hxLink(
    route("/prototype/atlas/repositories/atlas/sessions", variant, { status: value }),
    label,
    selected === value ? "active" : "",
  )).join("")}</nav>`
}

const filteredSessions = (filter: string) => {
  if (filter === "all") return sessions
  if (filter === "running") return sessions.filter((session) => session.status === "live" || session.status === "waiting")
  return sessions.filter((session) => session.status === filter)
}

const renderSessionsA = (variant: Variant, filter: string) => `<div class="session-list">${filteredSessions(filter).map((session) => hxLink(
  route(`/prototype/atlas/sessions/${session.id}`, variant),
  `<article class="session-row"><div class="session-state">${statusBadge(session.status)}<span>${session.elapsed}</span></div><div class="grow"><span class="issue-number">Spec #${session.spec}</span><h2>${session.title}</h2><p>${session.activity} · ${session.updated}</p></div><div class="open-link">Open ${icon("arrow")}</div></article>`,
)).join("")}</div>`

const renderSessionsB = (variant: Variant, filter: string) => `<div class="session-cards">${filteredSessions(filter).map((session) => hxLink(
  route(`/prototype/atlas/sessions/${session.id}`, variant),
  `<article class="session-card ${session.status}"><header>${statusBadge(session.status)}<span>${session.elapsed}</span></header><h2>${session.title}</h2><p>Spec #${session.spec}</p><div class="activity-line">${icon("pulse")}<span>${session.activity}</span></div><footer>Updated ${session.updated}<span>Inspect ${icon("arrow")}</span></footer></article>`,
)).join("")}</div>`

const renderSessionsC = (variant: Variant, filter: string) => `<div class="process-list"><div class="process-head"><span>SESSION</span><span>STATE</span><span>SPEC</span><span>ELAPSED</span><span>CURRENT ACTIVITY</span></div>
  ${filteredSessions(filter).map((session) => hxLink(route(`/prototype/atlas/sessions/${session.id}`, variant), `<span>${session.id.slice(0, 13)}</span><span>${statusBadge(session.status)}</span><span>#${session.spec} ${session.title}</span><span>${session.elapsed}</span><span>${session.activity}</span>`, "process-row")).join("")}
</div>`

const renderSessions = (variant: Variant, filter: string) => variant === "A" ? renderSessionsA(variant, filter) : variant === "B" ? renderSessionsB(variant, filter) : renderSessionsC(variant, filter)

const viewMeta: Record<View, [string, string]> = {
  specs: ["Specs", "Open GitHub issues carrying the spec label."],
  pulls: ["Pull requests", "Active open and draft work from GitHub."],
  sessions: ["Sessions", "OpenCode Sessions started by Atlas."],
}

const repositoryView = (repo: string, view: View, variant: Variant, url: URL) => {
  const path = `/prototype/atlas/repositories/${repo}/${view}`
  const stateValue = url.searchParams.get("state")
  const state: ViewState = ["empty", "loading", "disconnected", "failed"].includes(stateValue ?? "") ? stateValue as ViewState : "data"
  const filter = url.searchParams.get("status") ?? "running"
  const heading = pageHeading(
    "digis / atlas",
    viewMeta[view][0],
    viewMeta[view][1],
    view === "sessions" ? `<span class="sync-note"><span></span>Synced 12s ago</span>` : "",
  )
  const content = view === "specs" ? renderSpecs(variant) : view === "pulls" ? renderPulls(variant) : renderSessions(variant, filter)
  const controls = `${view === "sessions" ? sessionFilter(variant, filter) : ""}${stateLab(path, variant, state, view === "sessions" ? { status: filter } : {})}`
  return appShell(variant, repo, view, `${heading}${controls}${renderViewState(state, view, path, variant, content)}`)
}

const onboarding = (variant: Variant) => {
  if (variant === "A") return appShell(variant, null, null, `<section class="onboarding compact">
    <span class="eyebrow">GitHub App connected</span><h1>Add a Repository</h1><p>Choose one repository available to the Atlas installation.</p>
    <form hx-post="${route("/prototype/atlas/repositories", variant)}" hx-target="#app" class="repo-picker">
      ${repositories.map((repo, index) => `<label class="repo-option"><input type="radio" name="repo" value="${repo.id}" ${index === 0 ? "checked" : ""}/><span class="repo-symbol">${icon("repo")}</span><span class="grow"><strong>${repo.name}</strong><small>${repo.description}</small></span><span class="visibility">${repo.private ? "Private" : "Public"}</span></label>`).join("")}
      <button class="button primary wide-button" type="submit">Add Repository ${icon("arrow")}</button>
    </form>
  </section>`)

  if (variant === "B") return appShell(variant, null, null, `<section class="onboarding guided">
    <header><span class="eyebrow">Repository setup</span><h1>Bring a repository into Atlas</h1><p>Three short steps. Atlas only shows repositories granted to the GitHub App.</p></header>
    <ol class="steps"><li class="done"><span>1</span>App connected</li><li class="active"><span>2</span>Choose Repository</li><li><span>3</span>Start from a Spec</li></ol>
    <form hx-post="${route("/prototype/atlas/repositories", variant)}" hx-target="#app">
      <fieldset><legend>Available to Atlas</legend><div class="repo-grid">${repositories.map((repo, index) => `<label class="repo-tile"><input type="radio" name="repo" value="${repo.id}" ${index === 0 ? "checked" : ""}/><span>${icon("repo")}</span><strong>${repo.name}</strong><small>${repo.description}</small><em>${repo.private ? "Private" : "Public"}</em></label>`).join("")}</div></fieldset>
      <div class="form-footer"><span>Access can be changed in GitHub App settings.</span><button class="button primary" type="submit">Continue with Repository</button></div>
    </form>
  </section>`)

  return appShell(variant, null, null, `<section class="onboarding terminal-onboard">
    <div class="prompt-line"><span>atlas</span><strong>repository add</strong><i>_</i></div>
    <h1>Select a repository</h1><p>Installation digis-org · 3 repositories available</p>
    <form hx-post="${route("/prototype/atlas/repositories", variant)}" hx-target="#app" class="command-picker">
      ${repositories.map((repo, index) => `<label><input type="radio" name="repo" value="${repo.id}" ${index === 0 ? "checked" : ""}/><span class="caret">›</span><span>${repo.name}</span><small>${repo.private ? "private" : "public"} · ${repo.description}</small></label>`).join("")}
      <div class="key-help"><span><kbd>↑</kbd><kbd>↓</kbd> navigate</span><span><kbd>enter</kbd> select</span><button type="submit">Add selected Repository</button></div>
    </form>
  </section>`)
}

const startSession = (specId: number, variant: Variant) => {
  const spec = specs.find((item) => item.id === specId) ?? specs[0]
  const form = `<form class="prompt-form" hx-post="${route(`/prototype/atlas/specs/${spec.id}/sessions`, variant)}" hx-target="#app">
    <label for="prompt">Initial prompt</label><p class="field-help">Atlas includes the complete Spec automatically. Add context or a starting direction.</p>
    <textarea id="prompt" name="prompt" rows="7" required autofocus>Implement this Spec end to end. Follow the repository conventions and verify the result before finishing.</textarea>
    <div class="included-context"><span>${icon("spec")}</span><div><strong>Included automatically</strong><small>Spec #${spec.id} · ${spec.title}</small></div></div>
    <div class="form-actions">${hxLink(route("/prototype/atlas/repositories/atlas/specs", variant), "Cancel", "button ghost")}<button type="submit" class="button primary">Create and start Session ${icon("arrow")}</button></div>
  </form>`
  return appShell(variant, "atlas", "specs", `${pageHeading("Start Session", spec.title, `Spec #${spec.id} · No Session is created until you submit.`)}<div class="prompt-panel">${form}</div>`)
}

const sessionModeLab = (sessionId: string, variant: Variant, current: SessionMode) => {
  const modes: Array<[SessionMode, string]> = [["live", "Live"], ["disconnected", "Disconnected"], ["succeeded", "Succeeded"], ["failed", "Failed"], ["interrupted", "Interrupted"]]
  return `<aside class="state-lab session-mode" aria-label="Prototype session state controls"><span>Session state</span><div>${modes.map(([mode, label]) => hxLink(
    route(`/prototype/atlas/sessions/${sessionId}`, variant, mode === "live" ? {} : { mode }), label, current === mode ? "active" : "",
  )).join("")}</div></aside>`
}

const modeSummary = (mode: SessionMode) => {
  if (mode === "disconnected") return { semantic: "Live", badge: "disconnected", detail: "Reconnecting · last reconciled 48s ago", outcome: "Not terminal" }
  if (mode === "succeeded") return { semantic: "Succeeded", badge: "succeeded", detail: "Finished 38 minutes ago", outcome: "succeeded" }
  if (mode === "failed") return { semantic: "Failed", badge: "failed", detail: "Finished after 31 minutes", outcome: "failed" }
  if (mode === "interrupted") return { semantic: "Interrupted", badge: "interrupted", detail: "Server shutdown", outcome: "interrupted" }
  return { semantic: "Live", badge: "live", detail: "Running · event stream connected", outcome: "Not terminal" }
}

const timeline = (mode: SessionMode) => `<ol class="timeline">
  <li class="event user-event"><div class="event-marker">U</div><article><header><strong>You</strong><time>09:42:11</time></header><p>Implement this Spec end to end. Follow the repository conventions and verify the result before finishing.</p></article></li>
  <li class="event assistant-event"><div class="event-marker">A</div><article><header><strong>OpenCode · build agent</strong><time>09:42:14</time></header><p>I’ll inspect the repository and trace the existing health data flow before changing it.</p></article></li>
  <li class="event reasoning-event"><div class="event-marker">R</div><details open><summary><strong>Reasoning</strong><span>12s</span></summary><p>The dashboard already exposes repository sync timestamps. The smallest path is to project health from those records rather than introduce a second probe.</p></details></li>
  <li class="event tool-event completed"><div class="event-marker">T</div><details open><summary><span><strong>read</strong><code>src/repositories/routes.ts</code></span><span class="tool-state">completed · 84ms</span></summary><pre><code>export const repositoryRoutes = new Hono()
  .get('/:id', showRepository)</code></pre></details></li>
  <li class="event tool-event running"><div class="event-marker">T</div><details open><summary><span><strong>shell</strong><code>bun test</code></span><span class="tool-state">${mode === "live" || mode === "disconnected" ? "running · 63%" : mode === "succeeded" ? "completed · 42.8s" : "error · exit 1"}</span></summary>
    ${mode === "live" || mode === "disconnected" ? `<div class="progress"><span style="width:63%"></span></div><pre><code>47 pass
12 pending
Running repository route integration tests…</code></pre>` : mode === "succeeded" ? `<pre><code>59 pass
0 fail
Completed in 42.8s</code></pre>` : `<pre class="error-output"><code>58 pass
1 fail
Expected sync age “12s”, received “unknown”</code></pre>`}
  </details></li>
  ${mode === "failed" ? `<li class="event error-event"><div class="event-marker">!</div><article><header><strong>Execution failed</strong><time>10:13:28</time></header><p>Test command exited with status 1. Session outcome reconciled from OpenCode.</p></article></li>` : ""}
  ${mode === "interrupted" ? `<li class="event error-event"><div class="event-marker">!</div><article><header><strong>Execution interrupted</strong><time>09:54:06</time></header><p>The OpenCode server shut down. Preserved messages remain available.</p></article></li>` : ""}
  ${mode === "succeeded" ? `<li class="event assistant-event final"><div class="event-marker">A</div><article><header><strong>Final response</strong><time>11:53:37</time></header><p>Implemented repository health summaries and verified all 59 tests. The dashboard now distinguishes healthy, delayed, and disconnected sync states.</p></article></li>` : ""}
</ol>`

const subagentsPanel = (mode: SessionMode) => `<section class="subagents"><header><div><span class="eyebrow">Child Sessions</span><h2>Active subagents</h2></div><span class="count">${mode === "live" || mode === "disconnected" ? "2 active" : "0 active"}</span></header>
  <article><div class="agent-glyph">E</div><div><strong>explore</strong><span>Tracing health projection</span><small>ses_child_explore · 6m</small></div>${statusBadge(mode === "live" || mode === "disconnected" ? "live" : "succeeded")}</article>
  <article><div class="agent-glyph">G</div><div><strong>general</strong><span>Running route checks</span><small>ses_child_checks · 3m</small></div>${statusBadge(mode === "live" || mode === "disconnected" ? "live" : "succeeded")}</article>
  <p class="contract-note">Verified child Sessions whose agent mode is subagent or all.</p>
</section>`

const sessionHeader = (summary: ReturnType<typeof modeSummary>) => `<header class="session-header"><div>
  <span class="eyebrow">Spec #142 · Session ses_health_live</span><h1>Add repository health summary</h1>
  <div class="session-meta">${statusBadge(summary.badge)}<span>${summary.detail}</span><span>Started 09:42</span></div></div>
  <dl><div><dt>Elapsed</dt><dd>18m 24s</dd></div><div><dt>Last activity</dt><dd>Now</dd></div><div><dt>Outcome</dt><dd>${summary.outcome}</dd></div></dl>
</header>`

const sessionDetail = (sessionId: string, variant: Variant, url: URL, prompt = "") => {
  const requestedMode = url.searchParams.get("mode")
  const mode: SessionMode = ["disconnected", "succeeded", "failed", "interrupted"].includes(requestedMode ?? "") ? requestedMode as SessionMode : "live"
  const summary = modeSummary(mode)
  const promptNotice = prompt ? `<div class="created-notice" role="status"><strong>Session created</strong><span>Initial prompt: “${escapeHtml(prompt).slice(0, 120)}”</span></div>` : ""
  const stale = mode === "disconnected" ? disconnectedBanner() : ""
  let content = ""
  if (variant === "A") content = `${promptNotice}${stale}${sessionHeader(summary)}<div class="viewer-grid"><section class="activity"><header><h2>Activity</h2><span>HTTP reconciled · SSE ${mode === "disconnected" ? "reconnecting" : "connected"}</span></header>${timeline(mode)}</section>${subagentsPanel(mode)}</div>`
  if (variant === "B") content = `${promptNotice}${stale}${sessionHeader(summary)}<div class="session-workspace"><div class="now-card"><span class="eyebrow">Now</span><strong>${mode === "live" ? "Running repository route integration tests" : summary.semantic}</strong><div class="progress"><span style="width:${mode === "live" ? "63" : "100"}%"></span></div></div>${subagentsPanel(mode)}<section class="activity roomy"><header><h2>Session story</h2><p>Messages, decisions, and tool work in one readable sequence.</p></header>${timeline(mode)}</section></div>`
  if (variant === "C") content = `${promptNotice}${stale}<div class="terminal-session-head"><div><span>SESSION / ses_health_live</span><h1>Add repository health summary</h1></div>${statusBadge(summary.badge)}<dl><div><dt>elapsed</dt><dd>18m24s</dd></div><div><dt>outcome</dt><dd>${summary.outcome}</dd></div><div><dt>transport</dt><dd>${mode === "disconnected" ? "stale" : "fresh"}</dd></div></dl></div><div class="terminal-viewer"><section><header>activity.log <span>follow: ${mode === "live" ? "on" : "off"}</span></header>${timeline(mode)}</section>${subagentsPanel(mode)}</div>`
  return appShell(variant, "atlas", "sessions", `${sessionModeLab(sessionId, variant, mode)}${content}`)
}

const appShell = (variant: Variant, repo: string | null, view: View | null, content: string) => {
  const repoTitle = repo ? "digis / atlas" : "No Repository selected"
  const addUrl = route("/prototype/atlas", variant)
  if (variant === "A") return `<div class="shell shell-a"><aside class="rail"><a class="brand" href="${addUrl}"><span>A</span>Atlas</a>
    <div class="rail-label">Repository</div><button class="repo-select">${icon("repo")}<span><strong>${repoTitle}</strong><small>${repo ? "GitHub · synced" : "Add one to begin"}</small></span></button>
    ${repo && view ? repoNav(repo, view, variant) : ""}<div class="rail-bottom"><span class="connection-dot"></span>Services online</div></aside><section class="stage"><header class="topbar"><span>${repo ? "Repository workspace" : "Setup"}</span><div><span class="live-mark">Live</span><span class="user-avatar">SR</span></div></header><div class="page">${content}</div></section></div>`

  if (variant === "B") return `<div class="shell shell-b"><header class="global-header"><a class="brand" href="${addUrl}"><span>A</span>Atlas</a><div class="repository-crumb">${icon("repo")}<span>${repoTitle}</span></div><div class="global-actions"><span class="sync-note"><span></span>All systems connected</span><span class="user-avatar">SR</span></div></header>
    ${repo && view ? repoNav(repo, view, variant) : ""}<main class="canvas">${content}</main></div>`

  return `<div class="shell shell-c"><header class="terminal-bar"><a class="brand" href="${addUrl}"><span>▲</span> ATLAS</a><span>control plane / ${repo ? repoTitle : "setup"}</span><div><span class="connection-dot"></span> connected <kbd>⌘K</kbd></div></header><div class="terminal-layout"><aside><div class="tree-title">EXPLORER</div><a href="${addUrl}">${icon("repo")} repositories</a>${repo && view ? `<div class="tree-repo"><span>⌄</span><strong>atlas</strong></div>${repoNav(repo, view, variant)}` : ""}<div class="tree-footer">OPENCODE <span>beta-19135</span></div></aside><main class="terminal-canvas">${content}</main></div></div>`
}

const styles = `
  :root{color-scheme:dark;--bg:#080d16;--panel:#101827;--panel-2:#162235;--line:#26354a;--line-soft:#1c293a;--text:#f1f5f9;--muted:#94a3b8;--subtle:#64748b;--green:#4ade80;--green-dark:#173d2b;--blue:#60a5fa;--blue-dark:#172c4b;--amber:#fbbf24;--red:#fb7185;--red-dark:#491e2b;--purple:#c084fc;--radius:12px;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
  *{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font-size:14px}a{color:inherit;text-decoration:none}button,input,textarea{font:inherit}button,a,label{touch-action:manipulation}button,.button,a[role=button]{cursor:pointer}svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}h1,h2,h3,p{margin-top:0}h1{font-size:clamp(1.7rem,3vw,2.35rem);line-height:1.08;letter-spacing:-.035em;margin-bottom:9px}h2{font-size:1rem}p{color:var(--muted);line-height:1.55}.grow{flex:1;min-width:0}.muted{color:var(--subtle)}:focus-visible{outline:2px solid var(--blue);outline-offset:3px}.button{display:inline-flex;align-items:center;justify-content:center;gap:8px;border:1px solid var(--line);border-radius:8px;padding:10px 14px;font-weight:700;transition:background-color .18s,border-color .18s}.button.primary{background:var(--green);border-color:var(--green);color:#052e16}.button.primary:hover{background:#86efac}.button.secondary{background:var(--panel-2)}.button.secondary:hover,.button.ghost:hover{border-color:#526782;background:#1a293d}.button.ghost{background:transparent}.button svg{width:16px}.eyebrow,.section-label,.rail-label{display:block;color:var(--blue);font-size:11px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;margin-bottom:9px}.badge{display:inline-flex;align-items:center;gap:7px;width:max-content;border:1px solid var(--line);border-radius:999px;padding:4px 8px;color:var(--muted);font-size:11px;font-weight:700;white-space:nowrap}.status-dot{width:6px;height:6px;border-radius:50%;background:currentColor}.status-live,.status-running,.status-open,.status-succeeded{color:var(--green);background:rgba(74,222,128,.07);border-color:rgba(74,222,128,.22)}.status-live .status-dot{animation:pulse 1.6s infinite}.status-waiting,.status-draft{color:var(--amber);background:rgba(251,191,36,.07);border-color:rgba(251,191,36,.24)}.status-failed,.status-interrupted,.status-disconnected{color:var(--red);background:rgba(251,113,133,.07);border-color:rgba(251,113,133,.24)}
  .brand{display:flex;align-items:center;gap:9px;font-size:17px;font-weight:850;letter-spacing:-.02em}.brand>span{display:grid;place-items:center;width:29px;height:29px;border-radius:8px;background:var(--green);color:#052e16}.shell{min-height:100vh}.user-avatar{display:grid;place-items:center;width:30px;height:30px;border-radius:50%;background:#27364a;font-size:11px;font-weight:800}.connection-dot{display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--green);box-shadow:0 0 10px rgba(74,222,128,.6)}.repo-nav a{display:flex;align-items:center;gap:9px;color:var(--muted);font-weight:650;transition:background-color .18s,color .18s}.repo-nav a:hover,.repo-nav a.active{color:var(--text)}.page-heading{display:flex;align-items:end;justify-content:space-between;gap:20px;margin-bottom:26px}.page-heading p{margin-bottom:0}.sync-note{display:inline-flex;align-items:center;gap:7px;color:var(--muted);font-size:12px}.sync-note>span{width:7px;height:7px;border-radius:50%;background:var(--green)}
  .shell-a{display:grid;grid-template-columns:245px 1fr}.rail{position:sticky;top:0;height:100vh;border-right:1px solid var(--line-soft);background:#0c1320;padding:22px 15px;display:flex;flex-direction:column}.rail .brand{margin:0 8px 35px}.rail-label{color:var(--subtle);margin:0 9px 8px}.repo-select{display:flex;align-items:center;text-align:left;gap:10px;width:100%;border:1px solid var(--line);border-radius:9px;padding:10px;background:var(--panel);color:var(--text)}.repo-select>span{display:flex;flex-direction:column;min-width:0}.repo-select strong,.repo-select small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.repo-select small{color:var(--muted);font-size:11px;margin-top:2px}.rail .repo-nav{display:grid;gap:4px;margin-top:22px}.rail .repo-nav a{padding:10px;border-radius:7px}.rail .repo-nav a.active{background:var(--panel-2);box-shadow:inset 3px 0 var(--green)}.rail-bottom{display:flex;align-items:center;gap:8px;color:var(--subtle);font-size:12px;margin-top:auto;padding:10px}.stage{min-width:0}.topbar{height:64px;display:flex;align-items:center;justify-content:space-between;padding:0 34px;border-bottom:1px solid var(--line-soft);color:var(--muted)}.topbar>div{display:flex;align-items:center;gap:16px}.live-mark{color:var(--green);font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.1em}.page{max-width:1300px;margin:0 auto;padding:42px 38px 100px}
  .shell-b{background:linear-gradient(180deg,#0c1421 0,#080d16 420px)}.global-header{height:68px;padding:0 max(24px,calc((100vw - 1260px)/2));display:flex;align-items:center;gap:28px;border-bottom:1px solid var(--line-soft);background:rgba(8,13,22,.84);backdrop-filter:blur(14px)}.repository-crumb{display:flex;align-items:center;gap:9px;color:var(--muted);padding-left:28px;border-left:1px solid var(--line)}.global-actions{display:flex;align-items:center;gap:18px;margin-left:auto}.shell-b>.repo-nav{display:flex;gap:5px;padding:12px max(24px,calc((100vw - 1260px)/2));border-bottom:1px solid var(--line-soft)}.shell-b>.repo-nav a{padding:9px 13px;border-radius:999px}.shell-b>.repo-nav a.active{color:#052e16;background:var(--green)}.canvas{max-width:1260px;margin:0 auto;padding:52px 24px 110px}
  .shell-c{font-family:"SFMono-Regular",Consolas,"Liberation Mono",monospace;background:#070b12}.terminal-bar{height:46px;display:flex;align-items:center;gap:28px;padding:0 16px;border-bottom:1px solid #223044;background:#0b111b;color:var(--subtle);font-size:11px}.terminal-bar .brand{font-size:13px;color:var(--text)}.terminal-bar .brand>span{width:auto;height:auto;background:none;color:var(--green)}.terminal-bar>div{display:flex;align-items:center;gap:8px;margin-left:auto}.terminal-bar kbd{margin-left:14px}.terminal-layout{display:grid;grid-template-columns:210px 1fr;min-height:calc(100vh - 46px)}.terminal-layout>aside{position:sticky;top:46px;height:calc(100vh - 46px);padding:15px 8px;border-right:1px solid #202b3c;background:#0a1019;color:var(--muted)}.tree-title{font-size:10px;letter-spacing:.12em;margin:4px 8px 18px}.terminal-layout>aside>a,.tree-repo{display:flex;align-items:center;gap:7px;padding:7px 8px}.tree-repo{margin-top:15px;color:var(--text)}.terminal-layout .repo-nav{display:grid;margin-left:15px}.terminal-layout .repo-nav a{padding:8px;border-left:1px solid #2a3a50}.terminal-layout .repo-nav a.active{color:var(--green);background:#101c29}.tree-footer{position:absolute;left:16px;right:16px;bottom:16px;padding-top:12px;border-top:1px solid var(--line-soft);font-size:10px}.tree-footer span{float:right;color:var(--green)}.terminal-canvas{min-width:0;padding:29px 30px 100px}.shell-c .page-heading h1{font-size:25px;letter-spacing:-.025em}.shell-c .page-heading{padding-bottom:18px;border-bottom:1px solid var(--line)}
  .state-lab{display:flex;align-items:center;gap:12px;padding:8px 9px;margin-bottom:20px;border:1px dashed #3a4c64;border-radius:9px;background:rgba(96,165,250,.04)}.state-lab>span{color:var(--blue);font-size:10px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;margin-left:4px}.state-lab>div{display:flex;flex-wrap:wrap;gap:3px}.state-lab a{padding:5px 9px;border-radius:5px;color:var(--muted);font-size:11px}.state-lab a:hover,.state-lab a.active{background:var(--blue-dark);color:#bfdbfe}.session-mode{margin-bottom:24px}.filters{display:flex;gap:4px;margin-bottom:16px}.filters a{padding:7px 12px;border:1px solid transparent;border-radius:999px;color:var(--muted);font-size:12px;font-weight:700}.filters a:hover,.filters a.active{background:var(--panel-2);border-color:var(--line);color:var(--text)}
  .spec-list,.pr-list,.session-list{display:grid;border:1px solid var(--line);border-radius:var(--radius);overflow:hidden;background:var(--panel)}.spec-row{display:grid;grid-template-columns:minmax(250px,1.2fr) minmax(240px,1fr) auto;align-items:center;gap:22px;padding:18px;border-bottom:1px solid var(--line-soft)}.spec-row:last-child,.pr-row:last-child{border-bottom:0}.spec-main{display:flex;align-items:flex-start;gap:13px}.issue-number{color:var(--subtle);font-size:12px;white-space:nowrap}.spec-row h2,.pr-row h2,.session-row h2{font-size:14px;margin:0 0 8px}.meta{display:flex;align-items:center;flex-wrap:wrap;gap:6px;color:var(--subtle);font-size:11px}.label{padding:3px 6px;border-radius:5px;background:var(--blue-dark);color:#bfdbfe}.spec-sessions{min-width:0}.section-label{color:var(--subtle);margin-bottom:6px}.session-history{display:flex;flex-wrap:wrap;gap:5px}.session-chip{display:flex;align-items:center;gap:6px;padding:4px 6px 4px 0;color:var(--muted);font-size:11px;border-radius:6px}.session-chip:hover{background:var(--panel-2);color:var(--text)}.session-chip .badge{padding:3px 6px}.session-chip .status-dot{width:5px;height:5px}.session-chip .badge+.session-chip{display:none}
  .spec-board,.pr-board{display:grid;grid-template-columns:1.15fr .85fr;gap:22px;align-items:start}.spec-board>section,.pr-board>section{display:grid;gap:12px}.spec-board>section>h2,.pr-board>section>h2{display:flex;justify-content:space-between;color:var(--muted);font-size:12px;text-transform:uppercase;letter-spacing:.08em}.spec-board>section>h2 span{display:grid;place-items:center;width:22px;height:22px;border-radius:50%;background:var(--panel-2)}.spec-card,.pr-card{border:1px solid var(--line);border-radius:14px;background:linear-gradient(145deg,var(--panel),#0d1522);padding:20px}.spec-card:hover,.pr-card:hover{border-color:#40536d}.spec-card.featured{border-color:rgba(74,222,128,.34);box-shadow:0 16px 60px rgba(74,222,128,.06)}.spec-card h3,.pr-card h3{font-size:18px;line-height:1.35;margin:10px 0 6px}.spec-card p{font-size:12px}.card-actions{display:flex;align-items:end;justify-content:space-between;gap:12px;margin-top:18px}.card-actions .session-history{flex:1}.pr-card>div,.pr-card footer{display:flex;align-items:center;justify-content:space-between}.pr-card>p{font-family:monospace;color:var(--subtle)}.pr-card footer{border-top:1px solid var(--line-soft);padding-top:14px;margin-top:18px;color:var(--muted);font-size:12px}.pr-card footer strong{color:var(--green)}
  .pr-row{display:flex;align-items:center;gap:13px;padding:17px 18px;border-bottom:1px solid var(--line-soft)}.avatar{display:grid;place-items:center;width:34px;height:34px;border-radius:50%;background:var(--blue-dark);color:#bfdbfe;font-weight:800}.title-line{display:flex;align-items:center;gap:9px}.title-line h2{margin:0}.pr-row p{display:flex;align-items:center;gap:5px;margin:7px 0 0;font-size:11px}.pr-row p svg{width:13px}.checks{font-size:11px;font-weight:800}.checks.pass{color:var(--green)}.checks.pending{color:var(--amber)}
  .session-list>a{border-bottom:1px solid var(--line-soft)}.session-list>a:last-child{border:0}.session-row{display:flex;align-items:center;gap:18px;padding:17px 18px;transition:background-color .18s}.session-row:hover{background:var(--panel-2)}.session-state{display:flex;flex-direction:column;gap:7px;min-width:116px}.session-state>span:last-child{color:var(--subtle);font-size:11px}.session-row p{margin:0;font-size:11px}.open-link{display:flex;align-items:center;gap:5px;color:var(--blue);font-size:11px}.open-link svg{width:14px}.session-cards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}.session-card{height:100%;padding:18px;border:1px solid var(--line);border-top:3px solid var(--line);border-radius:12px;background:var(--panel);transition:border-color .18s,background-color .18s}.session-card:hover{background:var(--panel-2);border-color:#4c607c}.session-card.live{border-top-color:var(--green)}.session-card.waiting{border-top-color:var(--amber)}.session-card.failed,.session-card.interrupted{border-top-color:var(--red)}.session-card.succeeded{border-top-color:var(--green)}.session-card header,.session-card footer{display:flex;align-items:center;justify-content:space-between;color:var(--subtle);font-size:11px}.session-card h2{font-size:16px;line-height:1.35;margin:20px 0 5px}.activity-line{display:flex;align-items:center;gap:9px;min-height:48px;margin:18px 0;padding:11px;border-radius:7px;background:#0a111c;color:var(--muted);font-size:11px}.activity-line svg{color:var(--green)}.session-card footer span{display:flex;align-items:center;color:var(--blue)}.session-card footer svg{width:13px}.terminal-table,.process-list{border-top:1px solid var(--line);font-size:11px}.terminal-row{display:grid;grid-template-columns:70px minmax(240px,1.5fr) 120px minmax(230px,1fr) 80px;align-items:center;gap:12px;min-height:52px;padding:8px;border-bottom:1px solid var(--line-soft);color:var(--muted)}.terminal-row:hover:not(.terminal-head),.process-row:hover{background:#0e1824}.terminal-row strong{color:var(--text)}.terminal-row.pr{grid-template-columns:55px 90px minmax(220px,1.3fr) minmax(190px,1fr) 70px 80px}.terminal-head{min-height:32px;color:var(--subtle);font-size:9px;letter-spacing:.12em}.terminal-action{color:var(--green)}.shell-c .session-history{display:grid}.shell-c .session-chip{font-size:10px}.shell-c .session-chip>span:last-child{display:none}.process-head,.process-row{display:grid;grid-template-columns:135px 120px minmax(250px,1.3fr) 80px minmax(180px,1fr);gap:12px;align-items:center;padding:10px 8px}.process-head{color:var(--subtle);font-size:9px;letter-spacing:.1em;border-bottom:1px solid var(--line)}.process-row{min-height:52px;color:var(--muted);border-bottom:1px solid var(--line-soft)}.process-row>span:first-child{color:var(--blue)}.process-row>span:nth-child(3){color:var(--text)}
  .skeletons{display:grid;gap:10px;padding:18px;border:1px solid var(--line);border-radius:var(--radius);background:var(--panel)}.skeleton{height:62px;border-radius:8px;background:linear-gradient(90deg,#172235,#223148,#172235);background-size:200% 100%;animation:shimmer 1.5s infinite}.skeleton.wide{height:26px;width:45%}.skeleton.short{width:70%}.empty-state,.error-state{text-align:center;padding:80px 25px;border:1px dashed var(--line);border-radius:var(--radius);background:rgba(16,24,39,.5)}.empty-icon{display:grid;place-items:center;width:52px;height:52px;margin:0 auto 16px;border-radius:14px;background:var(--panel-2);color:var(--blue)}.empty-icon svg{width:24px;height:24px}.empty-state h2,.error-state h2{font-size:18px}.empty-state p,.error-state p{max-width:430px;margin:0 auto}.error-state .button{margin-top:22px}.error-code{display:block;color:var(--red);font-family:monospace;font-size:11px;margin-bottom:13px}.connection-banner{display:flex;align-items:center;gap:13px;padding:12px 14px;margin-bottom:18px;border:1px solid rgba(251,113,133,.28);border-radius:9px;background:rgba(73,30,43,.35)}.connection-banner>div{display:flex;flex-direction:column;gap:3px}.connection-banner>div span{color:var(--muted);font-size:11px}.connection-banner button{margin-left:auto;border:1px solid rgba(251,113,133,.35);border-radius:6px;padding:6px 10px;background:transparent;color:#fecdd3}.connection-banner button:hover{background:var(--red-dark)}
  .onboarding{max-width:900px;margin:8vh auto 0}.onboarding>p,.onboarding>header p{max-width:590px}.onboarding.compact{max-width:670px}.repo-picker{display:grid;gap:9px;margin-top:30px}.repo-option{display:flex;align-items:center;gap:13px;padding:14px;border:1px solid var(--line);border-radius:10px;background:var(--panel);cursor:pointer}.repo-option:hover,.repo-option:has(input:checked){border-color:var(--blue);background:var(--blue-dark)}.repo-option input,.repo-tile input,.command-picker input{accent-color:var(--green)}.repo-symbol{display:grid;place-items:center;width:36px;height:36px;border-radius:9px;background:#0a111c;color:var(--blue)}.repo-option strong,.repo-option small{display:block}.repo-option small{color:var(--muted);margin-top:3px}.visibility{color:var(--subtle);font-size:11px}.wide-button{width:100%;margin-top:9px}.steps{display:flex;list-style:none;padding:0;margin:34px 0;counter-reset:item}.steps li{display:flex;align-items:center;gap:8px;flex:1;color:var(--subtle);font-size:12px}.steps li:after{content:"";height:1px;background:var(--line);flex:1;margin:0 12px}.steps li:last-child:after{display:none}.steps li span{display:grid;place-items:center;width:24px;height:24px;border:1px solid var(--line);border-radius:50%;font-size:10px}.steps li.done,.steps li.active{color:var(--text)}.steps li.done span{background:var(--green);border-color:var(--green);color:#052e16}.steps li.active span{border-color:var(--green);color:var(--green)}fieldset{border:0;padding:0}legend{font-size:12px;font-weight:800;margin-bottom:12px}.repo-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:11px}.repo-tile{position:relative;display:grid;gap:9px;min-height:178px;padding:16px;border:1px solid var(--line);border-radius:12px;background:var(--panel);cursor:pointer}.repo-tile:hover,.repo-tile:has(input:checked){border-color:var(--green);background:linear-gradient(145deg,var(--green-dark),var(--panel))}.repo-tile input{position:absolute;right:14px;top:14px}.repo-tile>span{color:var(--green)}.repo-tile small{color:var(--muted);line-height:1.45}.repo-tile em{margin-top:auto;color:var(--subtle);font-size:10px;font-style:normal;text-transform:uppercase}.form-footer{display:flex;align-items:center;justify-content:space-between;gap:20px;margin-top:20px;color:var(--subtle);font-size:11px}.terminal-onboard{max-width:780px;margin-top:10vh}.prompt-line{display:flex;align-items:center;gap:9px;padding:11px 13px;margin-bottom:30px;border:1px solid var(--line);background:#0b131e;color:var(--muted)}.prompt-line span{color:var(--green)}.prompt-line strong{color:var(--text)}.prompt-line i{animation:blink 1s infinite}.command-picker{display:grid;margin-top:28px;border:1px solid var(--line);background:#0a111b}.command-picker label{display:grid;grid-template-columns:18px 1fr minmax(250px,1.5fr);gap:11px;padding:13px 16px;border-bottom:1px solid var(--line-soft);cursor:pointer}.command-picker label:hover,.command-picker label:has(input:checked){background:#102033}.command-picker input{display:none}.command-picker .caret{color:transparent}.command-picker label:has(input:checked) .caret{color:var(--green)}.command-picker small{color:var(--subtle)}.key-help{display:flex;align-items:center;gap:22px;padding:11px 14px;color:var(--subtle);font-size:10px}.key-help kbd,.terminal-bar kbd{padding:2px 5px;border:1px solid var(--line);border-radius:3px;background:var(--panel)}.key-help button{margin-left:auto;border:0;background:transparent;color:var(--green);font-weight:800}.prompt-panel{max-width:800px;padding:24px;border:1px solid var(--line);border-radius:var(--radius);background:var(--panel)}.prompt-form label{display:block;font-size:13px;font-weight:800}.field-help{font-size:12px}.prompt-form textarea{width:100%;resize:vertical;border:1px solid var(--line);border-radius:9px;padding:13px;background:#080f19;color:var(--text);line-height:1.55}.included-context{display:flex;align-items:center;gap:10px;margin-top:12px;padding:11px;border-radius:8px;background:var(--panel-2)}.included-context>span{color:var(--blue)}.included-context strong,.included-context small{display:block}.included-context small{color:var(--muted);margin-top:3px}.form-actions{display:flex;justify-content:flex-end;gap:9px;margin-top:20px}
  .created-notice{display:flex;gap:12px;padding:12px 14px;margin-bottom:16px;border:1px solid rgba(74,222,128,.26);border-radius:8px;background:rgba(23,61,43,.5)}.created-notice strong{color:var(--green)}.created-notice span{color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.session-header{display:flex;justify-content:space-between;gap:30px;padding-bottom:22px;margin-bottom:22px;border-bottom:1px solid var(--line)}.session-header .session-meta{display:flex;align-items:center;flex-wrap:wrap;gap:10px;color:var(--muted);font-size:11px}.session-header dl,.terminal-session-head dl{display:flex;gap:25px;margin:7px 0 0}.session-header dl div,.terminal-session-head dl div{display:flex;flex-direction:column;gap:5px}.session-header dt,.terminal-session-head dt{color:var(--subtle);font-size:9px;text-transform:uppercase;letter-spacing:.1em}.session-header dd,.terminal-session-head dd{margin:0;font-size:12px;font-weight:800}.viewer-grid{display:grid;grid-template-columns:minmax(0,1fr) 310px;gap:18px;align-items:start}.activity,.subagents{border:1px solid var(--line);border-radius:var(--radius);background:var(--panel)}.activity>header,.subagents>header{display:flex;align-items:center;justify-content:space-between;padding:14px 16px;border-bottom:1px solid var(--line-soft)}.activity>header h2,.subagents>header h2{margin:0}.activity>header span,.activity>header p{color:var(--subtle);font-size:10px;margin:0}.timeline{list-style:none;margin:0;padding:12px 18px}.event{position:relative;display:grid;grid-template-columns:27px 1fr;gap:11px;padding:10px 0}.event:before{content:"";position:absolute;left:13px;top:35px;bottom:-10px;width:1px;background:var(--line)}.event:last-child:before{display:none}.event-marker{position:relative;z-index:1;display:grid;place-items:center;width:27px;height:27px;border:1px solid var(--line);border-radius:7px;background:var(--panel-2);color:var(--muted);font-size:10px;font-weight:800}.assistant-event .event-marker{color:var(--green);border-color:rgba(74,222,128,.3)}.reasoning-event .event-marker{color:var(--purple)}.tool-event .event-marker{color:var(--blue)}.error-event .event-marker{color:var(--red);border-color:rgba(251,113,133,.35)}.event article,.event details{min-width:0;border:1px solid var(--line-soft);border-radius:8px;padding:11px;background:#0b131e}.event article header,.event summary{display:flex;align-items:center;justify-content:space-between;gap:10px;color:var(--muted);font-size:11px}.event article header strong,.event summary strong{color:var(--text)}.event time{color:var(--subtle)}.event p{margin:9px 0 0;font-size:12px}.event summary{cursor:pointer}.event summary>span{display:flex;align-items:center;gap:8px}.event summary code{color:var(--blue)}.tool-state{color:var(--green)}.event pre{overflow:auto;margin:11px 0 0;padding:10px;border-radius:6px;background:#060b12;color:#a7f3d0;font-size:10px;line-height:1.5}.event pre.error-output{color:#fecdd3}.progress{height:5px;margin:12px 0 4px;overflow:hidden;border-radius:10px;background:#26364b}.progress span{display:block;height:100%;background:var(--green)}.subagents{position:sticky;top:20px}.subagents header .eyebrow{margin-bottom:4px}.count{color:var(--green);font-size:10px}.subagents article{display:grid;grid-template-columns:31px 1fr auto;align-items:center;gap:9px;padding:13px 14px;border-bottom:1px solid var(--line-soft)}.agent-glyph{display:grid;place-items:center;width:31px;height:31px;border-radius:7px;background:var(--blue-dark);color:var(--blue);font-weight:800}.subagents article strong,.subagents article span,.subagents article small{display:block}.subagents article span{margin:3px 0;color:var(--muted);font-size:10px}.subagents article small{color:var(--subtle);font-size:9px}.contract-note{margin:0;padding:12px 14px;font-size:9px}.session-workspace{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(280px,.7fr);gap:16px}.session-workspace .now-card{grid-column:1/-1;padding:18px;border:1px solid rgba(74,222,128,.27);border-radius:12px;background:linear-gradient(90deg,rgba(23,61,43,.55),var(--panel))}.now-card strong{display:block;margin-bottom:13px}.session-workspace .subagents{grid-column:2;grid-row:2}.session-workspace .activity{grid-column:1;grid-row:2}.activity.roomy .timeline{padding:18px 25px}.terminal-session-head{display:grid;grid-template-columns:1fr auto;align-items:start;gap:20px;padding:10px 0 22px;border-bottom:1px solid var(--line)}.terminal-session-head>div>span{color:var(--green);font-size:10px}.terminal-session-head h1{font-size:24px;margin-top:8px}.terminal-session-head>dl{grid-column:1/-1}.terminal-viewer{display:grid;grid-template-columns:minmax(0,1fr) 320px;gap:1px;background:var(--line);border:1px solid var(--line);margin-top:17px}.terminal-viewer>section,.terminal-viewer>.subagents{background:#080e17;border:0;border-radius:0}.terminal-viewer>section>header{display:flex;justify-content:space-between;padding:10px 13px;border-bottom:1px solid var(--line);color:var(--muted);font-size:10px}.terminal-viewer .timeline{padding:8px 13px}.shell-c .event article,.shell-c .event details{border-radius:0;background:#080e17}.shell-c .event-marker{border-radius:2px}.shell-c .subagents{position:static}
  .prototype-switcher{position:fixed;z-index:50;left:50%;bottom:18px;transform:translateX(-50%);display:flex;align-items:center;gap:5px;padding:6px;border:1px solid #60748f;border-radius:999px;background:#f8fafc;color:#0f172a;box-shadow:0 16px 50px rgba(0,0,0,.45);font-family:ui-sans-serif,system-ui;font-size:12px}.prototype-switcher>a{display:grid;place-items:center;width:30px;height:30px;border-radius:50%;font-size:18px}.prototype-switcher>a:hover{background:#e2e8f0}.prototype-switcher strong{padding:0 9px}.prototype-switcher strong span{color:#64748b;font-weight:500}.htmx-indicator{opacity:0;transition:opacity .15s}.htmx-request .htmx-indicator,.htmx-request.htmx-indicator{opacity:1}.request-indicator{position:fixed;z-index:100;left:0;right:0;top:0;height:2px;background:var(--green);box-shadow:0 0 12px var(--green)}
  @keyframes pulse{50%{opacity:.35}}@keyframes shimmer{to{background-position:-200% 0}}@keyframes blink{50%{opacity:0}}
  @media (prefers-reduced-motion:reduce){*,*:before,*:after{animation:none!important;transition:none!important}}
  @media (max-width:900px){.shell-a{grid-template-columns:1fr}.rail{position:static;height:auto;border-right:0;border-bottom:1px solid var(--line);padding:13px}.rail .brand{margin:0 0 13px}.rail-label,.rail-bottom{display:none}.rail .repo-nav{display:flex;overflow:auto;margin-top:10px}.topbar{display:none}.page{padding:28px 18px 100px}.terminal-layout{grid-template-columns:1fr}.terminal-layout>aside{position:static;height:auto;border-right:0;border-bottom:1px solid var(--line)}.tree-title,.tree-footer,.terminal-layout>aside>a,.tree-repo{display:none}.terminal-layout .repo-nav{display:flex;overflow:auto;margin:0}.terminal-layout .repo-nav a{border-left:0}.terminal-canvas{padding:24px 16px 100px}.spec-row{grid-template-columns:1fr}.spec-board,.pr-board,.viewer-grid,.session-workspace,.terminal-viewer{grid-template-columns:1fr}.session-workspace .subagents,.session-workspace .activity{grid-column:1;grid-row:auto}.session-cards{grid-template-columns:repeat(2,1fr)}.repo-grid{grid-template-columns:1fr}.global-header{padding:0 16px}.repository-crumb{display:none}.terminal-row,.terminal-row.pr,.process-head,.process-row{grid-template-columns:90px minmax(210px,1fr);overflow:auto}.terminal-row>*:nth-child(n+3),.process-head>*:nth-child(n+3),.process-row>*:nth-child(n+3){display:none}.session-header{display:grid}.state-lab{align-items:flex-start;flex-direction:column}}
  @media (max-width:600px){.global-actions .sync-note{display:none}.shell-b>.repo-nav{overflow:auto}.canvas{padding:32px 14px 100px}.page-heading{align-items:start;flex-direction:column}.session-cards{grid-template-columns:1fr}.form-footer,.form-actions{align-items:stretch;flex-direction:column}.steps li{font-size:0}.command-picker label{grid-template-columns:18px 1fr}.command-picker small{display:none}.key-help>span{display:none}.session-header dl{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}.viewer-grid{display:block}.subagents{position:static;margin-top:14px}.prototype-switcher strong span{display:none}.created-notice{display:grid}.connection-banner{align-items:flex-start;flex-wrap:wrap}.connection-banner button{margin-left:0}}
`

const prototypeSwitcher = (url: URL, variant: Variant) => {
  const keys: Variant[] = ["A", "B", "C"]
  const index = keys.indexOf(variant)
  const href = (next: Variant) => {
    const copy = new URL(url)
    copy.searchParams.set("variant", next)
    return `${copy.pathname}${copy.search}`
  }
  return `<nav class="prototype-switcher" aria-label="Prototype variants" data-current="${variant}">
    <a href="${href(keys[(index + 2) % 3])}" data-previous aria-label="Previous variant">‹</a>
    <strong>${variant} <span>· ${variants[variant]}</span></strong>
    <a href="${href(keys[(index + 1) % 3])}" data-next aria-label="Next variant">›</a>
  </nav>`
}

const document = (content: string, url: URL, variant: Variant) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Atlas Phase 1 prototype · ${variant}</title><script src="https://cdn.jsdelivr.net/npm/htmx.org@2.0.4/dist/htmx.min.js"></script><style>${styles}</style></head>
<body><div id="request-indicator" class="request-indicator htmx-indicator"></div><main id="app" hx-indicator="#request-indicator">${content}</main>${prototypeSwitcher(url, variant)}
<script>
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    if (event.target.matches('input, textarea, [contenteditable]')) return
    document.querySelector(event.key === 'ArrowLeft' ? '[data-previous]' : '[data-next]').click()
  })
  document.body.addEventListener('htmx:beforeRequest', (event) => {
    if (event.detail.pathInfo.requestPath !== '/prototype/reconnect') return
    event.preventDefault()
    const current = new URL(location.href)
    current.searchParams.delete('state')
    current.searchParams.delete('mode')
    htmx.ajax('GET', current.pathname + current.search, { target: '#app', swap: 'innerHTML' })
    history.pushState({}, '', current)
  })
</script></body></html>`

const render = async (request: Request) => {
  const url = new URL(request.url)
  const variant = parseVariant(url)
  let content: string
  let pushUrl: string | null = null

  if (url.pathname === "/") return Response.redirect(new URL(route("/prototype/atlas", variant), url), 302)
  if (url.pathname === "/prototype/atlas" && request.method === "GET") content = onboarding(variant)
  else if (url.pathname === "/prototype/atlas/repositories" && request.method === "POST") {
    const form = await request.formData()
    const repo = String(form.get("repo") || "atlas")
    pushUrl = route(`/prototype/atlas/repositories/${repo}/specs`, variant)
    content = repositoryView(repo, "specs", variant, new URL(pushUrl, url))
  } else {
    const repositoryMatch = url.pathname.match(/^\/prototype\/atlas\/repositories\/([^/]+)\/(specs|pulls|sessions)$/)
    const startMatch = url.pathname.match(/^\/prototype\/atlas\/specs\/(\d+)\/start$/)
    const createMatch = url.pathname.match(/^\/prototype\/atlas\/specs\/(\d+)\/sessions$/)
    const sessionMatch = url.pathname.match(/^\/prototype\/atlas\/sessions\/([^/]+)$/)
    if (repositoryMatch && request.method === "GET") content = repositoryView(repositoryMatch[1], repositoryMatch[2] as View, variant, url)
    else if (startMatch && request.method === "GET") content = startSession(Number(startMatch[1]), variant)
    else if (createMatch && request.method === "POST") {
      const form = await request.formData()
      const prompt = String(form.get("prompt") || "")
      pushUrl = route("/prototype/atlas/sessions/ses_health_live", variant)
      content = sessionDetail("ses_health_live", variant, new URL(pushUrl, url), prompt)
    } else if (sessionMatch && request.method === "GET") content = sessionDetail(sessionMatch[1], variant, url)
    else if (url.pathname === "/prototype/reconnect") content = onboarding(variant)
    else return new Response("Not found", { status: 404 })
  }

  const headers = new Headers({ "Content-Type": "text/html; charset=utf-8" })
  if (pushUrl) headers.set("HX-Push-Url", pushUrl)
  const body = request.headers.get("HX-Request") === "true" ? content : document(content, new URL(pushUrl ?? url, url), variant)
  return new Response(body, { headers })
}

const port = Number(process.env.PORT || 3210)
Bun.serve({ port, fetch: render })
console.log(`Atlas Phase 1 prototype: http://localhost:${port}/prototype/atlas?variant=A`)
