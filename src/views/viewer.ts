import type { RefreshState, Repository, Session } from "../persistence.ts";
import { DEFAULT_VIEWER_MESSAGE_LIMIT } from "../session-viewer.ts";
import type { SessionViewerProjection, ViewerSessionNode } from "../session-viewer.ts";
import { escapeHtml, formatTime, safeExternalUrl } from "./html.ts";
import {
  ageShort,
  banner,
  button,
  emptyCard,
  group,
  groupLabel,
  handoffCheckpointLabel,
  icon,
  type IconName,
  type MenuItem,
  notLiveTag,
  prose,
  relativeTime,
  row,
  rowEnd,
  segmented,
  sessionLabel,
  sessionsLink,
  sessionTargetLabel,
  settingsRow,
  skeletonRows,
  statusForSession,
  statusPill,
  statusTile,
  targetReconfirmationNeeded,
  terminalWell,
} from "./shared.ts";
import { renderShell, type InboxContext } from "./shell.ts";
import { renderMarkdown } from "./markdown.ts";

// Session page (DESIGN.md Phase 5 "Session page structure", "Agent activity", "Pull request
// result", "Session states"). Styles: src/styles/session.css (prefix `sv-`).

type Message = ViewerSessionNode["messages"][number];
type AssistantMessage = Extract<Message, { type: "assistant" }>;
type UserMessage = Extract<Message, { type: "user" }>;
type ShellMessage = Extract<Message, { type: "shell" }>;
type ToolPart = Extract<AssistantMessage["content"][number], { type: "tool" }>;
type ShellOutput = { output: string; cursor: number; size: number; truncated: boolean };

export type SessionTab = "activity" | "spec" | "details";

const TABS: Array<{ id: SessionTab; label: string }> = [
  { id: "activity", label: "Activity" },
  { id: "spec", label: "Spec" },
  { id: "details", label: "Details" },
];

export const sessionTab = (value: string | undefined | null): SessionTab =>
  value === "spec" || value === "details" ? value : "activity";

const viewerJson = (value: unknown) => {
  try {
    return JSON.stringify(value, null, 2) ?? "[unavailable]";
  } catch {
    return "[unavailable]";
  }
};

const isoTime = (value: number | undefined) => {
  if (value === undefined || !Number.isFinite(value)) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? undefined : date.toISOString();
};

/** Compact age for rows inside a <summary> (no focusable tooltip inside an interactive control). */
const stepTime = (value: number | undefined) => {
  const iso = isoTime(value);
  if (!iso) return "";
  return `<time class="sv-time" datetime="${escapeHtml(iso)}" title="${escapeHtml(formatTime(iso))}">${escapeHtml(ageShort(iso))}</time>`;
};

/** Message age with the kit's exact-time tooltip. */
const messageTime = (value: number | undefined) => {
  const iso = isoTime(value);
  return iso ? `<span class="sv-time">${relativeTime(iso, { suffix: "" })}</span>` : "";
};

/** Agent text: escaped, then only `code` and **bold** are turned into markup. Line breaks are kept by CSS. */
const agentText = (value: string) =>
  escapeHtml(value)
    .replace(/`([^`\n]+)`/g, '<code class="ax-mono">$1</code>')
    .replace(/\*\*([^*\n]+)\*\*/g, "<b>$1</b>");

const firstLine = (value: string, max = 80) => {
  const line = value.split("\n").find((part) => part.trim()) ?? "";
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
};

// ── Tool steps ───────────────────────────────────────────────────────────

type StepKind = "read" | "search" | "change" | "command" | "subagent" | "thought" | "other";

type Step = {
  key: string;
  kind: StepKind;
  glyph: IconName;
  verb: string;
  target?: string;
  extraHtml?: string;
  path?: string;
  time?: number;
  live: boolean;
  failed: boolean;
  bodyHtml: string;
  /** What stays visible under a live step (progress only, never the input again). */
  liveHtml?: string;
};

const stringInput = (input: unknown, ...keys: string[]) => {
  if (!input || typeof input !== "object") return undefined;
  for (const key of keys) {
    const value = (input as Record<string, unknown>)[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return undefined;
};

const firstStringInput = (input: unknown) => {
  if (!input || typeof input !== "object") return undefined;
  return Object.values(input as Record<string, unknown>).find((value): value is string => typeof value === "string" && value.trim() !== "");
};

const toolShape = (name: string, input: unknown): Pick<Step, "kind" | "glyph" | "verb" | "target" | "path"> => {
  const lower = name.toLowerCase();
  const path = stringInput(input, "filePath", "path", "file");
  if (lower === "read") return { kind: "read", glyph: "eye", verb: "Read", target: path, path };
  if (lower === "grep" || lower === "glob" || lower === "list" || lower === "ls" || lower === "codesearch") {
    return { kind: "search", glyph: "list", verb: "Searched", target: stringInput(input, "pattern", "query", "path") };
  }
  if (lower === "edit" || lower === "multiedit" || lower === "patch" || lower === "apply_patch") return { kind: "change", glyph: "pencil", verb: "Edited", target: path, path };
  if (lower === "write") return { kind: "change", glyph: "pencil", verb: "Wrote", target: path, path };
  if (lower === "bash" || lower === "shell") return { kind: "command", glyph: "terminal", verb: "Ran", target: stringInput(input, "command") };
  if (lower === "task") return { kind: "subagent", glyph: "sparkle", verb: "Subagent", target: stringInput(input, "description", "prompt") };
  if (lower === "webfetch" || lower === "fetch") return { kind: "other", glyph: "external", verb: "Fetched", target: stringInput(input, "url") };
  if (lower === "todowrite" || lower === "todoread") return { kind: "other", glyph: "list", verb: "Updated the to-do list" };
  return { kind: "other", glyph: "sliders", verb: name, target: firstStringInput(input) };
};

const renderShellOutput = (output: ShellOutput, nextHref?: string, requestedCursor = 0) => {
  const more = shellOutputHasMore(output);
  const stalled = more && output.cursor <= requestedCursor;
  const warning = more
    ? banner({
      tone: "warning",
      bodyHtml: `<b>${output.truncated ? "Output is capped in this projection; more output is available." : "Output continues in a later page."}</b> This page ends at byte ${escapeHtml(String(output.cursor))} of ${escapeHtml(String(output.size))}.${nextHref ? ` <a class="ax-link" href="${escapeHtml(nextHref)}">Load next output page</a>.` : stalled ? " The upstream cursor did not advance, so no continuation link is offered." : ""}`,
    })
    : "";
  return `${terminalWell(output.output, "Command output")}${warning}`;
};

const toolContent = (content: readonly { type: string; text?: string; uri?: string; mime?: string; name?: string | null }[] | undefined, command: boolean) =>
  content && content.length > 0
    ? content.map((item) => {
      if (item.type === "file") {
        const link = item.uri ? safeExternalUrl(item.uri) : "";
        return `<p class="sv-file">${icon("doc", 16)}<span><b>${escapeHtml(item.name ?? item.uri ?? "unnamed")}</b> <span class="sv-dim-text">${escapeHtml(item.mime ?? "unknown type")}</span>${link ? ` · <a class="ax-link" href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer">Open safe link</a>` : ""}</span></p>`;
      }
      return command ? terminalWell(item.text ?? "", "Command output") : `<pre class="sv-code">${escapeHtml(item.text ?? "")}</pre>`;
    }).join("")
    : "";

const labelled = (label: string, html: string) => html ? `<div class="sv-kv"><p class="sv-kv-l">${escapeHtml(label)}</p>${html}</div>` : "";

const toolStep = (tool: ToolPart): Step => {
  const state = tool.state;
  const input = state.input;
  const shape = toolShape(tool.name, typeof input === "string" ? {} : input);
  const command = shape.kind === "command";
  const live = state.status === "running" || state.status === "streaming";
  const failed = state.status === "error";
  const inputHtml = state.status === "streaming"
    ? `<pre class="sv-code">${escapeHtml(String(input))}</pre>`
    : command && shape.target
      ? terminalWell(`$ ${shape.target}`, "Command")
      : `<pre class="sv-code">${escapeHtml(viewerJson(input))}</pre>`;
  const progress = state.status === "running" ? state.metadata : undefined;
  const progressOutput = progress && typeof (progress as Record<string, unknown>).output === "string" ? String((progress as Record<string, unknown>).output) : "";
  const progressHtml = progress
    ? progressOutput
      ? terminalWell(progressOutput, "Live output")
      : Object.keys(progress).length > 0 ? `<pre class="sv-code">${escapeHtml(viewerJson(progress))}</pre>` : ""
    : "";
  const error = state.status === "error"
    ? banner({ tone: "error", bodyHtml: `<b>${escapeHtml(state.error.type)}</b>: ${escapeHtml(state.error.message)}` })
    : "";
  const output = state.status === "completed" || state.status === "error" ? toolContent(state.content, command) : "";
  const diff = state.status === "completed" && typeof (state.metadata as Record<string, unknown> | undefined)?.diff === "string"
    ? `<pre class="sv-code sv-diff">${escapeHtml(String((state.metadata as Record<string, unknown>).diff))}</pre>`
    : "";
  return {
    ...shape,
    key: `tool:${tool.id}`,
    time: tool.time?.created,
    live,
    failed,
    liveHtml: progressHtml,
    extraHtml: failed ? '<span class="sv-extra t-failed">failed</span>' : state.status === "streaming" ? '<span class="sv-extra">preparing input</span>' : "",
    bodyHtml: `<div data-tool-id="${escapeHtml(tool.id)}">${labelled(command ? "Command" : "Input", inputHtml)}${labelled("Progress", progressHtml)}${error}${labelled(command ? "Output" : "Result", diff || output)}</div>`,
  };
};

// ── Activity feed ────────────────────────────────────────────────────────

type Entry =
  | { type: "step"; step: Step }
  | { type: "shown"; key: string; html: string };

const outcomeLabel = { succeeded: "succeeded", failed: "failed", interrupted: "was interrupted" } as const;

const renderAttachments = (message: UserMessage) => {
  if (!message.files || message.files.length === 0) return "";
  return `<div class="sv-kv" aria-label="User attachments"><p class="sv-kv-l">Attachments</p>${message.files.map((file) => {
    const link = file.source.type === "inline" ? "" : safeExternalUrl(file.source.uri);
    const source = file.source.type === "inline"
      ? "Inline attachment"
      : link
        ? `<a class="ax-link" href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer">Open safe source</a>`
        : "Referenced source (not linked)";
    return `<p class="sv-file">${icon("doc", 16)}<span><b>${escapeHtml(file.name ?? "Unnamed attachment")}</b> <span class="sv-dim-text">${escapeHtml(file.mime)} · ${source}</span>${file.description ? `<br>${escapeHtml(file.description)}` : ""}</span></p>`;
  }).join("")}</div>`;
};

const shownRow = (key: string, glyph: IconName, tileClass: string, title: string, bodyHtml: string, time?: number) =>
  `<div class="sv-act sv-msg" data-message-id="${escapeHtml(key)}"><span class="sv-ic ${tileClass}" aria-hidden="true">${icon(glyph, 15)}</span><div class="sv-act-body"><b class="sv-who">${escapeHtml(title)}</b>${bodyHtml}</div>${messageTime(time)}</div>`;

const stepSummary = (step: Step, live = false) =>
  `<span class="sv-ic${live ? " sv-ic-live" : step.failed ? " sv-ic-failed" : ""}" aria-hidden="true">${icon(step.glyph, 15)}</span><span class="sv-act-body"><b>${escapeHtml(step.verb)}</b>${step.target ? ` <span class="ax-mono">${escapeHtml(firstLine(step.target, 120))}</span>` : ""}${step.extraHtml ?? ""}${live ? '<span class="sv-now">now</span>' : ""}</span>${live ? "" : stepTime(step.time)}`;

const renderStep = (step: Step) =>
  `<details class="sv-step" data-fold-key="${escapeHtml(step.key)}"><summary class="sv-act">${stepSummary(step)}</summary><div class="sv-step-body">${step.bodyHtml}</div></details>`;

const renderLiveStep = (step: Step) =>
  `<div class="sv-act sv-live-step" data-live-step>${stepSummary(step, true)}</div>${step.liveHtml ? `<div class="sv-step-body sv-live-body">${step.liveHtml}</div>` : ""}`;

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

/** "read 2 files, searched, changed 3 files" for a fold of steps. */
const foldSummary = (steps: Step[]) => {
  const count = (kind: StepKind) => steps.filter((step) => step.kind === kind);
  const files = (kind: StepKind) => new Set(count(kind).map((step) => step.path ?? step.key)).size;
  const parts = [
    count("read").length ? `read ${plural(files("read"), "file")}` : "",
    count("search").length ? (count("search").length === 1 ? "searched" : `searched ${count("search").length}×`) : "",
    count("change").length ? `changed ${plural(files("change"), "file")}` : "",
    count("command").length ? `ran ${plural(count("command").length, "command")}` : "",
    count("subagent").length ? `started ${plural(count("subagent").length, "subagent")}` : "",
    count("thought").length ? "thought it through" : "",
    count("other").length ? plural(count("other").length, "other step") : "",
  ].filter(Boolean);
  return parts.length > 3 ? `${parts.slice(0, 3).join(", ")}, …` : parts.join(", ");
};

const renderFold = (steps: Step[]) => {
  const failed = steps.filter((step) => step.failed).length;
  return `<details class="sv-fold" data-fold-key="fold:${escapeHtml(steps[0]!.key)}"><summary class="sv-act sv-fold-sum"><span class="sv-ic" aria-hidden="true">${icon("list", 15)}</span><span class="sv-act-body"><b>${plural(steps.length, "step")}</b> · ${escapeHtml(foldSummary(steps))}${failed ? ` <span class="sv-extra t-failed">${failed} failed</span>` : ""}</span>${icon("chevron", 15, "sv-chev")}</summary><div class="sv-fold-body">${steps.map(renderStep).join("")}</div></details>`;
};

const messageEntries = (
  message: Message,
  context: { root: boolean; firstUserId?: string; shellHref?: (message: ShellMessage, cursor: number) => string; requestUrl?: string },
): Entry[] => {
  const created = message.time.created;
  if (message.type === "assistant") {
    const entries: Entry[] = message.content.map((part, index): Entry => {
      if (part.type === "text") {
        return { type: "shown", key: `${message.id}:${index}`, html: shownRow(message.id, "sparkle", "sv-ic-agent", "Agent", `<div class="sv-text">${agentText(part.text)}</div>`, created) };
      }
      if (part.type === "reasoning") {
        return {
          type: "step",
          step: { key: `reason:${message.id}:${index}`, kind: "thought", glyph: "sparkle", verb: "Thought", target: part.text ? firstLine(part.text) : undefined, time: created, live: false, failed: false, bodyHtml: `<div class="sv-text sv-dim-text">${escapeHtml(part.text) || "No public reasoning text was exposed."}</div>` },
        };
      }
      return { type: "step", step: toolStep(part) };
    });
    if (message.error) {
      entries.push({ type: "shown", key: `${message.id}:error`, html: `<div class="sv-act-note">${banner({ tone: "error", bodyHtml: `<b>${escapeHtml(message.error.type)}</b>: ${escapeHtml(message.error.message)}` })}</div>` });
    }
    if (message.retry) {
      entries.push({ type: "shown", key: `${message.id}:retry`, html: `<div class="sv-act-note">${banner({ tone: "warning", bodyHtml: `<b>Retry ${message.retry.attempt} scheduled:</b> ${escapeHtml(message.retry.error.message)}` })}</div>` });
    }
    return entries;
  }
  if (message.type === "user") {
    const isPrompt = message.id === context.firstUserId;
    const title = isPrompt ? (context.root ? "Prompt sent by Atlas" : "Task from the main Agent") : "Message to the Agent";
    return [{
      type: "shown",
      key: message.id,
      html: `<details class="sv-step sv-prompt" data-fold-key="${escapeHtml(`user:${message.id}`)}" data-message-id="${escapeHtml(message.id)}"><summary class="sv-act"><span class="sv-ic" aria-hidden="true">${icon("doc", 15)}</span><span class="sv-act-body"><b>${escapeHtml(title)}</b> <span class="sv-dim-text">${escapeHtml(firstLine(message.text, 70))}</span></span>${stepTime(created)}</summary><div class="sv-step-body"><div class="sv-text">${escapeHtml(message.text)}</div>${renderAttachments(message)}</div></details>`,
    }];
  }
  if (message.type === "shell") {
    const requested = requestedShellOutputCursor(context.requestUrl, message.shellID);
    const next = message.output ? nextShellOutputCursor(message.output, requested) : undefined;
    const href = next === undefined ? undefined : context.shellHref?.(message, next);
    const failed = message.exit !== undefined && message.exit !== 0;
    return [{
      type: "step",
      step: {
        key: `shell:${message.id}`,
        kind: "command",
        glyph: "terminal",
        verb: "Ran",
        target: message.command,
        time: created,
        live: message.status === "running",
        failed,
        extraHtml: message.exit !== undefined ? `<span class="sv-extra${failed ? " t-failed" : ""}">exit ${escapeHtml(String(message.exit))}</span>` : "",
        bodyHtml: `<div data-message-id="${escapeHtml(message.id)}">${message.output ? renderShellOutput(message.output, href, requested) : '<p class="sv-dim-text">Shell output is not present in this projection.</p>'}</div>`,
        liveHtml: message.output ? `<div data-message-id="${escapeHtml(message.id)}">${renderShellOutput(message.output, href, requested)}</div>` : "",
      },
    }];
  }
  if (message.type === "idle") {
    const tone = message.outcome === "succeeded" ? "succeeded" : "failed";
    const label = outcomeLabel[message.outcome as keyof typeof outcomeLabel] ?? escapeHtml(String(message.outcome));
    return [{
      type: "shown",
      key: message.id,
      html: `<div class="sv-outcome" data-message-id="${escapeHtml(message.id)}"><span class="t-${tone}">${icon(tone === "succeeded" ? "check" : "x", 15)}Execution ${label}</span>${message.error ? `<p>${escapeHtml(message.error.message)}</p>` : ""}${messageTime(created)}</div>`,
    }];
  }
  const simple = (verb: string, glyph: IconName, target: string | undefined, text: string): Entry => ({
    type: "step",
    step: { key: `msg:${message.id}`, kind: "other", glyph, verb, target, time: created, live: false, failed: false, bodyHtml: `<div class="sv-text" data-message-id="${escapeHtml(message.id)}">${escapeHtml(text)}</div>` },
  });
  if (message.type === "compaction") return [simple(`Context compaction · ${message.status}`, "refresh", undefined, message.status === "failed" ? message.error.message : message.summary)];
  if (message.type === "system") return [simple("System", "info", firstLine(message.text), message.text)];
  if (message.type === "synthetic") return [simple("Synthetic", "info", firstLine(message.text), message.text)];
  if (message.type === "skill") return [simple("Skill", "sparkle", message.name, message.text)];
  if (message.type === "agent-switched") return [simple("Agent selected", "sparkle", message.agent, `Agent selected: ${message.agent}`)];
  if (message.type === "model-switched") return [simple("Model selected", "sliders", `${message.model.providerID}/${message.model.id}`, `Model selected: ${message.model.providerID}/${message.model.id}`)];
  return [simple("Location changed", "folder", message.location.directory, message.location.directory)];
};

const chronological = (messages: readonly Message[]) =>
  messages.map((message, index) => ({ message, index }))
    .sort((a, b) => (a.message.time.created - b.message.time.created) || (b.index - a.index))
    .map(({ message }) => message);

const renderFeed = (entries: Entry[], liveAllowed: boolean) => {
  // Trailing steps still in progress stay visible outside the fold while the Session is running.
  const live: Step[] = [];
  if (liveAllowed) {
    while (entries.length > 0) {
      const last = entries[entries.length - 1]!;
      if (last.type !== "step" || !last.step.live) break;
      live.unshift(last.step);
      entries.pop();
    }
  }
  const items: string[] = [];
  let pending: Step[] = [];
  const flush = () => {
    if (pending.length > 0) items.push(renderFold(pending));
    pending = [];
  };
  for (const entry of entries) {
    if (entry.type === "step") pending.push(entry.step);
    else {
      flush();
      items.push(entry.html);
    }
  }
  flush();
  items.push(...live.map(renderLiveStep));
  return `<ol class="sv-feed" aria-label="Session activity">${items.map((item) => `<li>${item}</li>`).join("")}</ol>`;
};

// ── Shell paging helpers (contract asserted by scripts/verify-issue29.ts) ─

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

// ── Viewer sections ─────────────────────────────────────────────────────

const formOptions = (field: unknown) => {
  const options = (field as { options?: Array<{ label?: string; value?: string }> }).options;
  return Array.isArray(options) ? options.map((option) => option.label ?? option.value ?? "").filter(Boolean) : [];
};

/** Read-only list of what the Agent is waiting on. Atlas never answers, cancels or resumes. */
const pendingQuestions = (node: ViewerSessionNode) => [
  ...node.pending.forms.map((form) => {
    const fields = form.fields.map((field) => {
      const options = formOptions(field);
      return `<li><b>${escapeHtml(field.title ?? field.key)}</b>${options.length ? ` <span class="sv-dim-text">· ${escapeHtml(options.join(" · "))}</span>` : ""}</li>`;
    }).join("");
    return `<p class="sv-ask-q">${escapeHtml(form.title)}</p>${fields ? `<ul class="sv-ask-fields">${fields}</ul>` : ""}`;
  }),
  ...node.pending.permissions.map((permission) =>
    `<p class="sv-ask-q">Permission to ${escapeHtml(permission.action)}${permission.resources.length ? ` <span class="ax-mono">${escapeHtml(permission.resources.join(", "))}</span>` : ""}</p>${permission.message ? `<p class="sv-dim-text">${escapeHtml(permission.message)}</p>` : ""}`),
];

const askBox = (node: ViewerSessionNode, kicker = "The Agent asks") => {
  const questions = pendingQuestions(node);
  if (questions.length === 0) return "";
  return `<div class="sv-ask" role="group" aria-label="${escapeHtml(kicker)}"><p class="sv-ask-k">${escapeHtml(kicker)}</p>${questions.join("")}<p class="sv-ask-note">${icon("terminal", 15)}Answer it in OpenCode. Atlas can’t reply.</p></div>`;
};

const childLabel = (child: ViewerSessionNode) =>
  child.activeSubagent ? "Active subagent" : child.active ? "Active child Session" : "Child Session";

const renderChildren = (node: ViewerSessionNode, selectedId: string, endpoint: string, limit: number) => {
  if (node.children.length === 0) return "";
  const rows = node.children.map((child) => row({
    title: child.info.title ?? "Untitled child Session",
    href: `${endpoint}?child=${encodeURIComponent(child.info.id)}&limit=${limit}`,
    tileHtml: statusTile(child.active ? "running" : "idle", "sm", "sparkle"),
    subHtml: `${child.agentMode ? `${escapeHtml(child.agentMode)} · ` : ""}<span class="ax-mono">${escapeHtml(child.info.id)}</span>`,
    endHtml: rowEnd({ pillHtml: statusPill(child.active ? "running" : "idle", childLabel(child)) }),
    current: child.info.id === selectedId,
    chevron: true,
  }));
  return `<section class="sv-sec" aria-labelledby="descendants-${escapeHtml(node.info.id)}"><h3 id="descendants-${escapeHtml(node.info.id)}" class="sv-h3">Child Sessions <span class="sv-n">${node.children.length}</span></h3>${group(rows, { label: "Child Sessions" })}<p class="ax-group-foot">Verified through OpenCode Session records. “Active subagent” only when it is running and its agent mode says so.</p></section>`;
};

const renderShells = (node: ViewerSessionNode, rootId: string, endpoint: string, limit: number, requestUrl?: string) => {
  if (node.shells.length === 0) return "";
  const shells = node.shells.map((shell) => {
    const requested = requestedShellOutputCursor(requestUrl, shell.info.id);
    const next = shell.output ? nextShellOutputCursor(shell.output, requested) : undefined;
    const output = shell.output
      ? renderShellOutput(shell.output, next === undefined ? undefined : shellOutputHref(node, rootId, endpoint, limit, requestUrl, shell.info.id, next), requested)
      : shell.outputUnavailable ? banner({ tone: "warning", body: "Shell output is currently unavailable." }) : "";
    return `<div class="sv-shell"><p class="sv-shell-h">${icon("terminal", 15)}<span class="ax-mono">${escapeHtml(shell.info.command)}</span>${statusPill(shell.info.status === "running" ? "running" : "idle", shell.info.status)}</p><p class="sv-shell-cwd ax-mono">${escapeHtml(shell.info.cwd)}</p>${output}</div>`;
  }).join("");
  return `<section class="sv-sec" aria-labelledby="shells-${escapeHtml(node.info.id)}"><h3 id="shells-${escapeHtml(node.info.id)}" class="sv-h3">Live output</h3>${shells}<p class="ax-group-foot">Only shells tied to this Session are shown. Output from a shell that already exited may be gone after a disconnect.</p></section>`;
};

const renderNode = (node: ViewerSessionNode, root: ViewerSessionNode, endpoint: string, limit: number, requestUrl: string | undefined, session: Session) => {
  const isRoot = node.info.id === root.info.id;
  const firstUserId = chronological(node.messages).find((message) => message.type === "user")?.id;
  const entries = chronological(node.messages).flatMap((message) => messageEntries(message, {
    root: isRoot,
    firstUserId: node.nextMessageCursor ? undefined : firstUserId,
    requestUrl,
    shellHref: (shell, cursor) => shellOutputHref(node, root.info.id, endpoint, limit, requestUrl, shell.shellID, cursor),
  }));
  const liveAllowed = node.semanticState === "running" || (isRoot && session.state === "running");
  const older = node.nextMessageCursor
    ? `<p class="sv-older"><a class="ax-link" href="${escapeHtml(`${endpoint}?${new URLSearchParams({ ...(isRoot ? {} : { child: node.info.id }), cursor: node.nextMessageCursor, limit: String(limit) }).toString()}`)}">${icon("refresh", 15)}Load older messages</a></p>`
    : "";
  const feed = node.messagesLoaded
    ? entries.length > 0
      ? `${older}${renderFeed(entries, liveAllowed)}`
      : `${older}${emptyCard({ title: "No messages on this page", body: "An empty page is valid. It doesn’t mean the Session is finished or that history is missing.", glyph: "list" })}`
    : banner({ tone: "warning", body: node.unavailableReason ?? "Messages are not currently available." });
  const childBanner = isRoot
    ? ""
    : `<div class="sv-child-note">${statusTile(node.active ? "running" : "idle", "sm", "sparkle")}<div><p class="sv-child-k">Child Session${node.agentMode ? ` · ${escapeHtml(node.agentMode)}` : ""}</p><p class="sv-child-t">${escapeHtml(node.info.title ?? "Untitled child Session")}</p></div><a class="ax-link" href="${escapeHtml(`/sessions/${encodeURIComponent(session.atlasId)}`)}">Main Session</a></div>${askBox(node, "This child Session asks")}`;
  const queuedInbox = node.pending.inbox.length > 0
    ? `<p class="ax-group-foot">${plural(node.pending.inbox.length, "message")} queued for the Agent in OpenCode. That alone doesn’t mean anyone is being asked something.</p>`
    : "";
  return `${childBanner}<section class="sv-sec sv-sec-first" aria-labelledby="timeline-${escapeHtml(node.info.id)}"><h3 id="timeline-${escapeHtml(node.info.id)}" class="sr-only">${isRoot ? "Agent activity" : "Child Session activity"}</h3>${feed}${queuedInbox}</section>${renderShells(node, root.info.id, endpoint, limit, requestUrl)}${renderChildren(node, node.info.id, endpoint, limit)}`;
};

const connectionMessage = (freshness: string, staleReason?: string) => {
  if (freshness === "stale") {
    return `<div class="sv-conn" role="status" aria-live="polite" aria-atomic="true" data-viewer-connection-message data-viewer-state="stale" data-viewer-status data-viewer-stale>${escapeHtml(staleReason ?? "OpenCode transport or reconciliation is unavailable. Visible content is retained.")}</div>`;
  }
  if (freshness === "partial") {
    return `<div class="sv-conn" role="status" aria-live="polite" aria-atomic="true" data-viewer-connection-message data-viewer-state="partial" data-viewer-status>Partial Session view. Missing parts are shown as partial, not as empty history.</div>`;
  }
  return `<div class="sr-only" role="status" aria-live="polite" aria-atomic="true" data-viewer-connection-message data-viewer-state="fresh" data-viewer-status></div>`;
};

/**
 * The live part of the Activity tab. `public/app.js` re-fetches `/sessions/:id/view` with
 * `HX-Request` and replaces this root's children on SSE refreshes; keep its data attributes.
 */
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
  // Before the OpenCode handoff there is nothing to reconcile: keep connection noise quiet.
  const pending = !session.openCodeSessionId && session.handoffCheckpoint === "not_started";
  const notes = !pending && viewer?.partialReasons && viewer.partialReasons.length > 0
    ? `<details class="sv-notes" data-viewer-notes data-fold-key="notes"><summary>${icon("info", 15)}Some parts couldn’t be read</summary><ul>${viewer.partialReasons.map((reason) => `<li>${escapeHtml(reason)}</li>`).join("")}</ul></details>`
    : "";
  const content = viewer?.available && viewer.selected && viewer.root
    ? renderNode(viewer.selected, viewer.root, endpoint, limit, requestUrl, session)
    : !pending
      ? emptyCard({ title: "Agent activity unavailable", body: "Atlas can’t read this Session’s OpenCode history right now. It keeps the Session and won’t treat the missing history as empty or finished.", glyph: "terminal" })
      : emptyCard({ title: "No activity yet", body: session.state === "failed_setup" ? "Setup failed before the Agent started, so there is no Agent activity." : "Agent activity appears here once Atlas hands the Session to OpenCode.", glyph: "clock" });
  return `<section id="session-viewer" class="sv-viewer" data-session-viewer data-viewer-freshness="${freshness}" data-session-viewer-url="${escapeHtml(requestUrl ?? endpoint)}" data-session-events-url="${escapeHtml(eventsEndpoint)}" data-session-id="${escapeHtml(session.atlasId)}"${pending ? " data-viewer-pending" : ""} aria-labelledby="session-viewer-title">
    <h2 id="session-viewer-title" class="sr-only">Activity</h2>
    ${connectionMessage(freshness, viewer?.staleReason)}${notes}
    <div data-viewer-content>${content}</div>
  </section>`;
};

/** Loading placeholder for hosts that fetch the viewer late (e.g. an embedded pane). */
export const renderSessionViewerLoading = () =>
  `<div class="sv-viewer" aria-busy="true">${skeletonRows(4, "Loading Agent activity")}</div>`;

// ── Page ─────────────────────────────────────────────────────────────────

const PREPARATION_STEP: Record<Session["preparationCheckpoint"], string> = {
  queued: "Waiting to start preparing.",
  intent_saved: "Getting ready to copy the Repository.",
  clone_started: "Copying the Repository.",
  clone_complete: "Repository copied. Creating the working branch.",
  branch_started: "Creating the working branch.",
  prepared: "Branch ready. Handing the Session to OpenCode next.",
  start_unconfirmed: "Atlas couldn’t confirm the last setup step.",
  failed_setup: "Setup failed.",
};

const preparationLabel = (checkpoint: Session["preparationCheckpoint"]) => ({
  intent_saved: "Intent saved",
  clone_started: "Clone starting",
  clone_complete: "Clone complete",
  branch_started: "Branch starting",
  prepared: "Locally prepared",
  start_unconfirmed: "Start unconfirmed",
  failed_setup: "Setup failed",
  queued: "Queued",
}[checkpoint] ?? "Queued");

const lastStep = (node: ViewerSessionNode | undefined) => {
  if (!node) return undefined;
  const entries = chronological(node.messages).flatMap((message) => messageEntries(message, { root: true }));
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]!;
    if (entry.type === "step") return entry.step;
  }
  return undefined;
};

const terminalReason = (session: Session, root: ViewerSessionNode | undefined) => {
  if (session.stateReason) return session.stateReason;
  const idle = root ? chronological(root.messages).reverse().find((message) => message.type === "idle") : undefined;
  if (idle && idle.type === "idle" && idle.error) return idle.error.message;
  return undefined;
};

const statusCard = ({ session, viewer, stale }: { session: Session; viewer?: SessionViewerProjection; stale: boolean }) => {
  const status = statusForSession(session.state);
  const root = viewer?.available ? viewer.root : undefined;
  const started = relativeTime(session.submittedAt);
  const updated = relativeTime(session.updatedAt);
  const id = encodeURIComponent(session.atlasId);
  let title = sessionLabel(session.state);
  let now = "";
  let extra = "";
  let glyph: IconName | undefined;

  if (session.state === "running") {
    const step = lastStep(root);
    now = step?.live
      ? `${escapeHtml(step.verb)}${step.target ? ` <span class="ax-mono">${escapeHtml(firstLine(step.target, 60))}</span>` : ""}`
      : step ? `Last step: ${escapeHtml(step.verb.toLowerCase())}${step.target ? ` <span class="ax-mono">${escapeHtml(firstLine(step.target, 60))}</span>` : ""}` : "The Agent is working.";
    now = `Started ${started} · ${now}`;
  } else if (session.state === "waiting") {
    title = "Waiting for an answer";
    now = `Asked ${updated}`;
    extra = (root ? askBox(root) : "") || `<div class="sv-ask"><p class="sv-ask-k">The Agent is waiting</p><p class="sv-ask-q">Atlas can see that the Agent stopped for input, but can’t read the question here.</p><p class="sv-ask-note">${icon("terminal", 15)}Answer it in OpenCode. Atlas can’t reply.</p></div>`;
  } else if (session.state === "idle") {
    now = `Last activity ${updated} · Not finished: the Agent stopped without a final outcome.`;
    extra = `<p class="sv-card-note">${icon("info", 15)}Idle doesn’t mean done. Check the last Agent message in Activity, then continue the Session in OpenCode if it needs more work.</p>`;
  } else if (session.state === "queued") {
    now = `Queued ${relativeTime(session.submittedAt)} · #${session.submissionOrder} in line`;
    extra = targetReconfirmationNeeded(session)
      ? `<p class="sv-card-note">${icon("warn", 15)}<span>${escapeHtml(session.stateReason ?? "The starting point changed.")} Atlas won’t pick a new one for you.</span></p><div class="sv-card-act">${button({ label: "Review current target", href: `/sessions/${id}/target` })}</div>`
      : `<p class="sv-card-note">${icon("clock", 15)}<span>${escapeHtml(session.stateReason ?? "Atlas starts it when a slot is free.")} Next, Atlas copies the Repository and creates the working branch.</span></p>`;
  } else if (session.state === "preparing") {
    now = `${PREPARATION_STEP[session.preparationCheckpoint] ?? "Preparing."} · updated ${updated}`;
    extra = `<p class="sv-card-note">${icon("clock", 15)}<span>When the branch is ready, Atlas sends your prompt to OpenCode once and the Agent starts.</span></p>`;
  } else if (session.state === "succeeded") {
    now = `Finished ${updated}`;
    if (!session.resultPullRequestId) {
      extra = `<p class="sv-card-note">${icon("info", 15)}<span>No Pull request was found for this Session.${session.publicationReason ? ` ${escapeHtml(session.publicationReason)}` : ""}</span></p>`;
    }
  } else {
    // failed, interrupted, failed_setup: the real reason, prominently.
    glyph = session.state === "interrupted" ? "pause" : undefined;
    title = session.state === "failed_setup" ? "Setup failed" : sessionLabel(session.state);
    now = `${session.state === "interrupted" ? "Stopped" : "Ended"} ${updated}`;
    const reason = terminalReason(session, root);
    extra = `<div class="sv-reason" role="alert"><p class="sv-reason-k">${session.state === "failed_setup" ? "Why setup failed" : session.state === "interrupted" ? "Why it stopped" : "Why it failed"}</p><p>${reason ? escapeHtml(reason) : "Atlas didn’t record a reason. The last Agent message in Activity may explain it."}</p>${session.state === "failed_setup" ? '<p class="sv-reason-foot">The Agent never started. Atlas keeps any partial files and won’t delete or retry them.</p>' : ""}</div>`;
  }

  const live = session.state === "running" && !stale
    ? '<span class="sv-livetag" data-live-tag><i aria-hidden="true"></i>Live</span>'
    : "";
  const meta = session.workingBranch && !["queued", "failed_setup"].includes(session.state)
    ? `<p class="sv-card-meta"><span>Branch <b class="ax-mono">${escapeHtml(session.workingBranch)}</b></span><span>Based on <b class="ax-mono">${escapeHtml(session.resolvedParentBranch ?? session.baseBranch ?? session.targetBranch)}</b></span></p>`
    : "";
  return `<section class="sv-card" aria-labelledby="sv-state" data-session-state="${escapeHtml(session.state)}">
    <div class="sv-card-hd">${statusTile(status, "lg", glyph)}<div class="sv-card-main"><h2 id="sv-state" class="sv-card-t t-${status}">${escapeHtml(title)}${live}${stale ? notLiveTag() : ""}</h2><p class="sv-card-s">${now}</p></div></div>
    ${extra}${meta}
  </section>`;
};

const pullRequestCard = (session: Session, title?: string) => {
  if (!session.resultPullRequestId) return "";
  const url = safeExternalUrl(session.resultPullRequestUrl ?? "");
  const number = session.resultPullRequestNumber ? `#${session.resultPullRequestNumber}` : "Pull request";
  const into = session.resolvedParentBranch ?? session.baseBranch ?? session.targetBranch;
  const unsure = session.publicationStatus === "unverified" || session.publicationStatus === "ambiguous";
  return `<section class="sv-pr" aria-labelledby="sv-pr-t">
    <p class="sv-pr-k">${icon("pr", 15)}Pull request opened</p>
    ${title
      ? `<h2 id="sv-pr-t" class="sv-pr-t">${escapeHtml(title)}</h2>
    <p class="sv-pr-s">${escapeHtml(number)}${session.workingBranch ? ` · <span class="ax-mono">${escapeHtml(session.workingBranch)}</span>` : ""} into <span class="ax-mono">${escapeHtml(into)}</span></p>`
      : `<h2 id="sv-pr-t" class="sv-pr-t">${escapeHtml(number)}${session.workingBranch ? ` <span class="ax-mono">${escapeHtml(session.workingBranch)}</span>` : ""}</h2>
    <p class="sv-pr-s">Into <span class="ax-mono">${escapeHtml(into)}</span></p>`}
    ${unsure ? `<p class="sv-card-note">${icon("warn", 15)}<span>GitHub hasn’t confirmed this yet${session.publicationReason ? `: ${escapeHtml(session.publicationReason)}` : "."}</span></p>` : ""}
    ${url ? `<div class="sv-pr-acts">${button({ label: "Open on GitHub", href: url, icon: "external", block: true, attrs: 'target="_blank" rel="noopener noreferrer"' })}</div>` : '<p class="sv-pr-s">GitHub link unavailable.</p>'}
  </section>`;
};

const isStale = (session: Session, viewer?: SessionViewerProjection) =>
  session.opencodeFreshness === "stale" || viewer?.freshness === "stale";

/**
 * Fresh status and Pull request cards for the Session page. The `/sessions/:id/view` HTMX response
 * appends this after the viewer; `public/app.js` swaps it into `[data-sv-pr-slot]` and
 * `[data-sv-status-slot]` whenever it applies a fresh viewer refresh.
 */
export const renderSessionLiveCards = ({ session, viewer, pullRequestTitle }: { session: Session; viewer?: SessionViewerProjection; pullRequestTitle?: string }) =>
  `<template data-sv-live-cards><div data-sv-pr-slot>${pullRequestCard(session, pullRequestTitle)}</div><div data-sv-status-slot>${statusCard({ session, viewer, stale: isStale(session, viewer) })}</div></template>`;

const tabHref = (base: string, tab: SessionTab) => {
  const url = new URL(base, "http://atlas.invalid");
  if (tab === "activity") url.searchParams.delete("tab");
  else url.searchParams.set("tab", tab);
  return `${url.pathname}${url.search}`;
};

const setGroup = (label: string, rows: string[]) => `${groupLabel(label)}${group(rows.filter(Boolean))}`;

const detailsPanel = (session: Session, repository: Repository, pullRequestsRefresh?: RefreshState) => {
  const prUrl = safeExternalUrl(session.resultPullRequestUrl ?? "");
  const conflicts = session.reservationConflictCount ?? 0;
  const prRefresh = pullRequestsRefresh && (pullRequestsRefresh.requestedGeneration > pullRequestsRefresh.completedGeneration || ["never", "unavailable", "partial"].includes(pullRequestsRefresh.availability))
    ? banner({ tone: "warning", title: "Waiting for GitHub to confirm", body: `${pullRequestsRefresh.requestedGeneration > pullRequestsRefresh.completedGeneration ? "A fresh Pull request read is pending." : pullRequestsRefresh.failureReason ?? "The last Pull request read from GitHub failed."} Atlas keeps ownership held until it can confirm.` })
    : "";
  const mono = (title: string, value: string | null | undefined, fallback: string) =>
    settingsRow({ title, value: value ?? fallback, mono: Boolean(value) });
  return `<div class="sv-details">
    ${setGroup("Session", [
      settingsRow({ title: "State", value: sessionLabel(session.state) }),
      settingsRow({ title: "Submitted", valueHtml: `<span class="ax-setrow-val">${relativeTime(session.submittedAt)}</span>` }),
      settingsRow({ title: "Last update", valueHtml: `<span class="ax-setrow-val">${relativeTime(session.updatedAt)}</span>` }),
      settingsRow({ title: "Queue order", value: String(session.submissionOrder) }),
      settingsRow({ title: "Atlas Session", value: session.atlasId, mono: true }),
      settingsRow({ title: "Submission", value: session.submissionId, mono: true }),
      settingsRow({ title: "Repository", value: repository.fullName, mono: true }),
    ])}
    ${setGroup("Starting point", [
      settingsRow({ title: "Original target", value: session.originalTargetKind === "native_stack" ? `Native stack #${session.originalTargetStackNumber ?? "unknown"}` : session.originalTargetKind === "standalone_parent" ? `Standalone parent #${session.originalTargetParentPullRequestNumber ?? "unknown"}` : `Default branch · ${session.originalTargetBranch}` }),
      settingsRow({ title: "Current target", value: sessionTargetLabel(session) }),
      settingsRow({ title: "Resolved parent", value: `${session.resolvedParentBranch ?? session.baseBranch ?? session.targetBranch}${session.baseSha ? ` · ${session.baseSha}` : " · waiting for verified SHA"}`, mono: true }),
      settingsRow({ title: "Resolved trunk", value: session.resolvedTrunkBranch ?? session.baseBranch ?? session.targetBranch, mono: true }),
      settingsRow({ title: "Stack layers", value: session.resolvedLayers.length > 0 ? session.resolvedLayers.map((layer) => `#${layer.pullRequestNumber} ${layer.branch}`).join(" → ") : "Default branch" }),
      mono("Working branch", session.workingBranch, "Not assigned before admission"),
    ])}
    ${setGroup("Pull request", [
      settingsRow({ title: "Publication", value: { not_observed: "Not observed", unverified: "Unverified", ambiguous: "Ambiguous", identified: "Identified", qualifying: "Qualifying", released: "Reservation released" }[session.publicationStatus] ?? session.publicationStatus }),
      session.resultPullRequestId
        ? settingsRow({ title: "Result", valueHtml: `<span class="ax-setrow-val">${prUrl ? `<a class="ax-link" href="${escapeHtml(prUrl)}" target="_blank" rel="noopener noreferrer">#${escapeHtml(session.resultPullRequestNumber ?? "unknown")}</a>` : `#${escapeHtml(session.resultPullRequestNumber ?? "unknown")}`} <span class="ax-mono">${escapeHtml(session.resultPullRequestId)}</span></span>` })
        : settingsRow({ title: "Result", value: "No Pull request identified yet" }),
      session.publicationReason ? settingsRow({ title: "Note", value: session.publicationReason }) : "",
      settingsRow({ title: "Last evidence", value: formatTime(session.publicationObservedAt) }),
      settingsRow({ title: "Stack reservation", value: session.reservationState === "held" ? `Held${session.reservationId ? ` · ${session.reservationId}` : ""}` : session.reservationState === "released" ? "Released" : "None for default-branch work", mono: session.reservationState === "held" && Boolean(session.reservationId) }),
    ])}
    ${prRefresh}
    ${conflicts > 0 ? banner({ tone: "warning", title: "Reservation conflict hold recorded", body: `${conflicts} durable hold${conflicts === 1 ? "" : "s"} remain${conflicts === 1 ? "s" : ""} until every involved owner releases. Running work is not cancelled.` }) : ""}
    ${setGroup("Checkpoints", [
      settingsRow({ title: "Preparation", value: preparationLabel(session.preparationCheckpoint) }),
      session.preparationReason ? settingsRow({ title: "Checkpoint note", value: session.preparationReason }) : "",
      settingsRow({ title: "OpenCode handoff", value: handoffCheckpointLabel(session.handoffCheckpoint) }),
      settingsRow({ title: "Execution slot", value: session.executionSlotHeld ? "Held" : session.state === "queued" ? "Not held while Queued" : "Not held" }),
      mono("Session directory", session.directory, "Not assigned before admission"),
      mono("OpenCode intended Session", session.opencodeIntendedSessionId, "Not assigned before local preparation"),
      mono("OpenCode Session", session.openCodeSessionId, "Not associated"),
      mono("Initial message", session.initialMessageId, "Not assigned"),
      mono("Prompt inbox", session.initialInboxId, "Not accepted"),
      settingsRow({ title: "OpenCode freshness", value: session.opencodeFreshness === "fresh" ? "Fresh" : session.opencodeFreshness === "stale" ? "Not live" : "Not reconciled" }),
      settingsRow({ title: "Last reconciliation", value: formatTime(session.opencodeLastSuccessAt) }),
    ])}
  </div>`;
};

const specPanel = (session: Session, specUrl: string) => `<div class="sv-spec">
    <h3 class="sv-h3">Spec at submission</h3>
    ${prose(session.specBody.trim() ? renderMarkdown(session.specBody) : '<p class="sv-dim-text">No description provided.</p>')}
    <p class="ax-group-foot">Atlas keeps the Spec as it was when the Session started. Later edits on GitHub don’t change this Session.${specUrl ? ` <a class="ax-link" href="${escapeHtml(specUrl)}" target="_blank" rel="noopener noreferrer">Current Spec on GitHub</a>` : ""}</p>
    <h3 class="sv-h3">Your prompt</h3>
    <div class="sv-quote"><div class="sv-pre">${escapeHtml(session.prompt)}</div></div>
    <p class="ax-group-foot">Sent exactly as written.</p>
    ${session.exactMessage ? `<details class="sv-sent" data-fold-key="sent"><summary>${icon("terminal", 15)}Full message sent to OpenCode${icon("chevron", 15, "sv-chev")}</summary><p class="ax-group-foot">The Spec context plus your unchanged prompt, sent once as the first message.</p>${terminalWell(session.exactMessage, "Exact OpenCode handoff message")}</details>` : ""}
  </div>`;

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
  inbox,
  tab: requestedTab,
  pullRequestTitle,
}: {
  csrfToken: string;
  repository: Repository;
  session: Session;
  viewer?: SessionViewerProjection;
  pullRequestsRefresh?: RefreshState;
  viewerRequestUrl?: string;
  viewerLimit?: number;
  openCodeReadiness?: { ready: boolean; reason?: string; versionWarning?: string | null };
  persistenceHealth?: { healthy: boolean; reason?: string | null };
  sessionDirectoryAvailable?: boolean;
  inbox?: InboxContext;
  tab?: string;
  /** Title of the Session's Pull request, when Atlas has seen it. */
  pullRequestTitle?: string;
}) => {
  const id = encodeURIComponent(session.atlasId);
  const tab = sessionTab(requestedTab);
  const specPath = `/repositories/${encodeURIComponent(repository.githubId)}/specs/${encodeURIComponent(session.specIssueNumber)}`;
  const specUrl = safeExternalUrl(session.specHtmlUrl);
  const stale = isStale(session, viewer);
  const terminal = ["succeeded", "failed", "interrupted", "failed_setup"].includes(session.state);

  const menu: MenuItem[] = [
    ...(specUrl ? [{ label: "Spec on GitHub", href: specUrl, external: true }] : []),
    { label: "Spec in Atlas", href: specPath, icon: "doc" },
    { label: `All Sessions for ${repository.name}`, href: sessionsLink(repository), icon: "list" },
    ...(targetReconfirmationNeeded(session) ? [{ label: "Review current target", href: `/sessions/${id}/target`, icon: "branch" as IconName }] : []),
    ...(session.reservationState === "held" && ["succeeded", "failed", "interrupted"].includes(session.state)
      ? [{ label: "Release stack reservation…", href: `/sessions/${id}/reservation/release`, danger: true }]
      : []),
  ];

  const notices = [
    repository.removedAt ? banner({ tone: "warning", title: "This Repository was removed from Atlas", body: "This Session, its history and its files are kept. New Sessions can’t start until the Repository is added again." }) : "",
    repository.accessStatus === "unknown" ? banner({ tone: "warning", title: "Couldn’t check GitHub access", body: "Showing the last data Atlas saw. This doesn’t mean access was removed." }) : "",
    repository.accessStatus === "revoked" ? banner({ tone: "error", title: "GitHub App access is unavailable", body: "This Repository wasn’t in the last complete installation list. Saved data is kept; no new work starts." }) : "",
    repository.accessStatus === "transferred" ? banner({ tone: "error", title: "Repository moved outside the organization", body: "Saved data is kept and new work is paused." }) : "",
    repository.accessStatus === "suspended" ? banner({ tone: "error", title: "The GitHub App installation is suspended", body: "Saved data is kept and new work is paused." }) : "",
    persistenceHealth && !persistenceHealth.healthy ? banner({ tone: "error", title: "Atlas can’t save changes right now", body: `${persistenceHealth.reason ?? "New Sessions are paused while saved Session ownership is protected."} Running OpenCode work is kept.` }) : "",
    openCodeReadiness && !openCodeReadiness.ready ? banner({ tone: "warning", title: "OpenCode launches are paused", body: `${openCodeReadiness.reason ?? "The OpenCode service is unavailable or incompatible."} Atlas shows saved Session data and checks again before resuming.` }) : "",
    openCodeReadiness?.versionWarning ? banner({ tone: "warning", title: "OpenCode version mismatch", body: `${openCodeReadiness.versionWarning} This does not pause launches or affect Atlas updates.`, attrs: "data-opencode-version-warning" }) : "",
    recoveryNotice(session, viewer, sessionDirectoryAvailable),
    session.preparationCheckpoint === "start_unconfirmed"
      ? banner({ tone: "warning", title: "Setup unconfirmed", body: `${session.preparationReason ?? "The recorded folder and setup step need manual recovery."} Atlas won’t repeat a step it isn’t sure about.` })
      : session.handoffUncertainReason
        ? banner({ tone: "warning", title: "Start unconfirmed", body: `${session.handoffUncertainReason} Atlas won’t send the prompt to OpenCode a second time.` })
        : "",
  ].filter(Boolean).join("");

  const staleBanner = stale
    ? `<div class="sv-notlive" role="status">${icon("warn", 18)}<div><b>Not live</b>Atlas lost touch with OpenCode${session.opencodeLastSuccessAt ? ` ${relativeTime(session.opencodeLastSuccessAt)}` : ""}. This is what it last saw; the real state may have changed.${viewer?.staleReason ? ` <span class="sv-dim-text">${escapeHtml(viewer.staleReason)}</span>` : ""}</div></div>`
    : "";

  const base = viewerRequestUrl ?? `/sessions/${id}`;
  const panel = (name: SessionTab, html: string) =>
    `<div id="sv-panel-${name}" class="sv-panel" data-sv-panel="${name}" role="region" aria-label="${escapeHtml(TABS.find((item) => item.id === name)!.label)}"${name === tab ? "" : " hidden"}>${html}</div>`;

  const content = `<div class="sv-page${stale ? " sv-stale" : ""}${terminal ? " sv-terminal" : ""}" data-session-page>
    ${notices}
    <div data-sv-pr-slot>${pullRequestCard(session, pullRequestTitle)}</div>
    ${staleBanner}
    <div class="sv-live-wrap" data-sv-status-slot>${statusCard({ session, viewer, stale })}</div>
    <div class="sv-tabs" data-sv-tabs>${segmented({ label: "Session sections", large: true, items: TABS.map((item) => ({ href: tabHref(base, item.id), label: item.label, current: item.id === tab })) })}</div>
    ${panel("activity", `<div class="sv-live-wrap">${renderSessionViewerFragment({
      session,
      viewer,
      endpoint: `/sessions/${id}/view`,
      eventsEndpoint: `/events?session=${id}`,
      requestUrl: viewerRequestUrl,
      limit: viewerLimit,
    })}</div>`)}
    ${panel("spec", specPanel(session, specUrl))}
    ${panel("details", detailsPanel(session, repository, pullRequestsRefresh))}
  </div>`;

  return renderShell({
    title: `${session.specTitle} · Session`,
    csrfToken,
    historyDisabled: true,
    inbox,
    bodyClass: "sv-detail",
    header: {
      title: session.specTitle,
      eyebrow: `${repository.name} · Spec #${session.specIssueNumber}`,
      back: { href: specPath, label: "Spec" },
      menu: { title: session.specTitle, items: menu },
    },
    content,
  });
};

const recoveryNotice = (session: Session, viewer: { available?: boolean } | undefined, sessionDirectoryAvailable: boolean | undefined) => {
  const terminal = ["succeeded", "failed", "interrupted", "failed_setup"].includes(session.state);
  const directoryExpected = Boolean(session.directory) && !["queued", "intent_saved"].includes(session.preparationCheckpoint);
  const openCodeExpected = session.handoffCheckpoint !== "not_started" || Boolean(session.openCodeSessionId);
  const directoryUnavailable = directoryExpected && sessionDirectoryAvailable === false;
  const historyUnavailable = openCodeExpected && viewer?.available !== true;
  const associationUnavailable = openCodeExpected && !session.openCodeSessionId;
  if (!directoryUnavailable && !historyUnavailable && !associationUnavailable) return "";
  const details = [
    directoryUnavailable ? "The Session’s folder is missing." : "",
    historyUnavailable ? "Atlas couldn’t check the OpenCode history." : "",
    associationUnavailable ? "The OpenCode Session ID is unknown." : "",
  ].filter(Boolean).join(" ");
  const ownership = terminal
    ? session.executionSlotHeld ? "The recorded outcome stays; the execution slot is still marked held." : "The recorded outcome stays as it is."
    : session.executionSlotHeld ? "The Session keeps its execution slot." : "The recorded state stays as it is.";
  return banner({ tone: "warning", title: "Something this Session needs is missing", body: `${details} Atlas keeps what it last knew and won’t recreate anything or guess an outcome. ${ownership}`, role: "alert" });
};
