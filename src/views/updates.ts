import type { UpdateStatus } from "../update-discovery.ts";
import type { ReleaseIdentity, ReleaseMetadata } from "../release.ts";
import type { UpdaterStatus } from "../updater.ts";
import { escapeHtml, formatTime } from "./html.ts";
import { icon } from "./icons.ts";
import { alertSoft, pageHeader, statusBadge } from "./shared.ts";

const activeStage = new Set<UpdaterStatus["state"]>(["requested", "downloading", "verifying", "extracting"]);

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

export const renderUpdatesStatus = (status: UpdateStatus) => {
  const available = status.available;
  const polling = status.checking || Boolean(status.updater && activeStage.has(status.updater.state));
  const availableBody = available
    ? `${candidateIdentity(available)}<p class="mt-2 text-sm text-muted">${status.candidates.length} published release${status.candidates.length === 1 ? "" : "s"} retained for update-policy evaluation.</p>`
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
    <section class="mt-6 rounded-box border border-edge bg-base-100 p-4" aria-labelledby="update-policy-title">
      <div class="flex flex-wrap items-center justify-between gap-3"><h2 id="update-policy-title" class="text-base font-semibold">Update policy</h2>${statusBadge("badge-neutral", "Approval required")}</div>
      <p class="mt-3 max-w-prose text-sm leading-normal text-muted">Published artifacts may be downloaded and staged automatically. Staged releases remain inactive; this slice does not activate them.</p>
      <p class="mt-2 max-w-prose text-sm leading-normal text-muted">OpenCode is independently managed and is not checked for Atlas release eligibility.</p>
    </section>
  </div>`;
};

export const renderUpdatesPage = (status: UpdateStatus, csrfToken: string) => `${pageHeader({
  title: "Updates",
  description: "Check public Atlas Releases and observe durable host staging without changing the active release.",
  actions: `<form action="/updates/check" method="post">
    <input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}">
    <button class="btn btn-primary" type="submit">${icon("arrow-path", 16)} Check now</button>
  </form>`,
})}${renderUpdatesStatus(status)}`;
