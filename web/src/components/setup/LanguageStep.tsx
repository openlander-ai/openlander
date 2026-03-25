import { Globe, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type Language = 'en' | 'ko';

interface LanguageStepProps {
  language: Language;
  setLanguage: (lang: Language) => Promise<void>;
  onNext: () => void;
}

export function LanguageStep({ language, setLanguage, onNext }: LanguageStepProps) {
  return (
    <div className="animate-in fade-in slide-in-from-right-4 duration-300">
      <div className="text-center space-y-6">
        <div className="mx-auto w-16 h-16 rounded-2xl bg-agent/10 flex items-center justify-center">
          <Globe className="h-8 w-8 text-agent" />
        </div>
        <div className="space-y-2">
          <h1 className="font-display text-3xl font-bold text-primary-ol tracking-tight">
            {'Language 🌐'}
          </h1>
        </div>

        {/* Language selection cards */}
        <div className="grid grid-cols-2 gap-4">
          <button
            type="button"
            onClick={() => setLanguage('en')}
            className={cn(
              'flex flex-col items-center gap-3 p-6 rounded-xl border-2 transition-all',
              language === 'en'
                ? 'border-foreground bg-bg-subtle/50'
                : 'border-border bg-bg-subtle/30 hover:border-border/80',
            )}
          >
            <span className="text-4xl">🇺🇸</span>
            <span className="text-sm font-body font-medium">{'English'}</span>
          </button>
          <button
            type="button"
            onClick={() => setLanguage('ko')}
            className={cn(
              'flex flex-col items-center gap-3 p-6 rounded-xl border-2 transition-all',
              language === 'ko'
                ? 'border-foreground bg-bg-subtle/50'
                : 'border-border bg-bg-subtle/30 hover:border-border/80',
            )}
          >
            <span className="text-4xl">🇰🇷</span>
            <span className="text-sm font-body font-medium">{'한국어'}</span>
          </button>
        </div>

        <Button
          onClick={onNext}
          size="lg"
          className="w-full bg-agent text-bg-app hover:bg-agent/90 font-body gap-2"
        >
          {'Continue'}
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
