/*
===============================================================================
PUMP SYMBOL MODULE — STABLE WITH SAFETY GUARD (2025-10)
...
*/
// Requires: /symbols/baseSymbol.js

; (function (_SCADA, global) {
  // Always use parent SCADA if available (Phase 6 fix)
  const SCADA = window.parent?.SCADA || _SCADA;
  const NS = SCADA.Symbols = SCADA.Symbols || {};


  async function init(containerId, opts = {}) {
    // Phase 6A – iframe-aware lookup
    // Use document passed in options, then iframe’s own document, then current one.
    const targetDoc =
      opts.doc ||
      (window.frameElement?.contentDocument) ||
      document;

    const wrap = targetDoc.getElementById(containerId);
    if (!wrap)
      throw new Error(
        `Pump.init: container #${containerId} not found in ${targetDoc === document ? "main" : "iframe"} context`
      );


    // fetch pump SVG (relative to systems/)
    const res = await fetch("/symbols/pump.html");
    const svg = await res.text();
    wrap.innerHTML = svg;

    // inject pump CSS once
    if (!targetDoc.getElementById("pump-style")) {
      const st = targetDoc.createElement("style");
      st.id = "pump-style";
      st.textContent = `
        /* normal states */
        .pump.running .pump-body { fill: #22c55e !important; }
        .pump.stopped .pump-body { fill: #cccccc !important; }
        .pump.trip .pump-body    { fill: #ef4444 !important; }

        /* blinking state */
        .pump.trip-unack .pump-body {
          animation: pumpBlinkRed 1s infinite;
        }

        @keyframes pumpBlinkRed {
          0%, 100% { fill: #ef4444; }
          50%      { fill: #ffffff; }
        }
      `;


      targetDoc.head.appendChild(st);
    }

    // optional faceplate click
    if (opts.faceplate) {
      wrap.style.cursor = "pointer";
      wrap.onclick = () => {
        if (SCADA?.UI?.Faceplate?.open) {
          SCADA.UI.Faceplate.open(opts.faceplate);
        } else {
          console.warn("⚠️ Faceplate.open() not found in namespace");
        }
      };
    }


    // Register highlight using BaseSymbol helper
    if (SCADA.Core?.BaseSymbol?.registerHighlight) {
      SCADA.Core.BaseSymbol.registerHighlight(wrap, opts.equipKey);
    }


    let lastVisualClass = "stopped";
    let lastRun = 0;
    let lastTrip = 0;
    let lastTripUnack = false;

    // API methods
    function update(state) {
      const s = wrap.querySelector("svg");
      if (!s) return;

      // Always keep the base class 'pump'
      if (!s.classList.contains("pump")) s.classList.add("pump");

      // --- Apply only when state actually changes ---
      const prev = s.dataset.prevState;
      if (state === prev) return;          // no change → skip repaint
      s.dataset.prevState = state;

      // Reset old dynamic classes, then add the new one
      s.classList.remove("running", "stopped", "trip", "trip-unack");
      if (state) s.classList.add(state);


    }

    function showOverride(flag) {
      // ensure we attach to the *container*, not into the <svg>
      const target = wrap; // wrapper DIV that contains the SVG
      if (SCADA.Core?.BaseSymbol?.manageOverride) {
        SCADA.Core.BaseSymbol.manageOverride(target, !!flag);
      }
    }

    // ---------------------------------------------
    // Internal helper: decide visual class for pump
    // ---------------------------------------------

    function getVisualClass(data, alarms, loc) {
      if (!data || !alarms || !loc) {
        // ignore early poll packets while symbol still initialising
        return { visualClass: "stopped" };
      }
      // Determine pump prefix from equipKey (e.g. NBT-TRA-SUP001 -> SUP001)
      // This supports the new derived tag schema (SUP001.RunFb)
      let prefix = "";
      if (opts?.equipKey) {
        prefix = opts.equipKey.split("-").pop();
      } else if (typeof containerId === "string") {
        // Fallback for legacy containers without equipKey
        const m = containerId.match(/pump(\d+)/i);
        if (m) prefix = `Pump${parseInt(m[1], 10)}`;
      }


      // Re-fetch points for correct pump
      const runPt = data.points.find(p => p.tag === `${prefix}.RunFb` && p.loc === loc);
      const tripPt = data.points.find(p => p.tag === `${prefix}.Trip` && p.loc === loc);

      // Find matching alarm
      const tripAlarm = alarms.find(a =>
        (a.tag === `${prefix}.Trip` || a.label === `${prefix}.Trip`) &&
        (!a.loc || a.loc.toUpperCase() === loc.toUpperCase())
      );

      if (runPt) lastRun = Number(runPt.value);
      if (tripPt) lastTrip = Number(tripPt.value);
      if (tripAlarm) lastTripUnack = (tripAlarm.ack === false || tripAlarm.acknowledged === false);

      // Determine visual class
      // running → green; stopped → grey; trip-unack → blinking red; trip → solid red
      let visualClass = lastVisualClass; // start from previous stable state

      // --- Trip takes highest priority ---
      if (lastTrip === 1) {
        // Trip active (real or overridden to 1)
        visualClass = lastTripUnack ? "trip-unack" : "trip";

        // --- Running ---
      } else if (lastRun === 1) {
        visualClass = "running";

        // --- Stopped (includes manual override healthy) ---
      } else {
        visualClass = "stopped";
      }




      // remember last valid state
      lastVisualClass = visualClass;

      return { visualClass, run: runPt, trip: tripPt };

    }
    const api = { update, showOverride, getVisualClass };
    SCADA.Core.ActiveSymbols = SCADA.Core.ActiveSymbols || {};
    SCADA.Core.ActiveSymbols[opts.equipKey || containerId] = api;


    console.log("[Pump] init opts:", opts);
    if (!opts.noAutoRefresh) {

      const scope = "system:" + opts.loc;
      const callback = (msg) => {
        if (msg.type === "snapshot" || msg.type === "update") {
          // flatten all changed points
          const allPoints = msg.points
            ? Object.values(msg.points)
            : msg.diffs?.points?.changed
              ? Object.values(msg.diffs.points.changed)
              : [];

          // --- filter only this pump’s tags ---
          const equipPrefix = opts.equipKey.split("-").slice(-1)[0]; // e.g. SUP001
          const relevant = allPoints.filter(
            p => p.equipType === "SUP" && p.equipId === equipPrefix.replace("SUP", "")
          );

          if (!relevant.length) return; // ignore unrelated WS diffs

          const data = { points: relevant };
          const alarms = (msg.alarms && msg.alarms.length)
            ? msg.alarms
            : (SCADA.Core.AlarmManager?.getAlarms?.() || []);

          const cls = getVisualClass(data, alarms, opts.loc);
          update(cls.visualClass);
        }
      };


      SCADA.Core.SocketManager.subscribe(scope, callback);
      console.log(`🔌 [Pump] subscribed via SocketManager to ${scope}`);

      const observer = SCADA.Core.BaseSymbol.observeDestruction(wrap, () => {
        SCADA.Core.SocketManager.unsubscribe(scope, callback);
      });

      api.destroy = () => {
        SCADA.Core.SocketManager.unsubscribe(scope, callback);
        if (observer) observer.disconnect();
      };

    }

    return api;

  }

  NS.Pump = { init };
  console.log("✅ SCADA.Symbols.Pump registered (Phase 5)");
})(window.SCADA, window);

