import { type FormEvent, useEffect, useState } from 'react';
import { card } from '../../shared/cards';
import type { InviteStatus } from '../../shared/league';
import { Brand } from '../brand/Mark';
import { CardView } from '../cards/CardView';
import { type Profile, api, errorMessage, errorStatus } from '../lib/api';

// The perfect 29: three fives and the right jack, with the fourth five cut.
const FAN = [card(4, 0), card(4, 1), card(10, 2), card(4, 3), card(4, 2)];

/** "ABCD-EFGH" as the code is typed (the server ignores case and dashes). */
const formatLinkCode = (raw: string) => {
  const c = raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
  return c.length > 4 ? `${c.slice(0, 4)}-${c.slice(4)}` : c;
};

function LinkForm({ initial, onCreated, onBack }: { initial?: string; onCreated: (p: Profile) => void; onBack?: () => void }) {
  const [code, setCode] = useState(() => formatLinkCode(initial ?? ''));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const c = code.replace(/[^A-Z0-9]/gi, '');
    if (c.length !== 8) {
      setError('The code is eight letters and numbers.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      onCreated(await api.redeemLink(c));
    } catch (err) {
      setError(errorStatus(err) === 403 ? 'That code has expired or been used. Make a new one on your other device.' : errorMessage(err));
      setBusy(false);
    }
  };
  return (
    <form className="name-form" onSubmit={submit} noValidate>
      <p className="welcome__how">
        On a device where you’re already signed in, open <strong>You → Link another device</strong>. Scan its QR code with this
        device’s camera, or type the code here.
      </p>
      <label htmlFor="link-code">Code from your other device</label>
      <input
        id="link-code"
        className="input input--code"
        value={code}
        onChange={(e) => setCode(formatLinkCode(e.target.value))}
        autoCapitalize="characters"
        autoComplete="one-time-code"
        spellCheck={false}
        inputMode="text"
        placeholder="ABCD-EFGH"
        disabled={busy}
      />
      {error && <p className="form-error" role="alert">{error}</p>}
      <button type="submit" className="btn btn--wide" disabled={busy}>{busy ? 'One moment…' : 'Sign in on this device'}</button>
      {onBack && <button type="button" className="link" onClick={onBack}>I’m new here</button>}
    </form>
  );
}

/**
 * Sign-up and sign-in. `code`: the game this person was invited to (/g/CODE),
 * which also lets them join the league. `invite`: a league invite token
 * (/invite/TOKEN). `linkCode`: a one-time code from another device (/link/CODE).
 */
export function Welcome({ code, invite, linkCode, onCreated }: { code?: string; invite?: string; linkCode?: string; onCreated: (p: Profile) => void }) {
  const [mode, setMode] = useState<'new' | 'link'>(linkCode ? 'link' : 'new');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inviteStatus, setInviteStatus] = useState<InviteStatus | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);

  useEffect(() => {
    if (!invite) return;
    let alive = true;
    api.invite(invite).then(
      (s) => alive && setInviteStatus(s),
      (e: unknown) => alive && setInviteError(errorMessage(e)),
    );
    return () => {
      alive = false;
    };
  }, [invite]);

  const inviteBad = inviteStatus !== null && !inviteStatus.valid;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const n = name.trim();
    if (!n) {
      setError('Tell us what to call you.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      onCreated(await api.createPlayer(n, invite ? { invite } : code ? { code } : {}));
    } catch (err) {
      // Without a game code or an invite there is nothing to vouch for a newcomer.
      setError(!code && !invite && errorStatus(err) === 403
        ? 'Cabbage is invite-only — ask someone in the league for an invite link.'
        : errorMessage(err));
      setBusy(false);
    }
  };

  const reasons: Record<string, string> = {
    used: 'This invite link has already been used.',
    expired: 'This invite link has expired.',
    unknown: 'This invite link isn’t one we know.',
  };

  return (
    <div className="page">
      <main className="welcome">
        <div className="fan" aria-hidden="true">
          {FAN.map((c, i) => (
            <span key={c} className="fan__card" style={{ ['--i' as string]: i - 2 }}><CardView card={c} width={90} decorative /></span>
          ))}
        </div>
        <h1 className="welcome__title"><Brand /></h1>
        <p className="tagline">Cribbage for friends &amp; family</p>

        {mode === 'link' ? (
          <>
            <p className="invite-note panel">
              <strong>Sign in on this device</strong> Use your profile here too: same name, same games, same league.
            </p>
            <LinkForm initial={linkCode} onCreated={onCreated} onBack={() => setMode('new')} />
          </>
        ) : (
          <>
            {code && (
              <p className="invite-note panel">
                <strong>You’ve been invited to a game.</strong> Tell us your name and we’ll take you straight to the table.
              </p>
            )}
            {invite && !inviteStatus && !inviteError && <p className="muted welcome__checking">Checking your invite…</p>}
            {invite && inviteStatus?.valid && (
              <p className="invite-note panel">
                <strong>{inviteStatus.invitedBy ? `${inviteStatus.invitedBy.name} has invited you` : 'You’re invited'} to the league.</strong>
                Tell us your name to join. You’ll see the standings, the queue and everyone’s games.
              </p>
            )}
            {invite && (inviteBad || inviteError) && (
              <p className="invite-note invite-note--bad panel">
                <strong>{inviteStatus?.reason ? reasons[inviteStatus.reason] : 'We couldn’t check this invite.'}</strong>
                {inviteError ?? 'Ask whoever sent it for a fresh one — each invite link works once.'}
              </p>
            )}
            {!(invite && inviteBad) && (
              <form className="name-form" onSubmit={submit} noValidate>
                <label htmlFor="name">What should we call you?</label>
                <input
                  id="name"
                  className="input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={24}
                  autoComplete="nickname"
                  autoCapitalize="words"
                  enterKeyHint="go"
                  placeholder="Your name"
                  disabled={busy}
                />
                {error && <p className="form-error" role="alert">{error}</p>}
                <button type="submit" className="btn btn--wide" disabled={busy}>
                  {busy ? 'One moment…' : code ? 'Join the game' : invite ? 'Join the league' : 'Let’s play'}
                </button>
              </form>
            )}
            <button type="button" className="link welcome__switch" onClick={() => setMode('link')}>I already have a profile</button>
          </>
        )}
        <p className="fineprint">No passwords: this device remembers you.</p>
      </main>
    </div>
  );
}
