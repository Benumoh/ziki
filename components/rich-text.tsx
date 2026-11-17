import { Fragment, type ReactNode } from "react";
import {
  inlineImageSrc,
  looksLikeMarkdown,
  safeHref,
  stripLegacyMarkup,
  tokenizeInline,
} from "@/lib/rich-text";

type RichTextProps = {
  content: string;
  /** Extra classes appended to the default Markdown styles. */
  className?: string;
  /** Optional renderer for mention tags `@[Name](userId)` inside text segments. */
  renderMentions?: (text: string) => ReactNode;
};

// Inline-code styles are scoped to `:not(pre) > code`; fenced blocks keep the
// dark `pre` palette instead of light-on-light text (#113).
export const DEFAULT_CLASS_NAME =
  "rich-text mt-3 space-y-2 [overflow-wrap:anywhere] break-words text-slate-800 [&_a]:font-medium [&_a]:text-teal-700 [&_a]:underline [&_a]:break-all [&_:not(pre)>code]:break-all [&_:not(pre)>code]:rounded [&_:not(pre)>code]:bg-slate-100 [&_:not(pre)>code]:px-1 [&_:not(pre)>code]:py-0.5 [&_:not(pre)>code]:text-[0.9em] [&_del]:text-slate-500 [&_h1]:text-xl [&_h1]:font-semibold [&_h2]:text-lg [&_h2]:font-semibold [&_h3]:text-base [&_h3]:font-semibold [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-slate-900 [&_pre]:p-3 [&_pre]:text-sm [&_pre]:text-slate-100 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5";

/**
 * Safely render Markdown (or plain text) without raw HTML injection.
 *
 * Everything is emitted as React elements, so user content is escaped by
 * React itself; the only HTML-ish output is a link/image whose href has been
 * checked by `safeHref` (http/https/mailto only). Tag-like text such as
 * `<Button>` is displayed as typed; only legacy `<u>` underline tags are dropped.
 */
export function RichText({ content, className, renderMentions }: RichTextProps) {
  if (!content) return null;

  const safeContent = stripLegacyMarkup(content);
  const extra = className ? ` ${className}` : "";

  if (!looksLikeMarkdown(safeContent)) {
    const body = renderMentions ? renderMentions(safeContent) : safeContent;
    return (
      <div className={`mt-3 whitespace-pre-wrap [overflow-wrap:anywhere] break-words text-slate-800${extra}`}>{body}</div>
    );
  }

  return (
    <div className={`${DEFAULT_CLASS_NAME}${extra}`}>
      {renderBlocks(safeContent.replace(/\r\n/g, "\n").split("\n"), renderMentions)}
    </div>
  );
}

const LIST_ITEM_RE = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const TASK_MARKER_RE = /^\[([ xX])\]\s+(.*)$/;
const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const QUOTE_RE = /^>\s?(.*)$/;
const FENCE_RE = /^ {0,3}(`{3,}|~{3,})/;
const RULE_RE = /^\s*(?:(?:-\s*){3,}|(?:\*\s*){3,}|(?:_\s*){3,})$/;

type ListItem = {
  ordered: boolean;
  orderNumber?: number;
  task: boolean;
  checked: boolean;
  lines: string[];
  children: ListItem[];
};

function indentOf(line: string): number {
  return /^[\t ]*/.exec(line)?.[0].replace(/\t/g, "  ").length ?? 0;
}

/** Group consecutive list lines into a nested item tree. */
function parseList(
  lines: string[],
  start: number,
): { items: ListItem[]; next: number } {
  const items: ListItem[] = [];
  const stack: { indent: number; list: ListItem[] }[] = [];
  let last: ListItem | null = null;
  let i = start;

  while (i < lines.length) {
    const line = lines[i] ?? "";
    const match = LIST_ITEM_RE.exec(line);

    if (match) {
      const indent = indentOf(line);
      const marker = match[2] ?? "-";
      const rest = match[3] ?? "";
      const taskMatch = TASK_MARKER_RE.exec(rest);

      while (stack.length > 0 && (stack[stack.length - 1]?.indent ?? 0) >= indent) {
        stack.pop();
      }

      const parent = stack[stack.length - 1]?.list.slice(-1)[0];
      const target = parent ? parent.children : items;
      const isOrdered = /\d/.test(marker);
      const orderNumber = isOrdered ? parseInt(marker, 10) : undefined;
      const item: ListItem = {
        ordered: isOrdered,
        orderNumber: Number.isFinite(orderNumber) ? orderNumber : undefined,
        task: Boolean(taskMatch),
        checked: (taskMatch?.[1] ?? " ").toLowerCase() === "x",
        lines: [taskMatch?.[2] ?? rest],
        children: [],
      };
      target.push(item);
      last = item;
      stack.push({ indent, list: target });
      i += 1;
      continue;
    }

    // Lazy continuation line for the previous item.
    if (last && line.trim() !== "" && !isBlockStart(line)) {
      last.lines.push(line.trim());
      i += 1;
      continue;
    }

    break;
  }

  return { items, next: i };
}

/** `| --- | --- |`: the row under a table's header that marks it as a table. */
function isTableDelimiterRow(row: string): boolean {
  const cells = row
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
  return cells.length > 0 && cells.every((cell) => /^:?-+:?$/.test(cell));
}

function isBlockStart(line: string): boolean {
  return (
    FENCE_RE.test(line) ||
    HEADING_RE.test(line) ||
    RULE_RE.test(line) ||
    QUOTE_RE.test(line) ||
    LIST_ITEM_RE.test(line) ||
    (line.trim().startsWith("|") && line.trim().endsWith("|"))
  );
}

/**
 * Render sibling items, starting a new list whenever the marker type switches
 * between ordered and unordered, so `1. a` then `- b` stays an ol + ul (#725).
 */
function renderListItems(items: ListItem[], renderMentions?: (text: string) => ReactNode) {
  const runs: ListItem[][] = [];
  for (const item of items) {
    const run = runs[runs.length - 1];
    if (run && run[0]?.ordered === item.ordered) run.push(item);
    else runs.push([item]);
  }
  if (runs.length <= 1) return renderListRun(items, renderMentions);
  return runs.map((run, index) => (
    <Fragment key={index}>{renderListRun(run, renderMentions)}</Fragment>
  ));
}

function renderListRun(items: ListItem[], renderMentions?: (text: string) => ReactNode) {
  if (items.length === 0) return null;
  const ordered = items[0]?.ordered ?? false;
  const start = ordered ? items[0]?.orderNumber : undefined;

  if (ordered) {
    return (
      <ol start={start}>
        {items.map((item, index) => (
          <li key={index} className={item.task ? "list-none" : undefined}>
            {item.task ? (
              <span className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={item.checked}
                  readOnly
                  disabled
                  className="mt-1 h-3.5 w-3.5 shrink-0 accent-teal-600"
                />
                <span className="min-w-0">
                  {renderInline(item.lines.join(" "), renderMentions)}
                </span>
              </span>
            ) : (
              renderInline(item.lines.join(" "), renderMentions)
            )}
            {renderListItems(item.children, renderMentions)}
          </li>
        ))}
      </ol>
    );
  }

  return (
    <ul>
      {items.map((item, index) => (
        <li key={index} className={item.task ? "list-none" : undefined}>
          {item.task ? (
            <span className="flex items-start gap-2">
              <input
                type="checkbox"
                checked={item.checked}
                readOnly
                disabled
                className="mt-1 h-3.5 w-3.5 shrink-0 accent-teal-600"
              />
              <span className="min-w-0">
                {renderInline(item.lines.join(" "), renderMentions)}
              </span>
            </span>
          ) : (
            renderInline(item.lines.join(" "), renderMentions)
          )}
          {renderListItems(item.children, renderMentions)}
        </li>
      ))}
    </ul>
  );
}

function renderBlocks(
  lines: string[],
  renderMentions?: (text: string) => ReactNode,
): ReactNode[] {
  const nodes: ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i] ?? "";

    if (line.trim() === "") {
      i += 1;
      continue;
    }

    const open = FENCE_RE.exec(line);
    if (open) {
      // Only a bare fence of the same character, at least as long, closes the
      // block, so a ``` sample inside a ```` block stays code (#723).
      const marker = open[1] ?? "```";
      const isClose = (candidate: string) => {
        const close = FENCE_RE.exec(candidate)?.[1];
        return (
          !!close &&
          close[0] === marker[0] &&
          close.length >= marker.length &&
          candidate.trim() === close
        );
      };
      const fence: string[] = [];
      i += 1;
      while (i < lines.length && !isClose(lines[i] ?? "")) {
        fence.push(lines[i] ?? "");
        i += 1;
      }
      if (i < lines.length) i += 1;
      nodes.push(
        /* Focusable so a keyboard user can scroll a long line: a code block
           overflows on purpose, and axe flags an unreachable scroll region.
           A focusable scroll container is the fix, not the bug. */
        // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
        <pre key={`pre-${key++}`} tabIndex={0} role="group" aria-label="Code block">
          <code>{fence.join("\n")}</code>
        </pre>,
      );
      continue;
    }

    const heading = HEADING_RE.exec(line);
    if (heading) {
      const level = Math.min(heading[1]?.length ?? 1, 3);
      const HeadingTag = level === 1 ? "h1" : level === 2 ? "h2" : "h3";
      nodes.push(
        <HeadingTag key={`h-${key++}`}>
          {renderInline(heading[2] ?? "", renderMentions)}
        </HeadingTag>,
      );
      i += 1;
      continue;
    }

    if (RULE_RE.test(line)) {
      nodes.push(<hr key={`hr-${key++}`} className="border-slate-200" />);
      i += 1;
      continue;
    }

    if (QUOTE_RE.test(line)) {
      const quoted: string[] = [];
      while (i < lines.length && QUOTE_RE.test(lines[i] ?? "")) {
        quoted.push(QUOTE_RE.exec(lines[i] ?? "")?.[1] ?? "");
        i += 1;
      }
      nodes.push(
        <blockquote
          key={`quote-${key++}`}
          className="border-l-4 border-slate-200 pl-3 text-slate-700"
        >
          {renderBlocks(quoted, renderMentions)}
        </blockquote>,
      );
      continue;
    }

    const isTable =
      line.trim().startsWith("|") &&
      line.trim().endsWith("|") &&
      i + 1 < lines.length &&
      isTableDelimiterRow(lines[i + 1]);

    if (isTable) {
      const parseCells = (row: string) =>
        row
          .trim()
          .replace(/^\|/, "")
          .replace(/\|$/, "")
          .split("|")
          .map((c) => c.trim());

      const headers = parseCells(line);
      i += 2; // skip header and delimiter row
      const tableRows: string[][] = [];
      while (
        i < lines.length &&
        lines[i].trim().startsWith("|") &&
        lines[i].trim().endsWith("|")
      ) {
        tableRows.push(parseCells(lines[i]));
        i += 1;
      }

      nodes.push(
        <div
          key={`table-${key++}`}
          className="my-3 overflow-x-auto rounded-xl border border-zk-border shadow-xs"
        >
          <table className="w-full text-left text-sm">
            <thead className="border-b border-zk-border bg-zk-chip/60 text-xs font-bold text-zk-text">
              <tr>
                {headers.map((h, hIdx) => (
                  <th key={hIdx} className="px-4 py-2.5 font-bold">
                    {renderInline(h, renderMentions)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-zk-border font-mono text-xs">
              {tableRows.map((r, rIdx) => (
                <tr key={rIdx} className="hover:bg-zk-chip/30 transition">
                  {r.map((c, cIdx) => (
                    <td
                      key={cIdx}
                      className={`px-4 py-2 ${
                        cIdx === 0
                          ? "font-sans font-medium text-zk-text text-sm"
                          : "text-zk-text2"
                      }`}
                    >
                      {renderInline(c, renderMentions)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    if (LIST_ITEM_RE.test(line)) {
      const { items, next } = parseList(lines, i);
      const list = renderListItems(items, renderMentions);
      if (list) nodes.push(<div key={`list-${key++}`}>{list}</div>);
      i = next;
      continue;
    }

    const paragraph: string[] = [line];
    i += 1;
    while (
      i < lines.length &&
      (lines[i] ?? "").trim() !== "" &&
      !isBlockStart(lines[i] ?? "")
    ) {
      paragraph.push(lines[i] ?? "");
      i += 1;
    }
    nodes.push(
      <p key={`p-${key++}`} className="whitespace-pre-wrap">
        {renderInline(paragraph.join("\n"), renderMentions)}
      </p>,
    );
  }

  return nodes;
}




function renderInline(
  text: string,
  renderMentions?: (text: string) => ReactNode,
): ReactNode[] {
  return tokenizeInline(text).map((token, index) => {
    if (token.type === "text") {
      return (
        <span key={index}>
          {renderMentions ? renderMentions(token.value) : token.value}
        </span>
      );
    }
    if (token.type === "code") {
      return <code key={index}>{token.value}</code>;
    }
    if (token.type === "bold") {
      return (
        <strong key={index}>
          {renderInline(token.value, renderMentions)}
        </strong>
      );
    }
    if (token.type === "italic") {
      return (
        <em key={index}>
          {renderInline(token.value, renderMentions)}
        </em>
      );
    }
    if (token.type === "strikethrough") {
      return (
        <del key={index}>
          {renderInline(token.value, renderMentions)}
        </del>
      );
    }
    if (token.type === "image") {
      const src = inlineImageSrc(token.src);
      if (src) {
        return (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={index}
            src={src}
            alt={token.alt}
            loading="lazy"
            referrerPolicy="no-referrer"
            className="max-h-96 max-w-full rounded-lg border border-slate-200"
          />
        );
      }
      // Other hosts: a link the reader can choose to open; nothing auto-loads.
      const href = safeHref(token.src);
      const label = token.alt || "image";
      if (!href) return <span key={index}>{label}</span>;
      return (
        <a key={index} href={href} target="_blank" rel="noopener noreferrer">
          {label}
        </a>
      );
    }

    const href = safeHref(token.href);
    const label = token.type === "link" ? token.label : token.href;
    if (!href) return <span key={index}>{label}</span>;
    return (
      <a
        key={index}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        // A bare URL already shows its address; the print stylesheet uses
        // this to avoid printing it twice (#300).
        data-bare-url={label === token.href ? "" : undefined}
      >
        {label}
      </a>
    );
  });
}