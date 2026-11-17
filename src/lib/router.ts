// Two routes, no library: `/` and `/g/:CODE`, driven by pushState.
import { useEffect, useState } from 'react';

const NAV_EVENT = 'cabbage:navigate';

export type Route = { name: 'home' } | { name: 'deck' } | { name: 'game'; code: string } | { name: 'unknown' };

export function parseRoute(path: string): Route {
  if (path === '/' || path === '') return { name: 'home' };
  if (path === '/deck') return { name: 'deck' };
  const m = /^\/g\/([A-Za-z0-9]{3,12})\/?$/.exec(path);
  if (m) return { name: 'game', code: m[1].toUpperCase() };
  return { name: 'unknown' };
}

export function navigate(to: string, replace = false): void {
  if (to === location.pathname) return;
  if (replace) history.replaceState(null, '', to);
  else history.pushState(null, '', to);
  window.dispatchEvent(new Event(NAV_EVENT));
  window.scrollTo(0, 0);
}

export function usePath(): string {
  const [path, setPath] = useState(() => location.pathname);
  useEffect(() => {
    const update = () => setPath(location.pathname);
    window.addEventListener('popstate', update);
    window.addEventListener(NAV_EVENT, update);
    return () => {
      window.removeEventListener('popstate', update);
      window.removeEventListener(NAV_EVENT, update);
    };
  }, []);
  return path;
}

export const gameUrl = (code: string): string => `${location.origin}/g/${code}`;
