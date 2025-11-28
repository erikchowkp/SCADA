/*
===============================================================================
SCADA Core Configuration (config.js)
-------------------------------------------------------------------------------
Central location for constants and tunable parameters used throughout the SCADA.
Now exported under SCADA.Core.Config (with backward shim SCADA_CONFIG).
===============================================================================
*/

/*
===============================================================================
SCADA Core Configuration (config.js)
-------------------------------------------------------------------------------
Central location for constants and tunable parameters used throughout the SCADA.
Now exported under SCADA.Core.Config (with backward shim SCADA_CONFIG).
===============================================================================
*/

; (function (SCADA, global) {
  // --- Core configuration values ---
  const Config = {
    POLL_INTERVAL: 2000,   // ms — system mimic refresh
    ALARM_INTERVAL: 2000,  // ms — alarm & event list refresh
    PULSE_DURATION: 12000, // ms — highlight flash duration
    LOG: true,             // toggle for debug console logs
    BROWSER: 'edge',       // default browser for testing (edge/chrome)
    DISABLE_POLLING: false  // when true, use WebSocket-only mode (no polling)
  };

  // --- Namespace registration ---
  SCADA.Core.Config = Config;

  console.log("✅ SCADA.Core.Config registered (Phase 1)");

})(window.SCADA = window.SCADA || { Core: {}, Symbols: {}, UI: {}, State: {} }, window);
