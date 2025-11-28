/*
===============================================================================
SCADA.UI.ConnectionStatus
-------------------------------------------------------------------------------
Displays 🟢 Live / 🔴 Offline badge reflecting WebSocket connection state.
===============================================================================
*/
;(function (global) {
  if (!global.SCADA) global.SCADA = { Core: {}, Symbols: {}, UI: {}, State: {} };
  const NS = global.SCADA.UI = global.SCADA.UI || {};

  const ConnectionStatus = {
    _el: null,
    _current: 'UNKNOWN',

    init() {
      // Insert badge into header or banner
      this._el = document.createElement('span');
      this._el.id = 'connection-status';
      this._el.style.cssText = `
      margin-left: 12px;
      font-size: 14px;
      font-weight: bold;
      font-family: sans-serif;
      `;
       this.update('INIT');

      // ⬇️ Insert right next to the user/time clock in header
      const header = document.querySelector('header div:last-child');
      if (header) {
      header.appendChild(this._el);
      } else {
      document.body.appendChild(this._el); // fallback
      }


      // Listen to SocketManager connection changes
      const sm = global.SCADA?.Core?.SocketManager;
      if (sm && sm.onStateChange) {
        sm.onStateChange((state) => this.update(state));
        // initialise with current state
        this.update(sm.getConnectionState && sm.getConnectionState());
      } else {
        console.warn('ConnectionStatus: SocketManager not found');
      }
    },

    update(state) {
      const open = state === 'OPEN';
      const text = open ? '🟢 Live' : '🔴 Offline';
      const color = open ? 'green' : 'red';
      this._current = open ? 'LIVE' : 'OFFLINE';
      if (this._el) {
        this._el.textContent = text;
        this._el.style.color = color;
      }
    }
  };

  NS.ConnectionStatus = ConnectionStatus;
  document.addEventListener('DOMContentLoaded', () => ConnectionStatus.init());
  console.log('✅ SCADA.UI.ConnectionStatus registered (Phase 7.3)');

})(window);
