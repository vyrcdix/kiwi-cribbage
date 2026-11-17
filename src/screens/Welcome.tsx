import { type FormEvent, useState } from 'react';
import { card } from '../../shared/cards';
import { CardView } from '../cards/CardView';
import { type Profile, api, errorMessage } from '../lib/api';

// The perfect 29: three fives and the right jack, with the fourth five cut.
const FAN = [card(4, 0), card(4, 1), card(10, 2), card(4, 3), card(4, 2)];

export function Welcome({ invited, onCreated }: { invited: boolean; onCreated: (p: Profile) => void }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      onCreated(await api.createPlayer(n));
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <main className="welcome">
        <div className="fan" aria-hidden="true">
          {FAN.map((c, i) => (
            <CardView key={c} card={c} style={{ ['--i' as string]: i - 2 }} />
          ))}
        </div>
        <h1 className="brand">Cabbage</h1>
        <p className="tagline">Cribbage for friends &amp; family</p>
        {invited && (
          <p className="invite-note">
            <strong>You’ve been invited to a game.</strong> Tell us your name and we’ll take you straight to the table.
          </p>
        )}
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
          <button type="submit" className="btn btn--primary btn--wide" disabled={busy}>
            {busy ? 'One moment…' : invited ? 'Join the game' : 'Let’s play'}
          </button>
        </form>
        <p className="fineprint">No passwords: this device remembers you.</p>
      </main>
    </div>
  );
}
