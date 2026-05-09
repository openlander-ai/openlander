export type Locale = 'ko' | 'en';

export function pickLocale(locale: Locale, text: { ko: string; en: string }): string {
  return locale === 'ko' ? text.ko : text.en;
}
