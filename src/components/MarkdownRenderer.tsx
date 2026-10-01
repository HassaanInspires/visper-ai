import React, { useState } from "react";

interface MarkdownRendererProps {
  text: string;
  theme?: "light" | "dark";
}

function parseTimestampToSeconds(ts: string): number {
  const parts = ts.replace(/[\[\]]/g, "").split(":").map(Number);
  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }
  return 0;
}

function seekYoutubeVideo(seconds: number) {
  if (typeof chrome !== "undefined" && chrome.tabs?.query) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tabId = tabs[0]?.id;
      if (tabId) {
        chrome.tabs.sendMessage(tabId, { type: "YOUTUBE_SEEK", time: seconds }).catch(() => {});
      }
    });
  }
}

const CodeBlock: React.FC<{ code: string; language: string; isDark: boolean }> = ({ code, language, isDark }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const codeBg = isDark ? "bg-[#0c0818]/70 border-white/10 text-zinc-200" : "bg-zinc-100 border-zinc-200 text-zinc-800";
  const headerBg = isDark ? "bg-white/5 border-white/5 text-zinc-400" : "bg-zinc-200/50 border-zinc-200 text-zinc-600";

  return (
    <div className={`my-3 rounded-lg overflow-hidden border ${codeBg} text-xs font-mono shadow-sm`}>
      <div className={`flex items-center justify-between px-3 py-1.5 border-b text-[11px] ${headerBg}`}>
        <span className="uppercase font-semibold tracking-wider text-[10px]">{language || "code"}</span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium transition-colors hover:bg-white/10 active:scale-95"
          title="Copy code to clipboard"
        >
          {copied ? "✓ Copied" : "Copy"}
        </button>
      </div>
      <pre className="p-3 overflow-x-auto leading-relaxed whitespace-pre select-text">
        <code>{code}</code>
      </pre>
    </div>
  );
};

export const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({ text, theme = "dark" }) => {
  if (!text) return null;

  const isDark = theme === "dark";

  // Dynamic Theme Colors
  const textClass = isDark ? "text-zinc-200" : "text-zinc-800";
  const mutedTextClass = isDark ? "text-zinc-400" : "text-zinc-500";
  
  const h1Class = isDark ? "text-white" : "text-zinc-950";
  const h2Class = isDark ? "text-zinc-100" : "text-zinc-900";
  const h3Class = isDark ? "text-zinc-200" : "text-zinc-800";
  const h4Class = isDark ? "text-zinc-300" : "text-zinc-700";
  const h5Class = isDark ? "text-zinc-400" : "text-zinc-600";
  
  const borderClass = isDark ? "border-white/10" : "border-zinc-200";
  const blockquoteBorder = isDark ? "border-zinc-500" : "border-zinc-300";

  // Split content by code blocks, correctly handling unclosed code blocks during streaming
  const parts = text.split(/(```[\s\S]*?(?:```|$))/g);

  return (
    <div className={`markdown-body space-y-2.5 w-full overflow-hidden break-words ${textClass}`}>
      {parts.map((part, index) => {
        // Render Code Block
        if (part.startsWith("```")) {
          const hasClosing = part.endsWith("```") && part.length > 3;
          const raw = hasClosing ? part.slice(3, -3) : part.slice(3);
          const firstLineBreak = raw.indexOf("\n");
          let lang = "";
          let content = raw;
          if (firstLineBreak !== -1) {
            lang = raw.slice(0, firstLineBreak).trim();
            content = raw.slice(firstLineBreak + 1);
          }

          return <CodeBlock key={index} code={content.trimEnd()} language={lang} isDark={isDark} />;
        }

        // Render regular text segment (parse paragraphs, bullet lists, and GFM tables)
        const lines = part.split("\n");
        const renderedElements: React.ReactNode[] = [];
        let listItems: React.ReactNode[] = [];
        let inList = false;

        let tableLines: string[] = [];
        let inTable = false;

        const flushList = (key: string | number) => {
          if (listItems.length > 0) {
            renderedElements.push(
              <ul key={`ul-${key}`} className="list-disc pl-5 my-2 space-y-1">
                {listItems}
              </ul>
            );
            listItems = [];
            inList = false;
          }
        };

        const flushTable = (key: string | number) => {
          if (tableLines.length >= 2) {
            const tableKey = `table-${key}`;
            const parsedRows = tableLines.map(rowStr => 
              rowStr
                .split("|")
                .map(c => c.trim())
                .filter((_, idx, arr) => idx > 0 && idx < arr.length - 1 || (arr.length === 1))
            );

            // First row is header, second row is divider
            const headerRow = parsedRows[0] || [];
            const bodyRows = parsedRows.slice(2).filter(row => row.length > 0 && row.some(cell => cell.trim() !== ""));

            const thBg = isDark ? "bg-white/10 text-white border-white/10" : "bg-zinc-200/70 text-zinc-900 border-zinc-300";
            const tdBorder = isDark ? "border-white/10" : "border-zinc-200";
            const rowHover = isDark ? "hover:bg-white/5" : "hover:bg-zinc-50";

            renderedElements.push(
              <div key={tableKey} className="my-3 overflow-x-auto rounded-lg border border-white/10 shadow-sm select-text">
                <table className="w-full text-xs text-left border-collapse">
                  <thead>
                    <tr className={thBg}>
                      {headerRow.map((cell, cIdx) => (
                        <th key={cIdx} className="px-3 py-2 font-semibold border-b border-white/10 whitespace-nowrap">
                          {parseInlineFormatting(cell, isDark)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {bodyRows.map((row, rIdx) => (
                      <tr key={rIdx} className={`border-b transition-colors ${tdBorder} ${rowHover}`}>
                        {row.map((cell, cIdx) => (
                          <td key={cIdx} className="px-3 py-2 text-xs leading-normal">
                            {parseInlineFormatting(cell, isDark)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          }
          tableLines = [];
          inTable = false;
        };

        lines.forEach((line, lineIdx) => {
          const trimmed = line.trim();

          // Table line matching (starts/ends with | or has at least 2 |)
          const isTableLine = (trimmed.startsWith("|") && trimmed.endsWith("|")) || (trimmed.includes("|") && trimmed.split("|").length >= 3);

          if (isTableLine) {
            if (inList) flushList(lineIdx);
            inTable = true;
            tableLines.push(trimmed);
            return;
          }

          if (inTable) {
            flushTable(lineIdx);
          }

          // 1. Bullet list matching
          if (trimmed.startsWith("* ") || trimmed.startsWith("- ")) {
            inList = true;
            listItems.push(
              <li key={lineIdx} className="text-sm">
                {parseInlineFormatting(trimmed.slice(2), isDark)}
              </li>
            );
            return;
          }

          // Not a list item — flush existing list if any
          if (inList) {
            flushList(lineIdx);
          }

          // 2. Blockquote matching
          if (trimmed.startsWith(">")) {
            renderedElements.push(
              <blockquote key={lineIdx} className={`pl-3.5 border-l-[3px] italic my-2.5 py-0.5 text-sm ${blockquoteBorder} ${mutedTextClass}`}>
                {parseInlineFormatting(trimmed.slice(1).trim(), isDark)}
              </blockquote>
            );
            return;
          }

          // 3. Headers matching
          if (trimmed.startsWith("##### ")) {
            renderedElements.push(
              <h6 key={lineIdx} className={`text-[10px] font-bold uppercase tracking-wider mt-3 mb-1 ${h5Class}`}>
                {parseInlineFormatting(trimmed.slice(6), isDark)}
              </h6>
            );
            return;
          }
          if (trimmed.startsWith("#### ")) {
            renderedElements.push(
              <h5 key={lineIdx} className={`text-xs font-bold mt-3 mb-1 ${h4Class}`}>
                {parseInlineFormatting(trimmed.slice(5), isDark)}
              </h5>
            );
            return;
          }
          if (trimmed.startsWith("### ")) {
            renderedElements.push(
              <h4 key={lineIdx} className={`text-xs font-bold uppercase tracking-wider mt-4 mb-1 ${h3Class}`}>
                {parseInlineFormatting(trimmed.slice(4), isDark)}
              </h4>
            );
            return;
          }
          if (trimmed.startsWith("## ")) {
            renderedElements.push(
              <h3 key={lineIdx} className={`text-sm font-bold mt-4 mb-1.5 border-b pb-0.5 ${borderClass} ${h2Class}`}>
                {parseInlineFormatting(trimmed.slice(3), isDark)}
              </h3>
            );
            return;
          }
          if (trimmed.startsWith("# ")) {
            renderedElements.push(
              <h2 key={lineIdx} className={`text-base font-bold mt-5 mb-2 ${h1Class}`}>
                {parseInlineFormatting(trimmed.slice(2), isDark)}
              </h2>
            );
            return;
          }

          // 4. Horizontal Rule
          if (trimmed === "---") {
            renderedElements.push(
              <hr key={lineIdx} className={`my-4 border-t ${borderClass}`} />
            );
            return;
          }

          // 5. Empty paragraph
          if (!trimmed) {
            return;
          }

          // 6. Default Paragraph
          renderedElements.push(
            <p key={lineIdx} className="text-sm leading-relaxed my-1">
              {parseInlineFormatting(line, isDark)}
            </p>
          );
        });

        // Flush list or table at the end of lines if necessary
        if (inList) flushList(index);
        if (inTable) flushTable(index);

        return <div key={index}>{renderedElements}</div>;
      })}
    </div>
  );
};

// Helper: Parser for bold, italic, links, inline code formatting, and clickable YouTube timestamps
function parseInlineFormatting(text: string, isDark: boolean): React.ReactNode[] {
  // Regex pattern for bold (**), italic (*), links ([text](url)), inline code (`), and timestamps ([01:23] or 01:23)
  const regex = /(\*\*.*?\*\*|\*.*?\*|`.*?`|\[.*?\]\(.*?\)|\b\d{1,2}:\d{2}(?::\d{2})?\b|\[\d{1,2}:\d{2}(?::\d{2})?\])/g;
  const tokens = text.split(regex);
  const inlineCodeBg = isDark ? "bg-white/10 text-indigo-300 border-white/5" : "bg-black/5 text-indigo-600 border-black/5";
  const linkClass = isDark ? "text-indigo-400 hover:text-indigo-300" : "text-indigo-600 hover:text-indigo-700";
  const boldClass = isDark ? "font-semibold text-white" : "font-semibold text-zinc-950";
  const italicClass = isDark ? "italic text-zinc-300" : "italic text-zinc-600";
  const timestampBg = isDark ? "bg-purple-500/15 text-purple-300 hover:bg-purple-500/25 border-purple-500/20" : "bg-purple-100 text-purple-700 hover:bg-purple-200 border-purple-300";

  return tokens.map((token, index) => {
    // Bold: **text**
    if (token.startsWith("**") && token.endsWith("**")) {
      return <strong key={index} className={boldClass}>{token.slice(2, -2)}</strong>;
    }
    // Italic: *text*
    if (token.startsWith("*") && token.endsWith("*")) {
      return <em key={index} className={italicClass}>{token.slice(1, -1)}</em>;
    }
    // Inline Code: `code`
    if (token.startsWith("`") && token.endsWith("`")) {
      return <code key={index} className={`px-1.5 py-0.5 rounded font-mono text-xs border ${inlineCodeBg}`}>{token.slice(1, -1)}</code>;
    }
    // Link: [anchor](url)
    if (token.startsWith("[") && token.includes("](")) {
      const labelMatch = token.match(/\[(.*?)\]/);
      const urlMatch = token.match(/\((.*?)\)/);
      if (labelMatch && urlMatch) {
        const label = labelMatch[1];
        const url = urlMatch[1];
        return (
          <a
            key={index}
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className={`underline font-medium transition-colors cursor-pointer ${linkClass}`}
            onClick={(e) => {
              e.preventDefault();
              chrome.tabs.create({ url });
            }}
          >
            {label}
          </a>
        );
      }
    }
    // Clickable YouTube timestamp: [01:23] or 01:23
    const isTimestamp = /^\[?\d{1,2}:\d{2}(?::\d{2})?\]?$/.test(token);
    if (isTimestamp) {
      const cleanTs = token.replace(/[\[\]]/g, "");
      const seconds = parseTimestampToSeconds(cleanTs);
      return (
        <button
          key={index}
          type="button"
          onClick={() => seekYoutubeVideo(seconds)}
          className={`inline-flex items-center gap-1 px-1.5 py-0.5 mx-0.5 rounded text-[11px] font-mono font-medium border transition-colors cursor-pointer active:scale-95 ${timestampBg}`}
          title={`Seek video to ${cleanTs}`}
        >
          <span>▶</span>
          <span>{cleanTs}</span>
        </button>
      );
    }

    return token;
  });
}
