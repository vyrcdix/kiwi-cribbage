import { useEffect, useRef, useState } from 'react';
import { CardView } from '../cards/CardView';
import { gameUrl } from '../lib/router';
import type { ConnStatus } from '../lib/useGameSocket';
import { TopBar } from './TopBar';

async function copyText(text: string, fallbackEl: HTMLInputElement | null): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    if (!fallbackEl) return false;
    fallbackEl.select();
    try {
      return document.execCommand('copy');
    } catch {
      return false;
    }
  }
}

export function Waiting({ code, myName, status }: { code: string; myName: string; status: ConnStatus }) {
  const url = gameUrl(code);
  const inputRef = useRef<HTMLInputElement>(null);
  const [copied, setCopied] = useState<'yes' | 'no' | null>(null);
  const canShare = typeof navigator.share === 'function';

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(null), 2200);
    return () => clearTimeout(t);
  }, [copied]);

  const copy = async () => setCopied((await copyText(url, inputRef.current)) ? 'yes' : 'no');
  const share = async () => {
    try {
      await navigator.share({ title: 'Cabbage', text: `${myName} has dealt you in for a game of cribbage.`, url });
    } catch {
      /* cancelled */
    }
  };

  return (
    <div className="page page--game">
      <TopBar status={status} code={code} />
      <main className="waiting">
        <div className="waiting__deck" aria-hidden="true">
          <CardView card={null} />
          <CardView card={null} />
          <CardView card={null} />
        </div>
        <h1 className="waiting__title">Waiting for an opponent</h1>
        <p className="waiting__lede">
          Send this link to whoever you'd like to play. The cards are dealt the moment they open it.
        </p>
        <div className="invite">
          <a className="invite__url" href={url} onClick={(e) => e.preventDefault()}>
            {url.replace(/^https?:\/\//, '')}
          </a>
          <input ref={inputRef} className="sr-only" readOnly value={url} tabIndex={-1} aria-hidden="true" />
          <div className="invite__buttons">
            <button type="button" className="btn btn--primary" onClick={copy}>
              {copied === 'yes' ? 'Copied!' : copied === 'no' ? 'Copy failed' : 'Copy link'}
            </button>
            {canShare && (
              <button type="button" className="btn btn--ghost" onClick={share}>
                Share…
              </button>
            )}
          </div>
          <p className="invite__code">
            Game code <strong>{code}</strong>
          </p>
        </div>
        <p className="fineprint">You can leave this page: the game waits on your home screen.</p>
      </main>
    </div>
  );
}
