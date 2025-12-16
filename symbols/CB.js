/*
===============================================================================
CIRCUIT BREAKER (CB) SYMBOL MODULE
===============================================================================
*/
// Requires: /symbols/baseSymbol.js

; (function (_SCADA, global) {
    const SCADA = window.parent?.SCADA || _SCADA;
    const NS = SCADA.Symbols = SCADA.Symbols || {};

    async function init(containerId, opts = {}) {
        const targetDoc = opts.doc || (window.frameElement?.contentDocument) || document;
        const wrap = targetDoc.getElementById(containerId);
        if (!wrap) throw new Error(`CB.init: container #${containerId} not found`);

        // Load SVG
        const res = await fetch("/symbols/CB.html");
        const svg = await res.text();
        wrap.innerHTML = svg;

        // Inject CSS
        if (!targetDoc.getElementById("cb-style")) {
            const st = targetDoc.createElement("style");
            st.id = "cb-style";
            st.textContent = `
        /* CB States (Rhombus) */
        .cb-body { stroke-width: 2px; transition: fill 0.3s, stroke 0.3s; }
        .cb-half { fill: #22c55e; transition: opacity 0.3s; }
        .cb-text { fill: #d946ef; font-weight: bold; pointer-events: none; }

        /* Default: Open (Green Stroke, No Fill) */
        .cb .cb-body { stroke: #22c55e; fill: none; }

        /* Closed: Green Fill */
        .cb.closed .cb-body { fill: #22c55e; stroke: #22c55e; }

        /* Open: (Default is already correct, but explicit) */
        .cb.open .cb-body { fill: none; stroke: #22c55e; }

        /* Transit: Half Fill */
        .cb.transit .cb-body { fill: none; stroke: #22c55e; }
        .cb.transit .cb-half { display: block !important; }

        /* DAC: Magenta Stroke + Text */
        .cb.dac .cb-body { stroke: #d946ef; fill: none; }
        .cb.dac .cb-text { display: block !important; }

        /* Trip: Red Fill */
        .cb.trip .cb-body { fill: #ef4444; stroke: #ef4444; }
        
        /* Trip Unack: Blink Red */
        .cb.trip-unack .cb-body { animation: cbBlinkRed 1s infinite; stroke: #ef4444; }
        
        @keyframes cbBlinkRed {
          0%, 100% { fill: #ef4444; }
          50%      { fill: #ffffff; }
        }
      `;
            targetDoc.head.appendChild(st);
        }

        // Interaction
        if (opts.faceplate) {
            wrap.style.cursor = "pointer";
            wrap.onclick = () => {
                if (SCADA?.UI?.Faceplate?.open) SCADA.UI.Faceplate.open(opts.faceplate);
            };
        }

        if (SCADA.Core?.BaseSymbol?.registerHighlight) {
            SCADA.Core.BaseSymbol.registerHighlight(wrap, opts.equipKey);
        }

        let lastVisualClass = "transit";
        let lastStatus = 0;
        let lastTrip = 0;

        function update(state) {
            const s = wrap.querySelector("svg");
            if (!s) return;
            if (!s.classList.contains("cb")) s.classList.add("cb");

            const prev = s.dataset.prevState;
            if (state === prev) return;
            s.dataset.prevState = state;

            s.classList.remove("open", "closed", "transit", "dac", "trip", "trip-unack");
            if (state) s.classList.add(state);
        }

        function showOverride(flag) {
            const target = wrap;
            if (SCADA.Core?.BaseSymbol?.manageOverride) {
                SCADA.Core.BaseSymbol.manageOverride(target, !!flag);
            }
        }

        function getVisualClass(data, alarms, loc) {
            if (!data || !alarms || !loc) return { visualClass: "transit" };

            let prefix = "";
            if (opts?.equipKey) {
                prefix = opts.equipKey.split("-").pop();
                // If we get just "001" but points are "CB001...", fix it:
                if (/^\d+$/.test(prefix)) prefix = "CB" + prefix;
            } else if (typeof containerId === "string") {
                const m = containerId.match(/CB(\d+)/i);
                if (m) prefix = `CB${m[1]}`;
            }

            // Points: Status (0-3), Trip (0-1)
            const statusPt = data.points.find(p => p.tag === `${prefix}.Status` && p.loc === loc);
            const tripPt = data.points.find(p => p.tag === `${prefix}.Trip` && p.loc === loc);
            const tripAlarm = alarms.find(a => a.tag === `${prefix}.Trip` && a.loc === loc);

            if (statusPt) lastStatus = Number(statusPt.value);
            if (tripPt) lastTrip = Number(tripPt.value);

            const isTripUnack = tripAlarm && (tripAlarm.ack === false || tripAlarm.acknowledged === false);

            let visualClass = "transit";

            if (lastTrip === 1) {
                visualClass = isTripUnack ? "trip-unack" : "trip";
            } else {
                switch (lastStatus) {
                    case 0: visualClass = "transit"; break;
                    case 1: visualClass = "closed"; break;
                    case 2: visualClass = "open"; break;
                    case 3: visualClass = "dac"; break;
                    default: visualClass = "transit";
                }
            }

            const override = (statusPt?.mo_i) || (tripPt?.mo_i);
            return { visualClass, status: statusPt, trip: tripPt, override };
        }

        const api = { update, showOverride, getVisualClass };
        SCADA.Core.ActiveSymbols = SCADA.Core.ActiveSymbols || {};
        SCADA.Core.ActiveSymbols[opts.equipKey || containerId] = api;

        if (!opts.noAutoRefresh) {
            const scope = "system:" + opts.loc;
            const callback = (msg) => {
                if (msg.type === "snapshot" || msg.type === "update") {
                    const allPoints = msg.points ? Object.values(msg.points) : (msg.diffs?.points?.changed ? Object.values(msg.diffs.points.changed) : []);
                    const equipPrefix = opts.equipKey.split("-").pop();
                    const relevant = allPoints.filter(p => p.tag.startsWith(equipPrefix));

                    if (!relevant.length) return;

                    const alarms = (msg.alarms && msg.alarms.length) ? msg.alarms : (SCADA.Core.AlarmManager?.getAlarms?.() || []);
                    const cls = getVisualClass({ points: relevant }, alarms, opts.loc);
                    update(cls.visualClass);
                }
            };

            SCADA.Core.SocketManager.subscribe(scope, callback);
            SCADA.Core.BaseSymbol.observeDestruction(wrap, () => {
                SCADA.Core.SocketManager.unsubscribe(scope, callback);
            });
            api.destroy = () => SCADA.Core.SocketManager.unsubscribe(scope, callback);
        }

        return api;
    }

    NS.CB = { init };
    console.log("✅ SCADA.Symbols.CB registered");

})(window.SCADA, window);
