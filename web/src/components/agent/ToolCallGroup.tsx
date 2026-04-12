import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ToolCallCard } from './ToolCallCard';
import type { ToolCallInfo } from '@/lib/chat-types';

interface ToolCallGroupProps {
  toolCalls: ToolCallInfo[];
}

export function ToolCallGroup({ toolCalls }: ToolCallGroupProps) {
  const groups = new Map<number, ToolCallInfo[]>();
  for (const tc of toolCalls) {
    const key = tc.stepIndex ?? 0;
    const group = groups.get(key) ?? [];
    group.push(tc);
    groups.set(key, group);
  }

  const sortedKeys = Array.from(groups.keys()).sort((a, b) => a - b);

  return (
    <>
      {sortedKeys.map((key) => {
        const group = groups.get(key)!;

        if (group.length >= 3) {
          return <ToolCallGroupItem key={key} group={group} />;
        }

        return group.map((tc, i) => <ToolCallCard key={`${key}-${i}`} toolCall={tc} />);
      })}
    </>
  );
}

function ToolCallGroupItem({ group }: { group: ToolCallInfo[] }) {
  const [isOpen, setIsOpen] = useState(false);

  const toolNames = group.map((tc) => tc.toolName).join(', ');
  const truncatedNames = toolNames.length > 60 ? toolNames.substring(0, 57) + '...' : toolNames;

  return (
    <Collapsible
      open={isOpen}
      onOpenChange={setIsOpen}
      className="border border-border rounded-md my-2 overflow-hidden"
      data-testid="tool-call-group"
    >
      <CollapsibleTrigger className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-bg-subtle">
        <span className="font-medium flex-1 text-left text-muted-ol">
          ⚡ {group.length} tools · {truncatedNames}
        </span>
        {isOpen ? (
          <ChevronDown className="h-3 w-3 text-muted-ol" />
        ) : (
          <ChevronRight className="h-3 w-3 text-muted-ol" />
        )}
      </CollapsibleTrigger>
      <CollapsibleContent className="px-2 pb-1 bg-bg-subtle/30">
        {group.map((tc, i) => (
          <ToolCallCard key={i} toolCall={tc} />
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
}
