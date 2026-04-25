import { html } from './html.js';
import {
  CATEGORIES,
  scoreCategory,
  upperSubtotal,
  upperBonus,
  grandTotal,
} from '../game.js';
import { CATEGORY_LABELS, UPPER } from './labels.js';

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

export function Scorecard({ game, previewCategory, setPreviewCategory, interactive, onBank }) {
  const sc = game.scorecards.self;
  const pc = game.scorecards.peer;
  const upperSub = upperSubtotal(sc);
  const peerUpperSub = upperSubtotal(pc);
  const uBonus = upperBonus(sc);
  const peerBonus = upperBonus(pc);
  const yBonusPts = (sc.yahtzeeBonusCount || 0) * 100;
  const peerYBonus = (pc.yahtzeeBonusCount || 0) * 100;
  const grand = grandTotal(sc);
  const peerGrand = grandTotal(pc);

  const renderRow = (cat) => {
    const banked = sc[cat];
    const peerBanked = pc[cat];
    const isBanked = banked !== null;
    const peerIsBanked = peerBanked !== null;
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
              : html`<span class="r-tap" style="color:var(--muted-soft)">—</span>`
          }
        </div>
        <div class="r-peer ${peerIsBanked ? '' : 'empty'}">
          ${peerIsBanked ? peerBanked : '—'}
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

      <div class="sc-col-head">
        <div></div>
        <div>Ty</div>
        <div>Przec.</div>
      </div>

      <div class="sc-rows">
        ${UPPER.map(renderRow)}
      </div>

      <div class="sc-divider">Dół</div>

      <div class="sc-rows">
        ${CATEGORIES.filter((c) => !UPPER.includes(c)).map(renderRow)}
      </div>

      <div class="sc-totals">
        <div class="lbl"></div>
        <div class="hdr">Ty</div>
        <div class="hdr">Przec.</div>
        <div class="lbl">Góra</div>
        <div class="val">${upperSub}</div>
        <div class="val peer">${peerUpperSub}</div>
        <div class="lbl">Bonus</div>
        <div class="val">${uBonus}</div>
        <div class="val peer">${peerBonus}</div>
        ${(yBonusPts > 0 || peerYBonus > 0) && html`
          <div class="lbl">Premia Yahtzee</div>
          <div class="val">${yBonusPts > 0 ? `+${yBonusPts}` : '—'}</div>
          <div class="val peer">${peerYBonus > 0 ? `+${peerYBonus}` : '—'}</div>
        `}
        <div class="lbl grand">Suma</div>
        <div class="val grand">${grand}</div>
        <div class="val grand peer">${peerGrand}</div>
      </div>
    </div>
  `;
}
