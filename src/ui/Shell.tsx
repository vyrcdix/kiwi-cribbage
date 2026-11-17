// The frame round every league screen: the page and the persistent navigation.
// Phone: a tab bar along the bottom (thumb reach), four places. Laptop (900 px
// and up): the same four along the top beside the wordmark. The game table and
// the welcome screen have no navigation.
import type { ReactNode } from 'react';
import { Brand } from '../brand/Mark';
import { onLink } from '../lib/router';
import { useSession } from '../lib/session';
import { Avatar } from './Avatar';

export type Tab = 'home' | 'league' | 'stats' | 'me';

const ICONS: Record<Exclude<Tab, 'me'>, ReactNode> = {
  home: <path d="M4 11.5 12 5l8 6.5V20h-5.5v-5h-5v5H4z" />,
  league: (
    <>
      <path d="M5 6h14M5 12h14M5 18h14" />
      <path d="M8.5 4v16" />
    </>
  ),
  stats: <path d="M4 19h16M6.5 16v-5M11 16V7M15.5 16v-7M20 16V5" />,
};

const TABS: { tab: Tab; to: string; label: string }[] = [
  { tab: 'home', to: '/', label: 'Home' },
  { tab: 'league', to: '/league', label: 'League' },
  { tab: 'stats', to: '/stats', label: 'Stats' },
  { tab: 'me', to: '/me', label: 'You' },
];

export function Nav({ active }: { active: Tab | null }) {
  const { me, profile } = useSession();
  return (
    <nav className="nav" aria-label="Cabbage">
      <a className="nav__brand" href="/" onClick={(e) => onLink(e, '/')} aria-label="Cabbage home">
        <Brand size="small" />
      </a>
      <ul className="nav__tabs">
        {TABS.map((t) => (
          <li key={t.tab}>
            <a
              className="nav__tab"
              href={t.to}
              aria-current={active === t.tab ? 'page' : undefined}
              onClick={(e) => onLink(e, t.to)}
            >
              <span className="nav__icon" aria-hidden="true">
                {t.tab === 'me' ? (
                  <Avatar player={me ?? { id: profile.id, name: profile.name }} size={24} />
                ) : (
                  <svg viewBox="0 0 24 24">{ICONS[t.tab]}</svg>
                )}
              </span>
              <span className="nav__label">{t.label}</span>
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function Shell({ tab, children, className }: { tab: Tab | null; children: ReactNode; className?: string }) {
  return (
    <div className="app">
      <Nav active={tab} />
      <main className={['app__main', className].filter(Boolean).join(' ')}>{children}</main>
    </div>
  );
}
