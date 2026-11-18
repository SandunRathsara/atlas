// Markdown for Spec bodies (Spec page, Start Session, the Session page's Spec snapshot).
// Escape first, then add a small, fixed set of tags. Raw HTML in the source is never passed
// through; links only keep http(s) URLs and open in a new tab without referrer.
import { escapeHtml, safeExternalUrl } from "./html.ts";

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

/** Renders GitHub-flavoured Markdown (a Spec body) as sanitized HTML for `prose(...)`. */
export const renderMarkdown = (body: string) => {
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
      out.push(`<div class="ax-prose-table"><table><thead><tr>${header.map((cell) => `<th scope="col">${cell}</th>`).join("")}</tr></thead><tbody>${body.map((cells) => `<tr>${cells.map((cell) => `<td>${cell}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`);
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
