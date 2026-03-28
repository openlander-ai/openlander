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
  { id: 'dark', name: 'Dark' },
];

export function ThemeSelector() {
  const [currentTheme, setCurrentTheme] = useState('light');

  useEffect(() => {
    // Migrate old themes or load standard theme
    const saved = localStorage.getItem('ol-theme');
    const isValid = saved === 'light' || saved === 'dark';
    const initTheme = isValid
      ? saved
      : window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light';

    setTheme(initTheme);
  }, []);

  const setTheme = (themeId: string) => {
    setCurrentTheme(themeId);
    localStorage.setItem('ol-theme', themeId);

    if (themeId === 'light') {
      document.documentElement.removeAttribute('data-theme');
      document.documentElement.classList.remove('dark');
    } else {
      document.documentElement.setAttribute('data-theme', 'dark');
      document.documentElement.classList.add('dark');
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
