import type { RefreshState, Repository, Session } from "../persistence.ts";
import { DEFAULT_VIEWER_MESSAGE_LIMIT } from "../session-viewer.ts";
import type { SessionViewerProjection, ViewerSessionNode } from "../session-viewer.ts";
import { escapeHtml, formatTime, safeExternalUrl } from "./html.ts";
import {
  accessNotice,
  alertSoft,
  emptyState,
  handoffCheckpointLabel,
  openCodeReadinessNotice,
  pageHeader,
  persistenceHealthNotice,
  publicationMarkup,
  recordTable,
  repositoryAction,
  sessionBadgeClass,
  sessionFreshnessMarkup,
  sessionRecoveryNotice,
  sessionsLink,
  sessionStateLabel,
  sessionTargetLabel,
  statusBadge,
  targetReconfirmationNeeded,
} from "./shared.ts";
import { renderShell } from "./shell.ts";

const viewerJson = (value: unknown) => {
  try {
    return escapeHtml(JSON.stringify(value, null, 2) ?? "[unavailable]");
  } catch {
    return "[unavailable]";
  }
};

const viewerTimestamp = (value: number | undefined) => value === undefined
  ? "Unknown time"
  : formatTime(new Date(value).toISOString());

const viewerStatusLabel = (state: ViewerSessionNode["semanticState"]) => {
  if (state === "running") return "Running";
  if (state === "waiting") return "Waiting";
  if (state === "succeeded") return "Succeeded";
  if (state === "failed") return "Failed";
  if (state === "interrupted") return "Interrupted";
  return "Idle";
};

const viewerStatusClass = (state: ViewerSessionNode["semanticState"]) => {
  if (state === "running") return "badge-info";
  if (state === "waiting") return "badge-warning";
  if (state === "succeeded") return "badge-success";
  if (state === "failed" || state === "interrupted") return "badge-error";
  return "badge-neutral";
};

const codeWell = "max-w-full overflow-x-auto whitespace-pre-wrap break-words rounded-box bg-base-300 p-3 font-mono text-sm leading-normal";
const messageFrame = "rounded-box border border-edge bg-base-100 p-4 text-sm";

const renderToolContent = (content: readonly { type: string; text?: string; uri?: string; mime?: string; name?: string | null }[] | undefined) =>
  content && content.length > 0
    ? `<ul class="mt-3 grid gap-2" aria-label="Tool output">${content.map((item) => {
      if (item.type === "file") {
        const link = item.uri ? safeExternalUrl(item.uri) : "";
        return `<li class="rounded-field border border-edge px-3 py-3 text-sm"><span class="font-medium">File</span> · ${escapeHtml(item.name ?? item.uri ?? "unnamed")} <span class="text-muted">${escapeHtml(item.mime ?? "unknown type")}</span>${link ? ` · <a class="text-brand-readable underline decoration-brand-readable/50 underline-offset-4" href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer">Open safe link</a>` : ""}</li>`;
      }
      return `<li><pre class="${codeWell}">${escapeHtml(item.text ?? "")}</pre></li>`;
    }).join("")}</ul>`
    : "";

const renderTool = (tool: Extract<NonNullable<Extract<ViewerSessionNode["messages"][number], { type: "assistant" }>["content"]>[number], { type: "tool" }>) => {
  const state = tool.state;
  const stateLabel = state.status === "streaming" ? "Streaming input" : state.status === "running" ? "Running" : state.status === "completed" ? "Completed" : "Error";
  const input = state.status === "streaming" ? state.input : state.input;
  const details = state.status === "streaming"
    ? `<pre class="mt-3 ${codeWell}">${escapeHtml(String(input))}</pre>`
    : `<dl class="mt-3 grid gap-3 text-sm sm:grid-cols-2"><div><dt class="font-medium text-muted">Input</dt><dd class="mt-1"><pre class="${codeWell}">${viewerJson(input)}</pre></dd></div>${state.status === "running" ? `<div><dt class="font-medium text-muted">Progress</dt><dd class="mt-1"><pre class="${codeWell}">${viewerJson(state.metadata)}</pre></dd></div>` : ""}</dl>`;
  const output = state.status === "completed" || state.status === "error" ? renderToolContent(state.content) : "";
  const error = state.status === "error"
    ? `<div class="alert alert-error alert-soft mt-3 leading-normal" role="alert"><strong>${escapeHtml(state.error.type)}</strong>: ${escapeHtml(state.error.message)}</div>`
    : "";
  const badgeClass = state.status === "error"
    ? "badge-error"
    : state.status === "completed"
      ? "badge-success"
      : state.status === "running"
        ? "badge-info"
        : "badge-warning";
  return `<article class="mt-4 rounded-box border border-edge bg-base-100 p-4" data-tool-id="${escapeHtml(tool.id)}">
    <div class="flex flex-wrap items-center justify-between gap-3"><h4 class="break-words font-medium">Tool · ${escapeHtml(tool.name)}</h4>${statusBadge(badgeClass, stateLabel)}</div>
    ${details}${error}${output}
  </article>`;
};

const renderAssistantContent = (message: Extract<ViewerSessionNode["messages"][number], { type: "assistant" }>) => message.content.map((part) => {
  if (part.type === "text") return `<div class="mt-4 whitespace-pre-wrap break-words leading-normal">${escapeHtml(part.text)}</div>`;
  if (part.type === "reasoning") {
    return `<details class="mt-4 rounded-box border border-edge bg-base-100 p-4" open><summary class="cursor-pointer font-medium">Public reasoning</summary><div class="mt-3 whitespace-pre-wrap break-words leading-normal text-muted">${escapeHtml(part.text) || "No public reasoning text was exposed."}</div></details>`;
  }
  return renderTool(part);
}).join("");

type UserMessage = Extract<ViewerSessionNode["messages"][number], { type: "user" }>;

const renderUserAttachments = (message: UserMessage) => {
  if (!message.files || message.files.length === 0) return "";
  return `<section class="mt-5" aria-label="User attachments"><h4 class="font-medium">Attachments</h4><ul class="mt-3 grid gap-2">${message.files.map((file) => {
    const source = file.source.type === "inline"
      ? "Inline attachment"
      : safeExternalUrl(file.source.uri)
        ? `<a class="text-brand-readable underline decoration-brand-readable/50 underline-offset-4" href="${escapeHtml(safeExternalUrl(file.source.uri))}" target="_blank" rel="noopener noreferrer">Open safe source</a>`
        : "Referenced source (not linked)";
    return `<li class="rounded-field border border-edge px-3 py-3 text-sm"><p class="break-words font-medium">${escapeHtml(file.name ?? "Unnamed attachment")}</p><p class="mt-1 text-muted">${escapeHtml(file.mime)} · ${source}</p>${file.description ? `<p class="mt-2 whitespace-pre-wrap break-words">${escapeHtml(file.description)}</p>` : ""}</li>`;
  }).join("")}</ul></section>`;
};

const shellOutputHref = (node: ViewerSessionNode, rootId: string, endpoint: string, limit: number, requestUrl: string | undefined, shellId: string, cursor: number) => {
  const url = new URL(requestUrl ?? endpoint, "http://atlas.invalid");
  if (node.info.id === rootId) url.searchParams.delete("child");
  else url.searchParams.set("child", node.info.id);
  url.searchParams.set("shell", shellId);
  url.searchParams.set("shellCursor", String(cursor));
  url.searchParams.set("limit", String(limit));
  return `${url.pathname}${url.search}`;
};

const requestedShellOutputCursor = (requestUrl: string | undefined, shellId: string) => {
  try {
    const value = new URL(requestUrl ?? "", "http://atlas.invalid").searchParams;
    if (value.get("shell") !== shellId) return 0;
    const cursor = Number(value.get("shellCursor") ?? "0");
    return Number.isSafeInteger(cursor) && cursor >= 0 ? cursor : 0;
  } catch {
    return 0;
  }
};

const shellOutputHasMore = (output: { cursor: number; size: number }) =>
  Number.isSafeInteger(output.cursor) && Number.isSafeInteger(output.size) && output.cursor >= 0 && output.cursor < output.size;

const nextShellOutputCursor = (output: { cursor: number; size: number }, requestedCursor = 0) =>
  shellOutputHasMore(output) && output.cursor > requestedCursor ? output.cursor : undefined;

const renderShellOutput = (
  output: { output: string; cursor: number; size: number; truncated: boolean },
  nextHref?: string,
  requestedCursor = 0,
) => {
  const more = shellOutputHasMore(output);
  const stalled = more && output.cursor <= requestedCursor;
  const warning = more
    ? `<div class="alert alert-warning alert-soft mt-3 leading-normal" role="status"><strong>${output.truncated ? "Output is capped in this projection; more output is available." : "Output continues in a later page."}</strong> This page ends at byte ${escapeHtml(String(output.cursor))} of ${escapeHtml(String(output.size))}.${nextHref ? ` <a class="link link-hover font-medium" href="${escapeHtml(nextHref)}">Load next output page</a>.` : stalled ? " The upstream cursor did not advance, so no continuation link is offered." : ""}</div>`
    : "";
  return `<pre class="mt-4 max-w-full overflow-x-auto whitespace-pre-wrap break-words rounded-box bg-base-300 p-4 font-mono text-sm leading-normal">${escapeHtml(output.output)}</pre>${warning}`;
};

const renderViewerMessage = (message: ViewerSessionNode["messages"][number], nextShellOutputHref?: string, requestedShellCursor = 0) => {
  const time = viewerTimestamp(message.time.created);
  if (message.type === "assistant") {
    return `<li class="${messageFrame}" data-message-id="${escapeHtml(message.id)}"><div class="flex flex-wrap items-center justify-between gap-3"><h3 class="font-medium">Assistant</h3><time class="text-sm text-muted" datetime="${escapeHtml(new Date(message.time.created).toISOString())}">${escapeHtml(time)}</time></div>${renderAssistantContent(message)}${message.error ? `<div class="alert alert-error alert-soft mt-4 leading-normal" role="alert"><strong>${escapeHtml(message.error.type)}</strong>: ${escapeHtml(message.error.message)}</div>` : ""}${message.retry ? `<p class="mt-4 text-sm text-warning">Retry ${message.retry.attempt} scheduled: ${escapeHtml(message.retry.error.message)}</p>` : ""}</li>`;
  }
  if (message.type === "user") {
    return `<li class="${messageFrame}" data-message-id="${escapeHtml(message.id)}"><div class="flex flex-wrap items-center justify-between gap-3"><h3 class="font-medium">User message</h3><time class="text-sm text-muted">${escapeHtml(time)}</time></div><div class="mt-4 whitespace-pre-wrap break-words leading-normal">${escapeHtml(message.text)}</div>${renderUserAttachments(message)}</li>`;
  }
  if (message.type === "shell") {
    const shellBadge = message.status === "exited" ? "badge-success" : message.status === "running" ? "badge-info" : "badge-warning";
    return `<li class="${messageFrame}" data-message-id="${escapeHtml(message.id)}"><div class="flex flex-wrap items-center justify-between gap-3"><h3 class="font-medium">Session shell · ${escapeHtml(message.command)}</h3>${statusBadge(shellBadge, message.status)}</div><p class="mt-2 text-sm text-muted">${escapeHtml(time)}${message.exit !== undefined ? ` · exit ${escapeHtml(String(message.exit))}` : ""}</p>${message.output ? renderShellOutput(message.output, nextShellOutputHref, requestedShellCursor) : `<p class="mt-4 text-sm text-muted">Shell output is not present in this projection.</p>`}</li>`;
  }
  if (message.type === "compaction") {
    return `<li class="${messageFrame}" data-message-id="${escapeHtml(message.id)}"><div class="flex flex-wrap items-center justify-between gap-3"><h3 class="font-medium">Context compaction</h3>${statusBadge("badge-warning", message.status)}</div><p class="mt-3 whitespace-pre-wrap break-words leading-normal">${escapeHtml(message.status === "failed" ? message.error.message : message.summary)}</p></li>`;
  }
  if (message.type === "system" || message.type === "synthetic") {
    return `<li class="${messageFrame}" data-message-id="${escapeHtml(message.id)}"><h3 class="font-medium">${message.type === "system" ? "System" : "Synthetic"}</h3><p class="mt-3 whitespace-pre-wrap break-words leading-normal">${escapeHtml(message.text)}</p></li>`;
  }
  if (message.type === "skill") {
    return `<li class="${messageFrame}" data-message-id="${escapeHtml(message.id)}"><h3 class="font-medium">Skill · ${escapeHtml(message.name)}</h3><p class="mt-3 whitespace-pre-wrap break-words leading-normal">${escapeHtml(message.text)}</p></li>`;
  }
  if (message.type === "agent-switched") {
    return `<li class="${messageFrame}" data-message-id="${escapeHtml(message.id)}"><p class="font-medium">Agent selected: <code class="font-mono">${escapeHtml(message.agent)}</code></p></li>`;
  }
  if (message.type === "model-switched") {
    return `<li class="${messageFrame}" data-message-id="${escapeHtml(message.id)}"><p class="font-medium">Model selected: <code class="font-mono">${escapeHtml(message.model.providerID)}/${escapeHtml(message.model.id)}</code></p></li>`;
  }
  return `<li class="${messageFrame}" data-message-id="${escapeHtml(message.id)}"><p class="font-medium">Location changed</p><p class="mt-2 text-sm text-muted">${escapeHtml(message.location.directory)}</p></li>`;
};

const renderViewerPending = (node: ViewerSessionNode) => {
  const { permissions, forms, inbox } = node.pending;
  if (permissions.length === 0 && forms.length === 0 && inbox.length === 0) return "";
  return `<section class="mt-8" aria-labelledby="pending-${escapeHtml(node.info.id)}"><h3 id="pending-${escapeHtml(node.info.id)}" class="text-base font-semibold">Pending OpenCode work</h3><p class="mt-2 text-sm leading-normal text-muted">These records are displayed view-only. Atlas does not reply, cancel, or resume them.</p>${permissions.length > 0 ? `<div class="mt-4 rounded-box border border-edge bg-base-100 p-4"><h4 class="font-medium">Permission requests</h4><ul class="mt-3 grid gap-3">${permissions.map((permission) => `<li class="rounded-field border border-edge p-3"><p class="font-medium">${escapeHtml(permission.action)}</p><p class="mt-1 break-words text-sm text-muted">${escapeHtml(permission.resources.join(", "))}</p>${permission.message ? `<p class="mt-2 whitespace-pre-wrap break-words text-sm">${escapeHtml(permission.message)}</p>` : ""}</li>`).join("")}</ul></div>` : ""}${forms.length > 0 ? `<div class="mt-4 rounded-box border border-edge bg-base-100 p-4"><h4 class="font-medium">Forms</h4><ul class="mt-3 grid gap-3">${forms.map((form) => `<li class="rounded-field border border-edge p-3"><p class="font-medium">${escapeHtml(form.title)}</p><p class="mt-1 text-sm text-muted">${form.fields.length} field${form.fields.length === 1 ? "" : "s"} · response controls are disabled</p></li>`).join("")}</ul></div>` : ""}${inbox.length > 0 ? `<div class="mt-4 rounded-box border border-edge bg-base-100 p-4"><h4 class="font-medium">Queued inbox work</h4><p class="mt-2 text-sm leading-normal text-muted">Inbox work is not treated as proof that a person is being asked to respond.</p><p class="mt-2 text-sm">${inbox.length} queued item${inbox.length === 1 ? "" : "s"}</p></div>` : ""}</section>`;
};

const descendantStateLabel = (child: ViewerSessionNode) =>
  child.activeSubagent ? "Active subagent" : child.active ? "Active child Session" : "Child Session";

const descendantStateClass = (child: ViewerSessionNode) =>
  child.activeSubagent ? "badge-info" : child.active ? "badge-warning" : "badge-neutral";

const renderViewerDescendants = (
  node: ViewerSessionNode,
  selectedId: string,
  endpoint: string,
  limit: number,
) => {
  if (node.children.length === 0) return "";
  const records = node.children.map((child) => {
    const href = `${endpoint}?child=${encodeURIComponent(child.info.id)}&limit=${limit}`;
    const current = child.info.id === selectedId ? ' aria-current="page"' : "";
    const identity = `<p class="break-words font-medium">${escapeHtml(child.info.title ?? "Untitled child Session")}</p>
      <p class="mt-1 break-all font-mono text-xs text-faint">${escapeHtml(child.info.id)}</p>`;
    const badges = `<span class="flex flex-wrap items-center gap-1">${statusBadge(descendantStateClass(child), descendantStateLabel(child))}${child.agentMode ? statusBadge("badge-neutral", `agent: ${child.agentMode}`) : ""}</span>`;
    const action = `<a class="btn btn-ghost btn-xs" href="${escapeHtml(href)}"${current}>Open child Session</a>`;
    return {
      row: `<tr>
        <td>${identity}</td>
        <td>${badges}</td>
        <td>${action}</td>
      </tr>`,
      stacked: `<li class="p-3">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div class="min-w-0">${identity}</div>
          ${badges}
        </div>
        <div class="mt-3">${action}</div>
      </li>`,
    };
  });
  return `<section class="mt-8" aria-labelledby="descendants-${escapeHtml(node.info.id)}">
    <h3 id="descendants-${escapeHtml(node.info.id)}" class="text-base font-semibold">Descendant Sessions</h3>
    <p class="mt-2 text-sm leading-normal text-muted">Relationships are verified through OpenCode Session records. A child is called an active subagent only when active execution and its agent mode both support that label.</p>
    ${recordTable({
      label: "Descendant Sessions",
      headers: ["Session", "State", "Actions"],
      rows: records.map((record) => record.row),
      stacked: records.map((record) => record.stacked),
    })}
  </section>`;
};

const renderViewerShells = (node: ViewerSessionNode, rootId: string, endpoint: string, limit: number, requestUrl?: string) => {
  if (node.shells.length === 0) return "";
  const records = node.shells.map((shell) => {
    const requestedCursor = requestedShellOutputCursor(requestUrl, shell.info.id);
    const nextCursor = shell.output ? nextShellOutputCursor(shell.output, requestedCursor) : undefined;
    const output = shell.output
      ? renderShellOutput(
        shell.output,
        nextCursor === undefined ? undefined : shellOutputHref(node, rootId, endpoint, limit, requestUrl, shell.info.id, nextCursor),
        requestedCursor,
      )
      : shell.outputUnavailable
        ? `<p class="mt-4 text-sm text-warning">Shell output is currently unavailable.</p>`
        : "";
    const command = `<code class="break-words font-mono">${escapeHtml(shell.info.command)}</code>`;
    const badge = statusBadge("badge-info", shell.info.status);
    const cwd = escapeHtml(shell.info.cwd);
    return {
      row: `<tr>
        <td>${command}${output}</td>
        <td>${badge}</td>
        <td class="text-muted">${cwd}</td>
      </tr>`,
      stacked: `<li class="p-3">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div class="min-w-0">${command}</div>
          ${badge}
        </div>
        <p class="mt-2 text-sm text-muted">${cwd}</p>
        ${output}
      </li>`,
    };
  });
  return `<section class="mt-8" aria-labelledby="shells-${escapeHtml(node.info.id)}">
    <h3 id="shells-${escapeHtml(node.info.id)}" class="text-base font-semibold">Running generic shells</h3>
    <p class="mt-2 text-sm leading-normal text-muted">Only shells explicitly correlated to this Session are shown. Exited generic shells may not be recoverable after a disconnect.</p>
    ${recordTable({
      label: "Running generic shells",
      headers: ["Command", "State", "Working directory"],
      rows: records.map((record) => record.row),
      stacked: records.map((record) => record.stacked),
    })}
  </section>`;
};

const renderViewerNode = (node: ViewerSessionNode, selectedId: string, rootId: string, endpoint: string, limit: number, requestUrl?: string) => {
  const messagePage = node.messagesLoaded
    ? node.messages.length > 0
      ? `<ol class="mt-5 grid gap-4" aria-label="Session messages">${node.messages.map((message) => {
        const requestedCursor = message.type === "shell" ? requestedShellOutputCursor(requestUrl, message.shellID) : 0;
        const nextCursor = message.type === "shell" && message.output ? nextShellOutputCursor(message.output, requestedCursor) : undefined;
        return renderViewerMessage(message, nextCursor === undefined || message.type !== "shell" ? undefined : shellOutputHref(node, rootId, endpoint, limit, requestUrl, message.shellID, nextCursor), requestedCursor);
      }).join("")}</ol>`
      : emptyState("No messages in this projected page", "An empty final page is valid; it does not imply missing or completed execution.")
    : `<div class="alert alert-warning alert-soft mt-5 leading-normal" role="status">${escapeHtml(node.unavailableReason ?? "Messages are not currently available.")}</div>`;
  const next = node.nextMessageCursor
    ? `<a class="btn btn-ghost mt-5" href="${escapeHtml(`${endpoint}?${new URLSearchParams({ ...(node.info.id !== rootId ? { child: node.info.id } : {}), cursor: node.nextMessageCursor, limit: String(limit) }).toString()}`)}">Load older messages</a>`
    : "";
  return `${renderViewerDescendants(node, selectedId, endpoint, limit)}${renderViewerPending(node)}${renderViewerShells(node, rootId, endpoint, limit, requestUrl)}<section class="mt-8" aria-labelledby="timeline-${escapeHtml(node.info.id)}"><div class="flex flex-wrap items-start justify-between gap-4"><div><h3 id="timeline-${escapeHtml(node.info.id)}" class="text-base font-semibold">${node.info.id === selectedId ? "Message timeline" : "Session messages"}</h3><p class="mt-2 text-sm text-muted">${node.messagesLoaded ? `${node.messages.length} projected message${node.messages.length === 1 ? "" : "s"}` : "Message projection unavailable"} · last OpenCode update ${escapeHtml(viewerTimestamp(node.info.time.updated))}</p></div>${statusBadge(viewerStatusClass(node.semanticState), viewerStatusLabel(node.semanticState))}</div>${messagePage}${next}</section>`;
};

export const renderSessionViewerFragment = ({
  session,
  viewer,
  endpoint,
  eventsEndpoint,
  requestUrl,
  limit: requestedLimit,
}: {
  session: Session;
  viewer?: SessionViewerProjection;
  endpoint: string;
  eventsEndpoint: string;
  requestUrl?: string;
  limit?: number;
}) => {
  const limit = requestedLimit ?? DEFAULT_VIEWER_MESSAGE_LIMIT;
  const freshness = viewer?.freshness ?? "partial";
  const status = freshness === "stale"
    ? `<div class="alert alert-warning alert-soft mt-6 leading-normal" role="status" aria-live="polite" aria-atomic="true" data-viewer-connection-message data-viewer-state="stale" data-viewer-status data-viewer-stale><strong>Stale.</strong> ${escapeHtml(viewer?.staleReason ?? "OpenCode transport or reconciliation is unavailable. Visible content is retained.")}</div>`
    : freshness === "partial"
      ? `<div class="alert alert-warning alert-soft mt-6 leading-normal" role="status" aria-live="polite" aria-atomic="true" data-viewer-connection-message data-viewer-state="partial" data-viewer-status><strong>Partial Session view.</strong> Missing or unavailable projections are shown as partial data, not as empty Session history.</div>`
      : `<div class="sr-only" role="status" aria-live="polite" aria-atomic="true" data-viewer-connection-message data-viewer-state="fresh" data-viewer-status></div>`;
  const partial = viewer?.partialReasons && viewer.partialReasons.length > 0
    ? `<details class="mt-4 rounded-box border border-edge bg-base-100 p-4" data-viewer-notes><summary class="cursor-pointer font-medium">Projection notes</summary><ul class="mt-3 grid gap-2 text-sm leading-normal text-muted">${viewer.partialReasons.map((reason) => `<li>${escapeHtml(reason)}</li>`).join("")}</ul></details>`
    : "";
  const content = viewer?.available && viewer.selected && viewer.root
    ? renderViewerNode(viewer.selected, viewer.selected.info.id, viewer.root.info.id, endpoint, limit, requestUrl)
    : emptyState("OpenCode execution history unavailable", "Atlas retains the Session and does not infer empty or completed Session history from a missing upstream resource.");
  return `<section id="session-viewer" class="mt-8 border-t border-edge pt-8" data-session-viewer data-viewer-freshness="${freshness}" data-session-viewer-url="${escapeHtml(requestUrl ?? endpoint)}" data-session-events-url="${escapeHtml(eventsEndpoint)}" data-session-id="${escapeHtml(session.atlasId)}" aria-labelledby="session-viewer-title">
    <div class="flex flex-wrap items-start justify-between gap-4"><div><p class="text-xs font-medium uppercase tracking-wide text-accent">Terminal desk</p><h2 id="session-viewer-title" class="mt-2 text-base font-semibold">Live Session view</h2><p class="mt-2 max-w-prose text-base leading-normal text-muted">Canonical messages, typed tool activity, pending records, and verified descendants. Atlas provides no execution controls here.</p></div><span class="badge badge-sm ${freshness === "fresh" ? "badge-success" : "badge-warning"}" data-viewer-connection>${freshness === "fresh" ? "Fresh" : freshness === "stale" ? "Stale" : "Partial"}</span></div>
    ${status}${partial}
    <div data-viewer-content>${content}</div>
  </section>`;
};

export const renderSessionDetailPage = ({
  csrfToken,
  repository,
  session,
  viewer,
  pullRequestsRefresh,
  viewerRequestUrl,
  viewerLimit,
  openCodeReadiness,
  persistenceHealth,
  sessionDirectoryAvailable,
}: {
  csrfToken: string;
  repository: Repository;
  session: Session;
  viewer?: SessionViewerProjection;
  pullRequestsRefresh?: RefreshState;
  viewerRequestUrl?: string;
  viewerLimit?: number;
  openCodeReadiness?: { ready: boolean; reason?: string };
  persistenceHealth?: { healthy: boolean; reason?: string | null };
  sessionDirectoryAvailable?: boolean;
}) => {
  const specPath = `/repositories/${encodeURIComponent(repository.githubId)}/specs/${encodeURIComponent(session.specIssueNumber)}`;
  const githubUrl = safeExternalUrl(session.specHtmlUrl);
  const preparationLabel = session.preparationCheckpoint === "intent_saved"
    ? "Intent saved"
    : session.preparationCheckpoint === "clone_started"
      ? "Clone starting"
      : session.preparationCheckpoint === "clone_complete"
        ? "Clone complete"
        : session.preparationCheckpoint === "branch_started"
          ? "Branch starting"
          : session.preparationCheckpoint === "prepared"
            ? "Locally prepared"
            : session.preparationCheckpoint === "start_unconfirmed"
              ? "Start unconfirmed"
              : session.preparationCheckpoint === "failed_setup"
                ? "Setup failed"
                : "Queued";
  const handoffLabel = handoffCheckpointLabel(session.handoffCheckpoint);
  const preparationUnconfirmed = session.preparationCheckpoint === "start_unconfirmed";
  const handoffUnconfirmed = Boolean(session.handoffUncertainReason);
  const preparationNotice = session.state === "failed_setup"
    ? alertSoft("error", "alert", `<div><strong>Preparation failed before OpenCode execution.</strong> ${escapeHtml(session.stateReason ?? "The local setup did not complete.")} Partial resources are retained; Atlas will not delete or replay them.</div>`)
    : preparationUnconfirmed
      ? alertSoft("warning", "alert", `<div><strong>Preparation unconfirmed.</strong> Atlas will not replay an uncertain local operation. ${escapeHtml(session.preparationReason ?? "The recorded directory and preparation checkpoint require manual recovery.")}</div>`)
      : handoffUnconfirmed
        ? alertSoft("warning", "alert", `<div><strong>Start unconfirmed.</strong> Atlas will not replay an uncertain OpenCode create or prompt. ${escapeHtml(session.handoffUncertainReason ?? "The preserved handoff checkpoint requires reconciliation.")}</div>`)
        : session.handoffCheckpoint === "prompt_accepted"
          ? alertSoft("success", "status", `<div><strong>OpenCode handoff accepted.</strong> The initial prompt was accepted once; execution state and outcome remain canonical OpenCode evidence.</div>`)
          : session.preparationCheckpoint === "prepared"
            ? alertSoft("success", "status", `<div><strong>Local preparation complete.</strong> The full clone and working branch are ready. ${session.opencodeFreshness === "stale" ? "Atlas is waiting for a compatible OpenCode service or reconciliation." : "OpenCode handoff is proceeding through durable checkpoints."}</div>`)
            : alertSoft("info", "status", `<div><strong>${session.state === "queued" ? "Queued request accepted." : "Preparation in progress."}</strong> ${escapeHtml(session.stateReason ?? "Atlas is waiting for the next safe preparation step.")}</div>`);

  return renderShell({
    title: `Session ${session.atlasId}`,
    active: "sessions",
    repository,
    csrfToken,
    historyDisabled: true,
    content: `<p class="font-mono text-sm text-muted">${escapeHtml(repository.fullName)}</p>
      <div class="mt-2">${pageHeader({
        title: `Session ${escapeHtml(session.atlasId)}`,
        description: `Spec #${escapeHtml(session.specIssueNumber)}: ${escapeHtml(session.specTitle)}`,
        actions: `${statusBadge(sessionBadgeClass(session.state), sessionStateLabel(session.state))}${sessionFreshnessMarkup(session)}`,
      })}</div>
      ${accessNotice(repository)}
      ${persistenceHealthNotice(persistenceHealth)}
      ${openCodeReadinessNotice(openCodeReadiness)}
      ${sessionRecoveryNotice(session, viewer, sessionDirectoryAvailable)}
      ${preparationNotice}
      ${publicationMarkup(session, pullRequestsRefresh)}
      <div class="mt-8 flex flex-wrap gap-2">
        <a class="btn btn-ghost" href="${specPath}">Back to Spec</a>
        <a class="btn btn-ghost" href="${sessionsLink(repository)}">Repository Sessions</a>
        ${session.reservationState === "held" && ["succeeded", "failed", "interrupted"].includes(session.state) ? `<a class="btn btn-error" href="/sessions/${encodeURIComponent(session.atlasId)}/reservation/release">Review reservation release</a>` : ""}
        ${targetReconfirmationNeeded(session) ? `<a class="btn btn-primary" href="/sessions/${encodeURIComponent(session.atlasId)}/target">Review current target</a>` : ""}
        ${repositoryAction(repository, csrfToken)}
      </div>
      <dl class="mt-8 grid gap-4 border-y border-edge py-5 text-sm sm:grid-cols-2">
        <div><dt class="font-medium text-muted">State</dt><dd class="mt-1">${escapeHtml(sessionStateLabel(session.state))}</dd></div>
        <div><dt class="font-medium text-muted">Submitted</dt><dd class="mt-1">${escapeHtml(formatTime(session.submittedAt))}</dd></div>
        <div><dt class="font-medium text-muted">Queue order</dt><dd class="mt-1 tabular-nums">${session.submissionOrder}</dd></div>
        <div><dt class="font-medium text-muted">Submission identity</dt><dd class="mt-1 break-all font-mono">${escapeHtml(session.submissionId)}</dd></div>
        <div><dt class="font-medium text-muted">Original target</dt><dd class="mt-1">${escapeHtml(session.originalTargetKind === "native_stack" ? `Native stack #${session.originalTargetStackNumber ?? "unknown"}` : session.originalTargetKind === "standalone_parent" ? `Standalone parent #${session.originalTargetParentPullRequestNumber ?? "unknown"}` : `Default branch · ${session.originalTargetBranch}`)}</dd></div>
        <div><dt class="font-medium text-muted">Current target</dt><dd class="mt-1">${escapeHtml(sessionTargetLabel(session))}</dd></div>
        <div><dt class="font-medium text-muted">Preparation checkpoint</dt><dd class="mt-1">${escapeHtml(preparationLabel)}</dd></div>
        <div><dt class="font-medium text-muted">OpenCode handoff</dt><dd class="mt-1">${escapeHtml(handoffLabel)}</dd></div>
        <div><dt class="font-medium text-muted">Resolved parent</dt><dd class="mt-1 break-words font-mono">${escapeHtml(session.resolvedParentBranch ?? session.baseBranch ?? session.targetBranch)}${session.baseSha ? ` · ${escapeHtml(session.baseSha)}` : " · waiting for verified SHA"}</dd></div>
        <div><dt class="font-medium text-muted">Resolved trunk</dt><dd class="mt-1 break-words font-mono">${escapeHtml(session.resolvedTrunkBranch ?? session.baseBranch ?? session.targetBranch)}</dd></div>
        <div><dt class="font-medium text-muted">Resolved stack layers</dt><dd class="mt-1">${session.resolvedLayers.length > 0 ? escapeHtml(session.resolvedLayers.map((layer) => `#${layer.pullRequestNumber} ${layer.branch}`).join(" → ")) : "Default branch"}</dd></div>
        <div><dt class="font-medium text-muted">Working branch</dt><dd class="mt-1 break-words font-mono">${session.workingBranch ? escapeHtml(session.workingBranch) : "Not assigned before admission"}</dd></div>
        <div><dt class="font-medium text-muted">Execution slot</dt><dd class="mt-1">${session.executionSlotHeld ? "Held" : session.state === "queued" ? "Not held while Queued" : "Not held"}</dd></div>
        <div><dt class="font-medium text-muted">Stack reservation</dt><dd class="mt-1">${session.reservationState === "held" ? `Held${session.reservationId ? ` · ${escapeHtml(session.reservationId)}` : ""}` : session.reservationState === "released" ? "Released" : "None for default-branch work"}</dd></div>
        <div><dt class="font-medium text-muted">Session directory</dt><dd class="mt-1 break-words font-mono">${session.directory ? escapeHtml(session.directory) : "Not assigned before admission"}</dd></div>
        <div><dt class="font-medium text-muted">OpenCode intended Session</dt><dd class="mt-1 break-all font-mono">${session.opencodeIntendedSessionId ? escapeHtml(session.opencodeIntendedSessionId) : "Not assigned before local preparation"}</dd></div>
        <div><dt class="font-medium text-muted">OpenCode Session</dt><dd class="mt-1 break-all font-mono">${session.openCodeSessionId ? escapeHtml(session.openCodeSessionId) : "Not associated"}</dd></div>
        <div><dt class="font-medium text-muted">Initial message</dt><dd class="mt-1 break-all font-mono">${session.initialMessageId ? escapeHtml(session.initialMessageId) : "Not assigned"}</dd></div>
        <div><dt class="font-medium text-muted">Prompt inbox</dt><dd class="mt-1 break-all font-mono">${session.initialInboxId ? escapeHtml(session.initialInboxId) : "Not accepted"}</dd></div>
        <div><dt class="font-medium text-muted">OpenCode freshness</dt><dd class="mt-1">${session.opencodeFreshness === "fresh" ? "Fresh" : session.opencodeFreshness === "stale" ? "Stale" : "Not reconciled"}</dd></div>
        <div><dt class="font-medium text-muted">Last OpenCode reconciliation</dt><dd class="mt-1">${formatTime(session.opencodeLastSuccessAt)}</dd></div>
      </dl>
      ${session.preparationReason ? `<p class="mt-6 text-sm leading-normal text-muted">Checkpoint note: ${escapeHtml(session.preparationReason)}</p>` : ""}
      ${session.exactMessage ? `<section class="mt-8" aria-labelledby="sent-message-title">
        <h2 id="sent-message-title" class="text-base font-semibold">Exact OpenCode handoff message</h2>
        <p class="mt-2 max-w-prose text-base leading-normal text-muted">This is the context and unchanged prompt Atlas prepared for the one allowed initial message.</p>
        <pre class="mt-5 max-w-full overflow-x-auto whitespace-pre-wrap break-words rounded-box bg-base-300 p-5 font-mono text-sm leading-normal">${escapeHtml(session.exactMessage)}</pre>
      </section>` : ""}
      <section class="mt-8" aria-labelledby="immutable-context-title">
        <h2 id="immutable-context-title" class="text-base font-semibold">Immutable handoff context</h2>
        <p class="mt-2 max-w-prose text-base leading-normal text-muted">Atlas retains the Spec snapshot and prompt that were accepted. Later GitHub edits do not rewrite this attempt.</p>
        <dl class="mt-5 grid gap-4 border-y border-edge py-5 text-sm sm:grid-cols-2">
          <div><dt class="font-medium text-muted">Repository</dt><dd class="mt-1 break-words font-mono">${escapeHtml(repository.fullName)}</dd></div>
          <div><dt class="font-medium text-muted">Spec snapshot</dt><dd class="mt-1 break-words">${githubUrl ? `<a class="text-brand-readable underline decoration-brand-readable/50 underline-offset-4" href="${escapeHtml(githubUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(session.specTitle)}</a>` : escapeHtml(session.specTitle)}</dd></div>
        </dl>
        <article class="mt-6 rounded-box border border-edge bg-base-100 p-5">
          <h3 class="font-medium">Spec description at submission</h3>
          <div class="mt-4 whitespace-pre-wrap break-words leading-normal">${escapeHtml(session.specBody) || "No description provided."}</div>
        </article>
        <article class="mt-6 rounded-box border border-edge bg-base-100 p-5">
          <h3 class="font-medium">Initial prompt</h3>
          <pre class="mt-4 max-w-full overflow-x-auto whitespace-pre-wrap break-words rounded-box bg-base-300 p-4 font-mono text-sm leading-normal">${escapeHtml(session.prompt)}</pre>
        </article>
      </section>
      ${renderSessionViewerFragment({
        session,
        viewer,
        endpoint: `/sessions/${encodeURIComponent(session.atlasId)}/view`,
        eventsEndpoint: `/events?session=${encodeURIComponent(session.atlasId)}`,
        requestUrl: viewerRequestUrl,
        limit: viewerLimit,
      })}`,
  });
};
