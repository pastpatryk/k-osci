# P2P Yahtzee — Design Spec

**Date:** 2026-04-23
**Status:** Draft, pending user approval
**Target:** Two-player browser Yahtzee over WebRTC, zero backend, static hosting.

---

## 1. Goals and non-goals

### Goals

- Two players play Yahtzee in real time over a direct WebRTC data channel.
- Zero backend: only the PeerJS public signalling cloud touches our traffic; no game data is persisted server-side.
- Host generates a shareable `?join=PEER_ID` link; guest joins automatically when the link is opened.
- Full Yahtzee scoring (13 categories, +35 upper bonus at >= 63, simplified +100 per extra Yahtzee).
- High-juice feel: 3D dice tumble, glowing valid scorecard slots, haptic vibration, confetti on wins.
- PWA-installable app shell that loads offline (gameplay still requires network for signalling).
- Tight loading envelope: initial paint under 1.5s on a warm cache.

### Non-goals

- Anti-cheat. Active player generates their own dice values; friends-only trust model.
- Durable session resume across refresh. Disconnect beyond a reconnect window ends the game.
- More than two players.
- Accounts, matchmaking, spectators, chat.
- Custom PeerServer. Public PeerJS cloud is accepted.
- Unit tests for network / UI / FX layers.

---

## 2. Decisions locked during brainstorming

| Q | Decision |
|---|---|
| Disconnect recovery | ~60s reconnect window; in-memory state only; timeout ends the game and returns both sides to lobby. |
| End-of-game flow | Final scoreboard with Rematch (same peers, keeps DataChannel) and "Back to lobby" (destructive, confirms first). Session win/loss tally persists across rematches. |
| First-player selection | Alternates by `gameNumber`: odd games host starts, even games guest starts. |
| Yahtzee bonus rule | Simplified: +100 per extra Yahtzee, free category choice. No official Joker Rule. |
| Valid-slot glow | Only open categories that would score > 0 glow. Zero-score slots remain clickable (sacrifice) but muted. |
| Trust / cheat | Active player generates dice. No commit-reveal. Documented non-goal. |
| PWA scope | App shell + CDN assets cached by service worker. Gameplay requires network. |
| Framework | Preact + htm via ESM CDN. No bundler, no build step. |
| File layout | 5 JS files under `src/`; pure-game-logic split from everything else. |

---

## 3. Architecture

### 3.1 State authority model

Action-log with pure reducer. Both clients hold an identical reactive state tree. The active player generates messages (rolls, holds, banks); the reducer is a pure function `(state, action) -> state'`; both sides run the same reducer on the same ordered stream of actions and therefore converge to the same state.

Two safety properties:

1. Messages carry absolute outcomes, not toggles. `TOGGLE_HOLD` sends the resulting `held: true/false`; `BANK_SCORE` sends the computed `points`; `SYNC_ROLL` sends the final dice array. Reapplying a message is always idempotent.
2. On connection establishment the host sends a single `SYNC_STATE` snapshot so a just-joined guest hydrates cleanly. In-session we never re-sync; divergence would be a bug.

### 3.2 File layout

```
yahtzee/
├── index.html               # markup, CDN imports, root mount, inline Tailwind config
├── manifest.webmanifest     # PWA manifest
├── sw.js                    # service worker — app shell + CDN URL cache
├── icons/                   # PWA icon assets
├── src/
│   ├── app.js               # Preact root, components inline, glue between net and reducer
│   ├── game.js              # PURE: scoring, reducer, initial state, category constants
│   ├── net.js               # PeerJS wrapper — host/join/send/onMessage events
│   ├── fx.js                # haptics (navigator.vibrate), confetti wrapper
│   └── game.test.js         # node --test cases for scoring + reducer
└── docs/superpowers/specs/  # this document
```

Boundaries that matter:

- `game.js` is framework-free, DOM-free, network-free. Pure. Unit-tested.
- `net.js` knows nothing about game rules. Emits `message`, `status`, `open`, `close` events; exposes `send(type, payload)`.
- `fx.js` guards all browser-specific side-effects so they degrade silently where unsupported.
- `app.js` is the only place that imports from all three; it owns the reactive state and wires everything together.

### 3.3 Tech choices

- **Preact 10 + htm** via ESM CDN. `useReducer` for state; hooks for effects; `htm` tagged template literals for JSX-ish markup without a build step. ~6 KB gzipped.
- **PeerJS** via ESM CDN. DataChannel only.
- **canvas-confetti** via ESM CDN.
- **Tailwind v4 Play CDN** if stable at implementation time; fall back to Tailwind v3 Play CDN + hand-written OKLCH colors via CSS custom properties otherwise.
- **No TypeScript, no bundler, no package.json runtime deps.** `node --test` is the only dev tooling, for `src/game.test.js`.

---

## 4. State shape

Single state tree held at the app root, driven by `useReducer(gameReducer, initialState())`.

```js
{
  session: {
    selfId: "peer-abc123",           // our PeerJS id once assigned
    peerId: null | "peer-xyz789",    // remote peer id once connected
    role: "host" | "guest",
    status: "idle" | "connecting" | "connected" | "waiting" | "disconnected",
    tally: { self: 0, peer: 0 },     // session wins
    gameNumber: 1,                   // 1-indexed; drives starter selection
  },
  game: {
    phase: "lobby" | "playing" | "gameOver",
    turn: "self" | "peer",           // active player from THIS client's POV
    round: 1,                        // 1..13
    rollNumber: 0,                   // 0 before first roll; 1..3 during a turn
    dice: [
      { value: 1, held: false },
      { value: 1, held: false },
      { value: 1, held: false },
      { value: 1, held: false },
      { value: 1, held: false },
    ],
    scorecards: {
      self: { aces: null, twos: null, threes: null, fours: null, fives: null, sixes: null,
              threeOfAKind: null, fourOfAKind: null, fullHouse: null,
              smallStraight: null, largeStraight: null, yahtzee: null, chance: null,
              yahtzeeBonusCount: 0 },
      peer: { ... same shape ... },
    },
    lastBankedCategory: null | "fullHouse",  // for brief flash highlight
  },
}
```

Slot semantics:

- `null` means unbanked (scorable).
- Any number (including 0) means banked — sacrificing a zero is a legal action.
- `yahtzeeBonusCount` increments for each Yahtzee rolled after the first, regardless of what category it was banked into.
- Upper bonus (+35 if sum of aces..sixes >= 63) and grand totals are derived on render, never stored.

---

## 5. P2P protocol

One message shape across the wire:

```js
{ type: string, payload: object, meta: { from: peerId, ts: epochMs } }
```

| Type | Sender | Payload | When |
|------|--------|---------|------|
| `SYNC_ROLL` | active player | `{ values: [n,n,n,n,n], rollNumber: 1..3 }` | on each roll |
| `TOGGLE_HOLD` | active player | `{ index: 0..4, held: bool }` | on hold toggle during a turn |
| `BANK_SCORE` | active player | `{ category: string, points: number }` | on scoring a category |
| `RESET_GAME` | either | `{ starter: "host" \| "guest" }` | on rematch |
| `SYNC_STATE` | host | full `game` object + `session.tally` + `session.gameNumber` | once, immediately after DataChannel opens |
| `START_GAME` | either (from lobby) | `{ starter: "host" \| "guest" }` | on "Start game" click |

Rules:

- Payloads are absolute state, not relative. Applying the same message twice is a no-op.
- The sender dispatches its own message locally for instant UI feedback; it is not echoed back by PeerJS.
- Receivers dispatch an identically-shaped action into the reducer.
- The reducer rejects messages that would be invalid (wrong turn, bad round, bank to a filled slot). Invalid messages are logged to console and dropped — they should never happen in correct gameplay and signal a bug, not a cheat.

---

## 6. Lifecycle

### 6.1 Boot

1. `main` in `app.js` registers service worker (non-blocking).
2. Parse `?join=ID` from the URL.
3. Initialize PeerJS. On `open`, record `session.selfId`.
4. If `join` param present -> role = guest; immediately `peer.connect(hostId)`; `status` = "connecting".
5. Else -> role = host; render lobby; status = "idle".

### 6.2 Lobby -> Playing

1. Guest's connection request fires `connection` on host's Peer; host accepts.
2. Host sends `SYNC_STATE` snapshot on `open`. Host transitions to `"connected"`.
3. Guest receives `SYNC_STATE`, hydrates, transitions to `"connected"`.
4. Host sees a "Start game" button; guest sees "Waiting for host to start...". On host click -> dispatches + sends `START_GAME` with computed starter. Both sides enter `phase: "playing"`. (Host-only button prevents start-race.)
5. Starter formula: `starter = session.gameNumber % 2 === 1 ? "host" : "guest"`.

### 6.3 Turn flow

**Active player (self's turn):**

- Roll button is enabled iff `rollNumber < 3`.
- Click Roll -> generate 5 random ints for non-held dice -> dispatch `SYNC_ROLL` locally -> `net.send(SYNC_ROLL)`.
- Click a die after first roll -> compute `nextHeld = !die.held` -> dispatch `TOGGLE_HOLD` locally with `{ index, held: nextHeld }` -> `net.send(TOGGLE_HOLD, same payload)`. Both local dispatch and wire message use the same absolute-value action shape.
- Click a glowing (or muted sacrifice) scorecard slot -> compute points via `scoreCategory(dice, category)` in `game.js` -> dispatch + send `BANK_SCORE`.
- Reducer, on `BANK_SCORE`: writes the value, increments `yahtzeeBonusCount` if applicable, flips `turn`, advances `round` when both players have banked this round, resets `dice` + `rollNumber` to 0. Transitions `phase` to `"gameOver"` after round 13's last bank.
- Post-bank haptic: 50ms pulse. If Yahtzee bonus just triggered: triple-pulse + confetti burst.

**Waiting player:**

- Dice tray visibly dimmed, non-interactive.
- Own scorecard rows render but not clickable.
- State updates in real time as incoming `SYNC_ROLL` / `TOGGLE_HOLD` / `BANK_SCORE` flow.

### 6.4 Game over

- Reducer sets `phase: "gameOver"` after both scorecards are full on round 13.
- Winner computed from totals (includes +35 upper bonus + Yahtzee bonuses).
- Winner side plays full-screen confetti + sustained haptic + victory celebration text. Loser gets a subdued fade-in.
- `session.tally` increments for the winner on the side that won.
- Two buttons on overlay:
  - **Rematch** -> dispatches + sends `RESET_GAME` with new starter; both sides reset `game` and increment `gameNumber`.
  - **Back to lobby** -> confirm dialog ("This ends the session; your tally will be lost"). On confirm: close DataChannel, clear session, host regenerates lobby. Peer receives `close` and returns to initial lobby too.

### 6.5 Disconnect / reconnect window

- On PeerJS `close` or `error` during `phase: "playing"`:
  - `session.status` -> `"waiting"`.
  - Overlay shows "Peer disconnected - waiting 60s..." with visible countdown and a "Give up" button.
  - **Guest side** attempts `peer.connect(hostPeerId)` every 5s (guest is the active initiator in PeerJS). **Host side** passively waits for incoming `connection`.
  - If host's own Peer disconnected from the signalling server, it calls `peer.reconnect()` first, then resumes listening.
- On DataChannel reopen: host re-sends `SYNC_STATE`; both sides resume; `status` -> `"connected"`.
- On timeout or "Give up" click:
  - Clear `game`, clear `session.tally`, status -> `"disconnected"`, phase -> `"lobby"`, host regenerates share link.
- On `beforeunload` mid-game: browser confirm dialog (best-effort; browsers may ignore).
- On `document.hidden`: haptics and confetti suppress; DataChannel is unaffected.

---

## 7. UI design

### 7.1 Layout

- **Desktop (>= 768px):** 12-col CSS grid. Left bento cell: self player header + self scorecard. Right bento cell: peer player header + peer scorecard. Bottom full-width bento cell: dice tray + roll button + turn banner.
- **Mobile (< 768px):** stacked single column. Order: sticky turn banner, dice tray, self scorecard, peer scorecard (collapsible accordion), status pill in the top-right corner.
- **Glass surface:** each bento cell uses `bg-white/10 backdrop-blur-2xl border border-white/20 rounded-[2rem]` with a subtle inner highlight.
- **Background:** large radial gradient from `oklch(15% 0.02 250)` center to `oklch(12% 0.03 270)` edges. No image assets.
- **Accent:** `oklch(70% 0.3 260)` neon indigo for active turn glow, valid-slot glow, roll button, connected-status dot, confetti palette seed.
- **Typography:** system-ui optical-sizing enabled, no webfont to keep initial paint fast.

### 7.2 Components

```
<App>
  <Lobby>                 # phase === "lobby"
    <StatusPill/>
    <ShareCard/>          # share link + smart share button + join input for manual paste
  <Board>                 # phase === "playing" | "gameOver"
    <PlayerCard self/>    # name placeholder, total, tally badge, turn indicator
    <PlayerCard peer/>
    <DiceTray/>           # 5 <Die>
    <Scorecard side="self"/>   # interactive when self's turn
    <Scorecard side="peer"/>   # always read-only
    <TurnBanner/>
  <GameOverOverlay/>      # phase === "gameOver" — mounts confetti canvas
  <DisconnectOverlay/>    # session.status === "waiting"
```

Each component is a function returning `htm` markup. No SFCs. Files can be inlined in `app.js` or split if `app.js` grows past ~500 LOC.

### 7.3 Visual juice

- **Dice tumble:** each die is a `<button>` with CSS 3D transform. On `SYNC_ROLL` the reducer marks rolling dice; the component applies `transform: rotateX(Nx360deg) rotateY(Mx360deg)` with `transition: transform 600ms cubic-bezier(.2,.8,.2,1)`, then snaps to the face for the rolled value. Purely cosmetic — dispatched value is authoritative.
- **Held dice:** inset ring, slight scale-down, exempt from tumble.
- **Roll haptic:** `navigator.vibrate([15, 30, 15])` fires on `transitionend` of the dice, not on click.
- **Scorecard glow:** valid slots (open, would score > 0) get `box-shadow: 0 0 1.5rem oklch(70% 0.3 260 / 0.4)` and a subtle hover lift. Zero-score open slots render muted but clickable (sacrifice).
- **Last banked cell:** quick 800ms accent-ring fade after a bank to draw the eye.
- **Yahtzee bank:** localized confetti burst from the Yahtzee cell + triple-pulse haptic.
- **Game win:** full-screen confetti + sustained haptic; overlay fades in. Loser: no confetti, no celebration haptic.

### 7.4 Accessibility baseline

- Glow + border + aria-label on valid slots — color alone is not a signal.
- `prefers-reduced-motion` disables dice tumble and suppresses confetti; dice snap directly to rolled values. Haptics are a separate concern and remain enabled (they are feedback, not motion).
- All interactive elements are focusable `<button>`s.
- `aria-live="polite"` region announces turn changes and score events ("You scored 25 for Full House").

---

## 8. Testing strategy

- **Unit tests** in `src/game.test.js`, run via `node --test`:
  - Every category scorer (upper, three/four of a kind, full house, small/large straight, Yahtzee, chance).
  - Upper-section bonus threshold (62 -> no bonus, 63 -> +35).
  - Simplified Yahtzee bonus (2nd+ Yahtzee: +100 each, any open category allowed).
  - Reducer: roll -> hold -> bank -> turn flip -> round advance. Round 13 last bank -> `gameOver` transition.
  - Starter formula across `gameNumber` odd/even.
  - Idempotency: applying the same `TOGGLE_HOLD` or `BANK_SCORE` twice is a no-op.
  - Invalid actions (wrong turn, already-banked slot) are rejected cleanly.
- **No unit tests** for `net.js`, `fx.js`, `app.js`. The mocks would be heavier than the code; manual smoke test covers these.
- **Manual smoke test** (before declaring done): two windows (one with `?join=ID`), validate connect / roll sync / hold sync / bank sync / scorecard update both sides / rematch / disconnect -> reconnect window -> abandon / PWA install prompt.

---

## 9. Risks and accepted trade-offs

1. **Tailwind v4 Play CDN** may be unstable. Fallback: v3 Play CDN + hand-written OKLCH via CSS variables. Visual spec unchanged.
2. **Cross-origin CDN caching in service worker** depends on CORS-friendly responses (jsdelivr and unpkg are). SW invalidation on CDN version bumps handled by URL-bust.
3. **PeerJS public cloud** has occasional rate-limiting or outages. Accepted; no fallback signalling server.
4. **No cheat prevention.** Active player generates dice. Documented friends-only trust model.
5. **iOS Safari has no `navigator.vibrate`.** Haptics degrade silently. Not a regression, just a platform gap.
6. **Page refresh loses state.** Accepted per disconnect policy.

---

## 10. Out of scope / explicit YAGNI

- Custom Peer IDs (display names, avatars).
- Spectator mode.
- In-game chat or emoji reactions.
- AI opponent for single-player practice.
- Statistics beyond session tally.
- Animated avatars, sound effects.
- Internationalization.
- Analytics / telemetry.

---

## 11. Open questions for future iterations (post-v1)

- Custom display names (currently "You" / "Opponent").
- Shareable final-score screenshot.
- Streak tally persisted in localStorage across sessions with the same peer.
- "Rejoin link" that survives refresh — would require durable state (Q1 option C).
