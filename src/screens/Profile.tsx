// You: name, picture, deck and four-colour suits (all kept on the server, so
// they follow you to every device and to the table), your signed-in devices,
// linking a new one by QR code, inviting someone, and signing out.
import { type CSSProperties, type FormEvent, useState } from 'react';
import { MAX_NAME, isSingleEmoji } from '../../shared/league';
import { card } from '../../shared/cards';
import type { DeviceLinkCode } from '../../shared/league';
import { CardView } from '../cards/CardView';
import { DECKS, DECK_ORDER, DEFAULT_DECK } from '../cards/decks';
import { useFourColour } from '../cards/prefs';
import { api, clearProfile, errorMessage } from '../lib/api';
import { usePace } from '../game/pace';
import { linkUrl, navigate, onLink } from '../lib/router';
import { useApi, useSession } from '../lib/session';
import { AVATAR_COLOURS, Avatar } from '../ui/Avatar';
import { Confirm, ErrorLine, Loading, PageHead, QrCode, Section, fmtDate, useCountdown } from '../ui/bits';
import { timeAgo } from '../lib/format';
import { Shell } from '../ui/Shell';
import { Invite } from './League';

const EMOJI = ['🦉', '🐻', '🦊', '🐶', '🐱', '🐸', '🐢', '🐙', '🦆', '🐧', '🦔', '🐝', '🌻', '🌿', '🍄', '🌵', '🍓', '🍋', '🍐', '🥝', '🍰', '🥧', '☕', '🎣', '🚲', '⛵', '🎻', '🧶', '🎲', '⭐'];

function NameForm() {
  const { me, updateMe } = useSession();
  const [name, setName] = useState(me?.name ?? '');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    const n = name.trim();
    if (!n) return setMsg({ ok: false, text: 'Your name can’t be empty.' });
    setBusy(true);
    setMsg(null);
    try {
      await updateMe({ name: n });
      setMsg({ ok: true, text: 'Saved.' });
    } catch (err) {
      setMsg({ ok: false, text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="inline-form" onSubmit={save}>
      <label htmlFor="pname" className="sr-only">Name</label>
      <input id="pname" className="input" value={name} maxLength={MAX_NAME} onChange={(e) => setName(e.target.value)} autoComplete="nickname" />
      <button type="submit" className="btn" disabled={busy || name.trim() === me?.name}>Save</button>
      {msg && <p className={msg.ok ? 'ok-note' : 'form-error'} role="status">{msg.text}</p>}
    </form>
  );
}

function Picture() {
  const { me, updateMe } = useSession();
  const [custom, setCustom] = useState('');
  const [error, setError] = useState<string | null>(null);
  if (!me) return null;
  const emoji = me.avatar?.emoji ?? null;
  const colour = me.avatar?.colour ?? AVATAR_COLOURS[0];
  const set = async (e: string, c: string) => {
    setError(null);
    try {
      await updateMe({ avatar: { emoji: e, colour: c } });
    } catch (err) {
      setError(errorMessage(err));
    }
  };
  return (
    <div className="picture">
      <div className="picture__preview">
        <Avatar player={me} size={72} />
        {me.avatar && (
          <button type="button" className="link link--small" onClick={() => updateMe({ avatar: null }).catch((e2) => setError(errorMessage(e2)))}>
            Use my initial
          </button>
        )}
      </div>
      <div className="picture__pickers">
        <ul className="emoji-grid" aria-label="Emoji">
          {EMOJI.map((x) => (
            <li key={x}>
              <button type="button" className="emoji-grid__opt" aria-pressed={emoji === x} onClick={() => set(x, colour)} aria-label={x}>{x}</button>
            </li>
          ))}
        </ul>
        <form
          className="inline-form inline-form--small"
          onSubmit={(e) => {
            e.preventDefault();
            const v = custom.trim();
            if (!isSingleEmoji(v)) return setError('That needs to be a single emoji.');
            void set(v, colour);
            setCustom('');
          }}
        >
          <label htmlFor="emoji-custom" className="sr-only">Any emoji</label>
          <input id="emoji-custom" className="input input--small" value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="Or type any emoji" maxLength={16} />
          <button type="submit" className="btn btn--small btn--quiet" disabled={!custom.trim()}>Use</button>
        </form>
        <ul className="swatches" aria-label="Colour">
          {AVATAR_COLOURS.map((c) => (
            <li key={c}>
              <button
                type="button"
                className="swatch"
                style={{ '--sw': c } as CSSProperties}
                aria-pressed={me.avatar?.colour === c}
                aria-label={`Colour ${c}`}
                onClick={() => set(emoji ?? EMOJI[0], c)}
              />
            </li>
          ))}
        </ul>
        {error && <p className="form-error" role="alert">{error}</p>}
      </div>
    </div>
  );
}

const PREVIEW = [card(0, 0), card(11, 1), card(6, 2), card(12, 3)];

function Decks() {
  const { me, updateMe } = useSession();
  const [four, setFour] = useFourColour();
  const [error, setError] = useState<string | null>(null);
  const current = me?.deck && DECKS[me.deck] ? me.deck : DEFAULT_DECK;
  return (
    <div className="decks">
      <ul className="deck-tiles" role="radiogroup" aria-label="Deck">
        {DECK_ORDER.map((id) => (
          <li key={id}>
            <button
              type="button"
              role="radio"
              aria-checked={current === id}
              className="deck-tile"
              onClick={() => updateMe({ deck: id }).catch((e) => setError(errorMessage(e)))}
            >
              <span className="deck-tile__cards" aria-hidden="true">
                <CardView card={null} deck={id} width={44} decorative />
                {PREVIEW.map((c) => <CardView key={c} card={c} deck={id} width={44} decorative />)}
              </span>
              <span className="deck-tile__name">{DECKS[id].name}{id === DEFAULT_DECK && <small>the house deck</small>}</span>
            </button>
          </li>
        ))}
      </ul>
      <label className="switch">
        <input type="checkbox" checked={four} onChange={(e) => setFour(e.target.checked)} />
        <span className="switch__track" aria-hidden="true" />
        <span className="switch__text">
          <strong>Four-colour suits</strong>
          <span>Diamonds blue, clubs green — on every device you use</span>
        </span>
      </label>
      <PaceSetting />
      <p className="caption">You see your own deck at the table; everyone else sees theirs.</p>
      <a className="link" href={`/deck?d=${current}`} onClick={(e) => onLink(e, `/deck?d=${current}`)}>See the whole deck</a>
      {error && <p className="form-error" role="alert">{error}</p>}
    </div>
  );
}

/** How fast the show counts a hand aloud. Kept on this device for now. */
function PaceSetting() {
  const [pace, setPace] = usePace();
  return (
    <div className="pace">
      <p className="pace__label"><strong>Counting pace</strong><span>How fast hands are counted aloud at the show · this device</span></p>
      <div className="segmented segmented--start" role="radiogroup" aria-label="Counting pace">
        {(['relaxed', 'brisk'] as const).map((p) => (
          <button key={p} type="button" role="radio" aria-checked={pace === p} className="segmented__opt" onClick={() => setPace(p)}>
            {p === 'relaxed' ? 'Relaxed' : 'Brisk'}
          </button>
        ))}
      </div>
    </div>
  );
}

function LinkDevice() {
  const { token } = useSession();
  const [code, setCode] = useState<DeviceLinkCode | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const left = useCountdown(code?.expiresAt ?? null, () => setCode(null));
  const make = async () => {
    setBusy(true);
    setError(null);
    try {
      setCode(await api.createLink(token));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  if (!code) {
    return (
      <div className="linkdev">
        <p className="muted">Play on your phone and your laptop as the same person. Make a one-time code here, then scan it or type it on the other device.</p>
        <button type="button" className="btn btn--quiet" onClick={make} disabled={busy}>{busy ? 'Making a code…' : 'Link another device'}</button>
        {error && <p className="form-error" role="alert">{error}</p>}
      </div>
    );
  }
  const url = linkUrl(code.code);
  return (
    <div className="linkdev linkdev--open panel">
      <QrCode text={url} size={196} label="QR code that signs a new device in as you" />
      <p className="linkdev__code" aria-label={`Code ${code.code.split('').join(' ')}`}>{code.code.slice(0, 4)}<span>-</span>{code.code.slice(4)}</p>
      <p className="caption">
        Scan with the new device’s camera, or open Cabbage there, choose <strong>I already have a profile</strong> and type the code.
        Works once · {left} left.
      </p>
      <button type="button" className="btn btn--quiet btn--small" onClick={() => setCode(null)}>Done</button>
    </div>
  );
}

function Devices() {
  const { token, authLost } = useSession();
  const s = useApi('sessions', (t) => api.sessions(t));
  const [confirm, setConfirm] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const end = async (id: string, current: boolean) => {
    setBusy(true);
    setError(null);
    try {
      if (current) {
        await api.signOut(token);
        clearProfile();
        authLost();
        navigate('/', true);
        return;
      }
      await api.endSession(token, id);
      s.reload();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };
  const sessions = s.data?.sessions ?? [];
  const target = sessions.find((x) => x.id === confirm);
  return (
    <div className="devices">
      {s.error && <ErrorLine error={s.error} retry={s.reload} />}
      {!s.data && !s.error && <Loading what="Listing your devices" />}
      <ul className="rows">
        {sessions.map((x, i) => (
          <li key={x.id} className="device-row">
            <svg className="device-row__icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="3" width="10" height="18" rx="2.5" /><path d="M11 17.5h2" /></svg>
            <span className="device-row__main">
              <strong>{x.current ? 'This device' : `Device ${i + 1}`}</strong>
              <span className="caption">Signed in {fmtDate(x.createdAt, true)} · last seen {timeAgo(x.lastSeenAt)}</span>
            </span>
            <button type="button" className="btn btn--small btn--quiet" onClick={() => setConfirm(x.id)} disabled={busy}>Sign out</button>
          </li>
        ))}
      </ul>
      {error && <p className="form-error" role="alert">{error}</p>}
      {target && (
        <Confirm
          title={target.current ? 'Sign out of this device?' : 'Sign that device out?'}
          confirm="Sign out"
          danger
          busy={busy}
          onCancel={() => setConfirm(null)}
          onConfirm={() => end(target.id, target.current)}
        >
          {target.current
            ? 'Your games and stats stay in the league. To come back on this device, use a code from another device where you’re signed in.'
            : 'It will need a new code from you to sign in again.'}
        </Confirm>
      )}
    </div>
  );
}

export function ProfileScreen() {
  const { me, isCommissioner, league } = useSession();
  return (
    <Shell tab="me">
      <PageHead title="You" sub={me ? `In the league since ${fmtDate(me.createdAt, true)}${league ? ` · ${league.season.name}` : ''}` : undefined}>
        {me && (
          <a className="link link--small" href={`/players/${me.id}`} onClick={(e) => onLink(e, `/players/${me.id}`)}>Your stats</a>
        )}
      </PageHead>
      {isCommissioner && (
        <a className="comm-banner" href="/commissioner" onClick={(e) => onLink(e, '/commissioner')}>
          <span><strong>You’re the commissioner.</strong> Seasons, the round robin, voids and members.</span>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7" /></svg>
        </a>
      )}
      <div className="profile-grid">
        <div>
          <Section title="Name"><NameForm /></Section>
          <Section title="Picture"><Picture /></Section>
          <Section title="Cards"><Decks /></Section>
        </div>
        <div>
          <Section title="Link another device"><LinkDevice /></Section>
          <Section title="Signed-in devices"><Devices /></Section>
          <Section title="Invite someone to the league"><Invite /></Section>
        </div>
      </div>
    </Shell>
  );
}
