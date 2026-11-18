import type { PrStack, PullRequest, RefreshState, Repository } from "../persistence.ts";
import { escapeHtml, safeExternalUrl } from "./html.ts";
import { icon } from "./icons.ts";
import { ageShort, banner, button, emptyCard, prPill, prTile, relativeTime, sectionHeader, type PrState } from "./kit.ts";
import { repositoryPage } from "./shared.ts";
import { renderShell, type InboxContext } from "./shell.ts";
import { pullRequestLifecycle, stackStatus, standaloneStatus, type TargetStatus, targetVerificationStatus } from "./targets.ts";

/** Kit PR state for a Pull request (Merged › Draft › Open › Closed). */
const prState = (pullRequest: PullRequest): PrState =>
  pullRequestLifecycle(pullRequest).toLowerCase() as PrState;

const pullRequestsPath = (repository: Pick<Repository, "githubId">) =>
  `/repositories/${encodeURIComponent(repository.githubId)}/pull-requests`;

const age = (iso: string | null | undefined) => {
  const short = ageShort(iso);
  if (!short || !iso) return "";
  const date = new Date(iso);
  return `<time datetime="${escapeHtml(date.toISOString())}">${short === "now" ? "just now" : `${short} ago`}</time>`;
};

const external = (url: string | null, inner: string, className: string, label: string) => {
  const safe = safeExternalUrl(url ?? "");
  return safe
    ? `<a class="${className}" href="${escapeHtml(safe)}" target="_blank" rel="noopener noreferrer" aria-label="${escapeHtml(`${label} (opens on GitHub)`)}">${inner}</a>`
    : `<div class="${className}">${inner}</div>`;
};

/** Tick / cross / clock line with the real eligibility reason from targets.ts. */
const eligibilityLine = (status: TargetStatus, eligibleText: string, place: "stack" | "row") => {
  const tone = status.kind === "eligible" ? "ok" : status.kind === "warning" ? "wait" : "no";
  const glyph = status.kind === "eligible" ? "check" : status.kind === "warning" ? "clock" : "x";
  const text = status.kind === "eligible"
    ? eligibleText
    : status.kind === "warning"
      ? `Waiting for GitHub: ${status.reason}`
      : `Can’t start here: ${status.reason}`;
  return `<p class="pr-elig pr-elig-${place} pr-${tone}" data-target-status="${status.kind}">${icon(glyph, place === "stack" ? 16 : 14)}<span><span class="sr-only">${escapeHtml(status.label)}. </span>${escapeHtml(text)}</span></p>`;
};

/** One native PR stack: base layer first, layers joined by a line, eligibility at the foot. */
const stackCard = (repository: Repository, stack: PrStack, pullRequests: Map<string, PullRequest>, gate?: TargetStatus) => {
  const status = stackStatus(repository, stack, pullRequests, gate);
  const members = [...stack.members].sort((left, right) => left.position - right.position);
  const topPosition = members[members.length - 1]?.position;
  const layers = members.map((member) => {
    const pullRequest = pullRequests.get(member.pullRequestId);
    const top = member.position === topPosition ? `<span class="pr-top">Top</span>` : "";
    if (!pullRequest) {
      return `<li class="pr-layer"><span class="pr-dot pr-dot-unknown" aria-hidden="true"></span><div class="pr-layer-main"><b class="pr-layer-title">Pull request unavailable${top}</b><span class="pr-layer-sub">Layer ${member.position} · Atlas couldn’t match it to a Pull request</span></div></li>`;
    }
    const state = prState(pullRequest);
    const when = age(pullRequest.updatedAt);
    const inner = `<span class="pr-dot pr-dot-${state}" aria-hidden="true"></span><span class="pr-layer-main"><b class="pr-layer-title">${escapeHtml(pullRequest.title)}${top}</b><span class="pr-layer-sub"><span class="ax-mono">#${escapeHtml(pullRequest.number)}</span>${when ? ` · ${when}` : ""}</span></span>${prPill(state)}`;
    return `<li>${external(pullRequest.htmlUrl, inner, "pr-layer", `#${pullRequest.number} ${pullRequest.title}, ${pullRequestLifecycle(pullRequest)}${top ? ", top layer" : ""}`)}</li>`;
  }).join("");
  const count = members.length === 1 ? "1 layer" : `${members.length} layers`;
  return `<article class="pr-stack" aria-label="Stack #${escapeHtml(stack.number)}">
    <h3 class="pr-stack-head">${icon("stack", 18)}<span>Stack #${escapeHtml(stack.number)}</span><span class="pr-stack-n">${count}</span></h3>
    ${members.length > 0
      ? `<ol class="pr-layers" aria-label="Stack #${escapeHtml(stack.number)} layers, base first">${layers}</ol>`
      : `<p class="pr-layer-sub pr-stack-none">GitHub hasn’t reported any layers for this stack.</p>`}
    ${eligibilityLine(status, "Can start a Session as the next layer", "stack")}
  </article>`;
};

/** One standalone open Pull request with its eligibility line. */
const pullRequestRow = (repository: Repository, pullRequest: PullRequest, gate?: TargetStatus) => {
  const status = standaloneStatus(repository, pullRequest, gate);
  const state = prState(pullRequest);
  const when = age(pullRequest.updatedAt);
  const inner = `${prTile(state)}<span class="ax-row-main"><span class="ax-row-title">${escapeHtml(pullRequest.title)}</span><span class="ax-row-sub"><span class="ax-mono">#${escapeHtml(pullRequest.number)}</span> · into <span class="ax-mono">${escapeHtml(pullRequest.baseRef)}</span>${when ? ` · ${when}` : ""}</span>${eligibilityLine(status, "Can start a Session on top", "row")}</span><span class="ax-row-end"><span>${prPill(state)}</span></span>`;
  return external(pullRequest.htmlUrl, inner, "ax-row pr-row", `#${pullRequest.number} ${pullRequest.title}, ${pullRequestLifecycle(pullRequest)}`);
};

const refreshFailed = (refresh: RefreshState | undefined) =>
  !refresh || refresh.availability !== "available" || refresh.requestedGeneration > refresh.completedGeneration;

/** Amber note shown over last-seen data when the latest GitHub read did not complete. */
const unverifiedBanner = (refresh: RefreshState | undefined, hasData: boolean, compact = false) => {
  if (!refreshFailed(refresh)) return "";
  const never = !refresh || refresh.availability === "never" || !refresh.lastSuccessAt;
  const pending = refresh && refresh.availability === "available" && refresh.requestedGeneration > refresh.completedGeneration;
  const title = pending ? "Still checking GitHub" : "Couldn’t check GitHub just now";
  const body = never
    ? "Atlas hasn’t read this Repository’s pull requests yet, so nothing is shown. Starting on a pull request waits until GitHub can be checked."
    : `${hasData ? "Showing what Atlas last saw." : "Atlas last saw no open pull requests."} Starting on these waits until GitHub can be checked.`;
  const reason = refresh?.failureReason && !pending ? ` <span class="pr-reason">GitHub said: ${escapeHtml(refresh.failureReason)}</span>` : "";
  return banner({ title, bodyHtml: `${escapeHtml(body)}${reason}`, className: `pr-banner${compact ? " pr-banner-compact" : ""}` });
};

const freshnessLine = (refresh: RefreshState | undefined) => {
  if (!refresh?.lastSuccessAt) return `<p class="pr-fresh">Atlas hasn’t checked GitHub yet. Atlas only reads pull requests; it never changes them.</p>`;
  const verb = refreshFailed(refresh) ? "Last checked GitHub" : "Checked GitHub";
  return `<p class="pr-fresh">${verb} ${relativeTime(refresh.lastSuccessAt)}. Atlas only reads pull requests; it never changes them.</p>`;
};

type RepositoryPullRequests = {
  repository: Repository;
  pullRequests: PullRequest[];
  stacks: PrStack[];
  accessRefresh?: RefreshState;
  refresh?: RefreshState;
};

const project = ({ repository, pullRequests, stacks, accessRefresh, refresh }: RepositoryPullRequests) => {
  const pullRequestMap = new Map(pullRequests.map((pullRequest) => [pullRequest.githubId, pullRequest]));
  const standalone = pullRequests.filter((pullRequest) => pullRequest.isCurrent && pullRequest.state === "open" && !pullRequest.stack);
  const gate = targetVerificationStatus(repository, accessRefresh, refresh);
  return { pullRequestMap, standalone, gate, hasData: standalone.length > 0 || stacks.length > 0 };
};

/** Stacks and standalone Pull requests; side by side on desktop when both exist. */
const sections = (data: RepositoryPullRequests, headingLevel: "h2" | "h3", idPrefix: string) => {
  const { pullRequestMap, standalone, gate } = project(data);
  const header = (title: string, count: number, id: string) => headingLevel === "h2"
    ? sectionHeader({ title, count, id })
    : `<h3 class="pr-sub" id="${escapeHtml(id)}">${escapeHtml(title)} <span class="ax-section-n">${count}</span></h3>`;
  const stackColumn = data.stacks.length > 0
    ? `<section class="pr-col" aria-labelledby="${idPrefix}stacks">${header("Stacks", data.stacks.length, `${idPrefix}stacks`)}<div class="pr-stacks">${data.stacks.map((stack) => stackCard(data.repository, stack, pullRequestMap, gate)).join("")}</div></section>`
    : "";
  const rowColumn = standalone.length > 0
    ? `<section class="pr-col" aria-labelledby="${idPrefix}standalone">${header("Pull requests", standalone.length, `${idPrefix}standalone`)}<div class="ax-group pr-list">${standalone.map((pullRequest) => pullRequestRow(data.repository, pullRequest, gate)).join("")}</div></section>`
    : "";
  if (!stackColumn && !rowColumn) return "";
  return `<div class="pr-cols${stackColumn && rowColumn ? " pr-cols-2" : ""}">${stackColumn}${rowColumn}</div>`;
};

const noPullRequests = (body: string) =>
  `<div class="pr-empty">${emptyCard({ title: "No open pull requests", body, glyph: "pr" })}</div>`;

export const renderPullRequestsPage = ({
  csrfToken,
  repository,
  pullRequests,
  stacks,
  accessRefresh,
  refresh,
  inbox,
}: {
  csrfToken: string;
  repository: Repository;
  pullRequests: PullRequest[];
  stacks: PrStack[];
  accessRefresh?: RefreshState;
  refresh?: RefreshState;
  inbox?: InboxContext;
}) => {
  const data = { repository, pullRequests, stacks, accessRefresh, refresh };
  const { hasData } = project(data);
  const body = sections(data, "h2", "");
  const empty = !hasData && !refreshFailed(refresh)
    ? noPullRequests("Open pull requests and GitHub stacks for this Repository show up here.")
    : "";

  const page = repositoryPage(repository, "pull-requests", csrfToken);
  return renderShell({
    title: `${repository.fullName} Pull requests`,
    csrfToken,
    inbox,
    tab: "repos",
    header: page.header,
    content: `${page.intro}
      <div class="pr-page">
        ${unverifiedBanner(refresh, hasData)}
        ${empty}
        ${body}
        ${freshnessLine(refresh)}
      </div>`,
  });
};

/** Cross-Repository Pull requests tab (`/pull-requests`): last-seen data only, no GitHub reads. */
export const renderAllPullRequestsPage = ({
  csrfToken,
  repositories,
  inbox,
}: {
  csrfToken: string;
  repositories: RepositoryPullRequests[];
  inbox?: InboxContext;
}) => {
  const shown = repositories.filter((data) => project(data).hasData || refreshFailed(data.refresh));
  const filtered = inbox?.filtered;
  const blocks = shown.map((data) => {
    const { hasData } = project(data);
    const id = `repository-${data.repository.githubId}`;
    return `<section class="pr-repo" aria-labelledby="${escapeHtml(id)}">
      <h2 class="ax-section pr-repo-head" id="${escapeHtml(id)}"><a href="${escapeHtml(pullRequestsPath(data.repository))}">${escapeHtml(data.repository.fullName)}${icon("chevron", 16, "ax-chev")}</a></h2>
      ${unverifiedBanner(data.refresh, hasData, true)}
      ${sections(data, "h3", `${id}-`)}
    </section>`;
  }).join("");
  const freshest = repositories
    .map((data) => data.refresh?.lastSuccessAt)
    .filter((value): value is string => Boolean(value))
    .sort()[0];
  let content: string;
  if (repositories.length === 0) {
    content = emptyCard({
      title: "No Repositories yet",
      body: "Add a Repository to see its open pull requests and GitHub stacks here.",
      glyph: "folder",
      actionHtml: button({ label: "Add a Repository", href: "/repositories/new", icon: "plus" }),
    });
  } else if (!blocks) {
    content = noPullRequests(filtered
      ? `${filtered.fullName} has no open pull requests or GitHub stacks right now.`
      : "Open pull requests and GitHub stacks from your Repositories show up here.");
  } else {
    content = blocks;
  }
  const fresh = repositories.length > 0 && freshest
    ? `<p class="pr-fresh">Showing what Atlas last saw; the oldest GitHub check was ${relativeTime(freshest)}. Atlas only reads pull requests; it never changes them.</p>`
    : "";

  return renderShell({
    title: "Pull requests",
    csrfToken,
    inbox,
    tab: "prs",
    header: {
      title: "Pull requests",
      filter: true,
      description: filtered
        ? `Open pull requests and GitHub stacks in ${filtered.fullName}.`
        : "Open pull requests and GitHub stacks across your Repositories.",
    },
    content: `<div class="pr-page pr-all">${content}${fresh}</div>`,
  });
};
