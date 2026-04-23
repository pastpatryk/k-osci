// Preact root + components + glue between the reducer and the net client.
// No build step — uses htm for template literals.

import { h, render } from 'https://esm.sh/preact@10.19.3';
import { useReducer, useEffect, useRef, useState, useMemo } from 'https://esm.sh/preact@10.19.3/hooks';
import htm from 'https://esm.sh/htm@3.1.1';

import {
  CATEGORIES,
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

import { NetClient, isValidPeerId } from './net.js';
import { haptics, burstConfetti, stormConfetti } from './fx.js';

const html = htm.bind(h);

// ---------- Polish labels ----------

const CATEGORY_LABELS = {
  aces:          'Jedynki',
  twos:          'Dwójki',
  threes:        'Trójki',
  fours:         'Czwórki',
  fives:         'Piątki',
  sixes:         'Szóstki',
  threeOfAKind:  'Trójka',
  fourOfAKind:   'Kareta',
  fullHouse:     'Full',
  smallStraight: 'Mały strit',
  largeStraight: 'Duży strit',
  yahtzee:       'Generał',
  chance:        'Szansa',
};

const UPPER = ['aces', 'twos', 'threes', 'fours', 'fives', 'sixes'];

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

  // ---------- net setup ----------
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

  // ---------- Senders ----------
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

  // ---------- Win side-effects ----------
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

// ---------- Top bar ----------

function TopBar({ status, phase }) {
  const label = {
    idle: 'W sieci',
    connecting: 'Łączenie',
    connected: phase === 'lobby' ? 'Połączono' : 'Online',
    waiting: 'Czekam',
    disconnected: 'Rozłączono',
  }[status] || status;

  return html`
    <div class="topbar">
      <div class="brand">
        <span class="avatar">K</span>
        <span>K·OŚCI</span>
      </div>
      <div class="status-pill" data-status=${status}>
        <span class="dot"></span>
        <span>${label}</span>
      </div>
    </div>
  `;
}

// ---------- Decorative flourish ----------

function Flourish() {
  return html`
    <div class="decoration" aria-hidden="true">
      <svg viewBox="0 0 140 32" fill="none">
        <path d="M2 22 C 20 2, 50 32, 70 12 S 120 22, 138 8"
              stroke="#8b5a9f" stroke-width="1.2" stroke-linecap="round" fill="none" />
        <circle cx="38" cy="15" r="2.2" fill="#e8b4d0" />
        <circle cx="78" cy="12" r="2" fill="#e8b4d0" />
        <circle cx="112" cy="16" r="2.4" fill="#e8b4d0" />
      </svg>
    </div>
  `;
}

// ---------- Lobby ----------

function Lobby({ role, selfId, status, onStart, tally }) {
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
          title: 'K·OŚCI',
          text: 'Zagrajmy w kości:',
          url: joinUrl,
        });
        return;
      } catch (_) {}
    }
    await copyUrl();
  };

  const copyUrl = async () => {
    try {
      await navigator.clipboard.writeText(joinUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (_) {}
  };

  return html`
    <div class="lobby">
      <${Flourish} />
      <div class="kicker">
        2 GRACZY<span class="dot-sep">·</span>P2P<span class="dot-sep">·</span>WIOSNA
      </div>

      <div class="hero">
        <h1>Rzuć<em>kośćmi.</em></h1>
        <p>Zagraj ze znajomym. Bezpośrednio, bez konta, bez serwera. Wszystko między waszymi przeglądarkami.</p>
      </div>

      ${role === 'host' && html`
        <div class="id-card">
          <div class="label">Twój identyfikator</div>
          <div class="label-sub">podaj go znajomemu</div>
          <div class="id-row">
            <div class="peer-id">${selfId || '—'}</div>
            <div class="host-chip">GOSPODARZ</div>
          </div>
          <div class="url-row">
            <svg class="link-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
            </svg>
            <input readonly value=${joinUrl} onClick=${(e) => e.target.select()} />
          </div>
        </div>

        <div class="actions">
          <button class="btn primary" onClick=${smartShare} disabled=${!joinUrl}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
              <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
              <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
              <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
            </svg>
            <span>${navigator.share ? 'Udostępnij' : (copied ? 'Skopiowano' : 'Kopiuj')}</span>
          </button>
          <button class="btn ghost" onClick=${copyUrl} disabled=${!joinUrl}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
              <rect x="9" y="9" width="13" height="13" rx="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
            <span>${copied ? 'Skopiowano' : 'Kopiuj'}</span>
          </button>
        </div>

        ${status !== 'connected' ? html`
          <div class="waiting-card">
            <div class="spinner"></div>
            <div>
              <div class="wait-title">Czekam na przeciwnika…</div>
              <div class="wait-sub">udostępnij link, żeby zacząć</div>
            </div>
          </div>
        ` : html`
          <button class="btn primary" onClick=${onStart}>
            Rozpocznij grę
          </button>
        `}
      `}

      ${role === 'guest' && html`
        <div class="waiting-card">
          <div class="spinner"></div>
          <div>
            <div class="wait-title">${
              status === 'connecting' ? 'Łączenie z gospodarzem…' :
              status === 'connected'  ? 'Czekam, aż gospodarz rozpocznie…' :
              status === 'waiting'    ? 'Ponawiam połączenie…' :
                                        'Połączenie nie powiodło się'
            }</div>
            <div class="wait-sub">${status === 'connected' ? 'zaraz zaczniemy' : 'poczekaj chwilę'}</div>
          </div>
        </div>
      `}

      ${(tally.self + tally.peer) > 0 && html`
        <div class="kicker" style="text-align:left">
          Sesja <span class="dot-sep">·</span> ty ${tally.self} <span class="dot-sep">·</span> przeciwnik ${tally.peer}
        </div>
      `}
    </div>
  `;
}

// ---------- In-game layout ----------

function Game({ state, rollingKey, previewCategory, setPreviewCategory, onRoll, onToggleHold, onBank }) {
  const { game } = state;
  const selfTotal = grandTotal(game.scorecards.self);
  const peerTotal = grandTotal(game.scorecards.peer);
  const interactive = game.turn === 'self' && game.phase === 'playing';

  return html`
    <div class="game">
      <div class="game-header">
        <div class="player-chip opp ${game.turn === 'peer' ? 'active' : ''}">
          <div class="p-avatar">P</div>
          <div>
            <div class="p-name">Przeciwnik</div>
            <div class="p-score">${peerTotal}</div>
          </div>
        </div>
        <div class="round-chip">
          <div class="r-label">Runda</div>
          <div class="r-value">${String(game.round).padStart(2, '0')}<span class="of">/13</span></div>
        </div>
        <div class="player-chip you ${game.turn === 'self' ? 'active' : ''}">
          <div style="text-align:right">
            <div class="p-name">Ty</div>
            <div class="p-score">${selfTotal}</div>
          </div>
          <div class="p-avatar">T</div>
        </div>
      </div>

      <div class="card dice-card">
        <div class="turn-bar">
          <div class="turn-label ${game.turn === 'self' ? '' : 'theirs'}">
            ${game.turn === 'self' ? 'Twój ruch' : 'Ruch przeciwnika'}
          </div>
          <div class="roll-count">Rzut ${String(game.rollNumber).padStart(2, '0')}/${String(MAX_ROLLS).padStart(2, '0')}</div>
        </div>

        <${DiceTray}
          dice=${game.dice}
          rollingKey=${rollingKey}
          interactive=${interactive && game.rollNumber > 0}
          onToggleHold=${onToggleHold}
        />

        <button
          class="btn roll"
          onClick=${onRoll}
          disabled=${!interactive || game.rollNumber >= MAX_ROLLS}
        >
          <span>
            ${game.rollNumber === 0 ? 'Rzuć' : 'Rzuć ponownie'}
          </span>
          <span class="roll-left">${MAX_ROLLS - game.rollNumber} ${pluralRzut(MAX_ROLLS - game.rollNumber)}</span>
        </button>
      </div>

      <${Scorecard}
        game=${game}
        previewCategory=${previewCategory}
        setPreviewCategory=${setPreviewCategory}
        interactive=${interactive && game.rollNumber > 0}
        onBank=${onBank}
      />
    </div>
  `;
}

function pluralRzut(n) {
  // 1 rzut · 2-4 rzuty · 0,5+ rzutów
  if (n === 1) return 'RZUT';
  if (n >= 2 && n <= 4) return 'RZUTY';
  return 'RZUTÓW';
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
  const rot = useMemo(() => {
    const x = (Math.floor(Math.random() * 3) + 1) * 360;
    const y = (Math.floor(Math.random() * 3) + 1) * 360;
    return `rotateX(${x}deg) rotateY(${y}deg)`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rollingKey, value]);

  return html`
    <div class="die-wrap">
      <button
        class="die ${held ? 'held' : ''} ${interactive ? '' : 'locked'}"
        onClick=${interactive ? onClick : undefined}
        aria-label=${`Kostka ${value}${held ? ', zablokowana' : ''}`}
      >
        <div class="die-face" style=${{ transform: held ? 'none' : rot }}>
          ${DIE_FACES[value].map(([r, c], i) => html`
            <span key=${i} class="pip" style=${{ gridRow: r, gridColumn: c }}></span>
          `)}
        </div>
      </button>
      <div class="hold-label ${held ? '' : 'empty'}">TRZYMAJ</div>
    </div>
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

function Scorecard({ game, previewCategory, setPreviewCategory, interactive, onBank }) {
  const sc = game.scorecards.self;
  const upperSub = upperSubtotal(sc);
  const uBonus = upperBonus(sc);
  const yBonusPts = (sc.yahtzeeBonusCount || 0) * 100;
  const grand = grandTotal(sc);

  const renderRow = (cat) => {
    const banked = sc[cat];
    const isBanked = banked !== null;
    const preview = isBanked ? null : scoreCategory(game.dice, cat);
    const isSelected = previewCategory === cat;
    const wouldGlow = !isBanked && interactive && preview > 0;

    const onClick = () => {
      if (isBanked || !interactive) return;
      if (!isSelected) {
        setPreviewCategory(cat);
      } else {
        onBank(cat);
      }
    };

    const flash = game.lastBankedCategory === cat;

    return html`
      <div
        key=${cat}
        class="sc-row ${isBanked ? 'banked' : 'open'} ${wouldGlow && !isSelected ? 'tap' : ''} ${isSelected ? 'selected selectable' : ''} ${!isBanked && interactive ? 'selectable' : ''} ${flash ? 'flash' : ''}"
        onClick=${onClick}
        role="button"
        tabindex=${!isBanked && interactive ? '0' : undefined}
      >
        <div>
          <div class="r-label">${CATEGORY_LABELS[cat]}</div>
        </div>
        <div class="r-val">
          ${isBanked
            ? banked
            : wouldGlow
              ? html`<span class="r-chip">+${preview}</span><span class="r-tap">dotknij</span>`
              : interactive
                ? html`<span class="r-tap" style="color:var(--muted-soft)">—</span>`
                : ''
          }
        </div>

        ${isSelected && !isBanked && interactive && html`
          <div class="sc-preview" onClick=${(e) => e.stopPropagation()}>
            <div class="pv-head">Podgląd</div>
            <div class="pv-cat">${CATEGORY_LABELS[cat]}</div>
            <div class="pv-dice">
              ${scoringDiceFor(cat, game.dice).map((v, i) => html`<div key=${i} class="pv-die">${v}</div>`)}
            </div>
            <div class="pv-separator"></div>
            <div class="pv-bank">
              <span>Zapisz za</span>
              <span class="pts">+${preview}</span>
            </div>
            <div style="display:flex;gap:0.5rem;margin-top:0.6rem">
              <button class="btn ghost" style="flex:1;padding:0.55rem;font-size:0.85rem" onClick=${(e) => { e.stopPropagation(); setPreviewCategory(null); }}>Anuluj</button>
              <button class="btn primary" style="flex:1;padding:0.55rem;font-size:0.85rem" onClick=${(e) => { e.stopPropagation(); onBank(cat); }}>Zapisz +${preview}</button>
            </div>
          </div>
        `}
      </div>
    `;
  };

  return html`
    <div class="card scorecard-card">
      <div class="sc-header">
        <div>
          <div class="sc-title">Karta wyników</div>
        </div>
        <div class="sc-upper">
          Góra <strong>${upperSub}</strong>/63
        </div>
      </div>

      <div class="sc-rows">
        ${UPPER.map(renderRow)}
      </div>

      <div class="sc-divider">Dół</div>

      <div class="sc-rows">
        ${CATEGORIES.filter((c) => !UPPER.includes(c)).map(renderRow)}
      </div>

      <div class="sc-totals">
        <div class="lbl">Góra</div>
        <div class="val">${upperSub}</div>
        <div class="lbl">Bonus</div>
        <div class="val">${uBonus}</div>
        ${yBonusPts > 0 && html`
          <div class="lbl">Premia Yahtzee</div>
          <div class="val">+${yBonusPts}</div>
        `}
        <div class="lbl grand">Suma</div>
        <div class="val grand">${grand}</div>
      </div>
    </div>
  `;
}

// Returns the dice values that contribute to a category's score (for preview).
function scoringDiceFor(category, dice) {
  const vals = dice.map((d) => d.value);
  switch (category) {
    case 'aces':   return vals.filter((v) => v === 1);
    case 'twos':   return vals.filter((v) => v === 2);
    case 'threes': return vals.filter((v) => v === 3);
    case 'fours':  return vals.filter((v) => v === 4);
    case 'fives':  return vals.filter((v) => v === 5);
    case 'sixes':  return vals.filter((v) => v === 6);
    default:       return vals.slice().sort((a, b) => a - b);
  }
}

// ---------- Game Over ----------

function GameOver({ state, onRematch, onBackToLobby }) {
  const sSelf = state.game.scorecards.self;
  const sPeer = state.game.scorecards.peer;
  const selfTotal = grandTotal(sSelf);
  const peerTotal = grandTotal(sPeer);
  const outcome = selfTotal > peerTotal ? 'win' : selfTotal < peerTotal ? 'loss' : 'tie';
  const diff = Math.abs(selfTotal - peerTotal);

  const outcomeLabel = outcome === 'win' ? 'WYGRANA'
                     : outcome === 'loss' ? 'PRZEGRANA'
                     : 'REMIS';
  const subline = outcome === 'win' ? html`Pokonałeś przeciwnika o <span class="plus">+${diff}</span>`
                 : outcome === 'loss' ? html`Przegrałeś <span class="plus">−${diff}</span>`
                 : 'Remis — równa walka.';

  const selfUpper = upperSubtotal(sSelf);
  const peerUpper = upperSubtotal(sPeer);
  const selfUB = upperBonus(sSelf);
  const selfLower = selfTotal - selfUpper - selfUB;
  const peerLower = peerTotal - peerUpper - upperBonus(sPeer);
  const lowerMax = Math.max(selfLower, peerLower, 1);
  const upperMax = Math.max(selfUpper, peerUpper, 63);

  return html`
    <div class="game-over">
      <${Flourish} />
      <div class="go-outcome ${outcome}">${outcomeLabel}</div>
      <div class="go-score ${outcome}">${selfTotal}</div>
      <div class="go-sub">${subline}</div>

      <div class="vs-card">
        <div class="vs-row">
          <div class="vs-name" style="text-align:left"><strong>Ty</strong></div>
          <div class="vs-vs">vs</div>
          <div class="vs-name" style="text-align:right"><strong>Przeciwnik</strong></div>
        </div>
        <div class="vs-totals">
          <div class="vs-total you">${selfTotal}</div>
          <div></div>
          <div class="vs-total opp">${peerTotal}</div>
        </div>
        <div class="vs-labels">
          <div class="winner-label">${outcome === 'win' ? 'Zwycięzca' : ''}</div>
          <div></div>
          <div class="runner-label">${outcome === 'loss' ? 'Zwycięzca' : ''}</div>
        </div>

        <div class="compare-block">
          <div class="compare-title">
            <span>Góra</span>
            ${selfUB > 0 && html`<span class="bonus">+35 BONUS</span>`}
          </div>
          <div class="compare-bar self">
            <div class="bar"><div class="fill" style=${{ width: `${(selfUpper / upperMax) * 100}%` }}></div></div>
            <div class="num">${selfUpper}</div>
          </div>
          <div class="compare-bar opp">
            <div class="bar"><div class="fill" style=${{ width: `${(peerUpper / upperMax) * 100}%` }}></div></div>
            <div class="num">${peerUpper}</div>
          </div>
        </div>

        <div class="compare-block">
          <div class="compare-title"><span>Dół</span></div>
          <div class="compare-bar self">
            <div class="bar"><div class="fill" style=${{ width: `${(selfLower / lowerMax) * 100}%` }}></div></div>
            <div class="num">${selfLower}</div>
          </div>
          <div class="compare-bar opp">
            <div class="bar"><div class="fill" style=${{ width: `${(peerLower / lowerMax) * 100}%` }}></div></div>
            <div class="num">${peerLower}</div>
          </div>
        </div>
      </div>

      <div class="card cat-grid-card">
        <div class="compare-title" style="margin-bottom:0">
          <span>Rozkład punktów</span>
        </div>
        <div class="cat-grid">
          ${CATEGORIES.filter((c) => !UPPER.includes(c)).map((cat) => {
            const v = sSelf[cat] ?? 0;
            const p = sPeer[cat] ?? 0;
            const highlight = cat === 'yahtzee' && v >= 50;
            return html`
              <div key=${cat} class="cat-cell ${highlight ? 'highlight' : ''}">
                ${highlight
                  ? html`<div class="c-label">Generał</div>`
                  : html`<div class="c-label">${CATEGORY_LABELS[cat]}</div>`}
                <div class="c-vals">
                  <span class="c-self">${v}</span>
                  <span class="c-vs">vs</span>
                  <span class="c-opp">${p}</span>
                </div>
              </div>
            `;
          })}
        </div>
      </div>

      <div class="kicker" style="text-align:center">
        Sesja <span class="dot-sep">·</span> ty ${state.session.tally.self} <span class="dot-sep">·</span> przeciwnik ${state.session.tally.peer}
      </div>

      <div class="actions">
        <button class="btn primary" onClick=${onRematch}>Rewanż</button>
        <button class="btn ghost" onClick=${onBackToLobby}>Do menu</button>
      </div>
    </div>
  `;
}

// ---------- Disconnect / confirm overlays ----------

function DisconnectOverlay({ seconds, onGiveUp }) {
  return html`
    <div class="overlay disconnect">
      <div class="overlay-card">
        <h2>Przeciwnik się rozłączył</h2>
        <p style="color:var(--muted)">Czekam na powrót…</p>
        <div class="count">${seconds}s</div>
        <div class="cta">
          <button class="btn ghost" onClick=${onGiveUp}>Zakończ grę</button>
        </div>
      </div>
    </div>
  `;
}

function ConfirmModal({ title, body, confirmLabel, cancelLabel, onCancel, onConfirm }) {
  return html`
    <div class="overlay confirm">
      <div class="overlay-card small">
        <h3>${title}</h3>
        <p style="color:var(--muted)">${body}</p>
        <div class="cta">
          <button class="btn ghost" onClick=${onCancel}>${cancelLabel || 'Anuluj'}</button>
          <button class="btn danger" onClick=${onConfirm}>${confirmLabel}</button>
        </div>
      </div>
    </div>
  `;
}

// ---------- Boot ----------

if (typeof window !== 'undefined') {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
  const root = document.getElementById('app');
  if (root) render(html`<${App} />`, root);
}
