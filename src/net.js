// PeerJS wrapper. Knows nothing about game rules.
// Exposes a small event-emitter-like API used by app.js.

import { Peer } from 'https://esm.sh/peerjs@1.5.4?bundle';

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
  init() {
    this.peer = new Peer(undefined, { debug: 1 });

    this.peer.on('open', (id) => {
      this.selfId = id;
      this.emit('self-id', id);
    });

    this.peer.on('connection', (conn) => {
      // Incoming (host accepting a guest)
      this._attachConn(conn);
    });

    this.peer.on('disconnected', () => {
      // Lost connection to signalling server; try to reconnect.
      try { this.peer.reconnect(); } catch (_) {}
      this.emit('status', 'waiting');
    });

    this.peer.on('error', (err) => {
      console.warn('[net] peer error:', err && err.type, err && err.message);
      this.emit('error', err);
      // "peer-unavailable" is common during reconnect attempts; don't crash.
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
    conn.on('open', () => {
      this._clearReconnect();
      this.emit('status', 'connected');
      this.emit('open', { peerId: conn.peer });
    });
    conn.on('data', (msg) => {
      this.emit('message', msg);
    });
    conn.on('close', () => {
      this.emit('status', 'waiting');
      this.emit('close');
      this._scheduleReconnect();
    });
    conn.on('error', (err) => {
      console.warn('[net] conn error:', err);
      this.emit('error', err);
    });
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
