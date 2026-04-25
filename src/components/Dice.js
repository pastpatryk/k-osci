import { useRef } from 'https://esm.sh/preact@10.19.3/hooks';
import { html } from './html.js';

const DIE_FACES = {
  1: [[2, 2]],
  2: [[1, 1], [3, 3]],
  3: [[1, 1], [2, 2], [3, 3]],
  4: [[1, 1], [1, 3], [3, 1], [3, 3]],
  5: [[1, 1], [1, 3], [2, 2], [3, 1], [3, 3]],
  6: [[1, 1], [1, 3], [2, 1], [2, 3], [3, 1], [3, 3]],
};

function Die({ value, held, interactive, rollingKey, onClick }) {
  const rotRef = useRef('rotateX(0deg) rotateY(0deg)');
  const prevKey = useRef(rollingKey);
  if (rollingKey !== prevKey.current) {
    prevKey.current = rollingKey;
    if (!held) {
      const x = (Math.floor(Math.random() * 3) + 1) * 360;
      const y = (Math.floor(Math.random() * 3) + 1) * 360;
      rotRef.current = `rotateX(${x}deg) rotateY(${y}deg)`;
    }
  }

  return html`
    <div class="die-wrap">
      <button
        class="die ${held ? 'held' : ''} ${interactive ? '' : 'locked'}"
        onClick=${interactive ? onClick : undefined}
        aria-label=${`Kostka ${value}${held ? ', zablokowana' : ''}`}
      >
        <div class="die-face" style=${{ transform: rotRef.current }}>
          ${DIE_FACES[value].map(([r, c], i) => html`
            <span key=${i} class="pip" style=${{ gridRow: r, gridColumn: c }}></span>
          `)}
        </div>
      </button>
      <div class="hold-label ${held ? '' : 'empty'}">TRZYMAJ</div>
    </div>
  `;
}

export function DiceTray({ dice, rollingKey, interactive, onToggleHold }) {
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
