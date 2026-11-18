import type { Repository, Session, SessionState } from "../persistence.ts";
import { escapeHtml, safeExternalUrl } from "./html.ts";
import { banner, confirmAction, segmented, type MenuItem } from "./kit.ts";
import { icon } from "./icons.ts";

// New UI kit (Look A). Prefer these over the deprecated helpers below.
export * from "./kit.ts";
export { icon, logo, type IconName } from "./icons.ts";

export const repositoryLink = (repository: Pick<Repository, "githubId">) =>
  `/repositories/${encodeURIComponent(repository.githubId)}/specs`;
export const sessionsLink = (repository: Pick<Repository, "githubId">) =>
  `/repositories/${encodeURIComponent(repository.githubId)}/sessions`;

export const accessLabel = (repository: Repository) => {
  if (repository.removedAt) return "Removed from Atlas";
  if (repository.accessStatus === "unknown") return "Access unknown";
  if (repository.accessStatus === "revoked") return "Access unavailable";
  if (repository.accessStatus === "transferred") return "Transferred out of scope";
  if (repository.accessStatus === "suspended") return "App suspended";
  if (repository.archived) return "Archived";
  if (repository.disabled) return "Disabled";
  return "Available";
};

/** Plain reasons a Repository can't start Sessions, apart from access status (see `accessNotice`). */
export const eligibilityNotice = (repository: Repository) => {
  const reasons = [
    repository.archived ? "It’s archived on GitHub. You can still browse it." : "",
    repository.disabled ? "It’s disabled on GitHub. You can still browse it." : "",
    !repository.defaultBranch ? "Its default branch has no commit yet." : "",
    !repository.hasIssues ? "Issues are turned off for it on GitHub, so it has no Specs." : "",
  ].filter(Boolean);
  return reasons.join(" ");
};

/** Colour initial tile for a Repository (decorative; the name is always next to it). */
export const repositoryTile = (repository: { name: string; githubId?: string; id?: string; removedAt?: string | null; archived?: boolean }, size: 36 | 40 = 40) => {
  const key = repository.githubId ?? repository.id ?? repository.name;
  let hash = 0;
  for (const char of key) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  const grey = Boolean(repository.removedAt) || repository.archived === true;
  const colour = grey ? "grey" : String(hash % 5);
  const initial = Array.from(repository.name.replace(/^[^\p{L}\p{N}]+/u, ""))[0]?.toUpperCase() ?? "?";
  return `<span class="rp-tile rp-c${colour}${size === 36 ? " rp-tile-sm" : ""}" aria-hidden="true">${escapeHtml(initial)}</span>`;
};

/** One short truthful note for a Repository card ("Archived · can't start Sessions"), or undefined. */
export const repositoryNote = (repository: Repository): { text: string; tone: "warning" | "error" } | undefined => {
  if (repository.removedAt) return { text: "Removed from Atlas · history kept", tone: "warning" };
  if (repository.accessStatus === "unknown") return { text: "Access unverified · showing last-known data", tone: "warning" };
  if (repository.accessStatus === "revoked") return { text: "GitHub App access unavailable · can’t start Sessions", tone: "error" };
  if (repository.accessStatus === "transferred") return { text: "Outside the organization · can’t start Sessions", tone: "error" };
  if (repository.accessStatus === "suspended") return { text: "GitHub App suspended · can’t start Sessions", tone: "error" };
  if (repository.archived) return { text: "Archived · can’t start Sessions", tone: "warning" };
  if (repository.disabled) return { text: "Disabled on GitHub · can’t start Sessions", tone: "error" };
  if (!repository.defaultBranch) return { text: "No default-branch commit · can’t start Sessions", tone: "warning" };
  if (!repository.hasIssues) return { text: "Issues off on GitHub · no Specs", tone: "warning" };
  return undefined;
};

export const accessNotice = (repository: Repository) => {
  return [
    repository.removedAt
      ? banner({ tone: "warning", title: "Removed from Atlas", body: "Its history and existing Sessions are kept. It can’t start new Sessions until you re-add it. Nothing changed on GitHub." })
      : "",
    repository.accessStatus === "unknown"
      ? banner({ tone: "warning", role: "alert", title: "Couldn’t verify GitHub access", body: "Showing the last data Atlas read. This doesn’t mean access was removed. New Sessions wait until access is verified." })
      : "",
    repository.accessStatus === "revoked"
      ? banner({ tone: "error", title: "GitHub App access unavailable", body: "This Repository wasn’t in the App’s last complete installation list. Atlas keeps its cached data but won’t start new Sessions." })
      : "",
    repository.accessStatus === "transferred"
      ? banner({ tone: "error", title: "Outside the configured organization", body: "Its cached data is kept. New Sessions are paused." })
      : "",
    repository.accessStatus === "suspended"
      ? banner({ tone: "error", title: "GitHub App installation suspended", body: "Cached data is kept. New Sessions are paused." })
      : "",
  ].filter(Boolean).join("");
};

/**
 * Remove (confirm first) or Re-add. Remove is a kit `confirmAction` around the unchanged POST
 * form, so it asks before submitting even without JS. Re-add is the same enroll path as Add.
 */
export const repositoryAction = (repository: Repository, csrfToken: string, compact = false) => {
  const githubId = escapeHtml(repository.githubId);
  const action = repository.removedAt ? "/repositories" : `/repositories/${encodeURIComponent(repository.githubId)}/remove`;
  const form = (buttonHtml: string, progress: string) => `<form id="repository-action-${githubId}" class="rp-action" action="${action}" method="post" hx-post="${action}" hx-target="this" hx-swap="none" hx-indicator="#repository-progress-${githubId}" hx-disabled-elt="button[type='submit']">
    <input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}">
    ${repository.removedAt ? `<input type="hidden" name="repository_id" value="${githubId}">` : ""}
    <span data-form-status class="sr-only" role="status" aria-live="polite"></span>
    ${buttonHtml}
    <span id="repository-progress-${githubId}" class="htmx-indicator rp-progress" role="status" aria-live="polite">${progress}</span>
  </form>`;
  if (repository.removedAt) {
    return form(`<button class="ax-btn${compact ? " ax-btn-sm" : ""}" type="submit">Re-add</button>`, "Re-adding…");
  }
  return confirmAction({
    id: `remove-repository-${repository.githubId}`,
    label: "Remove from Atlas…",
    title: `Remove ${repository.name} from Atlas?`,
    body: "It leaves your lists and can’t start new Sessions. Its history and existing Sessions are kept, and you can re-add it later the same way. Nothing changes on GitHub.",
    confirmHtml: form(`<button class="ax-btn ax-btn-danger-fill" type="submit">Remove from Atlas</button>`, "Removing…"),
  });
};

const repositoryTabs = (repository: Repository, current: RepositorySection) => {
  const id = encodeURIComponent(repository.githubId);
  return segmented({
    label: `${repository.name} sections`,
    items: [
      { href: `/repositories/${id}/specs`, label: "Specs", current: current === "specs" },
      { href: `/repositories/${id}/pull-requests`, label: "Pull requests", current: current === "pull-requests" },
      { href: `/repositories/${id}/sessions`, label: "Sessions", current: current === "sessions" },
    ],
  });
};

export type RepositorySection = "specs" | "pull-requests" | "sessions";

/**
 * Repository pages (Specs, Pull requests, Sessions): `header` for `renderShell` (Repository name as the
 * h1, its description, back to Repositories, ⋯ menu with Open on GitHub and Remove) and `intro`, the
 * content that opens the page: removed note with Re-add, the section control and a "can't start
 * Sessions" note.
 */
export const repositoryPage = (repository: Repository, section: RepositorySection, csrfToken?: string) => {
  const githubUrl = safeExternalUrl(repository.htmlUrl);
  const eligibility = repository.removedAt ? "" : eligibilityNotice(repository);
  const items: MenuItem[] = [];
  if (githubUrl) items.push({ label: "Open on GitHub", href: githubUrl, external: true });
  if (csrfToken && !repository.removedAt) items.push({ label: "Remove from Atlas", danger: true, html: repositoryAction(repository, csrfToken) });
  const readd = csrfToken && repository.removedAt ? repositoryAction(repository, csrfToken, true) : "";
  const header = {
    title: repository.name,
    description: repository.description ?? repository.fullName,
    back: { href: "/repositories", label: "Repositories" },
    menu: items.length ? { title: repository.fullName, items, label: `More actions for ${repository.name}` } : undefined,
  };
  // Access problems are a truthfulness rule: say so on every Repository page, not just the list card.
  const access = !repository.removedAt && repository.accessStatus !== "available" ? repositoryNote(repository) : undefined;
  const intro = `<div class="rp-head">
  ${repository.removedAt ? `<div class="rp-removed"><span class="rp-note">Removed from Atlas · history kept</span>${readd}</div>` : ""}
  ${access ? `<p class="rp-note rp-head-note${access.tone === "error" ? " rp-note-red" : ""}">${icon("warn", 14)}${escapeHtml(access.text)}</p>` : ""}
  ${repositoryTabs(repository, section)}
  ${eligibility ? banner({ tone: "warning", title: "Can’t start Sessions", body: eligibility }) : ""}
</div>`;
  return { header, intro };
};

export const sessionStateLabel = (state: SessionState) => {
  if (state === "failed_setup") return "Failed — setup";
  return state.charAt(0).toUpperCase() + state.slice(1);
};

export const handoffCheckpointLabel = (checkpoint: Session["handoffCheckpoint"]) => {
  if (checkpoint === "intent_saved") return "Intent saved";
  if (checkpoint === "events_consuming") return "Events consuming";
  if (checkpoint === "create_sent") return "Create sent once";
  if (checkpoint === "create_confirmed") return "Create confirmed";
  if (checkpoint === "associated") return "Association confirmed";
  if (checkpoint === "prompt_sent") return "Prompt sent once";
  if (checkpoint === "prompt_accepted") return "Prompt accepted";
  return "Not started";
};

export const sessionTargetLabel = (session: Session) => {
  if (session.targetKind === "native_stack") return `Native stack #${session.targetStackNumber ?? "unknown"}`;
  if (session.targetKind === "standalone_parent") return `Standalone parent #${session.targetParentPullRequestNumber ?? "unknown"}`;
  return `Default branch · ${session.targetBranch}`;
};

export const publicationStatusLabel = (status: Session["publicationStatus"]) => {
  if (status === "not_observed") return "Not observed";
  if (status === "unverified") return "Publication unverified";
  if (status === "ambiguous") return "Publication ambiguous";
  if (status === "identified") return "Publication identified";
  if (status === "qualifying") return "Qualifying publication";
  return "Reservation released";
};

export const targetReconfirmationNeeded = (session: Session) =>
  session.state === "queued" &&
  session.admissionBlocked === true &&
  session.stateReason?.startsWith("Waiting for explicit target reconfirmation") === true;
