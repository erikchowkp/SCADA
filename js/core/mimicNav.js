/*
===============================================================================
Phase 6A – Dynamic Mimic Loader (iframe swap)
Ensures only one mimic instance exists at a time.
===============================================================================
*/
;(function (global) {
  const SCADA = global.SCADA || (global.SCADA = { Core:{}, UI:{}, Symbols:{}, State:{} });

  function initMimicNavigation() {
    document.getElementById("mimicPanel")?.remove();
    const frame = document.getElementById('mimicFrame');
    const links = document.querySelectorAll('#system-nav .system-link');
    const locButtons = document.querySelectorAll('.sidebar button');
    locButtons.forEach(btn => {
    btn.addEventListener('click', e => {
        locButtons.forEach(b => b.disabled = false);
        btn.disabled = true;
        const newLoc = btn.textContent.trim();
        SCADA.State.currentLocation = newLoc;
        console.log(`📍 Location changed → ${newLoc}`);
    });
    });


    if (!frame || !links.length) return;
    function injectGlobalStyles(frame) {
        try {
            // share namespace
            frame.contentWindow.SCADA = window.SCADA;

            const targetDoc = frame.contentDocument;
            if (!targetDoc || !targetDoc.head) {
              // iframe not ready yet — retry after a short delay
              setTimeout(() => injectGlobalStyles(frame), 100);
              return;
            }
            const parentBodyStyle = getComputedStyle(document.body);
            const styleEl = targetDoc.createElement("style");
            styleEl.id = "global-font-style";
            styleEl.textContent = `
            html, body, button, input, select, textarea, div, span {
                font-family: ${parentBodyStyle.fontFamily};
                font-size: ${parentBodyStyle.fontSize};
                color: ${parentBodyStyle.color};
            }
            body { background-color: ${parentBodyStyle.backgroundColor}; }
            `;
            targetDoc.head.appendChild(styleEl);

        } catch (err) {
            console.warn("⚠️ Could not inject SCADA fonts/colors on initial load:", err);
        }
    }

    links.forEach(a => {
      a.addEventListener('click', (e) => {
        e.preventDefault();
        const system = a.getAttribute('data-system');
        if (!system) return;

        // Determine current location (from sidebar selection or default)
        const loc = SCADA.State.currentLocation || 'NBT';

        // Compose full mimic filename (e.g. NBT_TRA.html)
        const file = `${loc}_${system}`;

        SCADA.State.currentSystem = system.replace(/\.html$/,'');
        SCADA.State.currentLocation = loc;

        frame.src = `systems/${file}`;

        // Wait for the new mimic to finish loading before injecting globals
        frame.onload = () => injectGlobalStyles(frame);

        console.log(`🔄 Mimic iframe swapped → ${file}`);
        // --- Phase 6B: record mimic in navigation history (so Back/Forward works)
        try {
          if (window.SCADA?.UI?.recordMimic) {
            window.SCADA.UI.recordMimic(file.replace(/\.html$/, ""), () => {
              const frame = document.getElementById("mimicFrame");
              if (frame) frame.src = `systems/${file}`;
            });
            console.log(`📜 History recorded → ${file}`);
          }
        } catch (e) {
          console.warn("⚠️ Could not record mimic history:", e);
        }

        // === Update mimic title using centralised titleMap ===
        try {
          const titleEl = document.getElementById("mimicTitle");
          if (titleEl) {
            const loc = SCADA.State.currentLocation || "NBT";
            const key = `${loc}_${system.replace(/\.html$/, "")}`;
            const map = window.titleMap || {}; // fallback if variable not global
            const newTitle = map[key] || map[system.replace(/\.html$/, "")] || key;
            titleEl.textContent = newTitle;
          }
        } catch (err) {
          console.warn("⚠️ Could not update mimic title:", err);
        }


        // update footer active link
        links.forEach(l => l.classList.remove('active'));
        a.classList.add('active');
      });
    });

    // --- Phase 6A: reliable global style injection ---
    function ensureGlobalStyles() {
      try {
        if (!frame.contentDocument) return;
        injectGlobalStyles(frame);
      } catch (e) {
        console.warn("⚠️ Global CSS injection retry:", e);
      }
    }

    // Always run once immediately after DOM ready
    if (frame) {
      // 1) Try immediately (in case iframe already finished)
      ensureGlobalStyles();

      // 2) Always run on load event (in case it wasn’t ready yet)
      frame.addEventListener("load", ensureGlobalStyles);

      // 3) Retry once more after 500 ms for late paints
      setTimeout(ensureGlobalStyles, 500);
    }

    // --- Set initial title on first load ---
    try {
      const titleEl = document.getElementById("mimicTitle");
      if (titleEl && window.titleMap) {
        const initialLoc = SCADA.State.currentLocation || "NBT";
        const initialSys = "TRA"; // your default system when first opened
        const key = `${initialLoc}_${initialSys}`;
        titleEl.textContent = window.titleMap[key] || key;
      }
    } catch (err) {
      console.warn("⚠️ Could not set initial mimic title:", err);
    }


  }

  // expose to namespace
  SCADA.Core.initMimicNavigation = initMimicNavigation;
})(window);

// auto-initialise after DOM loaded
document.addEventListener('DOMContentLoaded', () => {
  window.SCADA?.Core?.initMimicNavigation?.();
});
