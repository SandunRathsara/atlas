// Updates page: one centred status card for the current situation, the automatic-install switch,
// and everything else behind "Technical details". Contracts kept from the previous page:
// #updates-content (mutation swap target), #updates-live-status (2s poll while work is active),
// #update-check-form / #update-install-form / #update-policy-form with their indicators, CSRF and
// value-preserving failures. The policy form stays outside the polled region.
import type { UpdateStatus } from "../update-discovery.ts";
import type { ReleaseIdentity, ReleaseMetadata } from "../release.ts";
import { activationInProgress, type UpdatePolicy, type UpdaterStatus } from "../updater.ts";
import { escapeHtml, formatTime } from "./html.ts";
import { banner, group, icon, relativeTime, settingsRow, statusTile, type IconName, type StatusKey } from "./shared.ts";

const activeStage = new Set<UpdaterStatus["state"]>(["requested", "downloading", "verifying", "preparing"]);
const recovering = new Set(["selecting_previous", "restarting_previous", "validating_previous"]);
export type UpdateFeedback = { message: string; policy?: UpdatePolicy };

/** "v1.9.0+build.44" → "v1.9.0". */
const semverOf = (tag: string) => tag.split("+")[0] ?? tag;
const installedName = (installed: ReleaseIdentity) => installed.published ? semverOf(installed.tag) : "this development build";

// ── Labels (also used in Technical details) ─────────────────────────────

const stageLabel = (state: UpdaterStatus["state"]) => {
  if (state === "staged") return "Staged";
  if (state === "failed") return "Staging failed";
  if (state === "requested") return "Staging requested";
  if (activeStage.has(state)) return state[0]!.toUpperCase() + state.slice(1);
  return "Not staged";
};

const activationLabel = (updater: UpdaterStatus) => {
  const state = updater.activation.state;
  if (state === "succeeded") return "Activated";
  if (state === "rolled_back") return "Recovered";
  if (state === "rollback_failed") return "Recovery failed";
  if (state === "abandoned") return "Abandoned";
  if (recovering.has(state)) return "Recovering";
  if (activationInProgress(updater)) return state === "awaiting_checkpoint" ? "Waiting for safe checkpoint" : "Activating";
  return "No activation";
};

const cleanupLabel = (state: UpdaterStatus["cleanup"]["state"]) =>
  state === "failed" ? "Cleanup failed" : state === "cleaning" ? "Cleaning up" : state === "succeeded" ? "Cleanup complete" : "Not run";

// ── Forms ───────────────────────────────────────────────────────────────

const checkForm = (csrfToken: string, variant: "outline" | "plain" = "outline", label = "Check now") =>
  `<form action="/updates/check" id="update-check-form" method="post" hx-post="/updates/check" hx-target="#updates-content" hx-swap="outerHTML" hx-indicator="#update-check-progress" hx-disabled-elt="button[type='submit']" class="up-action">
    <input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}">
    <button class="ax-btn ax-btn-${variant} ax-btn-block" type="submit">${icon("refresh", 17)} ${escapeHtml(label)}</button>
    <span id="update-check-progress" class="htmx-indicator up-progress-text" role="status" aria-live="polite">Checking releases…</span>
    <p data-form-status class="sr-only" role="status" aria-live="polite"></p>
  </form>`;

/** Install / Retry, only when the exact candidate is staged, runtime-eligible and code-only reversible. */
const installForm = (status: UpdateStatus, candidate: ReleaseMetadata, csrfToken: string) => {
  const updater = status.updater;
  if (!csrfToken || !updater || activationInProgress(updater) || updater.state !== "staged" ||
      updater.metadata?.identity.tag !== candidate.identity.tag || !updater.stagedPath ||
      updater.requirements === null || updater.requirements.unmet.length > 0 || !candidate.rollback.codeOnlyCompatible) return "";
  const retry = updater.activation.failedTags.includes(candidate.identity.tag);
  return `<form id="update-install-form" class="up-action" action="/updates/install" method="post" hx-post="/updates/install" hx-target="#updates-content" hx-swap="outerHTML" hx-indicator="#update-install-progress" hx-disabled-elt="button[type='submit']">
    <input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}">
    <input type="hidden" name="tag" value="${escapeHtml(candidate.identity.tag)}">
    ${retry ? '<input type="hidden" name="retry" value="1">' : ""}
    <button class="ax-btn ax-btn-block" type="submit">${icon(retry ? "refresh" : "play", 17)} ${retry ? "Retry" : "Install"}</button>
    <span id="update-install-progress" class="htmx-indicator up-progress-text" role="status" aria-live="polite">${retry ? "Retrying activation…" : "Requesting activation…"}</span>
    <p data-form-status class="sr-only" role="status" aria-live="polite"></p>
  </form>`;
};

// ── Status card ─────────────────────────────────────────────────────────

type Card = {
  status: StatusKey;
  glyph: IconName;
  title: string;
  /** Mono identity line under the title. */
  version?: string;
  bodyHtml?: string;
  /** Trusted extras: steps, red reason box, notes. */
  extraHtml?: string;
  actionHtml?: string;
  /** Centred footnote under the card. */
  foot?: string;
  /** True when the card's action is already "Check now". */
  checks?: boolean;
  /** True when the card already shows the install blockers. */
  blocked?: boolean;
};

const para = (text: string) => `<p class="up-s">${escapeHtml(text)}</p>`;
const reasonBox = (title: string, text: string) =>
  `<div class="up-reason" role="note">${icon("warn", 18)}<div><b>${escapeHtml(title)}</b>${escapeHtml(text)}</div></div>`;

type Step = { label: string; state: "done" | "now" | "todo" };
const steps = (items: Step[], percent: number, label: string) => `<progress class="up-prog" aria-label="${escapeHtml(label)}" max="100" value="${percent}">${percent}%</progress>
  <ol class="up-steps">${items.map((step) => `<li class="up-${step.state}">${step.state === "done" ? icon("check", 16) : "<i aria-hidden=\"true\"></i>"}<span>${escapeHtml(step.label)}${step.state === "done" ? '<span class="sr-only"> (done)</span>' : step.state === "now" ? '<span class="sr-only"> (now)</span>' : ""}</span></li>`).join("")}</ol>`;

const versionLine = (identity: { tag: string; build: number }, installed?: ReleaseIdentity) =>
  `build ${identity.build}${installed ? ` · you have ${installed.published ? semverOf(installed.tag) : "a development build"}` : ""}`;

const checkedLine = (status: UpdateStatus) =>
  status.discovery.lastSuccessAt ? `<p class="up-s">Checked ${relativeTime(status.discovery.lastSuccessAt)}</p>` : "";

const installingCard = (status: UpdateStatus, updater: UpdaterStatus): Card => {
  const activation = updater.activation;
  const target = activation.metadata ?? updater.metadata;
  const name = target ? semverOf(target.identity.tag) : "the update";
  if (recovering.has(activation.state)) {
    return {
      status: "waiting",
      glyph: "refresh",
      title: `Going back to ${activation.previousMetadata ? semverOf(activation.previousMetadata.identity.tag) : "the previous version"}`,
      bodyHtml: para(`${name} didn't pass its health check, so Atlas is restoring the version that worked.`),
      extraHtml: activation.failureMessage ? reasonBox("What went wrong", activation.failureMessage) : "",
      foot: "You can leave this page. Agents keep working.",
    };
  }
  const waiting = activation.state === "awaiting_checkpoint" || activation.state === "requested";
  const restartStep: Record<string, string> = {
    stopping: "Restart and confirm · stopping Atlas",
    selecting: `Restart and confirm · switching to ${name}`,
    starting: `Restart and confirm · starting ${name}`,
    validating: "Restart and confirm · checking health",
  };
  const percent = waiting ? 45 : ({ stopping: 62, selecting: 72, starting: 82, validating: 92 } as Record<string, number>)[activation.state] ?? 60;
  return {
    status: "running",
    glyph: "refresh",
    title: `Installing ${name}`,
    version: target ? versionLine(target.identity) : undefined,
    extraHtml: `${steps([
      { label: "Downloaded and checked", state: "done" },
      { label: "Waiting for a safe moment to restart", state: waiting ? "now" : "done" },
      { label: restartStep[activation.state] ?? "Restart and confirm", state: waiting ? "todo" : "now" },
    ], percent, `Installing ${name}`)}${waiting && activation.deadlineAt ? `<p class="up-s up-left">Atlas waits for running setup steps to reach a safe point. If that takes more than 5 minutes, it calls the install off and keeps ${escapeHtml(installedName(status.installed))}.</p>` : ""}`,
    foot: "You can leave this page. Agents keep working.",
  };
};

const stagingCard = (candidate: ReleaseMetadata, updater: UpdaterStatus, policy: UpdatePolicy | undefined): Card => {
  // requested/downloading → step 0, verifying → step 1, preparing → step 2.
  const current = ({ requested: 0, downloading: 0, verifying: 1, preparing: 2 } as Record<string, number>)[updater.state] ?? 0;
  const step = (at: number, label: string): Step => ({ label, state: current > at ? "done" : current === at ? "now" : "todo" });
  return {
    status: "running",
    glyph: "refresh",
    title: `Getting ${semverOf(candidate.identity.tag)} ready`,
    version: versionLine(candidate.identity),
    bodyHtml: para(policy === "automatic"
      ? "Atlas downloads and checks it first. Nothing changes until it's ready."
      : "Atlas downloads and checks it first. Nothing changes until you tap Install."),
    extraHtml: steps([
      step(0, updater.state === "requested" ? "Waiting to download" : "Download"),
      step(1, "Check the download"),
      step(2, "Prepare"),
    ], ({ requested: 10, downloading: 30, verifying: 60, preparing: 85 } as Record<string, number>)[updater.state] ?? 10, `Getting ${semverOf(candidate.identity.tag)} ready`),
  };
};

const unmetFor = (status: UpdateStatus) =>
  status.available && status.updater?.metadata?.identity.tag === status.available.identity.tag ? status.updater.requirements?.unmet ?? [] : [];

/** Why the available release can't be installed from here; shown whatever the card says. */
const blockers = (status: UpdateStatus) => {
  const available = status.available;
  if (!available) return "";
  const unmet = unmetFor(status);
  return `${!available.rollback.codeOnlyCompatible ? banner({ tone: "warning", role: "none", title: "Manual maintenance required.", body: `This release cannot use normal code-only rollback. ${available.rollback.manualMaintenanceInstructions ?? "Follow the published release instructions."}` }) : ""}${unmet.length > 0 ? banner({ tone: "warning", role: "none", title: "Host runtime requirements are not met.", bodyHtml: `<ul class="up-list">${unmet.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>The updater does not upgrade host tools.` }) : ""}`;
};

const statusCard = (status: UpdateStatus, csrfToken: string): Card => {
  const updater = status.updater;
  const installed = status.installed;
  const available = status.available;
  const check = checkForm(csrfToken);

  if (status.updaterError) {
    return {
      status: "failed",
      glyph: "warn",
      title: "Update status unavailable",
      version: installed.published ? `${installed.tag}` : "Unpublished development",
      bodyHtml: para(`Atlas can't reach its updater, so it can't stage or install updates right now. ${installed.published ? semverOf(installed.tag) : "This build"} keeps running.`),
      extraHtml: reasonBox("Staging status unavailable.", status.updaterError),
      actionHtml: check,
      checks: true,
    };
  }

  if (updater && activationInProgress(updater)) return installingCard(status, updater);

  if (updater?.activation.state === "rollback_failed") {
    const activation = updater.activation;
    return {
      status: "failed",
      glyph: "warn",
      title: "The update failed and the previous version didn't come back",
      bodyHtml: para("Atlas needs its operator. Check the Atlas service on the host."),
      extraHtml: reasonBox("What went wrong", activation.failureMessage ?? activation.lastResult?.message ?? activation.message),
      actionHtml: available ? installForm(status, available, csrfToken) : "",
    };
  }

  if (!installed.published) {
    return {
      status: "none",
      glyph: "doc",
      title: "Development build",
      version: "Unpublished development",
      bodyHtml: para("This copy of Atlas wasn't installed from a published Release, so Atlas can't tell whether a newer one exists. A published installed identity is required before Atlas can order newer releases."),
      actionHtml: check,
      checks: true,
    };
  }

  if (available) {
    const name = semverOf(available.identity.tag);
    const tag = available.identity.tag;
    const action = installForm(status, available, csrfToken);
    const staging = updater && activeStage.has(updater.state) && updater.metadata?.identity.tag === tag;
    if (staging) return stagingCard(available, updater, updater.policy);

    const failedBefore = updater?.activation.failedTags.includes(tag);
    if (failedBefore) {
      const activation = updater!.activation;
      const reason = activation.lastResult?.tag === tag ? activation.failureMessage ?? activation.lastResult.message : activation.failureMessage;
      return {
        status: "failed",
        glyph: "warn",
        title: `${name} didn't install`,
        version: versionLine(available.identity, installed),
        bodyHtml: para(`Atlas went back to ${semverOf(installed.tag)} automatically. It won't try ${name} again on its own.`),
        extraHtml: reason ? reasonBox("What went wrong", reason) : "",
        actionHtml: action,
      };
    }

    if (action) {
      return {
        status: "running",
        glyph: "sparkle",
        title: `${name} is ready`,
        version: versionLine(available.identity, installed),
        bodyHtml: para("Atlas restarts for a moment. Queued Sessions are kept and OpenCode keeps running. If something goes wrong, the previous version comes back automatically."),
        actionHtml: action,
      };
    }

    const unmet = unmetFor(status);
    if (!available.rollback.codeOnlyCompatible || unmet.length > 0) {
      return {
        status: "waiting",
        glyph: "warn",
        title: `${name} can't be installed from here`,
        version: versionLine(available.identity, installed),
        bodyHtml: para(`It needs work on the Atlas host first. ${semverOf(installed.tag)} keeps running.`),
        extraHtml: blockers(status),
        blocked: true,
      };
    }

    if (updater?.state === "failed" && (updater.metadata?.identity.tag === tag || updater.lastResult?.tag === tag)) {
      return {
        status: "failed",
        glyph: "warn",
        title: `Couldn't download ${name}`,
        version: versionLine(available.identity, installed),
        bodyHtml: para(`Nothing changed; ${semverOf(installed.tag)} keeps running. Check again to retry the download.`),
        extraHtml: reasonBox("What went wrong", updater.lastResult?.message ?? updater.message),
        actionHtml: check,
        checks: true,
      };
    }

    if (status.discovery.stageRequestFailureReason) {
      return {
        status: "failed",
        glyph: "warn",
        title: `Couldn't start downloading ${name}`,
        version: versionLine(available.identity, installed),
        bodyHtml: para(`Nothing changed; ${semverOf(installed.tag)} keeps running. Check again to retry.`),
        extraHtml: reasonBox("Staging request failed.", status.discovery.stageRequestFailureReason),
        actionHtml: check,
        checks: true,
      };
    }

    return {
      status: "running",
      glyph: "sparkle",
      title: `${name} is available`,
      version: versionLine(available.identity, installed),
      bodyHtml: para("Atlas downloads and checks it before it can be installed."),
      extraHtml: checkedLine(status),
    };
  }

  if (status.discovery.failureReason) {
    return {
      status: "failed",
      glyph: "warn",
      title: "Couldn't check for updates",
      version: `${semverOf(installed.tag)} · build ${installed.build}`,
      bodyHtml: para(`Availability unknown. ${semverOf(installed.tag)} keeps running.`),
      extraHtml: `${reasonBox("Release check failed.", status.discovery.failureReason)}${status.discovery.lastSuccessAt ? `<p class="up-s">Last successful check ${relativeTime(status.discovery.lastSuccessAt)}</p>` : ""}`,
      actionHtml: checkForm(csrfToken, "outline", "Try again"),
      checks: true,
    };
  }

  if (status.checking && !status.discovery.lastSuccessAt) {
    return {
      status: "running",
      glyph: "refresh",
      title: "Checking for updates…",
      version: `${semverOf(installed.tag)} · build ${installed.build}`,
      bodyHtml: para("Looking for newer published Releases."),
    };
  }

  if (status.discovery.lastSuccessAt) {
    return {
      status: "succeeded",
      glyph: "check",
      title: "Atlas is up to date",
      version: `${semverOf(installed.tag)} · build ${installed.build}`,
      extraHtml: checkedLine(status),
      actionHtml: check,
      checks: true,
    };
  }

  return {
    status: "none",
    glyph: "clock",
    title: "Not checked yet",
    version: `${semverOf(installed.tag)} · build ${installed.build}`,
    bodyHtml: para("Atlas hasn't looked for published Releases yet. Check before deciding whether an update exists."),
    actionHtml: check,
    checks: true,
  };
};

const renderCard = (card: Card, status: UpdateStatus) => {
  const checking = status.checking && card.title !== "Checking for updates…"
    ? `<p class="up-s up-checking" role="status">${icon("refresh", 14)}Checking for a newer version…</p>`
    : "";
  return `<section class="up-hero" aria-labelledby="update-card-title">
    ${statusTile(card.status, "lg", card.glyph)}
    <h2 id="update-card-title" class="up-t">${escapeHtml(card.title)}</h2>
    ${card.version ? `<p class="up-v ax-mono">${escapeHtml(card.version)}</p>` : ""}
    ${card.bodyHtml ?? ""}
    ${card.extraHtml ?? ""}
    ${checking}
    ${card.actionHtml ?? ""}
  </section>
  ${card.foot ? `<p class="up-foot">${escapeHtml(card.foot)}</p>` : ""}`;
};

/** Extra notes that don't fit the card but must stay visible. */
const notes = (status: UpdateStatus, card: Card) => {
  const out: string[] = card.blocked ? [] : [blockers(status)];
  if (status.discovery.failureReason && card.title !== "Couldn't check for updates") {
    out.push(banner({
      tone: "error",
      role: "status",
      title: "Release check failed.",
      body: `${status.discovery.failureReason} Last successful check: ${formatTime(status.discovery.lastSuccessAt)}.`,
    }));
  }
  if (status.discovery.stageRequestFailureReason && !card.title.startsWith("Couldn't start downloading")) {
    out.push(banner({ tone: "error", role: "status", title: "Staging request failed.", body: status.discovery.stageRequestFailureReason }));
  }
  return out.join("");
};

// ── Technical details ───────────────────────────────────────────────────

const row = (title: string, value: string | null | undefined, mono = false, sub?: string) =>
  settingsRow({ title, value: value ?? "—", mono, sub });

const textRow = (text: string) => `<div class="ax-setrow up-note"><span class="ax-setrow-main"><span>${escapeHtml(text)}</span></span></div>`;

const section = (label: string, rows: string[]) =>
  `<h3 class="ax-group-label">${escapeHtml(label)}</h3>${group(rows.filter(Boolean))}`;

const technicalBody = (status: UpdateStatus, csrfToken: string, card: Card) => {
  const installed = status.installed;
  const updater = status.updater;
  const available = status.available;
  const requirements = available && updater?.metadata?.identity.tag === available.identity.tag ? updater.requirements : null;
  const availableText = available
    ? null
    : !installed.published
      ? "Unavailable"
      : status.discovery.failureReason
        ? "Availability unknown"
        : status.discovery.lastSuccessAt
          ? "No newer release found"
          : "Not checked yet";

  const parts: string[] = [];
  parts.push(section("Installed release", installed.published
    ? [row("Release", installed.tag, true), row("Build", String(installed.build)), row("Git SHA", installed.gitSha, true)]
    : [row("Release", "Unpublished development"), textRow("This tree has no authoritative release tag.")]));

  parts.push(section("Available release", available
    ? [
      row("Release", available.identity.tag, true),
      row("Build", String(available.identity.build)),
      row("Git SHA", available.identity.gitSha, true),
      row("Code-only rollback", available.rollback.codeOnlyCompatible ? "Yes" : "No — manual maintenance"),
      textRow(`${status.candidates.length} published release${status.candidates.length === 1 ? "" : "s"} retained for update-policy evaluation.`),
    ]
    : [
      row("Status", availableText),
      textRow(!installed.published
        ? "A published installed identity is required before Atlas can order newer releases."
        : status.discovery.failureReason
          ? "The latest check failed; known release information is retained."
          : status.discovery.lastSuccessAt
            ? "This is up to date only as of the last successful check."
            : "Check published releases before assessing availability."),
    ]));

  parts.push(section("Release check", [
    row("Last successful check", formatTime(status.discovery.lastSuccessAt), true),
    status.discovery.lastFailureAt ? row("Last failed check", formatTime(status.discovery.lastFailureAt), true, status.discovery.failureReason ?? undefined) : "",
    status.checking ? row("Now", "Checking published releases") : "",
    status.discovery.stageRequestFailureReason ? row("Staging request", "Failed", false, status.discovery.stageRequestFailureReason) : "",
  ]));

  if (available) {
    parts.push(section("Host runtime requirements", [
      row("Git", `${available.minimumHostTools.git} or newer${requirements ? ` · host ${requirements.available.git ?? "missing"}` : ""}`, true),
      row("gh", `${available.minimumHostTools.gh} or newer${requirements ? ` · host ${requirements.available.gh ?? "missing"}` : ""}`, true),
      textRow("The updater does not upgrade host tools."),
    ]));
  }

  if (status.updaterError) {
    parts.push(section("Staging", [row("Status", "Unavailable", false, status.updaterError)]));
  } else if (updater) {
    parts.push(section("Staging", [
      row("Status", stageLabel(updater.state), false, updater.message),
      updater.metadata ? row("Release", updater.metadata.identity.tag, true) : "",
      updater.stagedPath ? row("Staged at", updater.stagedPath, true) : "",
      updater.lastResult
        ? row("Latest staging result", updater.lastResult.tag, true, `${updater.lastResult.message} · ${formatTime(updater.lastResult.at)}`)
        : textRow("No staging result yet."),
      textRow("Staging leaves the active release and Session admission unchanged."),
    ]));

    const activation = updater.activation;
    parts.push(section("Activation and recovery", [
      row("Status", activationLabel(updater), false, activation.message),
      activation.metadata ? row("Target", activation.metadata.identity.tag, true) : "",
      activation.previousMetadata ? row("Previous release", activation.previousMetadata.identity.tag, true) : "",
      activation.requestedAt ? row("Requested", formatTime(activation.requestedAt), true) : "",
      activation.deadlineAt ? row("Safe-checkpoint deadline", formatTime(activation.deadlineAt), true) : "",
      activation.failureMessage ? row("Failure", null, false, activation.failureMessage) : "",
      activation.failedTags.length > 0 ? row("Needs explicit Retry", activation.failedTags.join(", "), true) : "",
      activation.lastResult
        ? row("Latest activation result", activation.lastResult.tag, true, `${activation.lastResult.message} · ${formatTime(activation.lastResult.at)}`)
        : textRow("No activation result yet."),
      textRow("Atlas identity and storage health are checked independently of OpenCode."),
    ]));

    const cleanup = updater.cleanup;
    parts.push(section("Release retention", [
      row("Status", cleanupLabel(cleanup.state), false, cleanup.message),
      cleanup.removedTags.length > 0 ? row("Removed", cleanup.removedTags.join(", "), true) : "",
      cleanup.pendingTags.length > 0 ? row("Pending", cleanup.pendingTags.join(", "), true) : "",
      cleanup.updatedAt ? row("Updated", formatTime(cleanup.updatedAt), true) : "",
      textRow("Current, previous working, staged, in-flight, and Session-helper-referenced releases are retained."),
    ]));
  }

  const policy = updater?.policy;
  parts.push(section("Update policy", [
    row("Policy", policy === "automatic" ? "Automatic" : policy === "approval_required" ? "Approval required" : "Unavailable"),
    textRow("Automatic mode installs only a newer numeric build of the installed SemVer. Every patch, minor, or major change still requires Install."),
    textRow("A failed build is suppressed until explicit Retry; a later eligible build may proceed normally. Each Atlas installation keeps its own policy and schedule."),
    textRow("Activation briefly restarts Atlas, preserves queued Sessions, and automatically restores the previous release when candidate validation fails. OpenCode keeps running and is not an activation gate."),
  ]));

  const updaterBusy = Boolean(updater && activationInProgress(updater));
  return `<div id="updates-tech-body" class="up-tech-body">${parts.join("")}${card.checks || updaterBusy ? "" : `<div class="up-tech-check">${checkForm(csrfToken, "plain", "Check for a newer version")}</div>`}</div>`;
};

// ── Policy ──────────────────────────────────────────────────────────────

const policyMarkup = (status: UpdateStatus, csrfToken: string, selectedPolicy?: UpdatePolicy) => {
  const policy = status.updater?.policy;
  if (!policy || !csrfToken) {
    return `<section class="up-policy" aria-labelledby="update-policy-title">
      <h2 id="update-policy-title" class="ax-group-label">Updates</h2>
      ${group(settingsRow({ title: "Install small fixes automatically", sub: "Unavailable while Atlas can't reach its updater" }))}
    </section>`;
  }
  const selected = selectedPolicy ?? policy;
  const on = selected === "automatic";
  const target: UpdatePolicy = on ? "approval_required" : "automatic";
  const unsaved = selectedPolicy && selectedPolicy !== policy;
  return `<section class="up-policy" aria-labelledby="update-policy-title">
    <h2 id="update-policy-title" class="ax-group-label">Updates</h2>
    <form id="update-policy-form" action="/updates/policy" method="post" hx-post="/updates/policy" hx-target="#updates-content" hx-swap="outerHTML" hx-indicator="#update-policy-progress" hx-disabled-elt="#update-policy, #update-policy-form button[type='submit']" hx-trigger="change, submit" hx-vals='{"policy":"${target}"}'>
      <input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}">
      <div class="ax-group">
        <label class="ax-setrow up-switch" for="update-policy"><span class="ax-setrow-main">Install small fixes automatically<span>Same version, newer build only</span></span><input class="ax-toggle" type="checkbox" role="switch" id="update-policy" aria-describedby="update-policy-foot"${on ? " checked" : ""}></label>
      </div>
      <p id="update-policy-foot" class="ax-group-foot">Bigger updates always wait for you to tap Install.</p>
      <div class="up-policy-actions">
        ${unsaved ? `<button class="ax-btn ax-btn-sm" type="submit" name="policy" value="${selected}">Try saving again</button>` : ""}
        <button class="ax-btn ax-btn-outline ax-btn-sm up-nojs" type="submit" name="policy" value="${target}">${on ? "Turn off automatic installs" : "Turn on automatic installs"}</button>
        <span id="update-policy-progress" class="htmx-indicator up-progress-text" role="status" aria-live="polite">Saving policy…</span>
      </div>
      <p data-form-status class="sr-only" role="status" aria-live="polite"></p>
    </form>
  </section>`;
};

// ── Public renderers ────────────────────────────────────────────────────

const pollAttributes = (status: UpdateStatus) => {
  const polling = status.checking || Boolean(status.updater && (activeStage.has(status.updater.state) || activationInProgress(status.updater) || status.updater.cleanup.state === "cleaning"));
  // The card swaps itself; Technical details updates out of band so its open/closed state survives.
  return polling ? ' hx-get="/updates/status" hx-trigger="every 2s" hx-swap="outerHTML" hx-push-url="false" hx-select="#updates-live-status" hx-select-oob="#updates-tech-body"' : "";
};

const liveStatus = (status: UpdateStatus, csrfToken: string, card: Card) =>
  `<div id="updates-live-status" class="up-live"${pollAttributes(status)}>
    ${renderCard(card, status)}
    ${notes(status, card)}
  </div>`;

const technicalDetails = (bodyHtml: string) =>
  `<details class="up-tech" id="updates-tech">
    <summary class="ax-setrow"><span class="ax-setrow-main">Technical details</span>${icon("chevron", 15, "ax-chev up-tech-chev")}</summary>
    ${bodyHtml}
  </details>`;

/** The polled fragment: the status card plus the Technical details body (swapped out of band). */
export const renderUpdatesStatus = (status: UpdateStatus, csrfToken = "") => {
  const card = statusCard(status, csrfToken);
  return `${liveStatus(status, csrfToken, card)}${technicalBody(status, csrfToken, card)}`;
};

export const renderUpdatesPage = (status: UpdateStatus, csrfToken: string, feedback?: UpdateFeedback) => {
  const card = statusCard(status, csrfToken);
  return `<div id="updates-content" class="up-page">
  ${feedback ? banner({
    tone: "error",
    attrs: 'tabindex="-1" data-focus-on-swap',
    bodyHtml: `<strong>The update change was not completed.</strong> ${escapeHtml(feedback.message)} Review the preserved choice and try again, or <a class="up-link" href="/inbox">return to Inbox</a>.`,
  }) : ""}
  ${liveStatus(status, csrfToken, card)}
  ${policyMarkup(status, csrfToken, feedback?.policy)}
  ${technicalDetails(technicalBody(status, csrfToken, card))}
</div>`;
};
