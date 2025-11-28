/*
===============================================================================
SCADA.Core.Loader
-------------------------------------------------------------------------------
Dynamically loads mimics, symbols, and defs modules on demand.
===============================================================================
*/
; (function (global) {
  const NS = global.SCADA.Core;

  const Loader = {
    _cache: { symbols: new Set(), defs: new Set() },
    _iframe: null,

    async loadSystem(systemType, systemName, args = {}) {
      // Special-case logging for standalone TREND
      if (systemType === 'TREND') {
        console.log(`🌀 Loading system: TREND`, args);
      } else {
        console.log(`🌀 Loading system: ${systemName}_${systemType}`);
      }

      // --- Step 1: Cleanup existing iframe ---
      this.unloadSystem();

      // --- Step 2: Paths (special-case TREND) ---
      let mimicPath, defPath = null, historyKey, titleKey;
      if (systemType === 'TREND') {
        mimicPath = `systems/TREND.html`;
        historyKey = 'TREND';
        titleKey = 'TREND';
      } else {
        mimicPath = `systems/${systemName}_${systemType}.html`;
        defPath = `defs/${systemType}.json`;
        historyKey = `${systemName}_${systemType}`;
        titleKey = historyKey;
      }

      // --- Step 3: Load defs once (skip for TREND) ---
      if (defPath && !this._cache.defs.has(defPath)) {
        try {
          const resp = await fetch(defPath);
          if (resp.ok) {
            const data = await resp.json();
            console.log(`📘 Loaded defs: ${defPath}`);
            this._cache.defs.add(defPath);
            global.SCADA.State.currentSystem = systemName;
            global.SCADA.State.currentDefs = data;
          }
        } catch (err) {
          console.warn(`⚠️ Failed to load defs: ${defPath}`, err);
        }
      } else if (defPath) {
        global.SCADA.State.currentSystem = systemName;
      }

      // --- Step 4: Create new iframe ---
      const iframe = document.createElement("iframe");
      iframe.id = "mimic-frame";
      iframe.src = mimicPath;
      iframe.style.cssText = "width:100%;height:100%;border:none;";

      /* ✅ Phase 9.2 Fix:
        preload PendingArgs *before* iframe.onload fires,
        so TREND.html’s trend.js sees the args immediately. */
      if (systemType === 'TREND') {
        window.SCADA.PendingArgs = args || {};
      }

      document.getElementById("mimic-container").appendChild(iframe);

      // keep a handle on the instance
      this._iframe = iframe;


      // --- Step 5: onload setup (title, subscriptions/history for real mimics, args for TREND) ---
      iframe.onload = () => {
        const inst = this._iframe;
        const currentSrc = (inst && inst.getAttribute("src")) || "";

        // Make parent SCADA visible inside child iframe (like mimicNav does)
        try {
          iframe.contentWindow.SCADA = window.SCADA;
        } catch (e) {
          console.warn("⚠️ Unable to share SCADA object to iframe:", e);
        }

        // Update title
        const titleEl = document.getElementById("mimicTitle");
        if (titleEl) {
          titleEl.textContent = (window.titleMap && window.titleMap[titleKey]) || titleKey;
        }

        // For normal system mimics, keep subscriptions/history behaviour
        if (systemType !== 'TREND' && currentSrc.startsWith("systems/")) {
          console.log(`✅ Mimic loaded: ${mimicPath}`);

          const sm = global.SCADA?.Core?.SocketManager;
          if (sm) {
            const sys = systemName.toUpperCase();
            sm.subscribe(`system:${sys}`, () => { });
            sm.subscribe("alarms", () => { });
            sm.subscribe("events", () => { });
            console.log(`📡 Auto-subscription active for system:${sys}`);
          }

          if (global.SCADA?.UI?.recordMimic) {
            if (window.__lastHistoryKey !== historyKey) {
              global.SCADA.UI.recordMimic(historyKey, () => {
                global.SCADA.Core.Loader.loadSystem(systemType, systemName);
              });
              window.__lastHistoryKey = historyKey;
              console.log(`🧭 History recorded → ${historyKey}`);
            }
          }
        } else {
          // TREND is a standalone page; record a clean history entry as TREND
          if (global.SCADA?.UI?.recordMimic) {
            if (window.__lastHistoryKey !== 'TREND') {
              global.SCADA.UI.recordMimic('TREND', () => {
                global.SCADA.Core.Loader.loadSystem('TREND', null, window.SCADA?.PendingArgs || {});
              });
              window.__lastHistoryKey = 'TREND';
              console.log(`🧭 History recorded → TREND`);
            }
          }
        }
      };
    },

    unloadSystem() {
      if (this._iframe) {
        console.log("♻️ Unloading previous mimic...");
        SCADA.Core.Bus?.emit('mimic:unloading', {
          system: SCADA.State?.currentSystem || '(unknown)',
        });
        SCADA.Test?.Regression?.log?.('Unloading mimic →', SCADA.State?.currentSystem);

        try {
          const sm = global.SCADA?.Core?.SocketManager;
          const sys = global.SCADA?.State?.currentSystem;
          if (sm && sys) {
            sm.unsubscribe(`system:${sys}`, () => { });
            sm.unsubscribe("alarms", () => { });
            sm.unsubscribe("events", () => { });
          }
        } catch (e) { }

        // --- Clean up PollManager subscribers before destroying iframe ---
        try {
          const PM = global.SCADA?.Core?.PollManager;
          if (PM && PM.clearAll) {
            PM.clearAll();
            console.log("🛑 Cleared all PollManager subscribers");
          }
        } catch (e) {
          console.warn("⚠️ Failed to clear PollManager subscribers:", e);
        }

        // --- Clean up all active symbols before unloading the mimic ---
        if (SCADA.Core && SCADA.Core.ActiveSymbols) {
          Object.entries(SCADA.Core.ActiveSymbols).forEach(([key, sym]) => {
            if (sym?.destroy) {
              try {
                console.log(`🔥 Destroying symbol: ${key}`);
                sym.destroy();
              } catch (err) {
                console.warn(`⚠️ Failed to destroy symbol ${key}`, err);
              }
            }
          });
          SCADA.Core.ActiveSymbols = {};
        }

        this._iframe.remove();
        this._iframe = null;
      }

      // 🧹 Always clear leftover content (e.g. alarm/event iframe) from mimic-container
      const container = document.getElementById("mimic-container");
      if (container) container.innerHTML = "";
    },
  };

  NS.Loader = Loader;
  console.log("✅ SCADA.Core.Loader registered (Phase 7.4)");
  SCADA.Test?.Regression?.log?.('Loader regression hook active');

})(window);
