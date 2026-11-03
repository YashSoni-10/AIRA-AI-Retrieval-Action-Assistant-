import React, { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import "highlight.js/styles/github-dark.css";
import { IconCheck, IconClipboardList } from "./icons";

interface MarkdownRendererProps {
  content: string;
  isDark?: boolean;
}

/**
 * Validates URLs to prevent javascript: or unsafe protocol execution.
 */
function isSafeUrl(url?: string): boolean {
  if (!url) return false;
  try {
    const trimmed = url.trim();
    if (trimmed.startsWith("#") || trimmed.startsWith("/")) return true;
    const parsed = new URL(trimmed);
    return ["http:", "https:", "mailto:"].includes(parsed.protocol);
  } catch {
    return false;
  }
}

/**
 * Copy button component for fenced code blocks.
 */
function CopyButton({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  };

  return (
    <button
      onClick={handleCopy}
      type="button"
      className="inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-[11px] font-medium text-zinc-400 hover:text-white hover:bg-white/10 transition-colors"
      title="Copy code"
      aria-label="Copy code to clipboard"
    >
      {copied ? (
        <>
          <IconCheck className="h-3.5 w-3.5 text-emerald-400" />
          <span className="text-emerald-400">Copied</span>
        </>
      ) : (
        <>
          <IconClipboardList className="h-3.5 w-3.5" />
          <span>Copy</span>
        </>
      )}
    </button>
  );
}

export const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({ content, isDark = true }) => {
  return (
    <div
      className={`aira-markdown leading-relaxed break-words text-sm ${
        isDark ? "text-zinc-200" : "text-slate-800"
      }`}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          // Headings with clear hierarchy and spacing
          h1: ({ children }) => (
            <h1
              className={`text-xl md:text-2xl font-bold mt-5 mb-3 pb-1.5 border-b ${
                isDark ? "text-white border-white/10" : "text-slate-900 border-slate-200"
              }`}
            >
              {children}
            </h1>
          ),
          h2: ({ children }) => (
            <h2
              className={`text-lg md:text-xl font-bold mt-4 mb-2.5 pb-1 border-b ${
                isDark ? "text-cyan-300 border-white/10" : "text-blue-700 border-slate-200"
              }`}
            >
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3
              className={`text-base md:text-lg font-semibold mt-3.5 mb-2 ${
                isDark ? "text-cyan-200" : "text-slate-900"
              }`}
            >
              {children}
            </h3>
          ),
          h4: ({ children }) => (
            <h4
              className={`text-sm md:text-base font-semibold mt-3 mb-1.5 ${
                isDark ? "text-zinc-200" : "text-slate-800"
              }`}
            >
              {children}
            </h4>
          ),

          // Paragraphs with comfortable line-height
          p: ({ children }) => <p className="mb-3 leading-relaxed last:mb-0">{children}</p>,

          // Lists with visible custom bullets and numbers
          ul: ({ children }) => (
            <ul className="mb-3 pl-5 space-y-1 list-disc marker:text-cyan-400">
              {children}
            </ul>
          ),
          ol: ({ children }) => (
            <ol className="mb-3 pl-5 space-y-1 list-decimal marker:text-cyan-400 marker:font-semibold">
              {children}
            </ol>
          ),
          li: ({ children }) => <li className="leading-relaxed pl-1">{children}</li>,

          // Blockquotes
          blockquote: ({ children }) => (
            <blockquote
              className={`my-3 pl-4 border-l-4 italic py-1 rounded-r-lg ${
                isDark
                  ? "border-cyan-500/60 bg-cyan-950/20 text-zinc-300"
                  : "border-blue-500 bg-blue-50/60 text-slate-700"
              }`}
            >
              {children}
            </blockquote>
          ),

          // Tables
          table: ({ children }) => (
            <div className={`overflow-x-auto my-4 rounded-xl border shadow-sm ${isDark ? "border-white/10" : "border-slate-200"}`}>
              <table className={`min-w-full divide-y text-xs md:text-sm ${isDark ? "divide-white/10" : "divide-slate-200"}`}>
                {children}
              </table>
            </div>
          ),
          thead: ({ children }) => (
            <thead className={isDark ? "bg-white/5 text-zinc-300" : "bg-slate-100 text-slate-700"}>
              {children}
            </thead>
          ),
          tbody: ({ children }) => (
            <tbody className={`divide-y ${isDark ? "divide-white/5" : "divide-slate-200"}`}>
              {children}
            </tbody>
          ),
          tr: ({ children }) => (
            <tr className={isDark ? "hover:bg-white/[0.02]" : "hover:bg-slate-50"}>
              {children}
            </tr>
          ),
          th: ({ children }) => (
            <th className="px-3.5 py-2.5 text-left font-semibold tracking-wider">{children}</th>
          ),
          td: ({ children }) => (
            <td className="px-3.5 py-2 leading-relaxed">{children}</td>
          ),

          // Code blocks & inline code
          code: ({ node, inline, className, children, ...props }: any) => {
            const match = /language-(\w+)/.exec(className || "");
            const language = match ? match[1] : "";
            const codeString = String(children).replace(/\n$/, "");

            if (!inline && (match || String(children).includes("\n"))) {
              return (
                <div className="my-3 overflow-hidden rounded-xl border border-zinc-800 bg-[#0d1117] shadow-lg">
                  {/* Code block header bar */}
                  <div className="flex items-center justify-between px-3.5 py-1.5 border-b border-zinc-800 bg-zinc-900/80 text-xs">
                    <span className="font-mono text-[11px] uppercase tracking-wider text-zinc-400">
                      {language || "code"}
                    </span>
                    <CopyButton code={codeString} />
                  </div>
                  {/* Code block body */}
                  <div className="overflow-x-auto p-3.5 text-xs md:text-sm font-mono leading-relaxed">
                    <pre className="!bg-transparent !p-0 !m-0">
                      <code className={className} {...props}>
                        {children}
                      </code>
                    </pre>
                  </div>
                </div>
              );
            }

            // Inline code
            return (
              <code
                className={`rounded px-1.5 py-0.5 font-mono text-[0.85em] ${
                  isDark
                    ? "bg-white/10 text-cyan-300 border border-white/10"
                    : "bg-slate-100 text-blue-700 border border-slate-200 font-semibold"
                }`}
                {...props}
              >
                {children}
              </code>
            );
          },

          // Links
          a: ({ href, children }) => {
            const safe = isSafeUrl(href);
            if (!safe) {
              return <span>{children}</span>;
            }
            return (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className={`underline underline-offset-2 transition-colors ${
                  isDark
                    ? "text-cyan-400 hover:text-cyan-300"
                    : "text-blue-600 hover:text-blue-800 font-medium"
                }`}
              >
                {children}
              </a>
            );
          },

          // Horizontal rule
          hr: () => (
            <hr className={`my-4 border-0 h-[1px] ${isDark ? "bg-white/10" : "bg-slate-200"}`} />
          ),

          // Emphasis
          strong: ({ children }) => (
            <strong className={`font-semibold ${isDark ? "text-white" : "text-slate-900"}`}>
              {children}
            </strong>
          ),
          em: ({ children }) => <em className="italic">{children}</em>,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
};

export default MarkdownRenderer;
