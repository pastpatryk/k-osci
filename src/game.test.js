import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CATEGORIES,
  scoreCategory,
  upperSubtotal,
  upperBonus,
  lowerSubtotal,
  grandTotal,
  isScorecardFull,
  freshGame,
  initialState,
  starterForGame,
  reducer,
  slotWouldScore,
  isYahtzee,
} from './game.js';

const d = (...vals) => vals.map((v) => ({ value: v, held: false }));

// --- Scoring: upper section ---

test('upper section: aces counts 1s', () => {
  assert.equal(scoreCategory(d(1, 1, 2, 3, 4), 'aces'), 2);
  assert.equal(scoreCategory(d(2, 3, 4, 5, 6), 'aces'), 0);
  assert.equal(scoreCategory(d(1, 1, 1, 1, 1), 'aces'), 5);
});

test('upper section: twos..sixes', () => {
  assert.equal(scoreCategory(d(2, 2, 2, 3, 4), 'twos'), 6);
  assert.equal(scoreCategory(d(3, 3, 4, 5, 6), 'threes'), 6);
  assert.equal(scoreCategory(d(4, 4, 4, 4, 4), 'fours'), 20);
  assert.equal(scoreCategory(d(5, 5, 1, 2, 3), 'fives'), 10);
  assert.equal(scoreCategory(d(6, 6, 6, 1, 1), 'sixes'), 18);
});

// --- Scoring: lower section ---

test('three of a kind: sum of all dice if any face appears >=3', () => {
  assert.equal(scoreCategory(d(3, 3, 3, 2, 4), 'threeOfAKind'), 15);
  assert.equal(scoreCategory(d(6, 6, 6, 6, 1), 'threeOfAKind'), 25); // 4 counts for 3-kind too
  assert.equal(scoreCategory(d(1, 2, 3, 4, 5), 'threeOfAKind'), 0);
});

test('four of a kind: sum of all dice if any face appears >=4', () => {
  assert.equal(scoreCategory(d(4, 4, 4, 4, 5), 'fourOfAKind'), 21);
  assert.equal(scoreCategory(d(5, 5, 5, 5, 5), 'fourOfAKind'), 25);
  assert.equal(scoreCategory(d(3, 3, 3, 2, 4), 'fourOfAKind'), 0);
});

test('full house: 25 if exactly 3+2', () => {
  assert.equal(scoreCategory(d(2, 2, 3, 3, 3), 'fullHouse'), 25);
  assert.equal(scoreCategory(d(5, 5, 5, 1, 1), 'fullHouse'), 25);
  assert.equal(scoreCategory(d(4, 4, 4, 4, 1), 'fullHouse'), 0); // 4+1 not a full house
  assert.equal(scoreCategory(d(6, 6, 6, 6, 6), 'fullHouse'), 0); // 5-kind not a full house per strict rule
});

test('small straight: 30 if any 4 consecutive', () => {
  assert.equal(scoreCategory(d(1, 2, 3, 4, 6), 'smallStraight'), 30);
  assert.equal(scoreCategory(d(3, 4, 5, 6, 6), 'smallStraight'), 30);
  assert.equal(scoreCategory(d(2, 3, 4, 5, 5), 'smallStraight'), 30);
  assert.equal(scoreCategory(d(1, 2, 3, 5, 6), 'smallStraight'), 0);
});

test('large straight: 40 if all 5 consecutive', () => {
  assert.equal(scoreCategory(d(1, 2, 3, 4, 5), 'largeStraight'), 40);
  assert.equal(scoreCategory(d(2, 3, 4, 5, 6), 'largeStraight'), 40);
  assert.equal(scoreCategory(d(1, 2, 3, 4, 6), 'largeStraight'), 0);
});

test('yahtzee: 50 for 5 of a kind', () => {
  assert.equal(scoreCategory(d(3, 3, 3, 3, 3), 'yahtzee'), 50);
  assert.equal(scoreCategory(d(6, 6, 6, 6, 1), 'yahtzee'), 0);
});

test('chance: sum of all dice', () => {
  assert.equal(scoreCategory(d(1, 2, 3, 4, 5), 'chance'), 15);
  assert.equal(scoreCategory(d(6, 6, 6, 6, 6), 'chance'), 30);
});

test('scoreCategory throws on unknown category', () => {
  assert.throws(() => scoreCategory(d(1, 2, 3, 4, 5), 'bogus'), /Unknown category/);
});

test('scoreCategory accepts raw values too', () => {
  assert.equal(scoreCategory([1, 1, 2, 3, 4], 'aces'), 2);
  assert.equal(scoreCategory([1, 2, 3, 4, 5], 'largeStraight'), 40);
});

// --- Derived totals ---

test('upperSubtotal sums banked upper categories', () => {
  const sc = {
    aces: 3, twos: 6, threes: 9, fours: 12, fives: 15, sixes: 18,
    threeOfAKind: null, fourOfAKind: null, fullHouse: null,
    smallStraight: null, largeStraight: null, yahtzee: null, chance: null,
    yahtzeeBonusCount: 0,
  };
  assert.equal(upperSubtotal(sc), 63);
  assert.equal(upperBonus(sc), 35);
});

test('upperBonus threshold: 62 -> 0, 63 -> 35', () => {
  const base = {
    aces: 0, twos: 0, threes: 0, fours: 0, fives: 0, sixes: 0,
    threeOfAKind: null, fourOfAKind: null, fullHouse: null,
    smallStraight: null, largeStraight: null, yahtzee: null, chance: null,
    yahtzeeBonusCount: 0,
  };
  assert.equal(upperBonus({ ...base, sixes: 62 % 6 === 0 ? 62 : 60, fives: 2 }), 0);
  const sc62 = { ...base, sixes: 60, twos: 2 };
  assert.equal(upperSubtotal(sc62), 62);
  assert.equal(upperBonus(sc62), 0);
  const sc63 = { ...base, sixes: 60, threes: 3 };
  assert.equal(upperSubtotal(sc63), 63);
  assert.equal(upperBonus(sc63), 35);
});

test('lowerSubtotal includes yahtzee bonuses', () => {
  const sc = {
    aces: null, twos: null, threes: null, fours: null, fives: null, sixes: null,
    threeOfAKind: 20, fourOfAKind: 25, fullHouse: 25,
    smallStraight: 30, largeStraight: 40, yahtzee: 50, chance: 20,
    yahtzeeBonusCount: 2,
  };
  // categories: 20+25+25+30+40+50+20 = 210; plus 2*100 bonus = 410
  assert.equal(lowerSubtotal(sc), 410);
});

test('grandTotal combines all sections', () => {
  const sc = {
    aces: 3, twos: 6, threes: 9, fours: 12, fives: 15, sixes: 18,
    threeOfAKind: 10, fourOfAKind: 10, fullHouse: 25,
    smallStraight: 30, largeStraight: 40, yahtzee: 50, chance: 20,
    yahtzeeBonusCount: 1,
  };
  // upper: 63 + 35 = 98; lower: 10+10+25+30+40+50+20 + 100 = 285; total = 383
  assert.equal(grandTotal(sc), 383);
});

test('isScorecardFull', () => {
  const full = {
    aces: 3, twos: 6, threes: 9, fours: 12, fives: 15, sixes: 18,
    threeOfAKind: 10, fourOfAKind: 10, fullHouse: 25,
    smallStraight: 30, largeStraight: 40, yahtzee: 50, chance: 20,
    yahtzeeBonusCount: 0,
  };
  assert.equal(isScorecardFull(full), true);
  assert.equal(isScorecardFull({ ...full, chance: null }), false);
});

// --- Starter formula ---

test('starter alternates: odd=host, even=guest', () => {
  assert.equal(starterForGame(1, 'host'), 'self');
  assert.equal(starterForGame(1, 'guest'), 'peer');
  assert.equal(starterForGame(2, 'host'), 'peer');
  assert.equal(starterForGame(2, 'guest'), 'self');
  assert.equal(starterForGame(3, 'host'), 'self');
});

// --- Reducer: lifecycle & state ---

test('reducer: SET_SELF_ID', () => {
  const s0 = initialState('host');
  const s1 = reducer(s0, { type: 'SET_SELF_ID', payload: { selfId: 'abc' } });
  assert.equal(s1.session.selfId, 'abc');
});

test('reducer: SET_CONNECTION', () => {
  const s0 = initialState('host');
  const s1 = reducer(s0, { type: 'SET_CONNECTION', payload: { peerId: 'x', status: 'connected' } });
  assert.equal(s1.session.peerId, 'x');
  assert.equal(s1.session.status, 'connected');
});

test('reducer: START_GAME sets phase and starter', () => {
  const s0 = initialState('host');
  const s1 = reducer(s0, { type: 'START_GAME', payload: { starter: 'host' } });
  assert.equal(s1.game.phase, 'playing');
  assert.equal(s1.game.turn, 'self');
  assert.equal(s1.game.round, 1);
  assert.equal(s1.game.rollNumber, 0);

  const s2 = reducer(initialState('guest'), { type: 'START_GAME', payload: { starter: 'host' } });
  assert.equal(s2.game.turn, 'peer');
});

test('reducer: SYNC_ROLL sets dice values for non-held dice', () => {
  let s = initialState('host');
  s = reducer(s, { type: 'START_GAME', payload: { starter: 'host' } });
  s = reducer(s, { type: 'SYNC_ROLL', payload: { values: [1, 2, 3, 4, 5], rollNumber: 1 } });
  assert.deepEqual(s.game.dice.map((d) => d.value), [1, 2, 3, 4, 5]);
  assert.equal(s.game.rollNumber, 1);

  // Hold one, re-roll — held die keeps value
  s = reducer(s, { type: 'TOGGLE_HOLD', payload: { index: 0, held: true } });
  s = reducer(s, { type: 'SYNC_ROLL', payload: { values: [6, 6, 6, 6, 6], rollNumber: 2 } });
  assert.deepEqual(s.game.dice.map((d) => d.value), [1, 6, 6, 6, 6]);
});

test('reducer: SYNC_ROLL ignored when rollNumber already maxed', () => {
  let s = initialState('host');
  s = reducer(s, { type: 'START_GAME', payload: { starter: 'host' } });
  s = reducer(s, { type: 'SYNC_ROLL', payload: { values: [1, 2, 3, 4, 5], rollNumber: 1 } });
  s = reducer(s, { type: 'SYNC_ROLL', payload: { values: [6, 6, 6, 6, 6], rollNumber: 2 } });
  s = reducer(s, { type: 'SYNC_ROLL', payload: { values: [1, 1, 1, 1, 1], rollNumber: 3 } });
  const before = s.game;
  s = reducer(s, { type: 'SYNC_ROLL', payload: { values: [2, 2, 2, 2, 2], rollNumber: 4 } });
  assert.equal(s.game, before);
});

test('reducer: TOGGLE_HOLD requires rollNumber > 0', () => {
  let s = initialState('host');
  s = reducer(s, { type: 'START_GAME', payload: { starter: 'host' } });
  const before = s.game;
  s = reducer(s, { type: 'TOGGLE_HOLD', payload: { index: 0, held: true } });
  assert.equal(s.game, before);
});

test('reducer: TOGGLE_HOLD idempotent', () => {
  let s = initialState('host');
  s = reducer(s, { type: 'START_GAME', payload: { starter: 'host' } });
  s = reducer(s, { type: 'SYNC_ROLL', payload: { values: [1, 2, 3, 4, 5], rollNumber: 1 } });
  s = reducer(s, { type: 'TOGGLE_HOLD', payload: { index: 2, held: true } });
  const s2 = reducer(s, { type: 'TOGGLE_HOLD', payload: { index: 2, held: true } });
  assert.deepEqual(s2.game.dice, s.game.dice);
});

test('reducer: BANK_SCORE writes value, flips turn, advances round after 2 banks', () => {
  let s = initialState('host');
  s = reducer(s, { type: 'START_GAME', payload: { starter: 'host' } });
  s = reducer(s, { type: 'SYNC_ROLL', payload: { values: [1, 1, 1, 2, 3], rollNumber: 1 } });
  s = reducer(s, { type: 'BANK_SCORE', payload: { category: 'aces', points: 3 } });
  assert.equal(s.game.scorecards.self.aces, 3);
  assert.equal(s.game.turn, 'peer');
  assert.equal(s.game.round, 1); // still round 1 until peer banks
  assert.equal(s.game.rollNumber, 0);

  // peer banks
  s = reducer(s, { type: 'SYNC_ROLL', payload: { values: [2, 2, 2, 3, 4], rollNumber: 1 } });
  s = reducer(s, { type: 'BANK_SCORE', payload: { category: 'twos', points: 6 } });
  assert.equal(s.game.scorecards.peer.twos, 6);
  assert.equal(s.game.round, 2);
  assert.equal(s.game.turn, 'self');
});

test('reducer: BANK_SCORE cannot re-bank an already banked slot', () => {
  let s = initialState('host');
  s = reducer(s, { type: 'START_GAME', payload: { starter: 'host' } });
  s = reducer(s, { type: 'SYNC_ROLL', payload: { values: [1, 1, 1, 2, 3], rollNumber: 1 } });
  s = reducer(s, { type: 'BANK_SCORE', payload: { category: 'aces', points: 3 } });
  // peer turn now; try to bank aces again on peer — should go into peer scorecard, not self
  s = reducer(s, { type: 'SYNC_ROLL', payload: { values: [1, 1, 1, 2, 3], rollNumber: 1 } });
  s = reducer(s, { type: 'BANK_SCORE', payload: { category: 'aces', points: 3 } });
  assert.equal(s.game.scorecards.self.aces, 3); // untouched
  assert.equal(s.game.scorecards.peer.aces, 3);

  // Now back on self's turn; try banking aces AGAIN on self — should be rejected
  s = reducer(s, { type: 'SYNC_ROLL', payload: { values: [1, 1, 1, 1, 1], rollNumber: 1 } });
  const before = s.game;
  s = reducer(s, { type: 'BANK_SCORE', payload: { category: 'aces', points: 5 } });
  assert.deepEqual(s.game, before);
});

test('reducer: Yahtzee bonus (+100) applies on subsequent Yahtzees', () => {
  let s = initialState('host');
  s = reducer(s, { type: 'START_GAME', payload: { starter: 'host' } });

  // Roll a Yahtzee, bank in 'yahtzee' for 50
  s = reducer(s, { type: 'SYNC_ROLL', payload: { values: [5, 5, 5, 5, 5], rollNumber: 1 } });
  s = reducer(s, { type: 'BANK_SCORE', payload: { category: 'yahtzee', points: 50 } });
  assert.equal(s.game.scorecards.self.yahtzee, 50);
  assert.equal(s.game.scorecards.self.yahtzeeBonusCount, 0);

  // peer takes a turn (bank something trivial)
  s = reducer(s, { type: 'SYNC_ROLL', payload: { values: [1, 1, 2, 3, 4], rollNumber: 1 } });
  s = reducer(s, { type: 'BANK_SCORE', payload: { category: 'aces', points: 2 } });

  // self rolls another Yahtzee, banks it in any open category (say 'fives' for simplified rules)
  s = reducer(s, { type: 'SYNC_ROLL', payload: { values: [5, 5, 5, 5, 5], rollNumber: 1 } });
  s = reducer(s, { type: 'BANK_SCORE', payload: { category: 'fives', points: 25 } });
  assert.equal(s.game.scorecards.self.fives, 25);
  assert.equal(s.game.scorecards.self.yahtzeeBonusCount, 1);
});

test('reducer: no Yahtzee bonus if initial Yahtzee was banked as 0', () => {
  let s = initialState('host');
  s = reducer(s, { type: 'START_GAME', payload: { starter: 'host' } });

  // Bank yahtzee as 0 (forfeit) without actually rolling a yahtzee
  s = reducer(s, { type: 'SYNC_ROLL', payload: { values: [1, 2, 3, 4, 5], rollNumber: 1 } });
  s = reducer(s, { type: 'BANK_SCORE', payload: { category: 'yahtzee', points: 0 } });
  assert.equal(s.game.scorecards.self.yahtzee, 0);

  // peer
  s = reducer(s, { type: 'SYNC_ROLL', payload: { values: [1, 2, 3, 4, 5], rollNumber: 1 } });
  s = reducer(s, { type: 'BANK_SCORE', payload: { category: 'largeStraight', points: 40 } });

  // self rolls a Yahtzee later — no bonus since initial yahtzee was 0
  s = reducer(s, { type: 'SYNC_ROLL', payload: { values: [6, 6, 6, 6, 6], rollNumber: 1 } });
  s = reducer(s, { type: 'BANK_SCORE', payload: { category: 'sixes', points: 30 } });
  assert.equal(s.game.scorecards.self.yahtzeeBonusCount, 0);
});

test('reducer: game ends when both scorecards full; tally increments for winner', () => {
  let s = initialState('host');
  s = reducer(s, { type: 'START_GAME', payload: { starter: 'host' } });

  // Cheat: manually fill all but one category on each side, then bank last two.
  const fill = (sc, except) => {
    for (const c of CATEGORIES) {
      if (c === except) continue;
      sc[c] = 5;
    }
  };
  fill(s.game.scorecards.self, 'chance');
  fill(s.game.scorecards.peer, 'chance');
  s.game.round = 13;

  // self banks last slot (higher)
  s = reducer(s, { type: 'SYNC_ROLL', payload: { values: [5, 5, 5, 5, 5], rollNumber: 1 } });
  s = reducer(s, { type: 'BANK_SCORE', payload: { category: 'chance', points: 25 } });
  // Still playing — peer has one slot open
  assert.equal(s.game.phase, 'playing');

  // peer banks last slot (lower)
  s = reducer(s, { type: 'SYNC_ROLL', payload: { values: [1, 1, 1, 1, 1], rollNumber: 1 } });
  s = reducer(s, { type: 'BANK_SCORE', payload: { category: 'chance', points: 5 } });

  assert.equal(s.game.phase, 'gameOver');
  assert.equal(s.session.tally.self, 1);
  assert.equal(s.session.tally.peer, 0);
});

test('reducer: RESET_GAME increments gameNumber and resets game state; tally preserved', () => {
  let s = initialState('host');
  s.session.tally = { self: 2, peer: 1 };
  s.session.gameNumber = 3;
  s = reducer(s, { type: 'RESET_GAME', payload: { starter: 'guest' } });
  assert.equal(s.session.gameNumber, 4);
  assert.equal(s.session.tally.self, 2);
  assert.equal(s.session.tally.peer, 1);
  assert.equal(s.game.phase, 'playing');
  assert.equal(s.game.turn, 'peer'); // role=host, starter=guest => peer
  assert.equal(s.game.round, 1);
});

test('reducer: CLEAR_SESSION returns to initial state keeping role', () => {
  let s = initialState('guest');
  s.session.tally = { self: 5, peer: 3 };
  s = reducer(s, { type: 'CLEAR_SESSION' });
  assert.equal(s.session.role, 'guest');
  assert.equal(s.session.tally.self, 0);
  assert.equal(s.game.phase, 'lobby');
});

test('reducer: SYNC_STATE hydrates with flipped POV', () => {
  const hostView = {
    phase: 'playing',
    turn: 'self', // host sees self
    round: 2,
    rollNumber: 0,
    dice: Array.from({ length: 5 }, () => ({ value: 1, held: false })),
    scorecards: {
      self: { aces: 3, twos: null, threes: null, fours: null, fives: null, sixes: null,
              threeOfAKind: null, fourOfAKind: null, fullHouse: null,
              smallStraight: null, largeStraight: null, yahtzee: null, chance: null,
              yahtzeeBonusCount: 0 },
      peer: { aces: 2, twos: null, threes: null, fours: null, fives: null, sixes: null,
              threeOfAKind: null, fourOfAKind: null, fullHouse: null,
              smallStraight: null, largeStraight: null, yahtzee: null, chance: null,
              yahtzeeBonusCount: 0 },
    },
    lastBankedCategory: 'aces',
    banksThisRound: 0,
  };

  const s0 = initialState('guest');
  const s1 = reducer(s0, {
    type: 'SYNC_STATE',
    payload: { game: hostView, tally: { self: 2, peer: 1 }, gameNumber: 3 },
  });
  // From guest's POV: host's self = our peer, host's peer = our self
  assert.equal(s1.game.turn, 'peer'); // it was host's turn on host side
  assert.equal(s1.game.scorecards.self.aces, 2);
  assert.equal(s1.game.scorecards.peer.aces, 3);
  assert.equal(s1.session.tally.self, 1); // flipped
  assert.equal(s1.session.tally.peer, 2);
  assert.equal(s1.session.gameNumber, 3);
});

test('slotWouldScore: true when category would score > 0', () => {
  assert.equal(slotWouldScore(d(1, 2, 3, 4, 5), 'largeStraight'), true);
  assert.equal(slotWouldScore(d(1, 2, 3, 4, 5), 'aces'), true);
  assert.equal(slotWouldScore(d(2, 3, 4, 5, 6), 'aces'), false);
});

test('isYahtzee detects 5-of-a-kind', () => {
  assert.equal(isYahtzee([3, 3, 3, 3, 3]), true);
  assert.equal(isYahtzee([3, 3, 3, 3, 4]), false);
});

test('freshGame sets starter side and resets dice', () => {
  const g = freshGame('peer');
  assert.equal(g.turn, 'peer');
  assert.equal(g.round, 1);
  assert.equal(g.rollNumber, 0);
  assert.equal(g.dice.length, 5);
});
