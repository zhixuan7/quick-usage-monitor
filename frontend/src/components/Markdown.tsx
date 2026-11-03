'use client';

/**
 * Markdown renderer for chat content (user messages and agent replies).
 * GFM enabled so tables render, remark-breaks keeps single newlines as line
 * breaks (chat replies rely on them). react-markdown escapes raw HTML by
 * default, which is what we want for untrusted chat text.
 */
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import { cn } from '@/lib/utils';

export default function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={cn('space-y-2 text-sm leading-relaxed [overflow-wrap:anywhere]', className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        components={{
          h1: ({ children }) => <h3 className="mt-3 text-base font-semibold text-ink-900 first:mt-0">{children}</h3>,
          h2: ({ children }) => <h4 className="mt-3 text-sm font-semibold text-ink-900 first:mt-0">{children}</h4>,
          h3: ({ children }) => <h5 className="mt-3 text-sm font-semibold text-ink-900 first:mt-0">{children}</h5>,
          h4: ({ children }) => <h6 className="mt-2 text-sm font-semibold text-ink-900 first:mt-0">{children}</h6>,
          p: ({ children }) => <p className="my-2 first:mt-0 last:mb-0">{children}</p>,
          ul: ({ children }) => <ul className="my-2 list-disc space-y-1 pl-5 first:mt-0 last:mb-0">{children}</ul>,
          ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 pl-5 first:mt-0 last:mb-0">{children}</ol>,
          li: ({ children }) => <li>{children}</li>,
          a: ({ children, href }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-quick-600 underline-offset-2 hover:text-quick-800 hover:underline"
            >
              {children}
            </a>
          ),
          blockquote: ({ children }) => (
            <blockquote className="my-2 border-l-2 border-quick-300 pl-3 text-ink-700">{children}</blockquote>
          ),
          code: ({ children, className }) =>
            className?.includes('language-') ? (
              <code className={cn('block', className)}>{children}</code>
            ) : (
              <code className="rounded bg-ink-100 px-1 py-0.5 font-mono text-[0.85em] text-ink-900">
                {children}
              </code>
            ),
          pre: ({ children }) => (
            <pre className="my-2 overflow-x-auto rounded-md border bg-ink-50 px-3 py-2 font-mono text-xs leading-relaxed first:mt-0 last:mb-0">
              {children}
            </pre>
          ),
          hr: () => <hr className="my-3 border-ink-200" />,
          table: ({ children }) => (
            <div className="my-2 overflow-x-auto first:mt-0 last:mb-0">
              <table className="w-full border-collapse text-xs">{children}</table>
            </div>
          ),
          thead: ({ children }) => <thead className="bg-ink-50">{children}</thead>,
          tbody: ({ children }) => <tbody>{children}</tbody>,
          tr: ({ children }) => <tr className="border-b border-ink-200 last:border-0">{children}</tr>,
          th: ({ children }) => (
            <th className="border border-ink-200 px-2.5 py-1.5 text-left font-semibold text-ink-700">
              {children}
            </th>
          ),
          td: ({ children }) => <td className="border border-ink-200 px-2.5 py-1.5 align-top">{children}</td>,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
