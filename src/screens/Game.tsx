import { useCallback, useEffect, useRef, useState } from 'react';
import type { Action } from '../../shared/game';
import type { Fixture } from '../../shared/league';
import type { Beat } from '../game/director';
import { Table } from '../game/Table';
import { TopBar } from '../game/TopBar';
import { Waiting } from '../game/Waiting';
import { type Profile, api, errorMessage, errorStatus } from '../lib/api';
import { navigate } from '../lib/router';
import { useOptionalSession } from '../lib/session';
import { nextLabel } from '../lib/league-text';
import { type StateMsg, useGameSocket } from '../lib/useGameSocket';

/** Display name by seat; yours falls back to your profile, open seats to "Open seat". */
function seatNames(m: StateMsg, myName: string): string[] {
  return m.players.map((p, s) => p?.name ?? (s === m.you ? myName : 'Open seat'));
}


type JoinState =
  | { kind: 'joining' }
  | { kind: 'ok' }
  | { kind: 'error'; title: string; detail: string; retry: boolean };

function Notice({ title, detail, retry, code }: { title: string; detail?: string; retry?: () => void; code: string }) {
  return (
    <div className="page page--game">
      <TopBar status="open" code={code} />
      <main className="notice">
        <h1>{title}</h1>
        {detail && <p>{detail}</p>}
        <div className="notice__buttons">
          {retry && (
            <button type="button" className="btn btn--primary" onClick={retry}>
              Try again
            </button>
          )}
          <button type="button" className={retry ? 'btn btn--ghost' : 'btn btn--primary'} onClick={() => navigate('/')}>
            Back to your games
          </button>
        </div>
      </main>
    </div>
  );
}

export function Game({ code, profile, onAuthLost }: { code: string; profile: Profile; onAuthLost: () => void }) {
  const token = profile.token;
  const [join, setJoin] = useState<JoinState>({ kind: 'joining' });
  const [joinAttempt, setJoinAttempt] = useState(0);
  const [msg, setMsg] = useState<StateMsg | null>(null);
  const [pending, setPending] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [rematchBusy, setRematchBusy] = useState(false);
  const [rematchError, setRematchError] = useState<string | null>(null);
  const [beat, setBeat] = useState<Beat>({ id: 0, events: [], fresh: true });
  const beatId = useRef(0);
  const authLost = useRef(onAuthLost);
  authLost.current = onAuthLost;
  const session = useOptionalSession();
  const [nextFixture, setNextFixture] = useState<Fixture | null>(null);
  const [nextBusy, setNextBusy] = useState(false);
  const [nextError, setNextError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setJoin({ kind: 'joining' });
    api.join(token, code).then(
      () => alive && setJoin({ kind: 'ok' }),
      (e: unknown) => {
        if (!alive) return;
        const status = errorStatus(e);
        if (status === 401) authLost.current();
        else if (status === 404)
          setJoin({
            kind: 'error',
            title: 'We can’t find that game',
            detail: `There’s no game with the code ${code}. Check the link, or start a new game from your home screen.`,
            retry: false,
          });
        else if (status === 409)
          setJoin({
            kind: 'error',
            title: 'That table is full',
            detail: 'Every seat in this game is already taken. Ask for a fresh invite link.',
            retry: false,
          });
        else setJoin({ kind: 'error', title: 'Couldn’t join the game', detail: errorMessage(e), retry: true });
      },
    );
    return () => {
      alive = false;
    };
  }, [token, code, joinAttempt]);

  const showToast = useCallback((text: string) => setToast(text), []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  // Safety valve: never leave buttons disabled if a reply goes missing.
  useEffect(() => {
    if (!pending) return;
    const t = setTimeout(() => setPending(false), 8000);
    return () => clearTimeout(t);
  }, [pending]);

  const sock = useGameSocket({
    code,
    token,
    enabled: join.kind === 'ok',
    onState: (m, fresh) => {
      setMsg(m);
      setPending(false);
      // Each message's events are a beat for the table's choreography.
      setBeat({ id: ++beatId.current, events: m.events, fresh });
    },
    onError: (message) => {
      setPending(false);
      showToast(message);
    },
  });

  const act = useCallback(
    (a: Action) => {
      if (sock.send(a)) setPending(true);
      else showToast('Not connected — reconnecting…');
    },
    [sock.send, showToast],
  );

  const goRematch = useCallback(async () => {
    if (msg?.next) {
      navigate(`/g/${msg.next}`);
      return;
    }
    setRematchBusy(true);
    setRematchError(null);
    try {
      const r = await api.rematch(token, code);
      navigate(`/g/${r.code}`);
    } catch (e) {
      if (errorStatus(e) === 401) authLost.current();
      setRematchError(errorMessage(e));
      setRematchBusy(false);
    }
  }, [msg?.next, token, code]);

  // Finishing a game offers you the next one in your queue.
  const finished = msg?.status === 'finished';
  useEffect(() => {
    if (!finished) return;
    let alive = true;
    api.nextFixture(token).then(
      (r) => alive && setNextFixture(r.fixture),
      () => {},
    );
    return () => {
      alive = false;
    };
  }, [finished, token]);

  const goNext = useCallback(async () => {
    if (!nextFixture) return;
    setNextBusy(true);
    setNextError(null);
    try {
      const r = await api.startFixture(token, nextFixture.id);
      navigate(`/g/${r.code}`);
    } catch (e) {
      if (errorStatus(e) === 401) authLost.current();
      setNextError(errorMessage(e));
      setNextBusy(false);
    }
  }, [nextFixture, token]);

  if (join.kind === 'joining') return <Notice code={code} title="Pulling up a chair…" />;
  if (join.kind === 'error')
    return (
      <Notice
        code={code}
        title={join.title}
        detail={join.detail}
        retry={join.retry ? () => setJoinAttempt((n) => n + 1) : undefined}
      />
    );
  if (sock.fatal && !msg) return <Notice code={code} title="Couldn’t open the game" detail={sock.fatal} retry={sock.retry} />;
  if (!msg)
    return (
      <div className="page page--game">
        <TopBar status={sock.status} code={code} />
        <main className="notice">
          <h1>Shuffling…</h1>
        </main>
      </div>
    );

  const names = seatNames(msg, profile.name);
  const emojis = msg.players.map((p) => (p ? session?.members.get(p.id)?.avatar?.emoji ?? null : null));

  // Removed from (or left) a waiting game: the server hung up on purpose.
  if (sock.fatal && !msg.view) return <Notice code={code} title={sock.fatal} detail="You can still find your other games on your home screen." />;

  if (!msg.view)
    return (
      <Waiting
        msg={msg}
        names={names}
        profile={profile}
        status={sock.status}
        onError={showToast}
        toast={toast}
        onAuthLost={() => authLost.current()}
      />
    );

  return (
    <Table
      msg={msg}
      view={msg.view}
      names={names}
      status={sock.fatal ? 'failed' : sock.status}
      pending={pending}
      act={act}
      beat={beat}
      toast={toast ?? (sock.fatal ? sock.fatal : null)}
      rematch={{ busy: rematchBusy, error: rematchError, go: goRematch }}
      emojis={emojis}
      next={nextFixture ? { label: nextLabel(nextFixture, profile.id), busy: nextBusy, error: nextError, go: goNext } : null}
    />
  );
}
