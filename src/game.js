// Pure game logic: constants, scoring, reducer. No DOM, no network, no framework.

export const CATEGORIES = [
  'aces', 'twos', 'threes', 'fours', 'fives', 'sixes',
  'threeOfAKind', 'fourOfAKind', 'fullHouse',
  'smallStraight', 'largeStraight', 'yahtzee', 'chance',
];

export const UPPER_CATEGORIES = ['aces', 'twos', 'threes', 'fours', 'fives', 'sixes'];
export const UPPER_BONUS_THRESHOLD = 63;
export const UPPER_BONUS = 35;
export const YAHTZEE_BONUS = 100;
export const MAX_ROUNDS = 13;
export const MAX_ROLLS = 3;
export const DICE_COUNT = 5;

const FACE_VALUE = { aces: 1, twos: 2, threes: 3, fours: 4, fives: 5, sixes: 6 };

function counts(values) {
  const c = [0, 0, 0, 0, 0, 0, 0];
  for (const v of values) c[v]++;
  return c;
}

function sum(values) {
  let s = 0;
  for (const v of values) s += v;
  return s;
}

function diceValues(dice) {
  return dice.map((d) => d.value);
}

function isYahtzee(values) {
  const c = counts(values);
  return c.some((n) => n === 5);
}

// scoreCategory: pure function dice[] -> points for the given category.
// dice can be either [{value, held}] or raw [n,n,n,n,n]
export function scoreCategory(dice, category) {
  const values = Array.isArray(dice) && dice.length > 0 && typeof dice[0] === 'object'
    ? diceValues(dice)
    : dice;

  if (FACE_VALUE[category] !== undefined) {
    const face = FACE_VALUE[category];
    return values.filter((v) => v === face).length * face;
  }

  const c = counts(values);
  const total = sum(values);

  switch (category) {
    case 'threeOfAKind':
      return c.some((n) => n >= 3) ? total : 0;
    case 'fourOfAKind':
      return c.some((n) => n >= 4) ? total : 0;
    case 'fullHouse':
      return c.some((n) => n === 3) && c.some((n) => n === 2) ? 25 : 0;
    case 'smallStraight': {
      // any 4 consecutive faces
      const has = (n) => c[n] > 0;
      if (has(1) && has(2) && has(3) && has(4)) return 30;
      if (has(2) && has(3) && has(4) && has(5)) return 30;
      if (has(3) && has(4) && has(5) && has(6)) return 30;
      return 0;
    }
    case 'largeStraight': {
      const has = (n) => c[n] > 0;
      if (has(1) && has(2) && has(3) && has(4) && has(5)) return 40;
      if (has(2) && has(3) && has(4) && has(5) && has(6)) return 40;
      return 0;
    }
    case 'yahtzee':
      return isYahtzee(values) ? 50 : 0;
    case 'chance':
      return total;
    default:
      throw new Error(`Unknown category: ${category}`);
  }
}

// Returns true if the dice roll is a Yahtzee (used to trigger simplified +100 bonus on later ones).
export { isYahtzee };

export function upperSubtotal(scorecard) {
  let s = 0;
  for (const k of UPPER_CATEGORIES) if (scorecard[k] !== null) s += scorecard[k];
  return s;
}

export function upperBonus(scorecard) {
  return upperSubtotal(scorecard) >= UPPER_BONUS_THRESHOLD ? UPPER_BONUS : 0;
}

export function lowerSubtotal(scorecard) {
  let s = 0;
  for (const k of CATEGORIES) {
    if (UPPER_CATEGORIES.includes(k)) continue;
    if (scorecard[k] !== null) s += scorecard[k];
  }
  s += (scorecard.yahtzeeBonusCount || 0) * YAHTZEE_BONUS;
  return s;
}

export function grandTotal(scorecard) {
  return upperSubtotal(scorecard) + upperBonus(scorecard) + lowerSubtotal(scorecard);
}

export function isScorecardFull(scorecard) {
  return CATEGORIES.every((k) => scorecard[k] !== null);
}

// --------- State ---------

function freshScorecard() {
  const s = { yahtzeeBonusCount: 0 };
  for (const c of CATEGORIES) s[c] = null;
  return s;
}

function freshDice() {
  const out = [];
  for (let i = 0; i < DICE_COUNT; i++) out.push({ value: 1, held: false });
  return out;
}

export function freshGame(starter = 'self') {
  return {
    phase: 'playing',
    turn: starter,
    round: 1,
    rollNumber: 0,
    dice: freshDice(),
    scorecards: { self: freshScorecard(), peer: freshScorecard() },
    lastBankedCategory: null,
    // tracks how many banks have happened this round; when === 2, round advances
    banksThisRound: 0,
  };
}

export function initialState(role = 'host') {
  return {
    session: {
      selfId: null,
      peerId: null,
      role,
      status: 'idle',
      tally: { self: 0, peer: 0 },
      gameNumber: 1,
    },
    game: {
      phase: 'lobby',
      turn: 'self',
      round: 1,
      rollNumber: 0,
      dice: freshDice(),
      scorecards: { self: freshScorecard(), peer: freshScorecard() },
      lastBankedCategory: null,
      banksThisRound: 0,
    },
  };
}

// Who starts game N given role. Spec: odd games host starts, even games guest.
// Returns the starter from `role`'s own POV — "self" or "peer".
export function starterForGame(gameNumber, role) {
  const starterRole = gameNumber % 2 === 1 ? 'host' : 'guest';
  return starterRole === role ? 'self' : 'peer';
}

// Flip side perspective for incoming messages: what's "self" on the sender is "peer" on us.
function flipSide(side) {
  return side === 'self' ? 'peer' : 'self';
}

// --------- Reducer ---------

// Actions:
// Session-level:
//   { type: 'SET_SELF_ID', payload: { selfId } }
//   { type: 'SET_CONNECTION', payload: { peerId?, status } }
// Network-originated (also dispatched locally by the actor):
//   { type: 'SYNC_STATE', payload: { game, tally, gameNumber }, remote: true }
//   { type: 'START_GAME', payload: { starter: 'host'|'guest' } }    (from either side)
//   { type: 'SYNC_ROLL', payload: { values: [n,n,n,n,n], rollNumber } }
//   { type: 'TOGGLE_HOLD', payload: { index, held } }
//   { type: 'BANK_SCORE', payload: { category, points, yahtzeeBonus? } }
//   { type: 'RESET_GAME', payload: { starter: 'host'|'guest' } }
// All network actions carry `remote: true` when they came off the wire.
// Local-only actions may set `remote: false` (default).

export function reducer(state, action) {
  switch (action.type) {
    case 'SET_SELF_ID':
      return { ...state, session: { ...state.session, selfId: action.payload.selfId } };

    case 'SET_CONNECTION': {
      const { peerId, status } = action.payload;
      return {
        ...state,
        session: {
          ...state.session,
          ...(peerId !== undefined ? { peerId } : {}),
          status,
        },
      };
    }

    case 'SYNC_STATE': {
      // Host's snapshot received by guest. Hydrate game + session meta,
      // flipping `turn` perspective (host's "self" is guest's "peer").
      const { game, tally, gameNumber } = action.payload;
      const hydratedGame = {
        ...game,
        turn: flipSide(game.turn),
        scorecards: { self: game.scorecards.peer, peer: game.scorecards.self },
      };
      const flippedTally = { self: tally.peer, peer: tally.self };
      return {
        ...state,
        session: { ...state.session, tally: flippedTally, gameNumber },
        game: hydratedGame,
      };
    }

    case 'START_GAME': {
      const starterSide = action.payload.starter === state.session.role ? 'self' : 'peer';
      return {
        ...state,
        game: freshGame(starterSide),
      };
    }

    case 'SYNC_ROLL': {
      if (state.game.phase !== 'playing') return state;
      if (state.game.rollNumber >= MAX_ROLLS) return state;
      const { values, rollNumber } = action.payload;
      if (!Array.isArray(values) || values.length !== DICE_COUNT) return state;
      // Only update values for non-held dice; held dice keep their existing value.
      const dice = state.game.dice.map((die, i) => {
        if (die.held) return die;
        return { ...die, value: values[i] };
      });
      return { ...state, game: { ...state.game, dice, rollNumber } };
    }

    case 'TOGGLE_HOLD': {
      if (state.game.phase !== 'playing') return state;
      if (state.game.rollNumber === 0) return state; // can't hold before first roll
      const { index, held } = action.payload;
      if (typeof index !== 'number' || index < 0 || index >= DICE_COUNT) return state;
      const dice = state.game.dice.map((die, i) =>
        i === index ? { ...die, held: !!held } : die
      );
      return { ...state, game: { ...state.game, dice } };
    }

    case 'BANK_SCORE': {
      if (state.game.phase !== 'playing') return state;
      const { category, points } = action.payload;
      if (!CATEGORIES.includes(category)) return state;

      // Active player from our POV is whoever's `turn` it is.
      // But the BANKer is the one whose turn it is, regardless of remote flag.
      const scorer = state.game.turn;
      const current = state.game.scorecards[scorer];
      if (current[category] !== null) return state; // slot already banked

      // Simplified Yahtzee bonus: once the player has banked their first Yahtzee > 0,
      // any additional Yahtzee roll grants +100, regardless of category banked into.
      const rolledYahtzee = isYahtzee(diceValues(state.game.dice));
      const hadInitialYahtzee = current.yahtzee !== null && current.yahtzee > 0;
      const isBonus = rolledYahtzee && hadInitialYahtzee;

      const updatedScorecard = {
        ...current,
        [category]: points,
        yahtzeeBonusCount: (current.yahtzeeBonusCount || 0) + (isBonus ? 1 : 0),
      };

      const scorecards = { ...state.game.scorecards, [scorer]: updatedScorecard };

      // Advance turn
      const nextTurn = scorer === 'self' ? 'peer' : 'self';
      const banksThisRound = state.game.banksThisRound + 1;
      const roundAdvances = banksThisRound >= 2;

      const nextRound = roundAdvances ? state.game.round + 1 : state.game.round;
      const nextBanks = roundAdvances ? 0 : banksThisRound;

      // End-of-game: both scorecards full.
      const allFull =
        isScorecardFull(scorecards.self) && isScorecardFull(scorecards.peer);

      const nextPhase = allFull ? 'gameOver' : 'playing';

      return {
        ...state,
        game: {
          ...state.game,
          scorecards,
          turn: allFull ? state.game.turn : nextTurn,
          round: allFull ? state.game.round : nextRound,
          rollNumber: 0,
          dice: freshDice(),
          banksThisRound: allFull ? state.game.banksThisRound : nextBanks,
          lastBankedCategory: category,
          phase: nextPhase,
        },
        session: allFull ? applyTally(state.session, scorecards) : state.session,
      };
    }

    case 'RESET_GAME': {
      const starterSide = action.payload.starter === state.session.role ? 'self' : 'peer';
      return {
        ...state,
        session: { ...state.session, gameNumber: state.session.gameNumber + 1 },
        game: freshGame(starterSide),
      };
    }

    case 'CLEAR_SESSION':
      return initialState(state.session.role);

    default:
      return state;
  }
}

function applyTally(session, scorecards) {
  const selfTotal = grandTotal(scorecards.self);
  const peerTotal = grandTotal(scorecards.peer);
  if (selfTotal > peerTotal) {
    return { ...session, tally: { ...session.tally, self: session.tally.self + 1 } };
  }
  if (peerTotal > selfTotal) {
    return { ...session, tally: { ...session.tally, peer: session.tally.peer + 1 } };
  }
  return session; // tie: no increment
}

// Helper used by UI to decide whether a slot should glow.
export function slotWouldScore(dice, category) {
  return scoreCategory(dice, category) > 0;
}
