import type { UpdateStatus } from "../update-discovery.ts";
import type { ReleaseIdentity, ReleaseMetadata } from "../release.ts";
import type { UpdaterStatus } from "../updater.ts";
import { escapeHtml, formatTime } from "./html.ts";
import { icon } from "./icons.ts";
import { alertSoft, pageHeader, statusBadge } from "./shared.ts";

const activeStage = new Set<UpdaterStatus["state"]>(["requested", "downloading", "verifying", "extracting"]);
const activeActivation = new Set<UpdaterStatus["activation"]["state"]>([
  "awaiting_checkpoint",
  "requested",
  "stopping",
  "selecting",
  "starting",
  "validating",
  "selecting_previous",
  "restarting_previous",
  "validating_previous",
]);

const identity = (release: ReleaseIdentity) => release.published
  ? `<p class="font-mono text-base">${escapeHtml(release.tag)}</p>
    <p class="mt-2 break-all font-mono text-xs text-faint">${escapeHtml(release.gitSha)}</p>`
  : `<p class="text-base">Unpublished development</p>
    <p class="mt-2 text-sm text-muted">This tree has no authoritative release tag.</p>`;

const candidateIdentity = (metadata: ReleaseMetadata) => `<p class="font-mono text-base">${escapeHtml(metadata.identity.tag)}</p>
  <p class="mt-2 break-all font-mono text-xs text-faint">${escapeHtml(metadata.identity.gitSha)}</p>`;

const stageBadge = (state: UpdaterStatus["state"]) => {
  if (state === "staged") return statusBadge("badge-success", "Staged");
  if (state === "failed") return statusBadge("badge-error", "Staging failed");
  if (activeStage.has(state)) return statusBadge("badge-info", state === "requested" ? "Staging requested" : state[0]!.toUpperCase() + state.slice(1));
  return statusBadge("badge-neutral", "Not staged");
};

const runtimeMarkup = (candidate: ReleaseMetadata, updater: UpdaterStatus | null) => {
  const requirements = updater?.metadata?.identity.tag === candidate.identity.tag ? updater.requirements : null;
  const required = candidate.runtime;
  const unmet = requirements?.unmet ?? [];
  return `<section class="mt-6" aria-labelledby="update-runtime-title">
    <h2 id="update-runtime-title" class="text-base font-semibold">Host runtime requirements</h2>
    <div class="mt-3 rounded-box border border-edge bg-base-100 p-4">
      <dl class="grid gap-3 sm:grid-cols-3">
        <div><dt class="text-sm font-medium text-muted">Bun</dt><dd class="mt-1 font-mono text-sm">${escapeHtml(required.bun)}</dd></div>
        <div><dt class="text-sm font-medium text-muted">Git</dt><dd class="mt-1 font-mono text-sm">${escapeHtml(required.git)}</dd></div>
        <div><dt class="text-sm font-medium text-muted">gh</dt><dd class="mt-1 font-mono text-sm">${escapeHtml(required.gh)}</dd></div>
      </dl>
    </div>
    ${unmet.length > 0 ? alertSoft("warning", "alert", `<div><strong>Host runtime requirements are not met.</strong><ul class="mt-2 list-disc pl-5">${unmet.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>The updater does not upgrade host tools.</div>`) : ""}
  </section>`;
};

const maintenanceMarkup = (candidate: ReleaseMetadata) => !candidate.rollback.codeOnlyCompatible
  ? alertSoft("warning", "alert", `<div><strong>Manual maintenance required.</strong> This release cannot use normal code-only rollback. ${escapeHtml(candidate.rollback.manualMaintenanceInstructions ?? "Follow the published release instructions.")}</div>`)
  : "";

const activationBadge = (state: UpdaterStatus["activation"]["state"]) => {
  if (state === "succeeded") return statusBadge("badge-success", "Activated");
  if (state === "rolled_back") return statusBadge("badge-warning", "Recovered");
  if (state === "rollback_failed") return statusBadge("badge-error", "Recovery failed");
  if (state === "abandoned") return statusBadge("badge-warning", "Abandoned");
  if (["selecting_previous", "restarting_previous", "validating_previous"].includes(state)) return statusBadge("badge-warning", "Recovering");
  if (activeActivation.has(state)) return statusBadge("badge-info", state === "awaiting_checkpoint" ? "Waiting for safe checkpoint" : "Activating");
  return statusBadge("badge-neutral", "No activation");
};

const activationAction = (status: UpdateStatus, candidate: ReleaseMetadata, csrfToken: string) => {
  const updater = status.updater;
  if (!csrfToken || !updater || activeActivation.has(updater.activation.state) || updater.state !== "staged" ||
      updater.metadata?.identity.tag !== candidate.identity.tag || !updater.stagedPath ||
      updater.requirements === null || updater.requirements.unmet.length > 0 || !candidate.rollback.codeOnlyCompatible) return "";
  const retry = updater.activation.failedTags.includes(candidate.identity.tag);
  return `<form class="mt-4" action="/updates/install" method="post">
    <input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}">
    <input type="hidden" name="tag" value="${escapeHtml(candidate.identity.tag)}">
    ${retry ? '<input type="hidden" name="retry" value="1">' : ""}
    <button class="btn btn-primary" type="submit">${icon(retry ? "arrow-path" : "play", 16)} ${retry ? "Retry" : "Install"}</button>
  </form>`;
};

const discoveryMarkup = (status: UpdateStatus) => {
  if (status.checking) return alertSoft("info", "status", "<div><strong>Checking published releases.</strong> Known release information remains visible while the check completes.</div>");
  if (status.discovery.failureReason) {
    return alertSoft("error", "alert", `<div><strong>Release check failed.</strong> ${escapeHtml(status.discovery.failureReason)} Last successful check: ${escapeHtml(formatTime(status.discovery.lastSuccessAt))}.</div>`);
  }
  if (status.discovery.lastSuccessAt) {
    return `<p class="mt-3 text-sm text-muted">Last successful check: ${escapeHtml(formatTime(status.discovery.lastSuccessAt))}.</p>`;
  }
  return `<p class="mt-3 text-sm text-muted">Published releases have not been checked yet.</p>`;
};

const stageMarkup = (status: UpdateStatus) => {
  if (status.updaterError) return alertSoft("error", "alert", `<div><strong>Staging status unavailable.</strong> ${escapeHtml(status.updaterError)}</div>`);
  const updater = status.updater;
  if (!updater) return "";
  const current = updater.metadata
    ? `<p class="mt-2 font-mono text-sm">${escapeHtml(updater.metadata.identity.tag)}</p>`
    : "";
  const latest = updater.lastResult
    ? `<div class="mt-4 border-t border-edge pt-4"><p class="text-sm font-medium text-muted">Latest staging result</p><p class="mt-2"><span class="font-mono">${escapeHtml(updater.lastResult.tag)}</span> · ${escapeHtml(updater.lastResult.message)}</p><p class="mt-1 text-sm text-muted">${escapeHtml(formatTime(updater.lastResult.at))}</p></div>`
    : `<p class="mt-4 border-t border-edge pt-4 text-sm text-muted">No staging result yet.</p>`;
  return `<section class="mt-6" aria-labelledby="staging-title">
    <div class="flex flex-wrap items-center justify-between gap-3"><h2 id="staging-title" class="text-base font-semibold">Staging</h2>${stageBadge(updater.state)}</div>
    <div class="mt-3 rounded-box border border-edge bg-base-100 p-4">
      <p>${escapeHtml(updater.message)}</p>${current}
      <p class="mt-2 text-sm text-muted">Staging leaves the active release and Session admission unchanged.</p>
      ${latest}
    </div>
  </section>`;
};

const activationMarkup = (status: UpdateStatus) => {
  if (status.updaterError || !status.updater) return "";
  const activation = status.updater.activation;
  const target = activation.metadata
    ? `<p class="mt-2 font-mono text-sm">${escapeHtml(activation.metadata.identity.tag)}</p>`
    : "";
  const latest = activation.lastResult
    ? `<div class="mt-4 border-t border-edge pt-4"><p class="text-sm font-medium text-muted">Latest activation result</p><p class="mt-2"><span class="font-mono">${escapeHtml(activation.lastResult.tag)}</span> · ${escapeHtml(activation.lastResult.message)}</p><p class="mt-1 text-sm text-muted">${escapeHtml(formatTime(activation.lastResult.at))}</p></div>`
    : `<p class="mt-4 border-t border-edge pt-4 text-sm text-muted">No activation result yet.</p>`;
  return `<section class="mt-6" aria-labelledby="activation-title">
    <div class="flex flex-wrap items-center justify-between gap-3"><h2 id="activation-title" class="text-base font-semibold">Activation and recovery</h2>${activationBadge(activation.state)}</div>
    <div class="mt-3 rounded-box border border-edge bg-base-100 p-4">
      <p>${escapeHtml(activation.message)}</p>${target}
      <p class="mt-2 text-sm text-muted">Atlas identity and storage health are checked independently of OpenCode.</p>
      ${latest}
    </div>
  </section>`;
};

const cleanupMarkup = (status: UpdateStatus) => {
  if (status.updaterError || !status.updater) return "";
  const cleanup = status.updater.cleanup;
  const badge = cleanup.state === "failed"
    ? statusBadge("badge-error", "Cleanup failed")
    : cleanup.state === "cleaning"
      ? statusBadge("badge-info", "Cleaning up")
      : cleanup.state === "succeeded"
        ? statusBadge("badge-success", "Cleanup complete")
        : statusBadge("badge-neutral", "Not run");
  const removed = cleanup.removedTags.length > 0
    ? `<p class="mt-2 text-sm text-muted">Removed: ${cleanup.removedTags.map((tag) => `<span class="font-mono">${escapeHtml(tag)}</span>`).join(", ")}</p>`
    : "";
  return `<section class="mt-6" aria-labelledby="cleanup-title">
    <div class="flex flex-wrap items-center justify-between gap-3"><h2 id="cleanup-title" class="text-base font-semibold">Release retention</h2>${badge}</div>
    <div class="mt-3 rounded-box border border-edge bg-base-100 p-4">
      <p>${escapeHtml(cleanup.message)}</p>${removed}
      <p class="mt-2 text-sm text-muted">Current, previous working, staged, in-flight, and Session-helper-referenced releases are retained.</p>
    </div>
  </section>`;
};

const policyMarkup = (status: UpdateStatus, csrfToken: string) => {
  const policy = status.updater?.policy;
  const badge = policy === "automatic"
    ? statusBadge("badge-info", "Automatic")
    : policy === "approval_required"
      ? statusBadge("badge-neutral", "Approval required")
      : statusBadge("badge-error", "Unavailable");
  const form = policy && csrfToken
    ? `<form class="mt-4 flex max-w-2xl flex-wrap items-end gap-3" action="/updates/policy" method="post">
        <input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}">
        <label class="flex min-w-56 flex-1 flex-col" for="update-policy">
          <span class="mb-2 text-sm font-medium text-muted">Policy</span>
          <select class="select w-full" id="update-policy" name="policy">
            <option value="approval_required"${policy === "approval_required" ? " selected" : ""}>Approval required</option>
            <option value="automatic"${policy === "automatic" ? " selected" : ""}>Automatic for current SemVer builds</option>
          </select>
        </label>
        <button class="btn" type="submit">Save policy</button>
      </form>`
    : "";
  return `<section class="mt-6 rounded-box border border-edge bg-base-100 p-4" aria-labelledby="update-policy-title">
    <div class="flex flex-wrap items-center justify-between gap-3"><h2 id="update-policy-title" class="text-base font-semibold">Update policy</h2>${badge}</div>
    <p class="mt-3 max-w-prose text-sm leading-normal text-muted">Automatic mode installs only a newer numeric build of the installed SemVer. Every patch, minor, or major change still requires Install.</p>
    <p class="mt-2 max-w-prose text-sm leading-normal text-muted">A failed build is suppressed until explicit Retry; a later eligible build may proceed normally. Each Atlas installation keeps its own policy and schedule.</p>
    ${form}
    <p class="mt-4 max-w-prose text-sm leading-normal text-muted">Activation briefly restarts Atlas, preserves queued Sessions, and automatically restores the previous release when candidate validation fails. OpenCode keeps running and is not an activation gate.</p>
  </section>`;
};

export const renderUpdatesStatus = (status: UpdateStatus, csrfToken = "") => {
  const available = status.available;
  const polling = status.checking || Boolean(status.updater && (activeStage.has(status.updater.state) || activeActivation.has(status.updater.activation.state) || status.updater.cleanup.state === "cleaning"));
  const availableBody = available
    ? `${candidateIdentity(available)}<p class="mt-2 text-sm text-muted">${status.candidates.length} published release${status.candidates.length === 1 ? "" : "s"} retained for update-policy evaluation.</p>${activationAction(status, available, csrfToken)}`
    : !status.installed.published
      ? `<p class="text-base">Unavailable</p><p class="mt-2 text-sm text-muted">A published installed identity is required before Atlas can order newer releases.</p>`
      : status.discovery.failureReason
        ? `<p class="text-base">Availability unknown</p><p class="mt-2 text-sm text-muted">The latest check failed; known release information is retained.</p>`
        : status.discovery.lastSuccessAt
          ? `<p class="text-base">No newer release found</p><p class="mt-2 text-sm text-muted">This is up to date only as of the last successful check shown below.</p>`
          : `<p class="text-base">Not checked yet</p><p class="mt-2 text-sm text-muted">Check published releases before assessing availability.</p>`;
  return `<div id="updates-status"${polling ? ' hx-get="/updates/status" hx-trigger="every 2s" hx-swap="outerHTML" hx-push-url="false"' : ""}>
    <div class="mt-6 grid gap-4 md:grid-cols-2">
      <section class="rounded-box border border-edge bg-base-100 p-4" aria-labelledby="installed-release-title">
        <div class="flex flex-wrap items-center justify-between gap-2"><h2 id="installed-release-title" class="text-base font-semibold">Installed release</h2>${status.installed.published ? statusBadge("badge-neutral", `Build ${status.installed.build}`) : statusBadge("badge-warning", "Development")}</div>
        <div class="mt-3">${identity(status.installed)}</div>
      </section>
      <section class="rounded-box border border-edge bg-base-100 p-4" aria-labelledby="available-release-title">
        <div class="flex flex-wrap items-center justify-between gap-2"><h2 id="available-release-title" class="text-base font-semibold">Available release</h2>${available ? statusBadge("badge-info", `Build ${available.identity.build}`) : ""}</div>
        <div class="mt-3">${availableBody}</div>
      </section>
    </div>
    ${discoveryMarkup(status)}
    ${status.discovery.stageRequestFailureReason ? alertSoft("error", "alert", `<div><strong>Staging request failed.</strong> ${escapeHtml(status.discovery.stageRequestFailureReason)}</div>`) : ""}
    ${available ? maintenanceMarkup(available) + runtimeMarkup(available, status.updater) : ""}
    ${stageMarkup(status)}
    ${activationMarkup(status)}
    ${cleanupMarkup(status)}
    ${policyMarkup(status, csrfToken)}
  </div>`;
};

export const renderUpdatesPage = (status: UpdateStatus, csrfToken: string) => `${pageHeader({
  title: "Updates",
  description: "Check, approve, and recover Atlas Releases without stopping Agent work.",
  actions: `<form action="/updates/check" method="post">
    <input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}">
    <button class="btn btn-primary" type="submit">${icon("arrow-path", 16)} Check now</button>
  </form>`,
})}${renderUpdatesStatus(status, csrfToken)}`;
