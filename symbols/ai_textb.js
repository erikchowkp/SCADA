// Requires: /symbols/baseSymbol.js

; (function (SCADA, global) {
  const NS = SCADA.Symbols = SCADA.Symbols || {};



  // Keep track of points that have returned to normal but are not yet acknowledged
  const clearedUnacked = {};

  async function init(containerId, opts = {}) {
    // Phase 6A — use the iframe's DOM if provided
    const targetDoc = opts.doc || document;
    const wrap = targetDoc.getElementById(containerId);

    if (!wrap) throw new Error(`AI_TEXTB.init: container #${containerId} not found`);

    const loc = opts.loc || "UNK";
    const sys = opts.sys || "UNK";
    const equipType = opts.equipType || "FLO";
    const equipId = opts.equipId || "001";
    const faceplate = `${loc}-${sys}-${equipType}-${equipId}`;
    const equipKey = `${loc}-${sys}-${equipType}${equipId}`;
    const unit = opts.unit || "";

    // Load SVG
    const res = await fetch("/symbols/ai_textb.html");
    wrap.innerHTML = await res.text();

    // Ensure container has ai_textb class for animation CSS
    wrap.classList.add("ai_textb");

    // --- Unified override flag handler ---
    function showOverride(flag) {
      SCADA.Core.BaseSymbol.manageOverride(wrap, flag);
    }



    // Unit text
    const unitEl = wrap.querySelector("#aiUnit");
    if (unit && unitEl) unitEl.textContent = unit;

    // Click → faceplate
    wrap.style.cursor = "pointer";
    wrap.onclick = () => {
      console.log("🟢 openFaceplate called with:", faceplate);
      if (SCADA.UI.Faceplate?.open)
        SCADA.UI.Faceplate.open(faceplate);
    };

    // Register highlight using BaseSymbol helper
    SCADA.Core.BaseSymbol.registerHighlight(wrap, equipKey);


    // Inject colour rules
    if (!targetDoc.getElementById("ai_textb-style")) {
      const st = targetDoc.createElement("style");
      st.textContent = `
        .ai_textb.normal #bg { fill:#ffffff; }
        .ai_textb.warn #bg, .ai_textb.warn_low #bg { fill:#eab308; } /* Crit 1 */
        .ai_textb.high #bg, .ai_textb.low #bg { fill:#f97316; }      /* Crit 2 */
        .ai_textb.hh #bg, .ai_textb.ll #bg { fill:#ef4444; }         /* Crit 3 */
        .ai_textb text { fill:#000000; }
        
        /* --- Flash between alarm colour and white --- */
        @keyframes flashWarn  { 0%,100% { fill:#eab308; } 50% { fill:#ffffff; } }  /* Crit 1 yellow */
        @keyframes flashHigh  { 0%,100% { fill:#f97316; } 50% { fill:#ffffff; } }  /* Crit 2 orange */
        @keyframes flashHH    { 0%,100% { fill:#ef4444; } 50% { fill:#ffffff; } }  /* Crit 3 red */
        @keyframes flashNorm  { 0%,100% { fill:#ffffff; } 50% { fill:#088d39; } }  /* Green flash when cleared */


        .ai_textb.flash-warn #bg,
        .ai_textb.flash-warn_low #bg { animation: flashWarn 1s infinite; }
        .ai_textb.flash-high #bg,
        .ai_textb.flash-low #bg { animation: flashHigh 1s infinite; }
        .ai_textb.flash-hh #bg,
        .ai_textb.flash-ll #bg { animation: flashHH 1s infinite; }
        .ai_textb.flash-normal #bg { animation: flashNorm 1s infinite; }
      `;
      targetDoc.head.appendChild(st);
    }

    // --- State tracking for rendering ---
    let lastState = "normal";

    // --- Update API ---
    function update(value, limits = {}, decimals = 2, flashClass = null) {
      const valEl = wrap.querySelector("#aiValue");
      if (!valEl) return;

      const v = parseFloat(value);
      if (isNaN(v)) {
        valEl.textContent = "--";
        wrap.classList.remove(
          "normal", "warn", "high", "hh", "warn_low", "low", "ll",
          "flash-warn", "flash-high", "flash-hh",
          "flash-warn_low", "flash-low", "flash-ll", "flash-normal"
        );
        wrap.classList.add("normal");
        lastState = "normal";
        return;
      }

      valEl.textContent = v.toFixed(decimals);

      const { warn, high, hh, warn_low, low, ll } = limits;
      let state = "normal";

      // --- High side ---
      if (hh != null && v >= hh) state = "hh";
      else if (high != null && v >= high) state = "high";
      else if (warn != null && v >= warn) state = "warn";

      // --- Low side ---
      else if (ll != null && v <= ll) state = "ll";
      else if (low != null && v <= low) state = "low";
      else if (warn_low != null && v <= warn_low) state = "warn_low";

      // --- Remove all previous style classes ---
      wrap.classList.remove(
        "normal", "warn", "high", "hh", "warn_low", "low", "ll",
        "flash-warn", "flash-high", "flash-hh",
        "flash-warn_low", "flash-low", "flash-ll", "flash-normal"
      );

      // Apply visual class
      wrap.classList.add(state);

      // Apply flash if provided (from getVisualClass)
      if (flashClass) {
        wrap.classList.add(flashClass);
      }

      // --- Save last state ---
      lastState = state;
    }

    // --- Get Visual Class (for page-managed mode) ---
    function getVisualClass(data, alarms, loc) {
      // Normalize data to array
      let pointsArray = [];
      if (Array.isArray(data?.points)) {
        pointsArray = data.points;
      } else if (data?.points && typeof data.points === "object") {
        pointsArray = Object.values(data.points);
      }

      // Find the point
      const pt = pointsArray.find(
        p => (p.tag === `${equipType}${equipId}` ||
          p.tag === `${equipType}${equipId}.Value`) &&
          (!p.loc || p.loc === loc)
      );

      if (!pt) return {
        value: null,
        limits: {},
        decimals: 1,
        visualClass: 'normal',
        flash: null,
        override: false,
        point: null
      };

      const { value, warn, high, hh, warn_low, low, ll, mo_i } = pt;
      const limits = { warn, high, hh, warn_low, low, ll };

      // Calculate visual state
      const v = parseFloat(value);
      let visualClass = 'normal';

      if (!isNaN(v)) {
        // High side
        if (hh != null && v >= hh) visualClass = 'hh';
        else if (high != null && v >= high) visualClass = 'high';
        else if (warn != null && v >= warn) visualClass = 'warn';
        // Low side  
        else if (ll != null && v <= ll) visualClass = 'll';
        else if (low != null && v <= low) visualClass = 'low';
        else if (warn_low != null && v <= warn_low) visualClass = 'warn_low';
      }

      // Check alarm state for flashing
      const related = alarms?.filter?.(
        a => a.loc === loc && a.sys === sys && a.label === `${equipType}${equipId}`
      );
      const isActive = related?.some?.(a => a.state === "Active");
      const isCleared = related?.some?.(a => a.state === "Cleared");
      const isAcked = related?.some?.(a => a.ack === true);

      let flash = null;
      if (isActive && !isAcked) flash = `flash-${visualClass}`;
      else if (isCleared && !isAcked) flash = 'flash-normal';

      return {
        value: v,
        limits,
        decimals: 1,
        visualClass,
        flash,
        override: mo_i || false,
        point: pt
      };
    }

    // --- Define API object ---
    const api = { update, showOverride, getVisualClass };
    SCADA.Core.ActiveSymbols = SCADA.Core.ActiveSymbols || {};
    SCADA.Core.ActiveSymbols[equipKey] = api;


    // --- Optional internal refresh loop ---
    if (!opts.noAutoRefresh) {

      // --- Universal data handler (works for WS + PollManager cache) ---
      const updateFromShared = (data, alarms) => {
        // Normalise: PollManager → array, WebSocket → object map
        let pointsArray = [];
        if (Array.isArray(data?.points)) {
          pointsArray = data.points;
        } else if (data?.points && typeof data.points === "object") {
          pointsArray = Object.entries(data.points).map(([key, val]) => ({
            ...val,
            tag: val?.tag || key.split(".").slice(1).join("."), // e.g. "FLO001.Value"
            loc: val?.loc || key.split(".")[0],                  // e.g. "NBT"
          }));
        }

        // Try both "FLO001" and "FLO001.Value" naming
        const pt = pointsArray.find(
          p =>
            (p.tag === `${equipType}${equipId}` ||
              p.tag === `${equipType}${equipId}.Value`) &&
            (!p.loc || p.loc === loc)
        );

        // Toggle M badge based on SCADA point's mo_i (same approach as pit.js)
        showOverride(!!pt?.mo_i);

        if (pt && api.update) {
          const { value, warn, high, hh, warn_low, low, ll } = pt;
          api.update(value, { warn, high, hh, warn_low, low, ll }, 1, alarms);
        }
      };

      // --- Direct WebSocket subscription ---
      const sm = SCADA.Core.SocketManager;
      const scope = `system:${loc}`;

      const onMsg = (msg) => {
        // Some SocketManager versions wrap the actual frame inside msg.data
        const payload = msg.data && msg.data.type ? msg.data : msg;

        // --- Full snapshot from server ---
        if (payload.type === "snapshot") {
          updateFromShared({ points: payload.points || {} }, payload.alarms || []);
          return;
        }

        // --- Incremental update frame ---
        if (payload.type === "update" && payload.diffs) {
          const changed = payload.diffs.points?.changed || {};
          const added = payload.diffs.points?.added || {};
          const merged = { ...changed, ...added };
          const alarms =
            payload.diffs.alarms?.updated ||
            payload.diffs.alarms?.added ||
            [];

          if (Object.keys(merged).length > 0) {
            updateFromShared({ points: merged }, alarms);
          }
        }
      };


      sm.subscribe(scope, onMsg);
      // Remember the moment we subscribed, to ignore spurious early DOM churn
      const _subscribedAt = Date.now();

      // --- Apply cached data immediately if available (for initial render) ---
      const cache = SCADA.Core.PollManager?.getCache?.();
      if (cache?.data && cache?.alarms) {
        updateFromShared(cache.data, cache.alarms);
      }

      // Manual destroy() for safety
      api.destroy = () => {
        sm.unsubscribe(scope, onMsg);
        console.warn(`🔥 [AI_TEXTB] destroy() called for ${scope}`);
      };

    }


    return api;

  }

  NS.AI_TEXTB = { init };
  console.log("✅ SCADA.Symbols.AITextB registered (Phase 5)");
})(window.SCADA, window);

