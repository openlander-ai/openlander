import { useEffect, useState } from 'react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { useLanguage } from '@/i18n/context';

interface BlueGreenDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectName: string;
  isSubmitting?: boolean;
  onConfirm: (healthCheckPath?: string) => void | Promise<void>;
}

export function BlueGreenDialog({
  open,
  onOpenChange,
  projectName,
  isSubmitting = false,
  onConfirm,
}: BlueGreenDialogProps) {
  const { t } = useLanguage();
  const [healthCheckPath, setHealthCheckPath] = useState('');

  useEffect(() => {
    if (!open) {
      setHealthCheckPath('');
    }
  }, [open]);

  const handleConfirm = () => {
    const trimmedPath = healthCheckPath.trim();
    void onConfirm(trimmedPath ? trimmedPath : undefined);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('blueGreen.title')}</DialogTitle>
          <DialogDescription>{t('blueGreen.description')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-2 pt-2">
          <label
            htmlFor="blue-green-health-check"
            className="text-xs font-medium text-foreground/80"
          >
            {t('blueGreen.healthCheckPath')}
          </label>
          <Input
            id="blue-green-health-check"
            placeholder={t('blueGreen.healthCheckPlaceholder')}
            value={healthCheckPath}
            onChange={(e) => setHealthCheckPath(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleConfirm();
              }
            }}
            className="h-8 text-sm"
            autoFocus
          />
          <p className="text-xs text-muted-foreground">{projectName}</p>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t('blueGreen.cancel')}
          </Button>
          <Button
            type="button"
            onClick={handleConfirm}
            disabled={isSubmitting}
            className="bg-foreground text-background hover:bg-foreground/90"
          >
            {isSubmitting ? <Spinner className="h-4 w-4 mr-1.5" /> : null}
            {t('blueGreen.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
