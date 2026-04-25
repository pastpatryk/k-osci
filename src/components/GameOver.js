import { html } from './html.js';
import { CATEGORIES, upperSubtotal, upperBonus, grandTotal } from '../game.js';
import { CATEGORY_LABELS, UPPER } from './labels.js';
import { Flourish } from './Flourish.js';

export function GameOver({ state, onRematch, onBackToLobby }) {
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
