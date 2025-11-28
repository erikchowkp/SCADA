/*
===============================================================================
SCADA.Core.SocketManager  (Phase 7.2)
-------------------------------------------------------------------------------
Handles WebSocket connection to backend /ws endpoint.
Implements subscribe/unsubscribe, heartbeat, auto-reconnect, and hybrid fallback.
On snapshot/update, it feeds SCADA.Core.PollManager so existing mimics refresh.
===============================================================================
*/

; (function (global) {
  if (!global.SCADA) global.SCADA = { Core: {}, Symbols: {}, UI: {}, State: {} };
  const NS = global.SCADA.Core = global.SCADA.Core || {};

  const RECONNECT_BASE = 2000;
  const RECONNECT_MAX = 15000;
  const HEARTBEAT_MS = 10000;

  const SocketManager = {
    _latestSnapshot: new Map(),   // scope -> last snapshot msg
    _ws: null,
    _connected: false,
    _reconnectDelay: RECONNECT_BASE,
    _subscriptions: new Map(), // scope -> Set<callback>
    _scopes: new Set(),        // Set<string>
    _heartbeatTimer: null,
    _reconnectTimer: null,
    _lastPong: Date.now(),

    connect() {
      const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
      const url = `${scheme}://${location.host}/ws`;
      console.log('🔌 SCADA.SocketManager connecting to', url);
      this._emitStateChange('CONNECTING');

      try {
        this._ws = new WebSocket(url);
      } catch (err) {
        console.error('WebSocket init failed', err);
        return this._scheduleReconnect();
      }

      this._ws.onopen = () => {
        if (SCADA.Core?.PollManager) {
          SCADA.Core.PollManager.stop();
        }

        this._connected = true;
        this._reconnectDelay = RECONNECT_BASE;
        console.log('✅ SCADA.SocketManager connected');
        this._emitStateChange('OPEN');

        // Hello
        this._send({ type: 'hello', project: 'SCADA', version: 7, clientId: Date.now() });

        // --- FIX: ALWAYS subscribe to alarms & events FIRST ---
        this._send({ type: "subscribe", scopes: ["alarms"] });
        this._send({ type: "subscribe", scopes: ["events"] });

        // --- Then re-subscribe all saved scopes ---
        if (this._scopes.size > 0) {
          this._send({ type: 'subscribe', scopes: Array.from(this._scopes) });
        }

        this._startHeartbeat();
      };


      this._ws.onmessage = (evt) => {
        let msg;
        try { msg = JSON.parse(evt.data); } catch { return; }
        console.log("WS-FRAME-RAW", new Date().toISOString(), msg);
        console.log("WS:", msg);
        this._handleMessage(msg);
      };



      this._ws.onclose = () => {
        console.warn('⚠️ WebSocket closed');
        this._emitStateChange('CLOSED');
        this._connected = false;
        this._stopHeartbeat();
        this._scheduleReconnect();
      };

      this._ws.onerror = (err) => {
        this._emitStateChange('ERROR');
        this._ws.close();
      };
    },

    _send(obj) {
      if (this._ws && this._ws.readyState === WebSocket.OPEN) {
        this._ws.send(JSON.stringify(obj));
      }
    },

    _handleMessage(msg) {
      // 🎯 ALARM-RELATED FRAME DETECTOR
      if (msg?.alarms || msg?.type === "alarms" || msg?.type === "alarm") {
        console.log("WS-ALARM-FRAME", new Date().toISOString(), msg);
      }
      switch (msg.type) {
        case 'welcome':
          // no-op
          break;

        case 'snapshot': {

          msg.scopes?.forEach(s => this._latestSnapshot.set(s, msg));
          this._notify(msg.scopes, msg);
          break;
        }

        case 'update': {
          // Forward diffs to PollManager
          //try { NS.PollManager?.applyDiffs?.(msg.diffs); } catch (e) { console.warn(e); }
          // Notify all scope subscribers (we don't know exact scope set from server)
          this._notify(null, msg);
          break;
        }

        case 'pong':
          this._lastPong = Date.now();
          break;

        case 'echo': {
          const rttMs = performance.now() - (_lastEchoStart || performance.now());
          SCADA.Core.Bus?.emit('socket:echo', { rttMs, serverTs: msg.ts });
          return;
        }

        default:
          // Optionally handle server-side errors/pings here
          // console.debug('Unhandled WS message', msg);
          break;
      }
    },

    // === Phase 7.3: Connection state event system ============================
    _socketListeners: new Set(),

    onStateChange(callback) {
      this._socketListeners.add(callback);
    },
    _offStateChange(callback) {
      this._socketListeners.delete(callback);
    },
    _emitStateChange(state) {
      try {
        for (const cb of this._socketListeners) cb(state);
      } catch (e) {
        console.error(e);
      }
    },

    _startHeartbeat() {
      clearInterval(this._heartbeatTimer);
      this._lastPong = Date.now();
      this._heartbeatTimer = setInterval(() => {
        if (!this._connected) return;
        const now = Date.now();
        if (now - this._lastPong > HEARTBEAT_MS * 2) {
          console.warn('Heartbeat timeout → reconnect');
          try { this._ws.close(); } catch { }
          return;
        }
        this._send({ type: 'ping', ts: now });
      }, HEARTBEAT_MS);
    },

    _stopHeartbeat() { clearInterval(this._heartbeatTimer); },

    _scheduleReconnect() {
      if (this._reconnectTimer) return;
      const delay = this._reconnectDelay;
      console.log(`⏳ Reconnecting in ${delay} ms`);
      this._reconnectTimer = setTimeout(() => {
        this._reconnectTimer = null;
        this._reconnectDelay = Math.min(this._reconnectDelay * 2, RECONNECT_MAX);
        this.connect();
      }, delay);
    },

    // ─── Public API ──────────────────────────────────────────────────────────
    subscribe(scope, cb) {
      if (!this._subscriptions.has(scope)) this._subscriptions.set(scope, new Set());
      this._subscriptions.get(scope).add(cb);
      this._scopes.add(scope);
      if (this._connected) this._send({ type: 'subscribe', scopes: [scope] });
    },

    unsubscribe(scope, cb) {
      const set = this._subscriptions.get(scope);
      if (set) {
        set.delete(cb);
        if (set.size === 0) {
          this._subscriptions.delete(scope);
          this._scopes.delete(scope);
          if (this._connected) this._send({ type: 'unsubscribe', scopes: [scope] });
        }
      }
    },

    _notify(scopes, msg) {
      // Only deliver to the scopes included in the message.
      // If scopes is null (update frame), deliver to all subscribers—but ONLY
      // if that subscriber's scope actually appears in msg.scopes.
      const targets = scopes ? scopes : (msg.scopes || []);  // <--- FIX (use the server's scopes)

      for (const s of targets) {
        const cbs = this._subscriptions.get(s);
        if (cbs) {
          for (const fn of cbs) {
            try {
              const enriched = {
                ...msg,
                alarms: msg.alarms ?? SCADA.Core.AlarmManager.getAlarms(),
                events: msg.events ?? []
              };
              // 🟡 TRACE PIT ALARM FLOW
              if (enriched.alarms) {
                const pitAlarms = Object.entries(enriched.alarms)
                  .filter(([tag, a]) => tag.includes("PIT"));
                if (pitAlarms.length > 0) {
                  console.log("WS-PIT-ALARM-DIFF", new Date().toISOString(), pitAlarms);
                }
              }

              fn(enriched);
            } catch (e) {
              console.error(e);
            }
          }
        }
      }
    },



    getConnectionState() {
      if (!this._ws) return 'DISCONNECTED';
      switch (this._ws.readyState) {
        case WebSocket.CONNECTING: return 'CONNECTING';
        case WebSocket.OPEN: return 'OPEN';
        case WebSocket.CLOSING: return 'CLOSING';
        case WebSocket.CLOSED: return 'CLOSED';
      }
    },

    // === Snapshot hydration helper ==========================================
    getLatestSnapshot(scope) {
      return this._latestSnapshot.get(scope) || null;
    }
  };

  NS.SocketManager = SocketManager;

  // --- Ensure alarms/events scopes are subscribed BEFORE connect ---
  SocketManager.subscribe("alarms", () => { });
  SocketManager.subscribe("events", () => { });


  SocketManager.connect();
  // --- Diagnostic helpers for teardown verification ---
  SocketManager.countSubscribers = function () {
    try {
      let total = 0;
      for (const [scope, set] of this._subscriptions.entries()) {
        total += set.size;
      }
      console.log(`🧮 Active WS subscriber callbacks: ${total}`);
      return total;
    } catch (err) {
      console.warn("countSubscribers() failed:", err);
      return -1;
    }
  };

  SocketManager.listSubscribers = function () {
    try {
      const out = {};
      for (const [scope, set] of this._subscriptions.entries()) {
        out[scope] = Array.from(set).map(fn => fn.name || "anonymous");
      }
      console.log("🔍 Active WS subscribers:", out);
      return out;
    } catch (err) {
      console.warn("listSubscribers() failed:", err);
      return {};
    }
  };

  console.log('✅ SCADA.Core.SocketManager registered (Phase 7.2)');



})(window);

