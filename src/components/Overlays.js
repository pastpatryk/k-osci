import { html } from './html.js';

export function DisconnectOverlay({ seconds, onGiveUp }) {
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

export function ConfirmModal({ title, body, confirmLabel, cancelLabel, onCancel, onConfirm }) {
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
