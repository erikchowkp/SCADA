// Requires: /symbols/baseSymbol.js

; (function (SCADA, global) {
  const NS = SCADA.Symbols = SCADA.Symbols || {};

  async function init(containerId, opts = {}) {
    // Phase 6A — use the iframe's DOM if provided
    const targetDoc = opts.doc || document;
    const wrap = targetDoc.getElementById(containerId);

    if (!wrap) throw new Error(`Selector.init: container #${containerId} not found`);

    // Load selector SVG
    const res = await fetch("/symbols/selector.html");
    const svg = await res.text();
    wrap.innerHTML = svg;

    // --- Update labels based on selector type ---
    const isModeSelector = containerId.toLowerCase().includes("mode") || (opts?.type === "mode");
    const svgEl = wrap.querySelector("svg");
    if (svgEl) {
      const leftLabel = svgEl.querySelector(".label-left");
      const rightLabel = svgEl.querySelector(".label-right");
      if (isModeSelector) {
        if (leftLabel) leftLabel.textContent = "Auto";
        if (rightLabel) rightLabel.textContent = "Manual";
      } else {
        if (leftLabel) leftLabel.textContent = "Remote";
        if (rightLabel) rightLabel.textContent = "Local";
      }
    }

    // Faceplate click (Phase 5)
    if (opts.faceplate) {
      wrap.style.cursor = "pointer";
      wrap.onclick = () => {
        if (SCADA.UI?.Faceplate?.open) {
          SCADA.UI.Faceplate.open(opts.faceplate);
        }
      };
    }


    // Register highlight using BaseSymbol
    if (SCADA.Core?.BaseSymbol?.registerHighlight) {
      SCADA.Core.BaseSymbol.registerHighlight(wrap, opts.equipKey);
    }


    // ------------------------------------------------------
    // Helper: apply selector visual class
    // ------------------------------------------------------
    function setSelectorState(svg, state) {
      if (!svg) return;
      svg.classList.remove("auto", "manual", "remote", "local");
      if (state) svg.classList.add(state);
    }

    // API
    function update(state) {
      const s = wrap.querySelector("svg");
      if (!s) return;
      setSelectorState(s, state);
    }

    function showOverride(flag) {
      if (SCADA.Core?.BaseSymbol?.manageOverride) {
        SCADA.Core.BaseSymbol.manageOverride(wrap, !!flag);
      }
    }

    function getVisualClass(data, loc, tag) {
      const pt = data.points?.find?.(p => p.tag === tag && p.loc === loc);
      if (!pt) return { state: null, override: false, point: null };

      let state = null;
      if (tag.includes("Mode")) {
        state = pt.value === 0 ? "auto" : "manual";
      } else if (tag.includes("LocalRemote")) {
        state = pt.value === 0 ? "remote" : "local";
      }

      return {
        state,
        override: pt.mo_i || false,
        point: pt
      };
    }

    const api = { update, showOverride, getVisualClass };
    SCADA.Core.ActiveSymbols = SCADA.Core.ActiveSymbols || {};
    SCADA.Core.ActiveSymbols[opts.equipKey || containerId] = api;

    // --- Shared polling subscription (Phase 2) ---
    if (!opts.noAutoRefresh) {
      const scope = "system:" + opts.loc;
      const callback = (msg) => {
        if (msg.type === "snapshot" || msg.type === "update") {
          const data = msg.points ? { points: Object.values(msg.points) } : msg.data || msg;
          const tag = opts.tag || (containerId.includes("Mode") ? "Panel.Mode" : "Panel.LocalRemote");
          const pt = data.points?.find?.(p => p.tag === tag && p.loc === opts.loc);
          if (pt) {
            const newState =
              tag.includes("Mode") ? (pt.value === 0 ? "auto" : "manual") :
                tag.includes("LocalRemote") ? (pt.value === 0 ? "remote" : "local") : null;
            if (newState) update(newState);
            if (pt.mo_i !== undefined) showOverride(pt.mo_i);
          }
        }
      };

      SCADA.Core.SocketManager.subscribe(scope, callback);
      console.log(`🔌 [Selector] subscribed via SocketManager to ${scope}`);

      api.destroy = () => {
        SCADA.Core.SocketManager.unsubscribe(scope, callback);
        console.warn(`🔥 [Selector] destroy() called for ${scope}`);
      };


    }

    return api;
  }

  NS.Selector = { init };
  console.log("✅ SCADA.Symbols.Selector registered (Phase 5)");
})(window.SCADA, window);

