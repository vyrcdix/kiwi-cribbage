import { useCallback, useEffect, useRef, useState } from 'react';
import { type Action, other } from '../../shared/game';
import { describeEvents, useCallouts } from '../game/callouts';
import { Table } from '../game/Table';
import { TopBar } from '../game/TopBar';
import { Waiting } from '../game/Waiting';
import { type Profile, api, errorMessage, errorStatus } from '../lib/api';
import { navigate } from '../lib/router';
import { type StateMsg, useGameSocket } from '../lib/useGameSocket';

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
  const callouts = useCallouts();
  const authLost = useRef(onAuthLost);
  authLost.current = onAuthLost;

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
            detail: 'Two players are already seated in this game. Ask for a fresh invite link.',
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

  const pushCallouts = callouts.push;
  const sock = useGameSocket({
    code,
    token,
    enabled: join.kind === 'ok',
    onState: (m, fresh) => {
      setMsg(m);
      setPending(false);
      if (!fresh && m.events.length) {
        const you = m.you;
        const names: [string, string] = [m.players[0]?.name ?? 'Opponent', m.players[1]?.name ?? 'Opponent'];
        names[you] = m.players[you]?.name ?? profile.name;
        pushCallouts(describeEvents(m.events, you, names));
      }
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

  const you = msg.you;
  const opp = other(you);
  const names: [string, string] = ['', ''];
  names[you] = msg.players[you]?.name ?? profile.name;
  names[opp] = msg.players[opp]?.name ?? 'Opponent';

  if (!msg.view) return <Waiting code={msg.code} myName={names[you]} status={sock.status} />;

  return (
    <Table
      msg={msg}
      view={msg.view}
      names={names}
      status={sock.fatal ? 'failed' : sock.status}
      pending={pending}
      act={act}
      callouts={callouts.active}
      log={callouts.log}
      toast={toast ?? (sock.fatal ? sock.fatal : null)}
      rematch={{ busy: rematchBusy, error: rematchError, go: goRematch }}
    />
  );
}
