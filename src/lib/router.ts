// Routes without a library, driven by pushState.
//   /                     home (your league day)
//   /league               standings, pending games, the queue, results
//   /stats, /stats/A/B    head-to-head
//   /fame                 hall of fame
//   /players/:id          a player's page
//   /replay/:code         a finished game, hand by hand
//   /me                   your profile, devices and invites
//   /commissioner         the commissioner's tools
//   /invite/:token        a league invite (sign-up)
//   /link/:code           sign in on this device with a one-time code
//   /g/:CODE              a game; /deck the deck gallery; /dev/table, /dev/sheet, /dev/cvd (development)
import { useEffect, useState } from 'react';

const NAV_EVENT = 'cabbage:navigate';

export type Route =
  | { name: 'home' }
  | { name: 'league' }
  | { name: 'stats'; a?: string; b?: string }
  | { name: 'fame' }
  | { name: 'player'; id: string }
  | { name: 'replay'; code: string }
  | { name: 'profile' }
  | { name: 'commissioner' }
  | { name: 'invite'; token: string }
  | { name: 'link'; code: string }
  | { name: 'deck' }
  | { name: 'dev' }
  | { name: 'game'; code: string }
  | { name: 'unknown' };

const ID = '([A-Za-z0-9_-]{1,64})';

export function parseRoute(path: string): Route {
  const p = path.length > 1 ? path.replace(/\/+$/, '') : path;
  if (p === '/' || p === '') return { name: 'home' };
  if (p === '/league') return { name: 'league' };
  if (p === '/stats') return { name: 'stats' };
  if (p === '/fame') return { name: 'fame' };
  if (p === '/me') return { name: 'profile' };
  if (p === '/commissioner') return { name: 'commissioner' };
  if (p === '/deck') return { name: 'deck' };
  if (import.meta.env.DEV && (p === '/dev/table' || p === '/dev/sheet' || p === '/dev/cvd')) return { name: 'dev' };
  let m = new RegExp(`^/stats/${ID}/${ID}$`).exec(p);
  if (m) return { name: 'stats', a: m[1], b: m[2] };
  m = new RegExp(`^/players/${ID}$`).exec(p);
  if (m) return { name: 'player', id: m[1] };
  m = /^\/replay\/([A-Za-z0-9]{3,12})$/.exec(p);
  if (m) return { name: 'replay', code: m[1].toUpperCase() };
  m = /^\/invite\/([A-Za-z0-9_-]{4,128})$/.exec(p);
  if (m) return { name: 'invite', token: m[1] };
  m = /^\/link\/([A-Za-z0-9-]{4,40})$/.exec(p);
  if (m) return { name: 'link', code: m[1].toUpperCase() };
  m = /^\/g\/([A-Za-z0-9]{3,12})$/.exec(p);
  if (m) return { name: 'game', code: m[1].toUpperCase() };
  return { name: 'unknown' };
}

export function navigate(to: string, replace = false): void {
  if (to === location.pathname + location.search) return;
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

/** An <a> click that should stay in the app (plain left click, no modifier keys). */
export function onLink(e: { button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; preventDefault: () => void }, to: string): void {
  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  e.preventDefault();
  navigate(to);
}

export const gameUrl = (code: string): string => `${location.origin}/g/${code}`;
export const inviteUrl = (token: string): string => `${location.origin}/invite/${token}`;
export const linkUrl = (code: string): string => `${location.origin}/link/${code}`;
