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

function App() {
  const role = useMemo(() => {
    const url = new URL(location.href);
    const joinId = url.searchParams.get('join');
    return joinId ? 'guest' : 'host';
  }, []);

  const [state, dispatch] = useReducer(reducer, undefined, () => initialState(role));
  const netRef = useRef(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  const [rollingKey, setRollingKey] = useState(0);
  const [showConfirmExit, setShowConfirmExit] = useState(false);
  const [previewCategory, setPreviewCategory] = useState(null);

  useEffect(() => {
    const net = new NetClient();
    netRef.current = net;
    if (typeof window !== 'undefined') window.__net = net;
    net.init();

    net.on('self-id', (id) => {
      dispatch({ type: 'SET_SELF_ID', payload: { selfId: id } });
      if (role === 'host') {
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
      if (role === 'host') {
        const s = stateRef.current;
        net.send('SYNC_STATE', {
          game: s.game,
          tally: s.session.tally,
          gameNumber: s.session.gameNumber,
        });
      }
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
  }, []);

  const send = (type, payload) => {
    dispatch({ type, payload });
    netRef.current?.send(type, payload);
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
    const net = new NetClient();
    netRef.current = net;
    if (typeof window !== 'undefined') window.__net = net;
    net.init();
    net.on('self-id', (id) => dispatch({ type: 'SET_SELF_ID', payload: { selfId: id } }));
    net.on('status', (status) => dispatch({ type: 'SET_CONNECTION', payload: { status } }));
    net.on('open', () => dispatch({ type: 'SET_CONNECTION', payload: { status: 'connected' } }));
    net.on('close', () => dispatch({ type: 'SET_CONNECTION', payload: { status: 'waiting' } }));
  };

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
          onRoll=${doRoll}
          onToggleHold=${toggleHold}
          onBank=${bank}
        />
      `}

      ${state.game.phase === 'gameOver' && html`
        <${GameOver}
          state=${state}
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
