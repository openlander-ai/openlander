import { useEffect, useState } from 'react';
import { FileText, ChevronDown, ChevronUp } from 'lucide-react';
import { fetchPostmortems } from '@/lib/api/operations';
import type { PostmortemEntry } from '@/lib/api/operations';
import { Skeleton } from '@/components/ui/skeleton';
import { parseTimestamp } from '@/lib/time';
import { useLanguage } from '@/i18n/context';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import 'highlight.js/styles/github-dark.css';

export function PostmortemsTab() {
  const { t } = useLanguage();
  const [postmortems, setPostmortems] = useState<PostmortemEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    const loadPostmortems = async () => {
      try {
        const data = await fetchPostmortems();
        setPostmortems(data.postmortems);
      } catch (error) {
        console.error('Failed to fetch postmortems:', error);
      } finally {
        setIsLoading(false);
      }
    };
    loadPostmortems();
  }, []);

  const toggleExpand = (id: string) => {
    setExpandedId(expandedId === id ? null : id);
  };

  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }

  if (postmortems.length === 0) {
    return (
      <div className="p-12 flex flex-col items-center justify-center text-center border border-dashed border-[hsl(var(--border))] rounded-lg m-6 bg-bg-subtle/30">
        <FileText className="h-14 w-14 text-muted-foreground/60 mb-4" />
        <h3 className="text-lg font-medium text-primary-ol mb-2">
          {t('postmortemsTab.noPostmortems')}
        </h3>
        <p className="text-sm text-muted-ol max-w-md">{t('postmortemsTab.emptyMessage')}</p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4">
      {postmortems.map((postmortem) => {
        const isExpanded = expandedId === postmortem.id;
        const date = parseTimestamp(String(postmortem.created_at));

        return (
          <div
            key={postmortem.id}
            className="rounded-lg border border-[hsl(var(--border))] bg-bg-panel overflow-hidden"
          >
            <button
              onClick={() => toggleExpand(postmortem.id)}
              className="w-full flex items-center justify-between p-4 hover:bg-bg-subtle transition-colors text-left"
            >
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-medium text-primary-ol">{postmortem.project_name}</span>
                  <span className="text-xs text-muted-ol px-2 py-0.5 rounded-full bg-bg-subtle border border-[hsl(var(--border))]">
                    {t('postmortemsTab.postmortem')}
                  </span>
                </div>
                <p className="text-sm text-muted-ol">
                  {t('postmortemsTab.generated')} {date ? date.toLocaleString() : 'Unknown time'}
                </p>
              </div>
              {isExpanded ? (
                <ChevronUp className="h-5 w-5 text-muted-ol" />
              ) : (
                <ChevronDown className="h-5 w-5 text-muted-ol" />
              )}
            </button>

            {isExpanded && (
              <div className="p-4 border-t border-[hsl(var(--border))] bg-bg-subtle/30">
                <div
                  className="prose prose-sm max-w-none
                  prose-headings:text-primary-ol
                  prose-p:text-secondary-ol
                  prose-a:text-ai prose-a:no-underline hover:prose-a:underline
                  prose-strong:text-primary-ol
                  prose-code:text-ai/80 prose-code:bg-bg-subtle prose-code:px-1 prose-code:py-0.5 prose-code:rounded
                  prose-pre:bg-bg-terminal prose-pre:text-zinc-100 prose-pre:border-0
                  [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-inherit
                  prose-td:text-secondary-ol prose-th:text-primary-ol
                  prose-blockquote:border-ai/30 prose-blockquote:text-secondary-ol
                "
                >
                  <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
                    {postmortem.content}
                  </ReactMarkdown>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
