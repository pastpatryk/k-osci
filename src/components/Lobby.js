import { useMemo, useState } from 'https://esm.sh/preact@10.19.3/hooks';
import { html } from './html.js';
import { Flourish } from './Flourish.js';

export function Lobby({ role, selfId, status, started, selfName, peerName, onSetName, onCreate, onCancelRoom, onStart, tally }) {
  const joinUrl = useMemo(() => {
    if (!selfId) return '';
    const base = `${location.origin}${location.pathname}`;
    return `${base}?join=${selfId}`;
  }, [selfId]);

  const [copied, setCopied] = useState(false);

  const smartShare = async () => {
    if (!joinUrl) return;
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'K·OŚCI',
          text: 'Zagrajmy w kości:',
          url: joinUrl,
        });
        return;
      } catch (_) {}
    }
    await copyUrl();
  };

  const copyUrl = async () => {
    try {
      await navigator.clipboard.writeText(joinUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (_) {}
  };

  return html`
    <div class="lobby">
      <${Flourish} />
      <div class="kicker">
        2 graczy<span class="dot-sep">·</span>WERKA STYLE
      </div>

      <div class="hero">
        <h1>Rzuć<em>kośćmi.</em></h1>
        <p>Kogo dziś ograsz?</p>
      </div>

      <div class="name-field">
        <label for="own-name">Twoje imię</label>
        <input
          id="own-name"
          type="text"
          maxlength="20"
          placeholder="np. Werka"
          value=${selfName}
          onInput=${(e) => onSetName(e.target.value)}
        />
      </div>

      ${role === 'host' && !started && html`
        <button class="btn primary" onClick=${onCreate}>
          Stwórz pokój
        </button>
        <div class="kicker" style="text-align:center">
          Klik — i lecimy.
        </div>
      `}

      ${role === 'host' && started && html`
        <div class="id-card">
          <div class="label">Twój identyfikator</div>
          <div class="label-sub">podaj go znajomemu</div>
          <div class="id-row">
            <div class="peer-id">${selfId || '—'}</div>
            <div class="host-chip">GOSPODARZ</div>
          </div>
          <div class="url-row">
            <svg class="link-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
            </svg>
            <input readonly value=${joinUrl} onClick=${(e) => e.target.select()} />
          </div>
        </div>

        <div class="actions">
          <button class="btn primary" onClick=${smartShare} disabled=${!joinUrl}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
              <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
              <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
              <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
            </svg>
            <span>${navigator.share ? 'Udostępnij' : (copied ? 'Skopiowano' : 'Kopiuj')}</span>
          </button>
          <button class="btn ghost" onClick=${copyUrl} disabled=${!joinUrl}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
              <rect x="9" y="9" width="13" height="13" rx="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
            <span>${copied ? 'Skopiowano' : 'Kopiuj'}</span>
          </button>
        </div>

        ${status !== 'connected' ? html`
          <div class="waiting-card">
            <div class="spinner"></div>
            <div>
              <div class="wait-title">Czekam na przeciwnika…</div>
              <div class="wait-sub">udostępnij link, żeby zacząć</div>
            </div>
          </div>
        ` : html`
          <button class="btn primary" onClick=${onStart}>
            Rozpocznij grę${peerName ? ` z ${peerName}` : ''}
          </button>
        `}

        <button class="btn ghost" onClick=${onCancelRoom}>
          Zamknij pokój
        </button>
      `}

      ${role === 'guest' && !started && html`
        <button class="btn primary" onClick=${onCreate}>
          Dołącz${selfName ? ` jako ${selfName}` : ''}
        </button>
        <div class="kicker" style="text-align:center">
          Klik — i gramy.
        </div>
      `}

      ${role === 'guest' && started && html`
        <div class="waiting-card">
          <div class="spinner"></div>
          <div>
            <div class="wait-title">${
              status === 'connecting' ? 'Łączenie z gospodarzem…' :
              status === 'connected'  ? 'Czekam, aż gospodarz rozpocznie…' :
              status === 'waiting'    ? 'Ponawiam połączenie…' :
                                        'Połączenie nie powiodło się'
            }</div>
            <div class="wait-sub">${status === 'connected' ? 'zaraz zaczniemy' : 'poczekaj chwilę'}</div>
          </div>
        </div>
      `}

      ${(tally.self + tally.peer) > 0 && html`
        <div class="kicker" style="text-align:left">
          Sesja <span class="dot-sep">·</span> ty ${tally.self} <span class="dot-sep">·</span> przeciwnik ${tally.peer}
        </div>
      `}
    </div>
  `;
}
