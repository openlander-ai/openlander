import { Globe, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { useLanguage } from '@/i18n/context';

type Language = 'en' | 'ko';

interface LanguageStepProps {
  language: Language;
  setLanguage: (lang: Language) => Promise<void>;
  onNext: () => void;
}

export function LanguageStep({ language, setLanguage, onNext }: LanguageStepProps) {
  const { t } = useLanguage();

  return (
    <div className="animate-in fade-in slide-in-from-right-4 duration-300">
      <div className="text-center space-y-6">
        <div className="mx-auto w-16 h-16 rounded-2xl bg-agent/10 flex items-center justify-center">
          <Globe className="h-8 w-8 text-agent" />
        </div>
        <div className="space-y-2">
          <h2 className="font-display text-2xl font-bold text-foreground tracking-tight">
            {t('setup.language.title')}
          </h2>
          <p className="text-sm font-body text-foreground/80">{t('setup.language.subtitle')}</p>
        </div>

        <Select value={language} onValueChange={(val) => setLanguage(val as Language)}>
          <SelectTrigger className="w-full bg-bg-app border-border font-mono text-sm">
            <SelectValue placeholder="Choose language..." />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="en">English</SelectItem>
            <SelectItem value="ko">한국어</SelectItem>
          </SelectContent>
        </Select>

        <Button
          onClick={onNext}
          size="lg"
          className="w-full bg-agent text-white hover:bg-agent/90 font-body gap-2"
        >
          {t('setup.common.continue')}
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
