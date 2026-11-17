import { useCallback, useEffect, useRef, useState } from 'react';
import { DEFAULT_DECK, DeckContext } from './cards/decks';
import { type Profile, api, clearProfile, errorStatus, loadProfile, saveProfile } from './lib/api';
import { navigate, parseRoute, usePath } from './lib/router';
import { DeckGallery } from './screens/DeckGallery';
import { Game } from './screens/Game';
import { Home } from './screens/Home';
import { Welcome } from './screens/Welcome';

export function App() {
  const path = usePath();
  const route = parseRoute(path);
  const [profile, setProfile] = useState<Profile | null>(loadProfile);
  const [checkedToken, setCheckedToken] = useState<string | null>(null);
  // Tokens we just received from the server don't need re-verifying.
  const trusted = useRef<string | null>(null);

  useEffect(() => {
    if (route.name === 'unknown') navigate('/', true);
  }, [route.name]);

  const signOut = useCallback(() => {
    clearProfile();
    setProfile(null);
  }, []);

  const token = profile?.token ?? null;
  useEffect(() => {
    if (!token || trusted.current === token) {
      setCheckedToken(token);
      return;
    }
    let alive = true;
    api.me(token).then(
      (me) => {
        if (!alive) return;
        setProfile((p) => {
          if (!p || p.token !== token || (p.name === me.name && p.id === me.id)) return p;
          const updated = { ...p, id: me.id, name: me.name };
          saveProfile(updated);
          return updated;
        });
        setCheckedToken(token);
      },
      (e: unknown) => {
        if (!alive) return;
        if (errorStatus(e) === 401) signOut();
        // Server unreachable: carry on with what we have; screens show their own errors.
        else setCheckedToken(token);
      },
    );
    return () => {
      alive = false;
    };
  }, [token, signOut]);

  let screen;
  if (route.name === 'deck') {
    screen = <DeckGallery />;
  } else if (!profile) {
    screen = (
      <Welcome
        invited={route.name === 'game'}
        onCreated={(p) => {
          saveProfile(p);
          trusted.current = p.token;
          setProfile(p);
        }}
      />
    );
  } else if (checkedToken !== profile.token) {
    screen = (
      <div className="page">
        <main className="splash">
          <h1 className="brand">Cabbage</h1>
        </main>
      </div>
    );
  } else if (route.name === 'game') {
    screen = <Game key={route.code} code={route.code} profile={profile} onAuthLost={signOut} />;
  } else {
    screen = <Home profile={profile} onAuthLost={signOut} />;
  }

  return <DeckContext.Provider value={DEFAULT_DECK}>{screen}</DeckContext.Provider>;
}
