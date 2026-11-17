import { useEffect, useRef, useState } from 'react';
import { type PlayerCount, teamOf } from '../../shared/game';
import { CardView } from '../cards/CardView';
import { type Profile, api, errorMessage, errorStatus } from '../lib/api';
import { gameUrl, navigate } from '../lib/router';
import { useOptionalSession } from '../lib/session';
import { Avatar } from '../ui/Avatar';
import { Confirm } from '../ui/bits';
import type { ConnStatus, StateMsg } from '../lib/useGameSocket';
import { relationOf, toneClass, toneOfSeat } from './seating';
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

interface Props {
  msg: StateMsg;
  names: string[];
  profile: Profile;
  status: ConnStatus;
  toast: string | null;
  onError: (message: string) => void;
  onAuthLost: () => void;
}

export function Waiting({ msg, names, profile, status, toast, onError, onAuthLost }: Props) {
  const { code, you } = msg;
  const players = msg.players.length as PlayerCount;
  const url = gameUrl(code);
  const inputRef = useRef<HTMLInputElement>(null);
  const [copied, setCopied] = useState<'yes' | 'no' | null>(null);
  const [picked, setPicked] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const canShare = typeof navigator.share === 'function';
  const isCreator = msg.creator === profile.id;
  const open = msg.players.filter((p) => p === null).length;
  const session = useOptionalSession();
  const [ask, setAsk] = useState<{ kind: 'remove'; id: string; name: string } | { kind: 'leave' } | null>(null);
  const [asking, setAsking] = useState(false);

  const confirmAsk = async () => {
    if (!ask) return;
    setAsking(true);
    try {
      if (ask.kind === 'leave') {
        await api.leaveGame(profile.token, code);
        navigate('/', true);
        return;
      }
      await api.removePlayer(profile.token, code, ask.id);
    } catch (e) {
      if (errorStatus(e) === 401) onAuthLost();
      else onError(errorMessage(e));
    } finally {
      setAsking(false);
      setAsk(null);
    }
  };

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(null), 2200);
    return () => clearTimeout(t);
  }, [copied]);
  // Someone joined or seats moved: drop a half-made swap.
  const seatKey = msg.players.map((p) => p?.id ?? '-').join(',');
  useEffect(() => setPicked(null), [seatKey]);

  const copy = async () => setCopied((await copyText(url, inputRef.current)) ? 'yes' : 'no');
  const share = async () => {
    try {
      await navigator.share({ title: 'Cabbage', text: `${names[you]} has dealt you in for a game of cribbage.`, url });
    } catch {
      /* cancelled */
    }
  };

  const swap = async (a: number, b: number) => {
    const order = msg.players.map((p) => p?.id ?? null);
    [order[a], order[b]] = [order[b], order[a]];
    setBusy(true);
    try {
      await api.arrangeSeats(profile.token, code, order);
    } catch (e) {
      if (errorStatus(e) === 401) onAuthLost();
      else onError(errorMessage(e));
    } finally {
      setBusy(false);
      setPicked(null);
    }
  };

  const tapSeat = (seat: number) => {
    if (!isCreator || busy) return;
    if (picked === null) {
      if (msg.players[seat] !== null) setPicked(seat);
    } else if (picked === seat) setPicked(null);
    else void swap(picked, seat);
  };

  const seatRow = (seat: number) => {
    const p = msg.players[seat];
    const rel = relationOf(players, you, seat);
    const tone = toneOfSeat(players, you, seat);
    const label = p ? (seat === you ? `${p.name} (you)` : p.name) : 'Open seat';
    const tag = rel === 'partner' ? 'your partner' : seat === you ? '' : players === 4 ? 'opponent' : '';
    const content = (
      <>
        <span className="seat__num">{seat + 1}</span>
        {p && <Avatar player={session?.members.get(p.id) ?? p} size={26} />}
        <span className="seat__name">{label}</span>
        {tag && p && <span className="seat__tag">{tag}</span>}
        {p && seat !== you && (
          <span className={`presence ${msg.online[seat] ? 'is-online' : 'is-offline'}`} title={msg.online[seat] ? 'Online' : 'Offline'} />
        )}
      </>
    );
    const cls = `seat ${p ? toneClass(tone) : 'seat--open'}${picked === seat ? ' is-picked' : ''}`;
    const row = isCreator ? (
      <button type="button" className={cls} onClick={() => tapSeat(seat)} disabled={busy || (picked === null && !p)}>
        {content}
      </button>
    ) : (
      <div className={cls}>{content}</div>
    );
    return (
      <div key={seat} className="seat-line">
        {row}
        {isCreator && p && seat !== you && (
          <button type="button" className="seat-line__remove" onClick={() => setAsk({ kind: 'remove', id: p.id, name: p.name })} aria-label={`Remove ${p.name}`}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17" /></svg>
          </button>
        )}
      </div>
    );
  };

  const seatList =
    players === 4 ? (
      <div className="seats seats--teams">
        {[0, 1].map((team) => (
          <div key={team} className={`team-box ${toneClass(toneOfSeat(4, you, team))}`}>
            <p className="team-box__head">
              {teamOf(4, you) === team ? 'Your side' : 'Opponents'} · seats {team + 1} &amp; {team + 3}
            </p>
            {seatRow(team)}
            {seatRow(team + 2)}
          </div>
        ))}
      </div>
    ) : (
      <div className="seats">{msg.players.map((_, s) => seatRow(s))}</div>
    );

  const title =
    players === 2 ? 'Waiting for an opponent' : open === 1 ? 'Waiting for one more player' : `Waiting for ${open} more players`;

  return (
    <div className="page page--game">
      <TopBar status={status} code={code} />
      <main className="waiting">
        <div className="waiting__deck" aria-hidden="true">
          <CardView card={null} width={64} decorative />
          <CardView card={null} width={64} decorative />
          <CardView card={null} width={64} decorative />
        </div>
        <h1 className="waiting__title">{title}</h1>
        <p className="waiting__lede">
          {players === 2
            ? 'Send this link to whoever you’d like to play. The cards are dealt the moment they open it.'
            : `A ${players}-player game${players === 4 ? ' in two partnerships' : ', everyone for themselves'}. Send the link to everyone; the cards are dealt when the last seat fills.`}
        </p>

        {players > 2 && (
          <section className="seating" aria-label="Seats">
            {seatList}
            <p className="seating__note">
              {players === 4 ? 'Partners sit opposite: seats 1 & 3 play seats 2 & 4.' : 'Play goes round in seat order: 1 → 2 → 3.'}{' '}
              {isCreator
                ? picked === null
                  ? 'To move someone, tap them, then tap the seat to swap with.'
                  : `Now tap the seat to swap ${msg.players[picked]?.name ?? ''} into.`
                : 'The player who made the game can rearrange seats.'}
            </p>
          </section>
        )}

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
        <button type="button" className="link link--quiet" onClick={() => setAsk({ kind: 'leave' })}>
          {isCreator && msg.players.filter(Boolean).length === 1 ? 'Cancel this game' : 'Leave this game'}
        </button>
        {ask && (
          <Confirm
            title={ask.kind === 'leave' ? (msg.players.filter(Boolean).length === 1 ? 'Cancel this game?' : 'Leave this game?') : `Remove ${ask.name}?`}
            confirm={ask.kind === 'leave' ? (msg.players.filter(Boolean).length === 1 ? 'Cancel the game' : 'Leave') : 'Remove'}
            danger
            busy={asking}
            onCancel={() => setAsk(null)}
            onConfirm={confirmAsk}
          >
            {ask.kind === 'leave'
              ? msg.players.filter(Boolean).length === 1
                ? 'Nobody else has joined, so the game and its link will be deleted.'
                : isCreator
                  ? 'Your seat opens up again, and the next player in becomes the one who arranges seats.'
                  : 'Your seat opens up again for someone else.'
              : `${ask.name}’s seat opens up again. They can come back with the link.`}
          </Confirm>
        )}
        {toast && (
          <p className="toast" role="alert">
            {toast}
          </p>
        )}
      </main>
    </div>
  );
}
