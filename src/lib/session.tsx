// The signed-in session: your profile from the server (the source of truth for
// name, avatar, deck and four-colour suits), the league's members (so avatars
// can be drawn wherever a player appears, even where the game protocol only
// carries a name) and a small data hook every league screen uses.
import { type ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { LeagueResponse, Me, PlayerCard, UpdateMeRequest } from '../../shared/league';
import { DECKS, DEFAULT_DECK, DeckContext } from '../cards/decks';
import { setFourColourFromProfile, setFourColourPersist, takeLegacyFourColour } from '../cards/prefs';
import { type Profile, api, errorMessage, errorStatus, saveProfile } from './api';

export interface Session {
  profile: Profile;
  token: string;
  /** null until loaded (or if the server can't be reached). */
  me: Me | null;
  league: LeagueResponse | null;
  /** Every member by id (deactivated included). */
  members: Map<string, PlayerCard>;
  isCommissioner: boolean;
  refreshLeague: () => void;
  updateMe: (patch: UpdateMeRequest) => Promise<Me>;
  /** The server says we're not signed in any more: forget this device's profile. */
  authLost: () => void;
}

const SessionContext = createContext<Session | null>(null);

export function useSession(): Session {
  const s = useContext(SessionContext);
  if (!s) throw new Error('useSession outside SessionProvider');
  return s;
}

/** For components that also render signed out (the table's strips in /dev). */
export const useOptionalSession = (): Session | null => useContext(SessionContext);

export function SessionProvider({ profile, onAuthLost, onProfile, splash, children }: {
  profile: Profile;
  onAuthLost: () => void;
  onProfile: (p: Profile) => void;
  splash: ReactNode;
  children: ReactNode;
}) {
  const token = profile.token;
  const [me, setMe] = useState<Me | null>(null);
  const [checked, setChecked] = useState(false);
  const [league, setLeague] = useState<LeagueResponse | null>(null);
  const lost = useRef(onAuthLost);
  lost.current = onAuthLost;
  const profileRef = useRef(profile);
  profileRef.current = profile;
  const onProfileRef = useRef(onProfile);
  onProfileRef.current = onProfile;

  const authLost = useCallback(() => lost.current(), []);

  const adopt = useCallback((m: Me) => {
    setMe(m);
    setFourColourFromProfile(m.fourColour);
    const p = profileRef.current;
    if (p.name !== m.name || p.id !== m.id) {
      const updated = { ...p, id: m.id, name: m.name };
      saveProfile(updated);
      onProfileRef.current(updated);
    }
  }, []);

  useEffect(() => {
    let alive = true;
    setChecked(false);
    api.me(token).then(
      async (m) => {
        if (!alive) return;
        adopt(m);
        setChecked(true);
        // Four-colour used to live in this browser only: carry it over once.
        const legacy = takeLegacyFourColour();
        if (legacy && !m.fourColour) {
          try {
            const updated = await api.updateMe(token, { fourColour: true });
            if (alive) adopt(updated);
          } catch {
            /* keep the server's value */
          }
        }
      },
      (e: unknown) => {
        if (!alive) return;
        if (errorStatus(e) === 401) lost.current();
        // Server unreachable: carry on with what we have; screens show their own errors.
        else setChecked(true);
      },
    );
    return () => {
      alive = false;
    };
  }, [token, adopt]);

  const refreshLeague = useCallback(() => {
    api.league(token).then(setLeague, (e: unknown) => {
      if (errorStatus(e) === 401) lost.current();
    });
  }, [token]);

  useEffect(() => {
    if (!checked) return;
    refreshLeague();
    const onVisible = () => {
      if (document.visibilityState === 'visible') refreshLeague();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [checked, refreshLeague]);

  const updateMe = useCallback(
    async (patch: UpdateMeRequest) => {
      try {
        const m = await api.updateMe(token, patch);
        adopt(m);
        refreshLeague();
        return m;
      } catch (e) {
        if (errorStatus(e) === 401) lost.current();
        throw e;
      }
    },
    [token, adopt, refreshLeague],
  );

  // Four-colour toggles anywhere (the deck gallery, the profile) save to the profile.
  useEffect(() => {
    setFourColourPersist((on) => {
      updateMe({ fourColour: on }).catch((e: unknown) => console.warn('Could not save four-colour:', errorMessage(e)));
    });
    return () => {
      setFourColourPersist(null);
      setFourColourFromProfile(false);
    };
  }, [updateMe]);

  const members = useMemo(() => {
    const m = new Map<string, PlayerCard>();
    for (const p of league?.members ?? []) m.set(p.id, p);
    if (me) m.set(me.id, me);
    return m;
  }, [league, me]);

  const value = useMemo<Session>(
    () => ({
      profile, token, me, league, members,
      isCommissioner: Boolean(me?.commissioner),
      refreshLeague, updateMe, authLost,
    }),
    [profile, token, me, league, members, refreshLeague, updateMe, authLost],
  );

  const deck = me?.deck && DECKS[me.deck] ? me.deck : DEFAULT_DECK;
  if (!checked) return <>{splash}</>;
  return (
    <SessionContext.Provider value={value}>
      <DeckContext.Provider value={deck}>{children}</DeckContext.Provider>
    </SessionContext.Provider>
  );
}

// ---------------------------------------------------------------- data

export interface Loaded<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
}

/**
 * Fetch something for the signed-in player. `key` names what is being fetched;
 * a new key fetches afresh (the old data stays until the new arrives), null
 * fetches nothing. Refetches when the page becomes visible again.
 */
export function useApi<T>(key: string | null, fetcher: (token: string) => Promise<T>): Loaded<T> {
  const { token, authLost } = useSession();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(key !== null);
  const [nonce, setNonce] = useState(0);
  const fetchRef = useRef(fetcher);
  fetchRef.current = fetcher;
  const seq = useRef(0);

  useEffect(() => {
    if (key === null) {
      setLoading(false);
      return;
    }
    const mine = ++seq.current;
    setLoading(true);
    fetchRef.current(token).then(
      (d) => {
        if (seq.current !== mine) return;
        setData(d);
        setError(null);
        setLoading(false);
      },
      (e: unknown) => {
        if (seq.current !== mine) return;
        if (errorStatus(e) === 401) authLost();
        setError(errorMessage(e));
        setLoading(false);
      },
    );
  }, [key, token, nonce, authLost]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') setNonce((n) => n + 1);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { data, error, loading, reload };
}
