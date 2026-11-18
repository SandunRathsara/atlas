import type { RefreshState, Repository, Session, Spec } from "../persistence.ts";
import { escapeHtml, safeExternalUrl } from "./html.ts";
import {
  ageShort,
  banner,
  button,
  emptyCard,
  group,
  heroCard,
  icon,
  notLiveTag,
  plainTile,
  prose,
  relativeTime,
  repositoryPage,
  repositoryLink,
  row,
  rowEnd,
  sectionHeader,
  sessionLabel,
  sessionPill,
  sessionsLink,
  sessionTargetLabel,
  statusForSession,
  statusTile,
} from "./shared.ts";
import { renderShell, type InboxContext } from "./shell.ts";
import { startTargetOptions } from "./targets.ts";

export const specHref = (spec: Pick<Spec, "repositoryId" | "issueNumber">) =>
  `/repositories/${encodeURIComponent(spec.repositoryId)}/specs/${encodeURIComponent(spec.issueNumber)}`;

/** "2d ago" / "just now" as plain text (safe inside links, unlike the focusable `relativeTime`). */
const ago = (iso: string | null | undefined) => {
  const age = ageShort(iso);
  return age === "" ? "" : age === "now" ? "just now" : `${age} ago`;
};

const isRetained = (spec: Spec) => !(spec.isCurrent && spec.state === "open" && spec.hasSpecLabel && !spec.isPullRequest);

const UNFINISHED = new Set(["queued", "preparing", "running", "waiting", "idle"]);
export const isUnfinished = (session: Session) => UNFINISHED.has(session.state);

// ── Spec Markdown ─────────────────────────────────────────────────────────
// Escape first, then add a small, fixed set of tags. Raw HTML in the issue body is never passed
// through; links only keep http(s) URLs and open in a new tab without referrer.

const unescapeUrl = (value: string) =>
  value.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

const inlineMarkdown = (escaped: string) => {
  const tokens: string[] = [];
  const keep = (html: string) => `\u0000${tokens.push(html) - 1}\u0000`;
  const link = (rawUrl: string, labelHtml: string) => {
    const url = safeExternalUrl(unescapeUrl(rawUrl));
    return url ? keep(`<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${labelHtml}</a>`) : labelHtml;
  };
  let text = escaped
    .replace(/`([^`]+)`/g, (_, code: string) => keep(`<code>${code}</code>`))
    .replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_, alt: string, url: string) => link(url, alt || "Image"))
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label: string, url: string) => link(url, label))
    .replace(/https?:\/\/[^\s<\u0000]+/g, (match: string) => {
      const trimmed = match.replace(/[.,;:!?)]+$/, "");
      return link(trimmed, trimmed) + match.slice(trimmed.length);
    });
  text = text
    .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
    .replace(/__([^_\n]+)__/g, "<strong>$1</strong>")
    .replace(/(^|[^\w*])\*([^*\s][^*\n]*?)\*(?!\w)/g, "$1<em>$2</em>")
    .replace(/(^|[^\w])_([^_\s][^_\n]*?)_(?!\w)/g, "$1<em>$2</em>")
    .replace(/~~([^~\n]+)~~/g, "<del>$1</del>");
  return text.replace(/\u0000(\d+)\u0000/g, (_, index: string) => tokens[Number(index)] ?? "");
};

const taskItem = (html: string) =>
  html.replace(/^\[( |x|X)\]\s+/, (_, mark: string) => `<span aria-hidden="true">${mark === " " ? "☐" : "☑"}</span> <span class="sr-only">${mark === " " ? "Not done:" : "Done:"}</span> `);

/** Renders a GitHub issue body as sanitized prose HTML. */
export const renderSpecMarkdown = (body: string) => {
  const lines = escapeHtml(body.replace(/<!--[\s\S]*?-->/g, "")).split(/\r?\n/);
  const out: string[] = [];
  let paragraph: string[] = [];
  let list: { type: "ul" | "ol"; items: string[] } | undefined;
  let quote: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length) out.push(`<p>${paragraph.map(inlineMarkdown).join("<br>")}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (list) out.push(`<${list.type}>${list.items.map((item) => `<li>${taskItem(inlineMarkdown(item))}</li>`).join("")}</${list.type}>`);
    list = undefined;
  };
  const flushQuote = () => {
    if (quote.length) out.push(`<blockquote>${quote.map(inlineMarkdown).join("<br>")}</blockquote>`);
    quote = [];
  };
  const flushAll = () => {
    flushParagraph();
    flushList();
    flushQuote();
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const fence = /^\s*(```|~~~)/.exec(line);
    if (fence) {
      flushAll();
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index]!.trimStart().startsWith(fence[1]!)) {
        code.push(lines[index]!);
        index += 1;
      }
      out.push(`<pre><code>${code.join("\n")}</code></pre>`);
      continue;
    }
    if (line.trim() === "") {
      flushAll();
      continue;
    }
    const heading = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (heading) {
      flushAll();
      const tag = heading[1]!.length <= 2 ? "h3" : "h4";
      out.push(`<${tag}>${inlineMarkdown(heading[2]!)}</${tag}>`);
      continue;
    }
    if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) {
      flushAll();
      out.push("<hr>");
      continue;
    }
    if (/^\s*\|/.test(line) && /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(lines[index + 1] ?? "")) {
      flushAll();
      const cells = (text: string) => text.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => inlineMarkdown(cell.trim()));
      const header = cells(line);
      const body: string[][] = [];
      index += 2;
      while (index < lines.length && /^\s*\|/.test(lines[index]!)) {
        body.push(cells(lines[index]!));
        index += 1;
      }
      index -= 1;
      out.push(`<div class="sp-table"><table><thead><tr>${header.map((cell) => `<th scope="col">${cell}</th>`).join("")}</tr></thead><tbody>${body.map((cells) => `<tr>${cells.map((cell) => `<td>${cell}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`);
      continue;
    }
    const quoted = /^\s{0,3}&gt;\s?(.*)$/.exec(line);
    if (quoted) {
      flushParagraph();
      flushList();
      quote.push(quoted[1]!);
      continue;
    }
    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
    const ordered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (bullet || ordered) {
      flushParagraph();
      flushQuote();
      const type = bullet ? "ul" : "ol";
      if (list && list.type !== type) flushList();
      list ??= { type, items: [] };
      list.items.push((bullet ?? ordered)![1]!);
      continue;
    }
    if (list && /^\s+\S/.test(line)) {
      list.items[list.items.length - 1] += ` ${line.trim()}`;
      continue;
    }
    flushList();
    flushQuote();
    paragraph.push(line.trim());
  }
  flushAll();
  return out.join("");
};

const specProse = (spec: Spec) =>
  spec.body.trim()
    ? prose(renderSpecMarkdown(spec.body))
    : `<div class="ax-prose sp-prose-empty">This issue has no description on GitHub.</div>`;

// ── Freshness ─────────────────────────────────────────────────────────────

const refreshPending = (refresh: RefreshState) => refresh.requestedGeneration > refresh.completedGeneration;

/** Honest amber/blue note for the Specs read. Empty when the data is current. */
export const specsFreshnessNote = (refresh: RefreshState | undefined, count: number) => {
  const seen = count > 0;
  if (!refresh || refresh.availability === "never") {
    return banner({
      tone: "info",
      title: "Specs haven’t loaded yet",
      body: "Atlas hasn’t finished its first read from GitHub, so it won’t show an empty list it hasn’t checked.",
    });
  }
  const last = ago(refresh.lastSuccessAt);
  if (refreshPending(refresh)) {
    return banner({
      title: "Checking GitHub for changes",
      body: seen ? `Showing Specs from the last complete check${last ? `, ${last}` : ""}.` : "No complete Specs check has finished yet.",
    });
  }
  if (refresh.availability === "unavailable" || refresh.availability === "partial") {
    return banner({
      role: "alert",
      title: "Couldn’t check GitHub just now",
      body: seen
        ? `Showing the ${count} Spec${count === 1 ? "" : "s"} Atlas saw at its last complete check${last ? `, ${last}` : ""}. Nothing was removed.`
        : "No complete Specs check has finished yet, so Atlas can’t list them.",
    });
  }
  if (refresh.lastSuccessAt && Date.now() - new Date(refresh.lastSuccessAt).valueOf() >= 10 * 60 * 1000) {
    return banner({ role: "alert", title: "Specs haven’t been checked for a while", body: `The last complete check was ${last}.` });
  }
  if (refresh.failureReason) return banner({ body: refresh.failureReason });
  return "";
};

const checkedLine = (label: string, refresh: RefreshState | undefined) =>
  refresh?.lastSuccessAt ? `${label} checked ${relativeTime(refresh.lastSuccessAt)}` : `${label} not checked yet`;

// ── Specs list inside a Repository ────────────────────────────────────────

export const renderSpecsPage = ({
  csrfToken,
  repository,
  specs,
  specsRefresh,
  inbox,
}: {
  csrfToken: string;
  repository: Repository;
  specs: Spec[];
  sessionsBySpec?: ReadonlyMap<string, Session[]>;
  accessRefresh?: RefreshState;
  specsRefresh?: RefreshState;
  inbox?: InboxContext;
}) => {
  const canShowEmptyState = specsRefresh?.availability === "available"
    && specsRefresh.requestedGeneration <= specsRefresh.completedGeneration;
  const list = specs.length > 0
    ? group(
      specs.map((spec) => row({
        title: spec.title,
        href: specHref(spec),
        tileHtml: plainTile("doc"),
        sub: `Spec #${spec.issueNumber}${spec.updatedAt ? ` · updated ${ago(spec.updatedAt)}` : ""}`,
        chevron: true,
      })),
      { label: "Open Specs" },
    )
    : canShowEmptyState
      ? emptyCard({
        title: "No Specs yet",
        bodyHtml: `Open GitHub issues labelled <code class="ax-mono">spec</code> show up here.`,
        glyph: "doc",
      })
      : "";

  const page = repositoryPage(repository, "specs", csrfToken);
  return renderShell({
    title: `${repository.fullName} Specs`,
    csrfToken,
    inbox,
    tab: "repos",
    header: page.header,
    content: `${page.intro}
      <div class="sp-list">
        ${specsFreshnessNote(specsRefresh, specs.length)}
        ${list}
        <p class="sp-fresh">${checkedLine("Specs", specsRefresh)}</p>
      </div>`,
  });
};

// ── Spec page ─────────────────────────────────────────────────────────────

/** Why this Spec can't start a Session right now, or undefined when it can. */
const startBlock = (repository: Repository, spec: Spec) => {
  if (isRetained(spec)) {
    return { title: "Can’t start a Session", reason: "This issue is no longer an open Spec on GitHub. Atlas shows the last copy it saw." };
  }
  const status = startTargetOptions(repository)[0]!.status;
  if (status.kind !== "eligible") {
    return {
      title: status.kind === "warning" ? "Can’t start a Session right now" : "Can’t start Sessions here",
      reason: status.reason,
    };
  }
  return undefined;
};

const sessionSub = (session: Session) => {
  if (session.resultPullRequestNumber) return `PR #${session.resultPullRequestNumber} · ${sessionTargetLabel(session)}`;
  if (session.stateReason && (session.state === "failed" || session.state === "failed_setup" || session.state === "interrupted")) {
    return session.stateReason;
  }
  return sessionTargetLabel(session);
};

const sessionRows = (sessions: Session[]) => group(
  sessions.map((session, index) => row({
    title: `Attempt ${sessions.length - index}`,
    href: `/sessions/${encodeURIComponent(session.atlasId)}`,
    tileHtml: statusTile(statusForSession(session.state), "sm"),
    sub: `${sessionSub(session)} · ${ago(session.submittedAt) || "started"}`,
    endHtml: rowEnd({ pillHtml: sessionPill(session.state, session.opencodeFreshness === "stale") }),
    chevron: true,
  })),
  { label: "Sessions for this Spec" },
);

const unfinishedHero = (session: Session) => {
  const status = statusForSession(session.state);
  return `<div class="sp-current">${heroCard({
    status,
    kicker: sessionLabel(session.state),
    title: "This Spec has an unfinished Session",
    subHtml: `<div class="ax-hero-s">${session.opencodeFreshness === "stale" ? `${notLiveTag()} ` : ""}Started ${escapeHtml(ago(session.submittedAt) || "recently")}. Atlas runs one unfinished Session per Spec, so a new one can’t start until it ends.</div>`,
    actionHtml: button({ label: "Open Session", href: `/sessions/${encodeURIComponent(session.atlasId)}`, icon: "chevron" }),
    warm: session.state === "waiting",
  })}</div>`;
};

export const renderSpecDetailPage = ({
  csrfToken,
  repository,
  spec,
  sessions,
  accessRefresh,
  specsRefresh,
  inbox,
}: {
  csrfToken: string;
  repository: Repository;
  spec: Spec;
  sessions?: Session[];
  accessRefresh?: RefreshState;
  specsRefresh?: RefreshState;
  inbox?: InboxContext;
}) => {
  const githubUrl = safeExternalUrl(spec.htmlUrl);
  const history = sessions ?? [];
  const unfinished = history.find(isUnfinished);
  const blocked = startBlock(repository, spec);
  const canStart = !blocked && !unfinished;
  const startHref = `${specHref(spec)}/sessions/new`;
  const startButton = (block: boolean) => button({ label: "Start Session", href: startHref, icon: "play", block });
  const githubButton = githubUrl
    ? button({ label: "GitHub", variant: "outline", href: githubUrl, icon: "external", attrs: 'target="_blank" rel="noopener noreferrer"', ariaLabel: "Open issue on GitHub" })
    : "";
  // Phones and tablets: GitHub and Repository Sessions live in the ⋯ menu; desktop shows buttons instead.
  const menu = {
    title: spec.title,
    items: [
      ...(githubUrl ? [{ label: "Open issue on GitHub", href: githubUrl, external: true }] : []),
      { label: "Repository Sessions", href: sessionsLink(repository), icon: "sparkle" as const },
    ],
  };
  const labels = spec.labels.length > 0
    ? `<div class="sp-labels" aria-label="Labels">${spec.labels.map((label) => `<span${label === "spec" ? ' class="sp-label-spec"' : ""}>${escapeHtml(label)}</span>`).join("")}</div>`
    : "";
  const accessStale = accessRefresh && (accessRefresh.availability === "unavailable" || accessRefresh.availability === "partial");
  const note = blocked
    ? `<div class="sp-note" role="status">${icon("warn", 18)}<div><b>${escapeHtml(blocked.title)}</b>${escapeHtml(blocked.reason)}</div></div>`
    : "";

  return renderShell({
    title: `Spec #${spec.issueNumber}`,
    csrfToken,
    inbox,
    tab: "repos",
    bodyClass: "sp-detail",
    header: {
      title: spec.title,
      back: { href: repositoryLink(repository), label: repository.name },
      actionsHtml: `<span class="sp-wide">${githubButton}${canStart ? startButton(false) : ""}</span>`,
      menu,
    },
    startBar: canStart ? startButton(true) : undefined,
    content: `<p class="sp-meta">Spec #${escapeHtml(spec.issueNumber)} · ${escapeHtml(repository.fullName)}${spec.updatedAt ? ` · updated <time datetime="${escapeHtml(spec.updatedAt)}">${escapeHtml(ago(spec.updatedAt))}</time>` : ""}</p>
      ${labels}
      ${note}
      ${unfinished ? unfinishedHero(unfinished) : ""}
      ${specsFreshnessNote(specsRefresh, 1)}
      ${accessStale ? banner({ title: "Couldn’t check GitHub access just now", body: "Showing the last data Atlas saw. This doesn’t mean access was removed." }) : ""}
      <div class="sp-cols">
        <section class="sp-col-spec" aria-labelledby="spec-body-title">
          ${sectionHeader({ title: "Spec", id: "spec-body-title" })}
          ${specProse(spec)}
        </section>
        <section class="sp-col-sessions" aria-labelledby="spec-sessions-title">
          ${sectionHeader({ title: "Sessions", count: history.length || undefined, id: "spec-sessions-title", more: { href: sessionsLink(repository), label: "All in Repository" } })}
          ${history.length > 0
            ? sessionRows(history)
            : emptyCard({
              title: "No Sessions yet",
              body: canStart ? "Start one to have the Agent work on this Spec." : "Sessions for this Spec will show up here.",
              glyph: "sparkle",
            })}
        </section>
      </div>`,
  });
};

// ── Specs unavailable ─────────────────────────────────────────────────────

export const renderSpecUnavailablePage = ({
  csrfToken,
  repository,
  specsRefresh,
  inbox,
}: {
  csrfToken: string;
  repository: Repository;
  accessRefresh?: RefreshState;
  specsRefresh?: RefreshState;
  inbox?: InboxContext;
}) => {
  const page = repositoryPage(repository, "specs", csrfToken);
  return renderShell({
  title: `${repository.fullName} Specs unavailable`,
  csrfToken,
  inbox,
  tab: "repos",
  header: page.header,
  content: `${page.intro}
    <div class="sp-list">
      ${banner({
        role: "alert",
        title: "Couldn’t load Specs from GitHub",
        body: "Atlas hasn’t completed a read of this Repository’s Specs, so it can’t show them yet. It won’t show an empty list it hasn’t checked. Try again in a moment.",
      })}
      <div class="sp-actions">${button({ label: "Try again", href: repositoryLink(repository), variant: "outline", icon: "refresh" })}</div>
      <p class="sp-fresh">${checkedLine("Specs", specsRefresh)}</p>
    </div>`,
  });
};
