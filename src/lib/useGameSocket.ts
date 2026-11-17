// One WebSocket per open game screen, with automatic reconnect. The server
// resends the full state after every (re)connect, so this hook keeps no game
// state of its own — it only hands messages to the caller.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Card } from '../../shared/cards';
import type { Action, ClientMsg, Seat, ServerMsg } from '../../shared/game';

export type StateMsg = Extract<ServerMsg, { t: 'state' }>;
export type ConnStatus = 'connecting' | 'open' | 'reconnecting' | 'failed';

interface Handlers {
  /** `fresh` is true for the first state after each (re)connect: its events must not be replayed. */
  onState: (msg: StateMsg, fresh: boolean) => void;
  onError: (message: string) => void;
  /** Presence: another player is considering the face-down card at `slot` (null = none). */
  onPresence?: (seat: Seat, slot: number | null) => void;
}

/** Presence is sent at most this often (about 4 a second); the latest value always gets through. */
const CONSIDER_EVERY_MS = 250;

interface Options extends Handlers {
  code: string;
  token: string;
  enabled: boolean;
}

/** After this long in the background a phone's socket may be silently dead; reconnect on return. */
const STALE_AFTER_HIDDEN_MS = 20_000;

export function useGameSocket({ code, token, enabled, onState, onError, onPresence }: Options) {
  const [status, setStatus] = useState<ConnStatus>('connecting');
  const [fatal, setFatal] = useState<string | null>(null);
  const [generation, setGeneration] = useState(0);
  const wsRef = useRef<WebSocket | null>(null);
  const handlers = useRef<Handlers>({ onState, onError, onPresence });
  handlers.current = { onState, onError, onPresence };

  // Presence: what we want the table to see, what this socket has been told, and when.
  const want = useRef<Card | null>(null);
  const told = useRef<{ ws: WebSocket | null; card: Card | null; at: number }>({ ws: null, card: null, at: 0 });
  const considerTimer = useRef<ReturnType<typeof setTimeout>>();
  const flushConsider = useCallback(() => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    // A new socket starts from "none" on the server.
    if (told.current.ws !== ws) told.current = { ws, card: null, at: 0 };
    if (told.current.card === want.current) return;
    const wait = told.current.at + CONSIDER_EVERY_MS - Date.now();
    if (wait > 0) {
      clearTimeout(considerTimer.current);
      considerTimer.current = setTimeout(flushConsider, wait);
      return;
    }
    told.current = { ws, card: want.current, at: Date.now() };
    const msg: ClientMsg = { t: 'consider', card: want.current };
    ws.send(JSON.stringify(msg));
  }, []);
  useEffect(() => () => clearTimeout(considerTimer.current), []);

  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let ws: WebSocket | null = null;
    let everOpen = false;
    let hiddenAt = 0;
    setFatal(null);
    setStatus('connecting');

    const connect = () => {
      clearTimeout(timer);
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const sock = new WebSocket(`${proto}//${location.host}/ws`);
      ws = sock;
      wsRef.current = sock;
      let gotState = false;

      sock.onopen = () => {
        const hello: ClientMsg = { t: 'hello', token, code };
        sock.send(JSON.stringify(hello));
      };
      sock.onmessage = (e) => {
        let msg: ServerMsg;
        try {
          msg = JSON.parse(String(e.data)) as ServerMsg;
        } catch {
          return;
        }
        if (msg.t === 'state') {
          const fresh = !gotState;
          gotState = true;
          everOpen = true;
          attempt = 0;
          setStatus('open');
          handlers.current.onState(msg, fresh);
          // After a reconnect, say again what we are considering.
          if (fresh) flushConsider();
        } else if (msg.t === 'presence') {
          handlers.current.onPresence?.(msg.seat, msg.slot);
        } else if (msg.t === 'error') {
          if (!gotState) setFatal(msg.message);
          else handlers.current.onError(msg.message);
        }
      };
      sock.onclose = (e) => {
        if (stopped || ws !== sock) return;
        wsRef.current = null;
        // 1008 = the server refused our hello (bad token, not a member…). Retrying won't help.
        if (e.code === 1008) {
          setStatus('failed');
          setFatal((f) => f ?? (e.reason || 'The server refused the connection'));
          return;
        }
        setStatus(everOpen ? 'reconnecting' : 'connecting');
        const delay = Math.min(10_000, 500 * 2 ** attempt) * (0.75 + Math.random() * 0.5);
        attempt += 1;
        timer = setTimeout(connect, delay);
      };
    };

    const reconnectNow = () => {
      if (stopped) return;
      const old = ws;
      ws = null;
      if (old) {
        old.onclose = null;
        old.onmessage = null;
        old.close();
      }
      attempt = 0;
      if (everOpen) setStatus('reconnecting');
      connect();
    };

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt = Date.now();
        return;
      }
      const stale = hiddenAt && Date.now() - hiddenAt > STALE_AFTER_HIDDEN_MS;
      if (stale || !ws || ws.readyState > WebSocket.OPEN) reconnectNow();
    };
    const onOnline = () => {
      if (!ws || ws.readyState !== WebSocket.OPEN) reconnectNow();
    };

    connect();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('online', onOnline);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('online', onOnline);
      if (ws) {
        ws.onclose = null;
        ws.close();
      }
      wsRef.current = null;
    };
  }, [code, token, enabled, generation]);

  const send = useCallback((action: Action): boolean => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    const msg: ClientMsg = { t: 'act', action };
    ws.send(JSON.stringify(msg));
    return true;
  }, []);

  /** Presence: say which card of yours you are considering (null = none). Throttled; never an error. */
  const consider = useCallback((card: Card | null) => {
    want.current = card;
    flushConsider();
  }, [flushConsider]);

  const retry = useCallback(() => setGeneration((g) => g + 1), []);

  return { status, fatal, send, consider, retry };
}
