/*
===============================================================================
Base Symbol Helper (2025-10)
-------------------------------------------------------------------------------
Centralised utilities shared by all symbol modules (pump, pit, selector, etc.)

Provides:
  • Highlight registration  → consistent and safe
  • Override flag handling  → unified UI rule
  • DOM cleanup observation → prevents memory leaks

Now exported under SCADA.Core.BaseSymbol.
===============================================================================
*/

; (function (SCADA, global) {
  const BaseSymbol = {};

  // ---------------------------------------------------------------------------
  // Register Highlight target safely (delayed if not yet ready)
  // ---------------------------------------------------------------------------
  BaseSymbol.registerHighlight = function (wrap, equipKey) {
    if (!equipKey || !wrap) return;
    const tryRegister = () => {
      const Highlight = SCADA.Core?.Highlight || global.Highlight;
      if (Highlight && typeof Highlight.register === "function") {
        Highlight.register(equipKey, wrap);
      } else {
        setTimeout(tryRegister, 100); // try again later
      }
    };
    tryRegister();
  };


  // ---------------------------------------------------------------------------
  // Add or remove Manual Override flag (M badge) — classic fixed position
  // ---------------------------------------------------------------------------
  BaseSymbol.manageOverride = function (wrap, flag) {
    if (!wrap) return;

    // Always anchor badge inside the symbol wrapper itself
    let badge = wrap.querySelector(".override-flag");

    // ensure wrapper can contain absolutely positioned badge
    const style = getComputedStyle(wrap);
    if (style.position === "static") wrap.style.position = "relative";

    if (flag) {
      if (!badge) {
        const doc = wrap.ownerDocument;
        // Inject style once per document (iframe-safe)
        if (!doc.getElementById("override-flag-style")) {
          const st = doc.createElement("style");
          st.id = "override-flag-style";
          st.textContent = `
        .override-flag {
          position: absolute;
          top: -8px;
          right: -8px;
          background: yellow;
          border: 1px solid red;
          color: red;
          font-weight: bold;
          font-size: 10px;
          padding: 0 3px;
          border-radius: 3px;
          z-index: 1000;
          line-height: 1;
          pointer-events: none;
        }
      `;
          doc.head.appendChild(st);
          console.log("Adding badge to", wrap.id);

        }

        badge = doc.createElement("div");
        badge.className = "override-flag";
        badge.textContent = "M";
        wrap.appendChild(badge);

      }
      badge.style.display = "block";

    } else if (badge) {
      badge.remove();
    }
  };



  // ---------------------------------------------------------------------------
  // Automatically unsubscribe symbol when DOM element removed
  // ---------------------------------------------------------------------------
  BaseSymbol.observeDestruction = function (wrap, unsubscribe) {
    if (!wrap || typeof unsubscribe !== "function") return;

    // Check if element is in document when observer is created
    if (!document.body.contains(wrap)) {
      return;
    }

    let timer = null;
    let isDestroyed = false;

    const observer = new MutationObserver(() => {
      // Simple check: is the element still in the document?
      const inDocument = document.body.contains(wrap);

      if (!inDocument && !isDestroyed) {
        // Element removed: wait to see if it comes back
        if (!timer) {
          timer = setTimeout(() => {
            // Final check before destroying
            if (!document.body.contains(wrap)) {
              isDestroyed = true;
              unsubscribe();
              observer.disconnect();
            }
            timer = null;
          }, 500);
        }
      } else if (inDocument && timer) {
        // Element came back, cancel destruction
        clearTimeout(timer);
        timer = null;
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
    return observer;
  };

  // ---------------------------------------------------------------------------
  // Namespace registration
  // ---------------------------------------------------------------------------
  SCADA.Core.BaseSymbol = BaseSymbol;

  // (Phase 5) legacy shim removed — use SCADA.Core.BaseSymbol only

  console.log("✅ SCADA.Core.BaseSymbol registered (Phase 1)");

})(window.SCADA = window.SCADA || { Core: {}, Symbols: {}, UI: {}, State: {} }, window);
