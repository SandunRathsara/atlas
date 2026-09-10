import type { RefreshState, Repository, Session, Spec } from "../persistence.ts";
import { escapeHtml, formatTime, safeExternalUrl } from "./html.ts";
import { icon } from "./icons.ts";
import {
  accessNotice,
  alertSoft,
  emptyState,
  pageHeader,
  recordTable,
  refreshLine,
  refreshWarning,
  renderRepositoryHeading,
  repositoryLink,
  sessionHistoryRow,
  sessionStateLabel,
  sessionsLink,
  specsNotice,
  statusBadge,
} from "./shared.ts";
import { renderShell } from "./shell.ts";

const specHref = (spec: Spec) =>
  `/repositories/${encodeURIComponent(spec.repositoryId)}/specs/${encodeURIComponent(spec.issueNumber)}`;

const specIdentity = (spec: Spec) =>
  `<a class="text-brand-readable underline decoration-brand-readable/50 underline-offset-4" href="${specHref(spec)}">${escapeHtml(spec.title)}</a>
    <p class="mt-1 font-mono text-xs text-faint">Spec #${escapeHtml(spec.issueNumber)}</p>`;

const specActions = (spec: Spec, sessions: Session[]) => {
  const githubUrl = safeExternalUrl(spec.htmlUrl);
  const latestSession = sessions[0];
  return `${githubUrl ? `<a class="btn btn-ghost btn-xs" href="${escapeHtml(githubUrl)}" target="_blank" rel="noopener noreferrer">${icon("arrow-top-right-on-square", 16)} GitHub issue</a>` : ""}
    ${latestSession
      ? `<a class="text-brand-readable underline decoration-brand-readable/50 underline-offset-4" href="/sessions/${encodeURIComponent(latestSession.atlasId)}">${sessions.length} Atlas Session${sessions.length === 1 ? "" : "s"} · latest ${escapeHtml(sessionStateLabel(latestSession.state))}</a>`
      : `<span class="text-muted">No Atlas Sessions yet</span>`}`;
};

export const renderSpecsPage = ({
  csrfToken,
  repository,
  specs,
  sessionsBySpec,
  accessRefresh,
  specsRefresh,
}: {
  csrfToken: string;
  repository: Repository;
  specs: Spec[];
  sessionsBySpec?: ReadonlyMap<string, Session[]>;
  accessRefresh?: RefreshState;
  specsRefresh?: RefreshState;
}) => {
  const canShowEmptyState = specsRefresh?.availability === "available"
    && specsRefresh.requestedGeneration <= specsRefresh.completedGeneration;
  const list = specs.length > 0
    ? recordTable({
      label: "Open Specs",
      headers: ["Spec", "State", "Updated", "Actions"],
      rows: specs.map((spec) => {
        const sessions = sessionsBySpec?.get(spec.issueNumber) ?? [];
        return `<tr>
          <td>
            <div class="flex gap-2">
              ${icon("document-text", 20)}
              <div class="min-w-0">${specIdentity(spec)}</div>
            </div>
          </td>
          <td>${statusBadge("badge-info", "Open Spec")}</td>
          <td class="text-muted">${formatTime(spec.updatedAt)}</td>
          <td><div class="flex flex-wrap items-center gap-1">${specActions(spec, sessions)}</div></td>
        </tr>`;
      }),
      stacked: specs.map((spec) => {
        const sessions = sessionsBySpec?.get(spec.issueNumber) ?? [];
        return `<li class="p-3">
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div class="min-w-0">${specIdentity(spec)}</div>
            ${statusBadge("badge-info", "Open Spec")}
          </div>
          <p class="mt-2 text-sm text-muted">Updated ${formatTime(spec.updatedAt)}</p>
          <div class="mt-3 flex flex-wrap items-center gap-2">${specActions(spec, sessions)}</div>
        </li>`;
      }),
    })
    : canShowEmptyState
      ? emptyState(
        "No open Specs",
        `Open, non-PR GitHub issues carrying the exact <code class="font-mono text-base-content">spec</code> label appear here.`,
      )
      : "";

  return renderShell({
    title: `${repository.fullName} Specs`,
    active: "specs",
    repository,
    csrfToken,
    content: `${renderRepositoryHeading(repository, "Specs", "Open, non-PR GitHub issues labelled exactly spec.", csrfToken)}
      ${accessNotice(repository)}
      ${refreshWarning("Access", accessRefresh)}
      ${specsNotice(specsRefresh, specs)}
      <p class="mt-6 text-sm text-muted">${refreshLine("Access", accessRefresh)} · ${refreshLine("Specs", specsRefresh)}</p>
      ${list}`,
  });
};

export const renderSpecDetailPage = ({
  csrfToken,
  repository,
  spec,
  sessions,
  accessRefresh,
  specsRefresh,
}: {
  csrfToken: string;
  repository: Repository;
  spec: Spec;
  sessions?: Session[];
  accessRefresh?: RefreshState;
  specsRefresh?: RefreshState;
}) => {
  const githubUrl = safeExternalUrl(spec.htmlUrl);
  const retained = !(spec.isCurrent && spec.state === "open" && spec.hasSpecLabel && !spec.isPullRequest);
  const canStart = !retained && repository.accessStatus === "available" && !repository.removedAt && !repository.archived && !repository.disabled && repository.hasIssues && Boolean(repository.defaultBranch);
  const labels = spec.labels.length > 0
    ? spec.labels.map((label) => `<span class="badge badge-sm ${label === "spec" ? "badge-info" : ""}">${escapeHtml(label)}</span>`).join(" ")
    : `<span class="text-sm text-muted">No labels recorded</span>`;
  const history = sessions ?? [];
  const historyRows = history.map(sessionHistoryRow);

  return renderShell({
    title: `Spec #${spec.issueNumber}`,
    active: "spec",
    repository,
    csrfToken,
    content: `<a class="text-sm text-brand-readable underline underline-offset-4" href="${repositoryLink(repository)}">← Back to Specs</a>
      <div class="mt-6">
        ${pageHeader({
          title: escapeHtml(spec.title),
          description: `<span class="font-mono">Spec #${escapeHtml(spec.issueNumber)}</span>`,
          actions: `${statusBadge(retained ? "badge-warning" : "badge-info", retained ? "Retained snapshot" : "Open Spec")}
            ${githubUrl ? `<a class="btn btn-ghost" href="${escapeHtml(githubUrl)}" target="_blank" rel="noopener noreferrer">${icon("arrow-top-right-on-square", 16)} Open on GitHub</a>` : ""}
            ${canStart ? `<a class="btn btn-primary" href="${specHref(spec)}/sessions/new">${icon("play", 16)} Start Session</a>` : ""}`,
        })}
      </div>
      ${accessNotice(repository)}
      ${refreshWarning("Access", accessRefresh)}
      ${refreshWarning("Specs", specsRefresh)}
      ${retained ? alertSoft("warning", "status", "This issue is no longer in the active Specs projection. Atlas retains the last complete snapshot for this direct link.") : ""}
      <div class="mt-6 flex flex-wrap items-center gap-2" aria-label="Spec labels">${labels}</div>
      <dl class="mt-6 grid gap-4 border-y border-edge py-5 text-sm sm:grid-cols-2">
        <div><dt class="font-medium text-muted">Repository</dt><dd class="mt-1 break-words font-mono">${escapeHtml(repository.fullName)}</dd></div>
        <div><dt class="font-medium text-muted">Last updated</dt><dd class="mt-1">${formatTime(spec.updatedAt)}</dd></div>
        <div><dt class="font-medium text-muted">Last observed</dt><dd class="mt-1">${formatTime(spec.observedAt)}</dd></div>
        <div><dt class="font-medium text-muted">Specs freshness</dt><dd class="mt-1">${refreshLine("Specs", specsRefresh)}</dd></div>
      </dl>
      <article class="mt-8 max-w-prose">
        <h2 class="text-base font-semibold">Spec description</h2>
        <div class="mt-3 whitespace-pre-wrap break-words text-base leading-normal">${escapeHtml(spec.body) || "No description provided."}</div>
      </article>
      <section class="mt-8" aria-labelledby="session-history-title">
        <div class="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 id="session-history-title" class="text-base font-semibold">Session history</h2>
            <p class="mt-2 text-sm leading-normal text-muted">Atlas attempts for this Spec, including queued work.</p>
          </div>
          <a class="text-sm text-brand-readable underline underline-offset-4" href="${sessionsLink(repository)}">View Repository Sessions</a>
        </div>
        ${history.length > 0
          ? recordTable({
            label: "Session history",
            headers: ["Session", "State", "Queue", "Submitted", "Actions"],
            aligns: ["left", "left", "right", "left", "left"],
            rows: historyRows.map((entry) => entry.row),
            stacked: historyRows.map((entry) => entry.stacked),
          })
          : emptyState(
            "No Atlas Sessions yet",
            "Starting a Session will preserve its prompt and Spec snapshot here.",
          )}
      </section>`,
  });
};

export const renderSpecUnavailablePage = ({
  csrfToken,
  repository,
  accessRefresh,
  specsRefresh,
}: {
  csrfToken: string;
  repository: Repository;
  accessRefresh?: RefreshState;
  specsRefresh?: RefreshState;
}) => renderShell({
  title: `${repository.fullName} Specs unavailable`,
  active: "specs",
  repository,
  csrfToken,
  content: `${renderRepositoryHeading(repository, "Specs unavailable", "Atlas could not complete the first Specs read.", csrfToken)}
     ${accessNotice(repository)}
     ${refreshWarning("Access", accessRefresh)}
     ${refreshWarning("Specs", specsRefresh)}
     ${alertSoft("warning", "alert", `<div><strong>GitHub synchronization is unavailable.</strong> Retry when the configured App access is available. Atlas has not invented an empty list.</div>`)}
    <p class="mt-6 text-sm text-muted">${refreshLine("Access", accessRefresh)} · ${refreshLine("Specs", specsRefresh)}</p>
    <a class="btn btn-ghost mt-8" href="${repositoryLink(repository)}">Back to Specs</a>`,
});
