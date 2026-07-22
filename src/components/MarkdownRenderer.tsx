import React from "react";

interface MarkdownRendererProps {
  text: string;
  theme?: "light" | "dark";
}

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
  
  const codeBg = isDark ? "bg-[#0c0818]/65 border-white/5 text-zinc-300" : "bg-zinc-100 border-zinc-200 text-zinc-800";

  // Split content by code blocks to separate code from text blocks
  const parts = text.split(/(```[\s\S]*?```)/g);

  return (
    <div className={`markdown-body space-y-2.5 w-full overflow-hidden break-words ${textClass}`}>
      {parts.map((part, index) => {
        // Render Code Block
        if (part.startsWith("```")) {
          const match = part.match(/```(\w*)\n([\s\S]*?)```/);
          const lang = match ? match[1] : "";
          const content = match ? match[2] : part.slice(3, -3);

          return (
            <pre key={index} className={`my-3 p-3 rounded-lg overflow-x-auto font-mono text-xs leading-relaxed leading-5 border ${codeBg}`}>
              {lang && (
                <div className={`text-[10px] uppercase font-bold tracking-wider mb-2 select-none ${mutedTextClass}`}>
                  {lang}
                </div>
              )}
              <code className="select-text whitespace-pre block">{content.trim()}</code>
            </pre>
          );
        }

        // Render regular text segment (parse paragraphs and bullet lists)
        const lines = part.split("\n");
        const renderedElements: React.ReactNode[] = [];
        let listItems: React.ReactNode[] = [];
        let inList = false;

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

        lines.forEach((line, lineIdx) => {
          const trimmed = line.trim();

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

        // Flush list at the end of parts if necessary
        if (inList) {
          flushList(index);
        }

        return <div key={index}>{renderedElements}</div>;
      })}
    </div>
  );
};

// Helper: Parser for bold, italic, links, and inline code formatting
function parseInlineFormatting(text: string, isDark: boolean): React.ReactNode[] {
  // Regex pattern for bold (**), italic (*), links ([text](url)), and inline code (`)
  const regex = /(\*\*.*?\*\*|\*.*?\*|`.*?`|\[.*?\]\(.*?\))/g;
  const tokens = text.split(regex);
  const inlineCodeBg = isDark ? "bg-white/10 text-indigo-300 border-white/5" : "bg-black/5 text-indigo-600 border-black/5";
  const linkClass = isDark ? "text-indigo-400 hover:text-indigo-300" : "text-indigo-600 hover:text-indigo-700";
  const boldClass = isDark ? "font-semibold text-white" : "font-semibold text-zinc-950";
  const italicClass = isDark ? "italic text-zinc-300" : "italic text-zinc-600";

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

    return token;
  });
}
