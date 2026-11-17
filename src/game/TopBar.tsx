import { navigate } from '../lib/router';
import type { ConnStatus } from '../lib/useGameSocket';

export function ConnPill({ status }: { status: ConnStatus }) {
  if (status === 'open') return null;
  const text = status === 'failed' ? 'Disconnected' : status === 'connecting' ? 'Connecting…' : 'Reconnecting…';
  return (
    <span className={`conn conn--${status}`} role="status">
      {status !== 'failed' && <span className="conn__spin" aria-hidden="true" />}
      {text}
    </span>
  );
}

export function TopBar({ status, code, hand }: { status: ConnStatus; code: string; hand?: number }) {
  return (
    <header className="topbar">
      <button type="button" className="topbar__back" onClick={() => navigate('/')} aria-label="Back to your games">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span>Games</span>
      </button>
      <span className="topbar__title">
        <span className="topbar__brand">Cabbage</span>
        <span className="topbar__meta">
          {code}
          {hand ? ` · deal ${hand}` : ''}
        </span>
      </span>
      <span className="topbar__right">
        <ConnPill status={status} />
      </span>
    </header>
  );
}
