import { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';

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

  const toggleTheme = () => {
    setTheme(currentTheme === 'light' ? 'dark' : 'light');
  };

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggleTheme}
      className="h-7 w-7 transition-all text-foreground/80 hover:text-foreground hover:bg-bg-subtle"
      title={currentTheme === 'light' ? 'Switch to Dark Mode' : 'Switch to Light Mode'}
    >
      {currentTheme === 'light' ? (
        <Moon className="h-3.5 w-3.5" />
      ) : (
        <Sun className="h-3.5 w-3.5" />
      )}
      <span className="sr-only">Toggle theme</span>
    </Button>
  );
}
