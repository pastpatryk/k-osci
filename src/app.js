// Preact root + components + glue between the reducer and the net client.
// No build step — uses htm for template literals.

import { h, render } from 'https://esm.sh/preact@10.19.3';
import { useReducer, useEffect, useRef, useState, useMemo } from 'https://esm.sh/preact@10.19.3/hooks';
import htm from 'https://esm.sh/htm@3.1.1';

import {
  CATEGORIES,
  UPPER_BONUS_THRESHOLD,
  MAX_ROLLS,
  DICE_COUNT,
  scoreCategory,
  upperSubtotal,
  upperBonus,
  grandTotal,
  initialState,
  reducer,
  isYahtzee,
} from './game.js';

import { NetClient } from './net.js';
import { haptics, burstConfetti, stormConfetti } from './fx.js';

const html = htm.bind(h);

// ---------- Category labels ----------

const CATEGORY_LABELS = {
  aces: 'Aces',
  twos: 'Twos',
  threes: 'Threes',
  fours: 'Fours',
  fives: 'Fives',
  sixes: 'Sixes',
  threeOfAKind: '3 of a Kind',
  fourOfAKind: '4 of a Kind',
  fullHouse: 'Full House',
  smallStraight: 'Sm. Straight',
  largeStraight: 'Lg. Straight',
  yahtzee: 'Yahtzee',
  chance: 'Chance',
};

// ---------- Randomness ----------

function rollValues(existing, held) {
  const out = [];
  for (let i = 0; i < DICE_COUNT; i++) {
    out.push(held[i] ? existing[i] : 1 + Math.floor(Math.random() * 6));
  }
  return out;
}

// ---------- Root ----------

function App() {
  const role = useMemo(() => {
    const url = new URL(location.href);
    return url.searchParams.get('join') ? 'guest' : 'host';
  }, []);

  const [state, dispatch] = useReducer(reducer, undefined, () => initialState(role));
  const netRef = useRef(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  // Transient UI flags that don't belong in reducer state
  const [rollingKey, setRollingKey] = useState(0);
  const [showConfirmExit, setShowConfirmExit] = useState(false);

  // ---------- net setup ----------
  useEffect(() => {
    const net = new NetClient();
    netRef.current = net;
    net.init();

    net.on('self-id', (id) => {
      dispatch({ type: 'SET_SELF_ID', payload: { selfId: id } });
      if (role === 'host') {
        net.host();
        dispatch({ type: 'SET_CONNECTION', payload: { status: 'idle' } });
      } else {
        const hostId = new URL(location.href).searchParams.get('join');
        if (hostId) net.connect(hostId);
      }
    });

    net.on('status', (status) => {
      dispatch({ type: 'SET_CONNECTION', payload: { status } });
    });

    net.on('open', ({ peerId }) => {
      dispatch({ type: 'SET_CONNECTION', payload: { peerId, status: 'connected' } });
      // Host sends a full snapshot so the guest can hydrate.
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
      // Side effects on some incoming messages
      if (msg.type === 'SYNC_ROLL') {
        setRollingKey((k) => k + 1);
        setTimeout(() => haptics.roll(), 600);
      }
      if (msg.type === 'BANK_SCORE') {
        // If remote side (peer) banked a Yahtzee while having already banked their initial one,
        // we don't need to do anything special — their own client handled it for their UI.
        // Subtle haptic confirming opponent just scored.
        haptics.bank();
      }
    });

    return () => net.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------- Local action senders ----------
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
    send('BANK_SCORE', { category, points });
    haptics.bank();
    // Simplified Yahtzee bonus UX: confetti burst when the rolled dice are a Yahtzee
    // AND we had already banked an initial Yahtzee > 0.
    const rolledY = isYahtzee(state.game.dice.map((d) => d.value));
    const hadInitial = state.game.scorecards.self.yahtzee !== null && state.game.scorecards.self.yahtzee > 0;
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
    // Full reset and re-init a new peer
    dispatch({ type: 'CLEAR_SESSION' });
    const net = new NetClient();
    netRef.current = net;
    net.init();
    net.on('self-id', (id) => dispatch({ type: 'SET_SELF_ID', payload: { selfId: id } }));
    net.on('status', (status) => dispatch({ type: 'SET_CONNECTION', payload: { status } }));
    net.on('open', () => dispatch({ type: 'SET_CONNECTION', payload: { status: 'connected' } }));
    net.on('close', () => dispatch({ type: 'SET_CONNECTION', payload: { status: 'waiting' } }));
  };

  // ---------- Win detection side-effects ----------
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

  // ---------- Disconnect countdown ----------
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
          // Timeout: backToLobby closes net + clears state + re-inits.
          backToLobby();
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.session.status, state.game.phase]);

  // ---------- beforeunload guard ----------
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

  // ---------- Render ----------

  return html`
    <div class="app-root">
      <${StatusPill} status=${state.session.status} />

      ${state.game.phase === 'lobby' && html`
        <${Lobby}
          role=${state.session.role}
          selfId=${state.session.selfId}
          status=${state.session.status}
          onStart=${startGame}
        />
      `}

      ${(state.game.phase === 'playing' || state.game.phase === 'gameOver') && html`
        <${Board}
          state=${state}
          rollingKey=${rollingKey}
          onRoll=${doRoll}
          onToggleHold=${toggleHold}
          onBank=${bank}
        />
      `}

      ${state.game.phase === 'gameOver' && html`
        <${GameOverOverlay}
          state=${state}
          onRematch=${rematch}
          onBackToLobby=${() => setShowConfirmExit(true)}
        />
      `}

      ${showConfirmExit && html`
        <${ConfirmModal}
          title="End the session?"
          body="Going back to the lobby will clear your session tally for this pair."
          confirmLabel="End session"
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

// ---------- Status pill ----------

function StatusPill({ status }) {
  const label = {
    idle: 'Waiting for peer',
    connecting: 'Connecting…',
    connected: 'Connected',
    waiting: 'Reconnecting…',
    disconnected: 'Disconnected',
  }[status] || status;

  return html`
    <div class="status-pill" data-status=${status}>
      <span class="dot"></span>
      <span>${label}</span>
    </div>
  `;
}

// ---------- Lobby ----------

function Lobby({ role, selfId, status, onStart }) {
  const joinUrl = useMemo(() => {
    if (!selfId) return '';
    const base = `${location.origin}${location.pathname}`;
    return `${base}?join=${selfId}`;
  }, [selfId]);

  const [copied, setCopied] = useState(false);

  const smartShare = async () => {
    if (!joinUrl) return;
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'Yahtzee',
          text: "Let's play Yahtzee:",
          url: joinUrl,
        });
        return;
      } catch (_) { /* fall back to clipboard */ }
    }
    try {
      await navigator.clipboard.writeText(joinUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (_) { /* last resort: do nothing */ }
  };

  return html`
    <div class="lobby">
      <div class="bento lobby-card">
        <h1 class="title">Yahtzee <span class="mono">·</span> two-player</h1>

        ${role === 'host' && html`
          <p class="sub">Send this link to a friend. When they open it, the game starts.</p>
          <div class="share-row">
            <input class="share-url" readonly value=${joinUrl} onClick=${(e) => e.target.select()} />
            <button class="btn primary" onClick=${smartShare} disabled=${!joinUrl}>
              ${copied ? 'Copied!' : (navigator.share ? 'Share link' : 'Copy link')}
            </button>
          </div>
          <div class="hint">${
            status === 'connected'
              ? html`<span class="ok">Opponent connected — ready when you are.</span>`
              : status === 'waiting'
                ? html`<span>Opponent disconnected — waiting for them to rejoin…</span>`
                : html`<span>Generating link… waiting for opponent to join.</span>`
          }</div>
          <button class="btn start" onClick=${onStart} disabled=${status !== 'connected'}>
            Start game
          </button>
        `}

        ${role === 'guest' && html`
          <p class="sub">${
            status === 'connecting' ? 'Connecting to host…' :
            status === 'connected'  ? 'Connected. Waiting for host to start…' :
            status === 'waiting'    ? 'Reconnecting…' :
                                      'Connection failed. Ask your friend for a new link.'
          }</p>
          <div class="spinner" aria-hidden></div>
        `}
      </div>
    </div>
  `;
}

// ---------- Board ----------

function Board({ state, rollingKey, onRoll, onToggleHold, onBank }) {
  const { game } = state;

  return html`
    <div class="board">
      <div class="bento player-card self ${game.turn === 'self' ? 'active' : ''}">
        <${PlayerHeader} label="You" total=${grandTotal(game.scorecards.self)} tally=${state.session.tally.self} active=${game.turn === 'self'} />
        <${Scorecard}
          side="self"
          scorecard=${game.scorecards.self}
          dice=${game.dice}
          interactive=${game.turn === 'self' && game.rollNumber > 0 && game.phase === 'playing'}
          lastBanked=${game.lastBankedCategory}
          onBank=${onBank}
        />
      </div>

      <div class="bento player-card peer ${game.turn === 'peer' ? 'active' : ''}">
        <${PlayerHeader} label="Opponent" total=${grandTotal(game.scorecards.peer)} tally=${state.session.tally.peer} active=${game.turn === 'peer'} />
        <${Scorecard}
          side="peer"
          scorecard=${game.scorecards.peer}
          dice=${game.dice}
          interactive=${false}
          lastBanked=${game.lastBankedCategory}
          onBank=${() => {}}
        />
      </div>

      <div class="bento dice-area">
        <${TurnBanner} turn=${game.turn} rollNumber=${game.rollNumber} />
        <${DiceTray}
          dice=${game.dice}
          rollingKey=${rollingKey}
          interactive=${game.turn === 'self' && game.rollNumber > 0 && game.phase === 'playing'}
          onToggleHold=${onToggleHold}
        />
        <button
          class="btn roll"
          onClick=${onRoll}
          disabled=${game.turn !== 'self' || game.rollNumber >= MAX_ROLLS || game.phase !== 'playing'}
        >
          ${game.rollNumber === 0 ? 'Roll' : `Roll (${MAX_ROLLS - game.rollNumber} left)`}
        </button>
      </div>
    </div>
  `;
}

function PlayerHeader({ label, total, tally, active }) {
  return html`
    <div class="player-header">
      <div>
        <div class="player-label">${label}</div>
        <div class="player-total">${total}</div>
      </div>
      <div class="player-meta">
        <div class="tally">wins: ${tally}</div>
        ${active && html`<div class="turn-dot">turn</div>`}
      </div>
    </div>
  `;
}

function TurnBanner({ turn, rollNumber }) {
  const yours = turn === 'self';
  return html`
    <div class="turn-banner ${yours ? 'yours' : 'theirs'}">
      ${yours
        ? (rollNumber === 0 ? 'Your turn — roll to begin' : `Your turn — roll ${rollNumber}/${MAX_ROLLS}`)
        : 'Waiting for opponent…'}
    </div>
  `;
}

// ---------- Dice ----------

const DIE_FACES = {
  1: [[2, 2]],
  2: [[1, 1], [3, 3]],
  3: [[1, 1], [2, 2], [3, 3]],
  4: [[1, 1], [1, 3], [3, 1], [3, 3]],
  5: [[1, 1], [1, 3], [2, 2], [3, 1], [3, 3]],
  6: [[1, 1], [1, 3], [2, 1], [2, 3], [3, 1], [3, 3]],
};

function Die({ value, held, interactive, rollingKey, onClick }) {
  // Randomize a tumble transform per roll
  const rot = useMemo(() => {
    const x = (Math.floor(Math.random() * 3) + 1) * 360;
    const y = (Math.floor(Math.random() * 3) + 1) * 360;
    return `rotateX(${x}deg) rotateY(${y}deg)`;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rollingKey]);

  return html`
    <button
      class="die ${held ? 'held' : ''} ${interactive ? 'interactive' : 'locked'}"
      onClick=${interactive ? onClick : undefined}
      aria-label=${`Die showing ${value}${held ? ', held' : ''}`}
    >
      <div class="die-face" style=${{ transform: held ? 'none' : rot }}>
        ${DIE_FACES[value].map(([r, c]) => html`
          <span class="pip" style=${{ gridRow: r, gridColumn: c }}></span>
        `)}
      </div>
    </button>
  `;
}

function DiceTray({ dice, rollingKey, interactive, onToggleHold }) {
  return html`
    <div class="dice-tray">
      ${dice.map((die, i) => html`
        <${Die}
          key=${i}
          value=${die.value}
          held=${die.held}
          interactive=${interactive}
          rollingKey=${rollingKey}
          onClick=${() => onToggleHold(i)}
        />
      `)}
    </div>
  `;
}

// ---------- Scorecard ----------

function Scorecard({ side, scorecard, dice, interactive, lastBanked, onBank }) {
  const rows = CATEGORIES.map((cat) => {
    const banked = scorecard[cat];
    const isBanked = banked !== null;
    const preview = isBanked ? null : scoreCategory(dice, cat);
    const wouldGlow = !isBanked && interactive && preview > 0;
    const flash = lastBanked === cat;
    return html`
      <button
        class="row ${isBanked ? 'banked' : 'open'} ${wouldGlow ? 'glow' : ''} ${flash ? 'flash' : ''}"
        onClick=${interactive && !isBanked ? () => onBank(cat) : undefined}
        disabled=${!interactive || isBanked}
      >
        <span class="row-label">${CATEGORY_LABELS[cat]}</span>
        <span class="row-val">
          ${isBanked ? banked : (interactive ? preview : '')}
        </span>
      </button>
    `;
  });

  const uSub = upperSubtotal(scorecard);
  const uBonus = upperBonus(scorecard);
  const grand = grandTotal(scorecard);
  const yBonus = (scorecard.yahtzeeBonusCount || 0) * 100;

  return html`
    <div class="scorecard ${side}">
      ${rows}
      <div class="subrow">
        <span>Upper (${uSub}/${UPPER_BONUS_THRESHOLD})</span>
        <span>Bonus ${uBonus}</span>
      </div>
      ${yBonus > 0 && html`
        <div class="subrow">
          <span>Yahtzee bonus</span>
          <span>+${yBonus}</span>
        </div>
      `}
      <div class="subrow total">
        <span>Total</span>
        <span>${grand}</span>
      </div>
    </div>
  `;
}

// ---------- Overlays ----------

function GameOverOverlay({ state, onRematch, onBackToLobby }) {
  const selfTotal = grandTotal(state.game.scorecards.self);
  const peerTotal = grandTotal(state.game.scorecards.peer);
  const outcome = selfTotal > peerTotal ? 'win' : selfTotal < peerTotal ? 'loss' : 'tie';
  const heading = outcome === 'win' ? 'You win!' : outcome === 'loss' ? 'You lost.' : "It's a tie!";
  return html`
    <div class="overlay gameover ${outcome}">
      <div class="bento overlay-card">
        <h2>${heading}</h2>
        <div class="final">
          <div><span>You</span><strong>${selfTotal}</strong></div>
          <div><span>Opponent</span><strong>${peerTotal}</strong></div>
        </div>
        <div class="final-tally">Session: you ${state.session.tally.self} — opponent ${state.session.tally.peer}</div>
        <div class="cta">
          <button class="btn primary" onClick=${onRematch}>Rematch</button>
          <button class="btn ghost" onClick=${onBackToLobby}>Back to lobby</button>
        </div>
      </div>
    </div>
  `;
}

function DisconnectOverlay({ seconds, onGiveUp }) {
  return html`
    <div class="overlay disconnect">
      <div class="bento overlay-card">
        <h2>Peer disconnected</h2>
        <p>Waiting <strong>${seconds}s</strong> for reconnect…</p>
        <div class="cta">
          <button class="btn ghost" onClick=${onGiveUp}>Give up</button>
        </div>
      </div>
    </div>
  `;
}

function ConfirmModal({ title, body, confirmLabel, onCancel, onConfirm }) {
  return html`
    <div class="overlay confirm">
      <div class="bento overlay-card small">
        <h3>${title}</h3>
        <p>${body}</p>
        <div class="cta">
          <button class="btn ghost" onClick=${onCancel}>Cancel</button>
          <button class="btn danger" onClick=${onConfirm}>${confirmLabel}</button>
        </div>
      </div>
    </div>
  `;
}

// ---------- Boot ----------

if (typeof window !== 'undefined') {
  // Register service worker (non-blocking)
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
  const root = document.getElementById('app');
  if (root) render(html`<${App} />`, root);
}
