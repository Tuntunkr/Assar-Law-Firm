import { useCallback, useEffect, useState } from 'react';

type Theme = 'light' | 'dark';
const KEY = 'assar:theme';

const read = (): Theme => {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'light' || v === 'dark') return v;
  } catch {
    /* storage can be blocked; fall through */
  }
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
};

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(read);
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    try {
      localStorage.setItem(KEY, theme);
    } catch {
      /* ignore */
    }
  }, [theme]);
  const toggle = useCallback(() => setTheme((t) => (t === 'dark' ? 'light' : 'dark')), []);
  return { theme, toggle };
}
