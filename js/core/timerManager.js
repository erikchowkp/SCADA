/*
===============================================================================
Timer Manager (timerManager.js)
-------------------------------------------------------------------------------
Centralised registration & cleanup of all setInterval / setTimeout timers.
Now exported under SCADA.Core.TimerManager.
===============================================================================
*/

;(function (SCADA, global) {
  const timers = {};

  const TimerManager = {
    register(name, id) {
      if (timers[name]) clearInterval(timers[name]);
      timers[name] = id;
      if (SCADA.Core.Config?.LOG)
        console.log(`⏱️ TimerManager: registered '${name}'`);
    },
    clear(name) {
      if (timers[name]) clearInterval(timers[name]);
      delete timers[name];
    },
    
    // ✅ Phase 5 helper: check if a timer is registered
    has(name) {
    return !!timers[name];
    },

    clearAll() {
      Object.keys(timers).forEach(n => clearInterval(timers[n]));
      for (const n in timers) delete timers[n];
      if (SCADA.Core.Config?.LOG)
        console.log("🧹 TimerManager: cleared all intervals");
    }
  };

  // === New namespaced export ===
  SCADA.Core.TimerManager = TimerManager;

})(window.SCADA = window.SCADA || { Core:{}, Symbols:{}, UI:{}, State:{} }, window);
