import { Suspense, lazy, useCallback, useEffect, useState } from 'react';
import { Brand } from './brand/Mark';
import { DEFAULT_DECK, DeckContext } from './cards/decks';
import { type Profile, clearProfile, loadProfile, saveProfile } from './lib/api';
import { navigate, parseRoute, usePath } from './lib/router';
import { SessionProvider, useSession } from './lib/session';
import { Commissioner } from './screens/Commissioner';
import { DeckGallery } from './screens/DeckGallery';
import { Fame } from './screens/Fame';
import { Game } from './screens/Game';
import { HeadToHeadScreen } from './screens/HeadToHead';
import { Home } from './screens/Home';
import { League } from './screens/League';
import { PlayerPage } from './screens/Player';
import { ProfileScreen } from './screens/Profile';
import { Replay } from './screens/Replay';
import { Welcome } from './screens/Welcome';

// Development-only fixture table; the dynamic import is dropped from production builds.
const Preview = import.meta.env.DEV ? lazy(() => import('./dev/Preview').then((m) => ({ default: m.Preview }))) : null;

const splash = (
  <div className="page">
    <main className="splash">
      <h1><Brand /></h1>
    </main>
  </div>
);

/** Signed in, but the link was for someone new (an invite) or another device (a link code). */
function AlreadyIn({ kind }: { kind: 'invite' | 'link' }) {
  const { profile } = useSession();
  return (
    <div className="page">
      <main className="notice">
        <h1>{kind === 'invite' ? 'You’re already in the league' : 'This device is already signed in'}</h1>
        <p>
          {kind === 'invite'
            ? `This device is signed in as ${profile.name}. Invite links are for people who aren’t members yet — pass it on to them.`
            : `This device is signed in as ${profile.name}. To use the code on this device, sign out first from your profile.`}
        </p>
        <div className="notice__buttons">
          <button type="button" className="btn btn--primary" onClick={() => navigate('/', true)}>Go to your league</button>
        </div>
      </main>
    </div>
  );
}

function SignedIn() {
  const path = usePath();
  const route = parseRoute(path);
  const { profile, authLost } = useSession();
  switch (route.name) {
    case 'game': return <Game key={route.code} code={route.code} profile={profile} onAuthLost={authLost} />;
    case 'league': return <League />;
    case 'stats': return <HeadToHeadScreen key={`${route.a}-${route.b}`} a={route.a} b={route.b} />;
    case 'fame': return <Fame />;
    case 'player': return <PlayerPage key={route.id} id={route.id} />;
    case 'replay': return <Replay key={route.code} code={route.code} />;
    case 'profile': return <ProfileScreen />;
    case 'commissioner': return <Commissioner />;
    case 'invite': return <AlreadyIn kind="invite" />;
    case 'link': return <AlreadyIn kind="link" />;
    default: return <Home />;
  }
}

export function App() {
  const path = usePath();
  const route = parseRoute(path);
  const [profile, setProfile] = useState<Profile | null>(loadProfile);

  useEffect(() => {
    if (route.name === 'unknown') navigate('/', true);
  }, [route.name]);

  const signOut = useCallback(() => {
    clearProfile();
    setProfile(null);
  }, []);

  if (route.name === 'dev' && Preview) {
    return <Suspense fallback={null}><Preview /></Suspense>;
  }
  if (!profile) {
    return (
      <DeckContext.Provider value={DEFAULT_DECK}>
        {route.name === 'deck' ? (
          <DeckGallery />
        ) : (
          <Welcome
            code={route.name === 'game' ? route.code : undefined}
            invite={route.name === 'invite' ? route.token : undefined}
            linkCode={route.name === 'link' ? route.code : undefined}
            onCreated={(p) => {
              saveProfile(p);
              setProfile(p);
              // A linked device or a league invite lands on the league day; a game invite stays on its table.
              if (route.name === 'invite' || route.name === 'link') navigate('/', true);
            }}
          />
        )}
      </DeckContext.Provider>
    );
  }
  return (
    <SessionProvider profile={profile} onAuthLost={signOut} onProfile={setProfile} splash={splash}>
      {route.name === 'deck' ? <DeckGallery /> : <SignedIn />}
    </SessionProvider>
  );
}
