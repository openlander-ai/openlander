import React from 'react';
import {
  Bot,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  XCircle,
  Rocket,
  Search,
  Wrench,
  Key,
  MessageCircle,
  Clock,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { AssistantItem } from '@/hooks/use-assistant';

import { ToolResultContent, maskSecrets } from './ToolResultContent';

export function ToolCallItem({ item }: { item: AssistantItem }) {
  const [expanded, setExpanded] = React.useState(false);
  return (
    <div className="rounded-md border border-agent/20 bg-agent/5 overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-3 py-1.5 text-xs font-mono text-agent hover:bg-agent/10 transition-colors"
      >
        <span className="flex items-center gap-2">
          <Bot className="h-3 w-3" />
          {item.toolName}
        </span>
        {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
      </button>
      {expanded && item.toolArgs && (
        <div className="px-3 py-2 border-t border-agent/10 bg-bg-app/50">
          <pre className="text-[10px] font-mono text-muted-ol whitespace-pre-wrap break-all">
            {JSON.stringify(maskSecrets(item.toolArgs), null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

export function ToolResultItem({ item }: { item: AssistantItem }) {
  const [expanded, setExpanded] = React.useState(false);
  const isSuccess = item.toolSuccess !== false;
  return (
    <div
      className={cn(
        'rounded-md border overflow-hidden',
        isSuccess ? 'border-success/20 bg-success/5' : 'border-error/20 bg-error/5',
      )}
    >
      <button
        onClick={() => setExpanded(!expanded)}
        className={cn(
          'w-full flex items-center justify-between px-3 py-1.5 text-xs font-mono transition-colors',
          isSuccess ? 'text-success hover:bg-success/10' : 'text-error hover:bg-error/10',
        )}
      >
        <span className="flex items-center gap-2">
          {isSuccess ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
          {item.toolName} {isSuccess ? '✓' : '✗'}
        </span>
        {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
      </button>
      {expanded && (
        <div className="px-3 py-2 border-t border-black/10 bg-bg-app/50">
          {item.toolError ? (
            <pre
              className={cn(
                'text-[10px] font-mono whitespace-pre-wrap break-all',
                isSuccess ? 'text-success/80' : 'text-error/80',
              )}
            >
              {item.toolError}
            </pre>
          ) : (
            <ToolResultContent toolName={item.toolName || ''} result={item.toolResult} />
          )}
        </div>
      )}
    </div>
  );
}

function getToolSummary(items: AssistantItem[], primaryTool: string, hasFailure: boolean) {
  const call = items.find((i) => i.type === 'tool_call' && i.toolName === primaryTool);
  const result = items.find((i) => i.type === 'tool_result' && i.toolName === primaryTool);
  const isComplete = !!result;

  const isKnownTool = [
    'deploy_project',
    'debug_build_error',
    'fix_dockerfile',
    'set_env_vars',
    'ask_user_question',
  ].includes(primaryTool);

  if (hasFailure && isKnownTool) {
    return `Failed to execute ${primaryTool}`;
  }

  switch (primaryTool) {
    case 'deploy_project': {
      if (!isComplete) {
        const args = call?.toolArgs as Record<string, unknown> | undefined;
        const repoUrl = typeof args?.repo_url === 'string' ? args.repo_url : 'project';
        return `Deploying ${repoUrl}...`;
      }
      return 'Deploy complete ✓';
    }
    case 'debug_build_error': {
      if (!isComplete) return 'Analyzing build error...';
      const toolResult = result?.toolResult as Record<string, unknown> | undefined;
      const summary = typeof toolResult?.summary === 'string' ? toolResult.summary : undefined;
      return summary ? `Found: ${summary}` : 'Analyzed build error';
    }
    case 'fix_dockerfile': {
      if (!isComplete) return 'Generating Dockerfile fix...';
      const toolResult = result?.toolResult as Record<string, unknown> | undefined;
      const changes = Array.isArray(toolResult?.changes) ? toolResult.changes : [];
      return changes.length > 0 ? `Fix ready: ${String(changes[0])}` : 'Dockerfile fix ready';
    }
    case 'set_env_vars': {
      if (!isComplete) {
        const args = call?.toolArgs as Record<string, unknown> | undefined;
        let keysCount = 0;
        if (typeof args?.variables === 'string') {
          try {
            const parsed = JSON.parse(args.variables) as Record<string, unknown>;
            keysCount = Object.keys(parsed).length;
          } catch {
            // ignore
          }
        }
        return keysCount > 0 ? `Setting ${keysCount} env vars...` : 'Setting env vars...';
      }
      const toolResult = result?.toolResult as Record<string, unknown> | undefined;
      const keys = Array.isArray(toolResult?.keys) ? toolResult.keys.map(String) : [];
      return keys.length > 0 ? `Updated: ${keys.join(', ')}` : 'Configured environment variables';
    }
    case 'ask_user_question': {
      return 'Waiting for your input...';
    }
    default:
      return null;
  }
}

function getToolIcon(toolName: string, hasFailure: boolean) {
  if (hasFailure) return XCircle;
  switch (toolName) {
    case 'deploy_project':
      return Rocket;
    case 'debug_build_error':
      return Search;
    case 'fix_dockerfile':
      return Wrench;
    case 'set_env_vars':
      return Key;
    case 'ask_user_question':
      return MessageCircle;
    default:
      return CheckCircle2;
  }
}

/** Collapsed group of consecutive tool calls/results */
export function CollapsedToolGroup({ items }: { items: AssistantItem[] }) {
  const [expanded, setExpanded] = React.useState(false);

  const toolNames = [...new Set(items.filter((i) => i.toolName).map((i) => i.toolName!))];
  const hasFailure = items.some((i) => i.type === 'tool_result' && i.toolSuccess === false);
  const toolCount = toolNames.length;

  const primaryTool =
    toolNames.find((name) =>
      [
        'deploy_project',
        'debug_build_error',
        'fix_dockerfile',
        'set_env_vars',
        'ask_user_question',
      ].includes(name),
    ) || toolNames[0];

  const summary = primaryTool ? getToolSummary(items, primaryTool, hasFailure) : null;
  const Icon = primaryTool
    ? getToolIcon(primaryTool, hasFailure)
    : hasFailure
      ? XCircle
      : CheckCircle2;

  const firstItem = items[0];
  const lastItem = items[items.length - 1];
  const duration =
    lastItem &&
    firstItem &&
    new Date(lastItem.timestamp).getTime() > new Date(firstItem.timestamp).getTime()
      ? Math.round(
          (new Date(lastItem.timestamp).getTime() - new Date(firstItem.timestamp).getTime()) / 1000,
        )
      : null;

  return (
    <div
      data-testid="tool-call-group"
      className={cn(
        'rounded-lg border overflow-hidden',
        hasFailure ? 'border-error/20 bg-error/5' : 'border-agent/15 bg-agent/5',
      )}
    >
      <button
        onClick={() => setExpanded(!expanded)}
        className={cn(
          'w-full flex items-center justify-between px-3 py-2 text-xs font-mono transition-colors',
          hasFailure ? 'text-error hover:bg-error/10' : 'text-agent hover:bg-agent/10',
        )}
      >
        <span className="flex items-center gap-2 truncate">
          <Icon className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">
            {summary ? (
              summary
            ) : (
              <>
                {hasFailure ? 'Failed' : 'Used'} {toolNames.slice(0, 3).join(', ')}
                {toolNames.length > 3 && ` +${toolNames.length - 3}`}
                {' — '}
                {toolCount} {toolCount === 1 ? 'tool' : 'tools'}
              </>
            )}
          </span>
        </span>
        <div className="flex items-center gap-2 shrink-0 ml-2">
          {duration !== null && duration > 0 && (
            <span className="flex items-center gap-1 text-[10px] text-muted-ol">
              <Clock className="h-3 w-3" />
              {duration}s
            </span>
          )}
          {expanded ? (
            <ChevronUp className="h-3.5 w-3.5" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5" />
          )}
        </div>
      </button>

      {expanded && (
        <div className="px-2 py-2 border-t border-agent/10 space-y-1.5">
          {items.map((item) =>
            item.type === 'tool_call' ? (
              <ToolCallItem key={item.id} item={item} />
            ) : (
              <ToolResultItem key={item.id} item={item} />
            ),
          )}
        </div>
      )}
    </div>
  );
}
