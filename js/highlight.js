/*
===============================================================================
Highlight Manager (highlight.js)
-------------------------------------------------------------------------------
Registers DOM elements by equipment key (e.g. "SBT-TRA-SUP001") and flashes them
when Highlight.equipIfPending() is called.
Now exported under SCADA.Core.Highlight.
===============================================================================
*/

;(function (SCADA, global) {
  const registry = {}; // key -> array of DOM elements
  
  // Ensure highlight CSS exists in a specific document (parent or iframe)
  function ensureStyle(doc) {
    if (!doc) return;
    if (!doc.getElementById("highlight-style")) {
      const st = doc.createElement("style");
      st.id = "highlight-style";
      st.textContent = `
        .highlight-pulse {
          animation: highlightPulse 1s ease-out 0s 6;
        }
        @keyframes highlightPulse {
          0%   { filter: drop-shadow(0 0 0 rgba(33,150,243,0.0)); }
          50%  { filter: drop-shadow(0 0 10px rgba(255, 0, 200, 0.9)); }
          100% { filter: drop-shadow(0 0 0 rgba(33,150,243,0.0)); }
        }
      `;
      (doc.head || doc.documentElement).appendChild(st);
    }
  }

  const Highlight = {
    // Register a DOM element for a given equipment key
    register(key, el) {
      if (!key || !el) return;
      ensureStyle(el.ownerDocument);
      const ukey = key.toUpperCase();
      registry[ukey] = registry[ukey] || [];
      if (!registry[ukey].includes(el)) registry[ukey].push(el);
    },

    // Clear all registrations (e.g. when a mimic unloads)
    clear() {
      for (const k in registry) delete registry[k];
    },

    // Apply highlight if a pending key exists
    equipIfPending() {
      const key = global.__highlightEquipKey;
      if (!key) return;
      const ukey = key.toUpperCase();

      if (registry[ukey]) {
        registry[ukey].forEach(el => {
          ensureStyle(el.ownerDocument);
          el.classList.add("highlight-pulse");
          setTimeout(
            () => el.classList.remove("highlight-pulse"),
            SCADA.Core.Config?.PULSE_DURATION || 12000
          );
        });
        console.log("Highlighted", ukey);
      } else {
        console.warn("Highlight: no element registered for", ukey);
      }

      // consume
      global.__highlightEquipKey = null;
    }
  };

  // === New namespaced export ===
  SCADA.Core.Highlight = Highlight;

})(window.SCADA = window.SCADA || { Core:{}, Symbols:{}, UI:{}, State:{} }, window);
