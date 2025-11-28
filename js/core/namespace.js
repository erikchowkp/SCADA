/*
===============================================================================
Namespace Initialisation (namespace.js)
-------------------------------------------------------------------------------
Ensures a single global SCADA object exists, providing isolated containers for
Core modules, UI components, reusable Symbols, and runtime State variables.
===============================================================================
*/
;(function (global) {
  global.SCADA = global.SCADA || {
    Core: {},     // Polling, Timer, Config, BaseSymbol, etc.
    Symbols: {},  // Pump, Pit, Selector, AITextB, etc.
    UI: {},       // Faceplate, AlarmBanner, AISetting, etc.
    State: {}     // Current mimic state, selected location, etc.
  };
})(window);

console.log("✅ SCADA Namespace initialised (Phase 5)");
