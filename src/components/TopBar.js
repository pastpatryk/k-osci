import { html } from './html.js';

export function TopBar({ status, phase }) {
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
