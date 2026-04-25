// Preact root + glue between the reducer and the net client.
// No build step — uses htm for template literals.

import { render } from 'https://esm.sh/preact@10.19.3';
import { useReducer, useEffect, useRef, useState, useMemo } from 'https://esm.sh/preact@10.19.3/hooks';

import {
  MAX_ROLLS,
  DICE_COUNT,
  scoreCategory,
  grandTotal,
  initialState,
  reducer,
  isYahtzee,
} from './game.js';

import { NetClient, isValidPeerId } from './net.js';
import { haptics, burstConfetti, stormConfetti } from './fx.js';

import { html } from './components/html.js';
import { TopBar } from './components/TopBar.js';
import { Lobby } from './components/Lobby.js';
import { Game } from './components/Game.js';
import { GameOver } from './components/GameOver.js';
import { DisconnectOverlay, ConfirmModal } from './components/Overlays.js';

function rollValues(existing, held) {
  const out = [];
  for (let i = 0; i < DICE_COUNT; i++) {
    out.push(held[i] ? existing[i] : 1 + Math.floor(Math.random() * 6));
  }
  return out;
}

// ---------- Host session persistence ----------
// Keep the host's identity + game state across refreshes so a reload doesn't
// spawn a brand-new room. Guest state isn't persisted — guests rehydrate via
// SYNC_STATE on reconnect.
const STORAGE_KEY = 'kosci.host.session';
const STORAGE_TTL_MS = 6 * 60 * 60 * 1000;

function loadHostSnapshot() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object') return null;
    if (Date.now() - data.savedAt > STORAGE_TTL_MS) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return data;
  } catch (_) {
    return null;
  }
}

function saveHostSnapshot(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      state,
      savedAt: Date.now(),
    }));
  } catch (_) {}
}

function clearHostSnapshot() {
  try { localStorage.removeItem(STORAGE_KEY); } catch (_) {}
}

const NAME_KEY = 'kosci.name';

function loadOwnName() {
  try { return (localStorage.getItem(NAME_KEY) || '').slice(0, 20); } catch (_) { return ''; }
}

function saveOwnName(name) {
  try { localStorage.setItem(NAME_KEY, name); } catch (_) {}
}

function App() {
  const role = useMemo(() => {
    const url = new URL(location.href);
    const joinId = url.searchParams.get('join');
    return joinId ? 'guest' : 'host';
  }, []);

  const [state, dispatch] = useReducer(reducer, undefined, () => {
    const storedName = loadOwnName();
    if (role === 'host') {
      const snap = loadHostSnapshot();
      if (snap?.state) {
        return {
          ...snap.state,
          session: {
            ...snap.state.session,
            status: 'idle',
            selfName: snap.state.session.selfName || storedName,
          },
        };
      }
    }
    const init = initialState(role);
    if (storedName) init.session.selfName = storedName;
    return init;
  });
  const netRef = useRef(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  const [rollingKey, setRollingKey] = useState(0);
  const [showConfirmExit, setShowConfirmExit] = useState(false);
  const [previewCategory, setPreviewCategory] = useState(null);

  const [started, setStarted] = useState(() => {
    if (role === 'host') {
      const url = new URL(location.href);
      if (url.searchParams.get('host')) return true;
      if (loadHostSnapshot()) return true;
    }
    return false;
  });

  useEffect(() => {
    if (!started) return;
    const net = new NetClient();
    netRef.current = net;
    if (typeof window !== 'undefined') window.__net = net;

    let preferredId = null;
    if (role === 'host') {
      const url = new URL(location.href);
      preferredId = url.searchParams.get('host');
      if (!preferredId) {
        preferredId = stateRef.current.session.selfId;
      }
      if (preferredId && !isValidPeerId(preferredId)) preferredId = null;
    }
    net.init(preferredId);

    net.on('self-id', (id) => {
      dispatch({ type: 'SET_SELF_ID', payload: { selfId: id } });
      if (role === 'host') {
        const url = new URL(location.href);
        if (url.searchParams.get('host') !== id) {
          url.searchParams.set('host', id);
          history.replaceState(null, '', url.toString());
        }
        net.host();
        dispatch({ type: 'SET_CONNECTION', payload: { status: 'idle' } });
      } else {
        const hostId = new URL(location.href).searchParams.get('join');
        if (hostId && isValidPeerId(hostId)) net.connect(hostId);
      }
    });

    net.on('status', (status) => {
      dispatch({ type: 'SET_CONNECTION', payload: { status } });
    });

    net.on('open', ({ peerId }) => {
      dispatch({ type: 'SET_CONNECTION', payload: { peerId, status: 'connected' } });
      const s = stateRef.current;
      if (role === 'host') {
        net.send('SYNC_STATE', {
          game: s.game,
          tally: s.session.tally,
          gameNumber: s.session.gameNumber,
        });
      }
      if (s.session.selfName) net.send('SET_NAME', { name: s.session.selfName });
    });

    net.on('close', () => {
      dispatch({ type: 'SET_CONNECTION', payload: { status: 'waiting' } });
    });

    net.on('message', (msg) => {
      if (!msg || typeof msg.type !== 'string') return;
      switch (msg.type) {
        case 'SYNC_STATE':
        case 'START_GAME':
        case 'SYNC_ROLL':
        case 'TOGGLE_HOLD':
        case 'BANK_SCORE':
        case 'RESET_GAME':
        case 'SET_NAME':
          dispatch({ type: msg.type, payload: msg.payload, remote: true });
          break;
        default:
          console.warn('[app] unknown message type:', msg.type);
      }
      if (msg.type === 'SYNC_ROLL') {
        setRollingKey((k) => k + 1);
        setTimeout(() => haptics.roll(), 600);
      }
      if (msg.type === 'BANK_SCORE') {
        haptics.bank();
      }
    });

    return () => net.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [started]);

  const send = (type, payload) => {
    dispatch({ type, payload });
    netRef.current?.send(type, payload);
  };

  const setName = (name) => {
    const trimmed = (name || '').slice(0, 20);
    saveOwnName(trimmed);
    dispatch({ type: 'SET_NAME', payload: { name: trimmed } });
    if (state.session.status === 'connected') {
      netRef.current?.send('SET_NAME', { name: trimmed });
    }
  };

  const startGame = () => {
    const starter = (state.session.gameNumber % 2 === 1) ? 'host' : 'guest';
    send('START_GAME', { starter });
  };

  const doRoll = () => {
    if (state.game.turn !== 'self') return;
    if (state.game.rollNumber >= MAX_ROLLS) return;
    const existing = state.game.dice.map((d) => d.value);
    const held = state.game.dice.map((d) => d.held);
    const values = rollValues(existing, held);
    const rollNumber = state.game.rollNumber + 1;
    send('SYNC_ROLL', { values, rollNumber });
    setRollingKey((k) => k + 1);
    setPreviewCategory(null);
    setTimeout(() => haptics.roll(), 600);
  };

  const toggleHold = (index) => {
    if (state.game.turn !== 'self') return;
    if (state.game.rollNumber === 0) return;
    const die = state.game.dice[index];
    send('TOGGLE_HOLD', { index, held: !die.held });
  };

  const bank = (category) => {
    if (state.game.turn !== 'self') return;
    if (state.game.scorecards.self[category] !== null) return;
    const points = scoreCategory(state.game.dice, category);
    const rolledY = isYahtzee(state.game.dice.map((d) => d.value));
    const hadInitial = state.game.scorecards.self.yahtzee !== null && state.game.scorecards.self.yahtzee > 0;
    send('BANK_SCORE', { category, points });
    setPreviewCategory(null);
    haptics.bank();
    if (rolledY && hadInitial) {
      haptics.yahtzee();
      burstConfetti({ x: 0.5, y: 0.35 });
    }
  };

  const rematch = () => {
    const starter = ((state.session.gameNumber + 1) % 2 === 1) ? 'host' : 'guest';
    send('RESET_GAME', { starter });
  };

  const backToLobby = () => {
    netRef.current?.close();
    dispatch({ type: 'CLEAR_SESSION' });
    if (role === 'host') {
      clearHostSnapshot();
      const url = new URL(location.href);
      if (url.searchParams.has('host')) {
        url.searchParams.delete('host');
        history.replaceState(null, '', url.toString());
      }
    }
    setStarted(false);
  };

  useEffect(() => {
    if (role !== 'host') return;
    if (!state.session.selfId) return;
    saveHostSnapshot(state);
  }, [role, state]);

  // Whenever the connection becomes 'connected' or our name changes while
  // already connected, push our latest name to the peer.
  useEffect(() => {
    if (state.session.status !== 'connected') return;
    if (!state.session.selfName) return;
    netRef.current?.send('SET_NAME', { name: state.session.selfName });
  }, [state.session.status, state.session.selfName]);

  const prevPhase = useRef(state.game.phase);
  useEffect(() => {
    if (prevPhase.current !== 'gameOver' && state.game.phase === 'gameOver') {
      const selfTotal = grandTotal(state.game.scorecards.self);
      const peerTotal = grandTotal(state.game.scorecards.peer);
      if (selfTotal > peerTotal) {
        haptics.win();
        stormConfetti();
      }
    }
    prevPhase.current = state.game.phase;
  }, [state.game.phase]);

  const [disconnectSecs, setDisconnectSecs] = useState(60);
  useEffect(() => {
    if (state.session.status !== 'waiting' || state.game.phase !== 'playing') {
      setDisconnectSecs(60);
      return;
    }
    setDisconnectSecs(60);
    const t = setInterval(() => {
      setDisconnectSecs((s) => {
        if (s <= 1) {
          clearInterval(t);
          backToLobby();
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.session.status, state.game.phase]);

  useEffect(() => {
    const onBeforeUnload = (e) => {
      if (state.game.phase === 'playing') {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    addEventListener('beforeunload', onBeforeUnload);
    return () => removeEventListener('beforeunload', onBeforeUnload);
  }, [state.game.phase]);

  return html`
    <div class="app-root">
      <${TopBar} role=${role} status=${state.session.status} gameNumber=${state.session.gameNumber} phase=${state.game.phase} />

      ${state.game.phase === 'lobby' && html`
        <${Lobby}
          role=${role}
          selfId=${state.session.selfId}
          status=${state.session.status}
          started=${started}
          selfName=${state.session.selfName}
          peerName=${state.session.peerName}
          onSetName=${setName}
          onCreate=${() => setStarted(true)}
          onCancelRoom=${backToLobby}
          onStart=${startGame}
          tally=${state.session.tally}
        />
      `}

      ${(state.game.phase === 'playing') && html`
        <${Game}
          state=${state}
          rollingKey=${rollingKey}
          previewCategory=${previewCategory}
          setPreviewCategory=${setPreviewCategory}
          selfName=${state.session.selfName}
          peerName=${state.session.peerName}
          onSetName=${setName}
          onRoll=${doRoll}
          onToggleHold=${toggleHold}
          onBank=${bank}
          onEndGame=${role === 'host' ? () => setShowConfirmExit(true) : null}
        />
      `}

      ${state.game.phase === 'gameOver' && html`
        <${GameOver}
          state=${state}
          selfName=${state.session.selfName}
          peerName=${state.session.peerName}
          onRematch=${rematch}
          onBackToLobby=${() => setShowConfirmExit(true)}
        />
      `}

      ${showConfirmExit && html`
        <${ConfirmModal}
          title="Zakończyć sesję?"
          body="Powrót do menu wyzeruje wynik tej sesji."
          confirmLabel="Zakończ"
          cancelLabel="Anuluj"
          onCancel=${() => setShowConfirmExit(false)}
          onConfirm=${() => { setShowConfirmExit(false); backToLobby(); }}
        />
      `}

      ${state.session.status === 'waiting' && state.game.phase === 'playing' && html`
        <${DisconnectOverlay} seconds=${disconnectSecs} onGiveUp=${backToLobby} />
      `}
    </div>
  `;
}

if (typeof window !== 'undefined') {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
  const root = document.getElementById('app');
  if (root) render(html`<${App} />`, root);
}
