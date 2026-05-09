import { useState, useEffect } from 'react';

const MOBILE_BREAKPOINT = 768;

export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(
    typeof window !== 'undefined' ? window.innerWidth < MOBILE_BREAKPOINT : false,
  );

  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mql.addEventListener('change', handler);
    setIsMobile(mql.matches);
    return () => mql.removeEventListener('change', handler);
  }, []);

  return isMobile;
}

/** Shows a toast-like message when a mobile user tries a desktop-only action */
export function showMobileToast(message = 'Please deploy from a desktop browser') {
  // Simple toast — create a temporary DOM element
  const el = document.createElement('div');
  el.textContent = message;
  Object.assign(el.style, {
    position: 'fixed',
    bottom: '24px',
    left: '50%',
    transform: 'translateX(-50%)',
    background: 'hsl(0 0% 9%)',
    color: 'hsl(0 0% 98%)',
    padding: '8px 16px',
    borderRadius: '8px',
    fontSize: '13px',
    fontFamily: "'Inter Variable', Inter, system-ui, sans-serif",
    zIndex: '9999',
    border: '1px solid hsl(0 0% 14%)',
    boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
    transition: 'opacity 0.3s ease',
    opacity: '0',
  });
  document.body.appendChild(el);
  requestAnimationFrame(() => {
    el.style.opacity = '1';
  });
  setTimeout(() => {
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 300);
  }, 2500);
}
