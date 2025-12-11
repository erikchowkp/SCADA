/*
===============================================================================
Highlight Manager (highlight.js)
-------------------------------------------------------------------------------
Registers DOM elements by equipment key (e.g. "SBT-TRA-SUP001") and flashes them
when Highlight.equipIfPending() is called.
Now exported under SCADA.Core.Highlight.
===============================================================================
*/

; (function (SCADA, global) {
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
      const localKey = global.__highlightEquipKey;
      const parentKey = global.parent ? global.parent.__highlightEquipKey : null;
      const key = localKey || parentKey;

      if (!key) return;
      const ukey = key.toUpperCase();

      let target = registry[ukey];

      // fallback: try stripping alpha prefix from last segment (e.g. TFAN001 -> 001)
      if (!target) {
        const parts = ukey.split('-');
        if (parts.length > 0) {
          const last = parts[parts.length - 1];
          const numericPart = last.replace(/^[A-Z]+/, '');
          if (numericPart && numericPart !== last) {
            const altKey = [...parts.slice(0, -1), numericPart].join('-');
            if (registry[altKey]) {
              console.log(`Highlight: Fuzzy match ${ukey} -> ${altKey}`);
              target = registry[altKey];
            }
          }
        }
      }

      if (target) {
        target.forEach(el => {
          ensureStyle(el.ownerDocument);
          el.classList.add("highlight-pulse");
          setTimeout(
            () => el.classList.remove("highlight-pulse"),
            SCADA.Core.Config?.PULSE_DURATION || 12000
          );
        });
        console.log("Highlighted", ukey);

        // Consume from source
        if (key === localKey) global.__highlightEquipKey = null;
        else if (key === parentKey && global.parent) global.parent.__highlightEquipKey = null;

      } else {
        // Only warn if we checked local and failed, or if we really expected it
        if (key === localKey) console.warn("Highlight: no element registered for", ukey);
      }
    }
  };

  // === New namespaced export ===
  SCADA.Core.Highlight = Highlight;

})(window.SCADA = window.SCADA || { Core: {}, Symbols: {}, UI: {}, State: {} }, window);
