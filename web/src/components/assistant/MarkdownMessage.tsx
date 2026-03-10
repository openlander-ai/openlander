import React, { useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import remarkGfm from 'remark-gfm';
import 'highlight.js/styles/atom-one-dark.min.css';

const rehypePlugins = [rehypeHighlight] as Parameters<typeof ReactMarkdown>[0]['rehypePlugins'];
const remarkPlugins = [remarkGfm] as Parameters<typeof ReactMarkdown>[0]['remarkPlugins'];

interface MarkdownMessageProps {
  content: string;
}

export const MarkdownMessage = React.memo(function MarkdownMessage({
  content,
}: MarkdownMessageProps) {
  // Memoize plugins to avoid re-creating on each render
  const plugins = useMemo(() => ({ rehype: rehypePlugins, remark: remarkPlugins }), []);

  return (
    <div className="prose prose-sm dark:prose-invert max-w-none prose-a:text-agent prose-code:bg-bg-subtle prose-pre:bg-bg-subtle prose-pre:border prose-pre:border-[hsl(var(--border))]">
      <ReactMarkdown rehypePlugins={plugins.rehype} remarkPlugins={plugins.remark}>
        {content}
      </ReactMarkdown>
    </div>
  );
});
