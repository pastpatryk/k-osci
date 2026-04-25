// PeerJS wrapper. Knows nothing about game rules.
// Exposes a small event-emitter-like API used by app.js.

import { Peer } from 'https://esm.sh/peerjs@1.5.4?bundle';

// --- Friendly peer ID generation ---
// Creates short, memorable IDs like "WISNIA-914" to replace UUIDs in share URLs.
const FRIENDLY_WORDS = [
  'PEONIA', 'LILIA', 'IRYS', 'JASMIN', 'ROZA', 'TULIPAN',
  'MAGNOLIA', 'FIOLEK', 'MAK', 'BEZ', 'BRZOZA', 'KLON',
  'BAMBUS', 'BUK', 'LIPA', 'WIERZBA', 'WISNIA', 'JABLON',
  'SOSNA', 'LAS', 'LAKA', 'OGROD', 'RZEKA', 'KAMIEN',
  'MGLA', 'CHMURA', 'SNIEG', 'DESZCZ', 'SWIT', 'WIATR',
  'ROSA', 'SLONCE', 'GWIAZDA', 'PLATEK', 'KWIAT', 'LISC',
  'ZURAW', 'BOCIAN', 'WROBEL', 'JASKOLKA',
];

function generateFriendlyId() {
  const word = FRIENDLY_WORDS[Math.floor(Math.random() * FRIENDLY_WORDS.length)];
  const num = String(Math.floor(Math.random() * 900) + 100); // 100..999
  return `${word}-${num}`;
}

// Validate incoming ?join= IDs — must be our friendly format OR a PeerJS UUID (fallback).
export function isValidPeerId(id) {
  if (!id || typeof id !== 'string') return false;
  if (/^[A-Z]+-\d{3}$/.test(id)) return true;
  // UUID fallback
  return /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id);
}

const LISTENERS = Symbol('listeners');

class Emitter {
  constructor() { this[LISTENERS] = new Map(); }
  on(event, fn) {
    if (!this[LISTENERS].has(event)) this[LISTENERS].set(event, new Set());
    this[LISTENERS].get(event).add(fn);
    return () => this.off(event, fn);
  }
  off(event, fn) {
    this[LISTENERS].get(event)?.delete(fn);
  }
  emit(event, payload) {
    const set = this[LISTENERS].get(event);
    if (!set) return;
    for (const fn of set) {
      try { fn(payload); } catch (e) { console.error(`[net] listener error on '${event}':`, e); }
    }
  }
}

export class NetClient extends Emitter {
  constructor() {
    super();
    this.peer = null;
    this.conn = null;
    this.selfId = null;
    this.targetId = null; // id we're trying to reach (guest only)
    this.role = 'host';
    this.reconnectTimer = null;
  }

  // Create the Peer. Emits 'self-id' when the PeerJS server assigns one.
  // Pass a preferredId to attempt to register under a known ID (used for refresh-resume).
  init(preferredId, attempt = 0) {
    const id = preferredId || generateFriendlyId();
    this.peer = new Peer(id, {
      debug: 2,
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
          { urls: 'stun:stun.cloudflare.com:3478' },
          // Public free TURN (OpenRelay) — relays traffic through metered.ca when P2P fails.
          {
            urls: 'turn:openrelay.metered.ca:80',
            username: 'openrelayproject',
            credential: 'openrelayproject',
          },
          {
            urls: 'turn:openrelay.metered.ca:443',
            username: 'openrelayproject',
            credential: 'openrelayproject',
          },
          {
            urls: 'turn:openrelay.metered.ca:443?transport=tcp',
            username: 'openrelayproject',
            credential: 'openrelayproject',
          },
        ],
        iceCandidatePoolSize: 4,
      },
    });

    this.peer.on('open', (id) => {
      console.log('[net] peer open, selfId=', id);
      this.selfId = id;
      this.emit('self-id', id);
    });

    this.peer.on('connection', (conn) => {
      console.log('[net] incoming connection from', conn.peer);
      this._attachConn(conn);
    });

    this.peer.on('disconnected', () => {
      console.warn('[net] peer disconnected from signalling');
      try { this.peer.reconnect(); } catch (_) {}
      this.emit('status', 'waiting');
    });

    this.peer.on('error', (err) => {
      console.warn('[net] peer error:', err && err.type, err && err.message);
      // On friendly-id collision (unavailable-id), retry a handful of times.
      if (err && err.type === 'unavailable-id' && attempt < 5) {
        try { this.peer.destroy(); } catch (_) {}
        // Drop the preferredId on retry — fall back to a fresh friendly ID.
        setTimeout(() => this.init(undefined, attempt + 1), 200);
        return;
      }
      this.emit('error', err);
    });
  }

  // Guest side: initiate a connection to the given host id.
  connect(hostId) {
    this.role = 'guest';
    this.targetId = hostId;
    this.emit('status', 'connecting');
    this._dial();
  }

  // Host side: no dial — just wait for incoming 'connection' event.
  host() {
    this.role = 'host';
    this.emit('status', 'idle');
  }

  _dial() {
    if (!this.peer || !this.targetId) return;
    try {
      const conn = this.peer.connect(this.targetId, { reliable: true });
      this._attachConn(conn);
    } catch (e) {
      console.warn('[net] dial failed:', e);
    }
  }

  _attachConn(conn) {
    this.conn = conn;
    console.log('[net] attaching conn, peer=', conn.peer, 'type=', conn.type);
    conn.on('open', () => {
      console.log('[net] conn OPEN with', conn.peer);
      this._clearReconnect();
      this.emit('status', 'connected');
      this.emit('open', { peerId: conn.peer });
    });
    conn.on('data', (msg) => {
      this.emit('message', msg);
    });
    conn.on('close', () => {
      console.log('[net] conn CLOSE');
      this.emit('status', 'waiting');
      this.emit('close');
      this._scheduleReconnect();
    });
    conn.on('error', (err) => {
      console.warn('[net] conn error:', err);
      this.emit('error', err);
    });
    // Surface ICE state + candidates if the underlying RTCPeerConnection exists.
    const attachPc = () => {
      const pc = conn.peerConnection;
      if (!pc) return false;
      pc.addEventListener('iceconnectionstatechange', () => {
        console.log('[net] iceConnectionState=', pc.iceConnectionState);
      });
      pc.addEventListener('connectionstatechange', () => {
        console.log('[net] connectionState=', pc.connectionState);
      });
      pc.addEventListener('icegatheringstatechange', () => {
        console.log('[net] iceGatheringState=', pc.iceGatheringState);
      });
      pc.addEventListener('icecandidate', (e) => {
        if (e.candidate) {
          const c = e.candidate;
          console.log(
            '[net] local candidate:',
            c.type, c.protocol, c.address || '(hidden)', c.port, 'priority=', c.priority
          );
        } else {
          console.log('[net] candidate gathering complete');
        }
      });
      pc.addEventListener('icecandidateerror', (e) => {
        console.warn('[net] icecandidateerror:', e.errorCode, e.errorText, e.url);
      });
      return true;
    };
    if (!attachPc()) {
      // pc might be lazily created in some PeerJS code paths; retry shortly.
      setTimeout(attachPc, 100);
    }
  }

  _scheduleReconnect() {
    if (this.role !== 'guest') return; // host just waits passively
    if (this.reconnectTimer) return;
    this.reconnectTimer = setInterval(() => {
      if (this.conn && this.conn.open) {
        this._clearReconnect();
        return;
      }
      this._dial();
    }, 5000);
  }

  _clearReconnect() {
    if (this.reconnectTimer) {
      clearInterval(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  send(type, payload) {
    if (!this.conn || !this.conn.open) {
      console.warn('[net] send dropped — no open conn:', type);
      return false;
    }
    this.conn.send({ type, payload, ts: Date.now() });
    return true;
  }

  close() {
    this._clearReconnect();
    try { this.conn?.close(); } catch (_) {}
    try { this.peer?.destroy(); } catch (_) {}
    this.conn = null;
    this.peer = null;
  }
}
