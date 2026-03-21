import { useState, useEffect } from 'react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Share2,
  RefreshCw,
  Copy,
  Check,
  Eye,
  EyeOff,
  Globe,
  Lock,
  X,
  AlertTriangle,
} from 'lucide-react';
import { shareProject, unshareProject } from '@/lib/api';
import { useLanguage } from '@/i18n/context';
import { cn } from '@/lib/utils';

interface ShareDialogProps {
  projectId: string;
  projectName: string;
  isRunning: boolean;
  visibility: string;
  publicUrl: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onShareChange: () => void;
}

function generateAccessCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

export function ShareDialog({
  projectId,
  projectName,
  isRunning,
  visibility,
  publicUrl,
  open,
  onOpenChange,
  onShareChange,
}: ShareDialogProps) {
  const { t } = useLanguage();
  const [accessCode, setAccessCode] = useState('');
  const [showCode, setShowCode] = useState(false);
  const [loading, setLoading] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [copiedInvite, setCopiedInvite] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isShared = visibility === 'shared';

  useEffect(() => {
    if (open && !isShared && !accessCode) {
      setAccessCode(generateAccessCode());
    }
    if (!open) {
      setError(null);
    }
  }, [open, isShared, accessCode]);

  const handleGenerate = () => {
    setAccessCode(generateAccessCode());
  };

  const handleShare = async () => {
    if (!accessCode || accessCode.length < 4) return;
    setLoading(true);
    setError(null);
    try {
      await shareProject(projectId, accessCode);
      onShareChange();
    } catch (err) {
      console.error('Failed to share project:', err);
      setError(err instanceof Error ? err.message : 'Failed to share project');
    } finally {
      setLoading(false);
    }
  };

  const handleStopSharing = async () => {
    setLoading(true);
    try {
      await unshareProject(projectId);
      onShareChange();
      setAccessCode(generateAccessCode());
    } catch (error) {
      console.error('Failed to stop sharing:', error);
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = async (text: string, type: 'url' | 'invite') => {
    try {
      await navigator.clipboard.writeText(text);
      if (type === 'url') {
        setCopiedUrl(true);
        setTimeout(() => setCopiedUrl(false), 2000);
      } else {
        setCopiedInvite(true);
        setTimeout(() => setCopiedInvite(false), 2000);
      }
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-[400px] sm:w-[540px] border-l border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 p-0 flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border/40">
          <SheetHeader className="text-left space-y-1">
            <SheetTitle className="font-display text-lg font-medium flex items-center gap-2">
              <Share2 className="h-4 w-4 text-muted-foreground" />
              {t('share.title')}
            </SheetTitle>
            <SheetDescription className="font-body text-xs">{projectName}</SheetDescription>
          </SheetHeader>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded-full hover:bg-muted/50"
            onClick={() => onOpenChange(false)}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-8">
          {!isRunning ? (
            <div className="flex flex-col items-center justify-center py-12 text-center space-y-3">
              <div className="h-12 w-12 rounded-full bg-muted/30 flex items-center justify-center">
                <Lock className="h-5 w-5 text-muted-foreground" />
              </div>
              <p className="text-sm text-muted-foreground font-body">{t('share.notRunning')}</p>
            </div>
          ) : (
            <>
              {/* Status Indicator */}
              <div className="flex items-center gap-3 p-3 rounded-lg border border-border/40 bg-muted/10">
                <div
                  className={cn(
                    'h-8 w-8 rounded-full flex items-center justify-center',
                    isShared ? 'bg-agent/10 text-agent' : 'bg-muted/30 text-muted-foreground',
                  )}
                >
                  {isShared ? <Globe className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium font-display">
                    {isShared ? t('share.alreadyShared') : 'Private'}
                  </p>
                  <p className="text-xs text-muted-foreground font-body">
                    {isShared
                      ? 'Accessible via public URL with access code'
                      : 'Only accessible on local network'}
                  </p>
                </div>
              </div>

              {/* Access Code Section */}
              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium font-display">
                    {t('share.accessCode')}
                  </label>
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <Input
                        type={showCode ? 'text' : 'password'}
                        value={isShared ? '••••••••' : accessCode}
                        onChange={(e) => !isShared && setAccessCode(e.target.value)}
                        disabled={isShared}
                        className="font-mono text-sm pr-10"
                        placeholder="Enter access code"
                      />
                      {!isShared && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 text-muted-foreground hover:text-foreground"
                          onClick={() => setShowCode(!showCode)}
                        >
                          {showCode ? (
                            <EyeOff className="h-3.5 w-3.5" />
                          ) : (
                            <Eye className="h-3.5 w-3.5" />
                          )}
                        </Button>
                      )}
                    </div>
                    {!isShared && (
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        onClick={handleGenerate}
                        title={t('share.generate')}
                      >
                        <RefreshCw className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground font-body">
                    {t('share.accessCodeHint')}
                  </p>
                </div>

                {!isShared ? (
                  <div className="space-y-4">
                    <Button
                      className="w-full font-body"
                      onClick={handleShare}
                      disabled={loading || accessCode.length < 4}
                    >
                      {loading ? (
                        <RefreshCw className="h-4 w-4 animate-spin mr-2" />
                      ) : (
                        <Share2 className="h-4 w-4 mr-2" />
                      )}
                      {t('share.shareButton')}
                    </Button>

                    {error && (
                      <div className="p-3 rounded-lg border border-destructive/40 bg-destructive/5 space-y-3">
                        <div className="flex items-start gap-2 text-destructive">
                          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                          <div className="space-y-1">
                            <p className="text-sm font-medium font-display">{error}</p>
                            <p className="text-xs text-muted-foreground font-body">
                              TryCloudflare is temporarily unavailable. You can also share via
                              Settings → Domains.
                            </p>
                          </div>
                        </div>
                        <div className="flex justify-end">
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 text-xs font-body border-destructive/40 hover:bg-destructive/10 hover:text-destructive"
                            onClick={handleShare}
                            disabled={loading}
                          >
                            <RefreshCw
                              className={cn('h-3 w-3 mr-1.5', loading && 'animate-spin')}
                            />
                            Retry
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="space-y-4 pt-4 border-t border-border/40">
                    <div className="space-y-2">
                      <label className="text-xs font-medium text-muted-foreground font-display">
                        Public URL
                      </label>
                      <div className="flex gap-2">
                        <Input
                          readOnly
                          value={publicUrl || ''}
                          className="font-mono text-xs bg-muted/30"
                        />
                        <Button
                          variant="outline"
                          size="icon"
                          onClick={() => copyToClipboard(publicUrl || '', 'url')}
                        >
                          {copiedUrl ? (
                            <Check className="h-4 w-4 text-success" />
                          ) : (
                            <Copy className="h-4 w-4" />
                          )}
                        </Button>
                      </div>
                    </div>

                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        className="flex-1 font-body"
                        onClick={() =>
                          copyToClipboard(`${publicUrl}\nAccess Code: [Hidden]`, 'invite')
                        }
                      >
                        {copiedInvite ? (
                          <Check className="h-4 w-4 mr-2 text-success" />
                        ) : (
                          <Copy className="h-4 w-4 mr-2" />
                        )}
                        {t('share.copyInvitation')}
                      </Button>
                      <Button
                        variant="destructive"
                        className="flex-1 font-body"
                        onClick={handleStopSharing}
                        disabled={loading}
                      >
                        {loading ? (
                          <RefreshCw className="h-4 w-4 animate-spin mr-2" />
                        ) : (
                          <X className="h-4 w-4 mr-2" />
                        )}
                        {t('share.stopSharing')}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
