import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { useLanguage } from '@/i18n/context';

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'default' | 'destructive';
  onConfirm: () => void;
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel,
  variant = 'default',
  onConfirm,
}: ConfirmDialogProps) {
  const { t } = useLanguage();
  const isDestructive = variant === 'destructive';
  const resolvedConfirmLabel = confirmLabel ?? t('common.confirm');
  const resolvedCancelLabel = cancelLabel ?? t('common.cancel');
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md border-[color:var(--ol-border)] bg-[color:var(--ol-panel)] p-5">
        <DialogPrimitive.Title className="text-[16px] font-semibold text-[color:var(--ol-fg)]">
          {title}
        </DialogPrimitive.Title>
        <DialogPrimitive.Description className="mt-1 text-[12.5px] text-[color:var(--ol-fg-muted)]">
          {description}
        </DialogPrimitive.Description>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="rounded-md border border-[color:var(--ol-border)] px-3 py-2 text-[12.5px] text-[color:var(--ol-fg-muted)] transition-colors hover:border-[color:var(--ol-border-strong)] hover:text-[color:var(--ol-fg)]"
          >
            {resolvedCancelLabel}
          </button>
          <button
            type="button"
            onClick={() => {
              onConfirm();
              onOpenChange(false);
            }}
            className={`rounded-md px-3 py-2 text-[12.5px] font-medium text-[color:var(--ol-primary-fg)] transition-opacity hover:opacity-90 ${
              isDestructive ? 'bg-[color:var(--ol-error)]' : 'bg-[color:var(--ol-primary)]'
            }`}
          >
            {resolvedConfirmLabel}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
