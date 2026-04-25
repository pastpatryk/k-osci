import { html } from './html.js';
import { MAX_ROLLS, grandTotal } from '../game.js';
import { pluralRzut } from './labels.js';
import { DiceTray } from './Dice.js';
import { Scorecard } from './Scorecard.js';

export function Game({ state, rollingKey, previewCategory, setPreviewCategory, onRoll, onToggleHold, onBank }) {
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
