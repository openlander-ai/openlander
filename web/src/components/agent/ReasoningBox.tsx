import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';

interface ReasoningBoxProps {
  content: string;
}

export function ReasoningBox({ content }: ReasoningBoxProps) {
  const [isOpen, setIsOpen] = useState(true);

  if (!content) return null;

  return (
    <Collapsible
      open={isOpen}
      onOpenChange={setIsOpen}
      className="mb-2 rounded-md border border-dashed border-border bg-muted/30"
      data-testid="reasoning-box"
    >
      <CollapsibleTrigger className="flex w-full items-center gap-2 px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors">
        {isOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        🤔 Thinking...
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="px-3 pb-3 text-xs text-muted-foreground whitespace-pre-wrap">{content}</div>
      </CollapsibleContent>
    </Collapsible>
  );
}
