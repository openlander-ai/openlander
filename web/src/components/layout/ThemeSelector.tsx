import { useEffect, useState } from 'react';
import { Palette } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const themes = [
  { id: 'light', name: 'Light (Default)' },
  { id: 'ink', name: 'Ink (Mono Light)' },
  { id: 'glass-light', name: 'Soft Glass' },
  { id: 'lavender', name: 'Lavender Dream' },
  { id: 'solar', name: 'Solar (Amber)' },
  { id: 'deep-blue', name: 'Deep Blue (Dark)' },
  { id: 'vercel-dark', name: 'Vercel Dark' },
  { id: 'cobalt', name: 'Cobalt (GitHub)' },
  { id: 'nord', name: 'Nord (Frost)' },
  { id: 'ocean', name: 'Ocean (Teal)' },
  { id: 'midnight', name: 'Midnight (Purple)' },
  { id: 'supabase', name: 'Supabase (Emerald)' },
  { id: 'cyber', name: 'Cyberpunk (Neon)' },
  { id: 'ruby', name: 'Raycast (Ruby)' },
];

export function ThemeSelector() {
  const [currentTheme, setCurrentTheme] = useState('light');

  useEffect(() => {
    // on load
    const saved = localStorage.getItem('ol-theme') || 'light';
    setCurrentTheme(saved);
    if (saved !== 'light') {
      document.documentElement.setAttribute('data-theme', saved);
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
  }, []);

  const setTheme = (themeId: string) => {
    setCurrentTheme(themeId);
    localStorage.setItem('ol-theme', themeId);
    if (themeId === 'light') {
      document.documentElement.removeAttribute('data-theme');
    } else {
      document.documentElement.setAttribute('data-theme', themeId);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 transition-all text-secondary-ol hover:text-primary-ol hover:bg-bg-subtle"
          title="Change Theme (Dev)"
        >
          <Palette className="h-3.5 w-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40 z-[100]">
        {themes.map((t) => (
          <DropdownMenuItem
            key={t.id}
            onClick={() => setTheme(t.id)}
            className={cn(
              'font-body text-sm cursor-pointer',
              currentTheme === t.id && 'font-bold text-primary-ol bg-bg-subtle',
            )}
          >
            {t.name}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
