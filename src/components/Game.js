import { useState } from 'https://esm.sh/preact@10.19.3/hooks';
import { html } from './html.js';
import { MAX_ROLLS, grandTotal } from '../game.js';
import { pluralRzut } from './labels.js';
import { DiceTray } from './Dice.js';
import { Scorecard } from './Scorecard.js';

export function Game({ state, rollingKey, previewCategory, setPreviewCategory, selfName, peerName, onSetName, onRoll, onToggleHold, onBank, onEndGame }) {
  const [editingName, setEditingName] = useState(false);
  const { game } = state;
  const selfTotal = grandTotal(game.scorecards.self);
  const peerTotal = grandTotal(game.scorecards.peer);
  const interactive = game.turn === 'self' && game.phase === 'playing';
  const selfDisplay = selfName || 'Ty';
  const peerDisplay = peerName || 'Przeciwnik';
  const selfInitial = (selfName || 'T').trim().charAt(0).toUpperCase() || 'T';
  const peerInitial = (peerName || 'P').trim().charAt(0).toUpperCase() || 'P';

  return html`
    <div class="game">
      <div class="game-header">
        <div class="player-chip opp ${game.turn === 'peer' ? 'active' : ''}">
          <div class="p-avatar">${peerInitial}</div>
          <div>
            <div class="p-name">${peerDisplay}</div>
            <div class="p-score">${peerTotal}</div>
          </div>
        </div>
        <div class="round-chip">
          <div class="r-label">Runda</div>
          <div class="r-value">${String(game.round).padStart(2, '0')}<span class="of">/13</span></div>
        </div>
        <div class="player-chip you ${game.turn === 'self' ? 'active' : ''}">
          <div style="text-align:right">
            ${editingName ? html`
              <input
                class="p-name-input"
                type="text"
                maxlength="20"
                autofocus
                value=${selfName}
                placeholder="Twoje imię"
                onBlur=${(e) => { onSetName(e.target.value); setEditingName(false); }}
                onKeyDown=${(e) => { if (e.key === 'Enter' || e.key === 'Escape') e.target.blur(); }}
              />
            ` : html`
              <button
                class="p-name p-name-edit"
                onClick=${() => setEditingName(true)}
                title="Zmień imię"
              >${selfDisplay}<span class="edit-mark">✎</span></button>
            `}
            <div class="p-score">${selfTotal}</div>
          </div>
          <div class="p-avatar">${selfInitial}</div>
        </div>
      </div>

      <div class="card dice-card">
        <div class="turn-bar">
          <div class="turn-label ${game.turn === 'self' ? '' : 'theirs'}">
            ${game.turn === 'self' ? 'Twój ruch' : `Ruch ${peerDisplay === 'Przeciwnik' ? 'przeciwnika' : peerDisplay}`}
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

      ${onEndGame && html`
        <button class="btn ghost end-game-btn" onClick=${onEndGame}>
          Zakończ grę
        </button>
      `}
    </div>
  `;
}
