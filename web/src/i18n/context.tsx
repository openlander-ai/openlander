import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import { translations as enTranslations } from './en';
import { translations as koTranslations } from './ko';
import { setLanguage as apiSetLanguage } from '@/lib/api';

type Language = 'en' | 'ko';

type Translations = any;

interface LanguageContextType {
  language: Language;
  setLanguage: (lang: Language) => Promise<void>;
  t: (key: string) => string;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

const translations: Record<Language, Translations> = {
  en: enTranslations,
  ko: koTranslations,
};

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(() => {
    const saved = localStorage.getItem('openlander-language');
    if (saved === 'en' || saved === 'ko') {
      return saved;
    }
    return navigator.language.startsWith('ko') ? 'ko' : 'en';
  });

  useEffect(() => {
    localStorage.setItem('openlander-language', language);
  }, [language]);

  const setLanguage = async (lang: Language) => {
    setLanguageState(lang);
    localStorage.setItem('openlander-language', lang);
    try {
      await apiSetLanguage(lang);
    } catch (error) {
      console.error('Failed to save language to backend:', error);
    }
  };

  const t = (key: string): string => {
    const keys = key.split('.');
    let current: any = translations[language];

    for (const k of keys) {
      if (current === undefined || current === null) {
        console.warn(`Translation key not found: ${key}`);
        return key;
      }
      current = current[k];
    }

    if (typeof current !== 'string') {
      console.warn(`Translation key does not resolve to a string: ${key}`);
      return key;
    }

    return current;
  };

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (context === undefined) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return context;
}
