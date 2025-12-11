/*
===============================================================================
TFAN SYMBOL MODULE (Tunnel Fan)
===============================================================================
*/
; (function (_SCADA, global) {
    const SCADA = window.parent?.SCADA || _SCADA;
    const NS = SCADA.Symbols = SCADA.Symbols || {};

    async function init(containerId, opts = {}) {
        const targetDoc = opts.doc || (window.frameElement?.contentDocument) || document;
        const wrap = targetDoc.getElementById(containerId);
        if (!wrap) throw new Error(`TFan.init: container #${containerId} not found`);

        // fetch SVG
        const res = await fetch("/symbols/tfan.html");
        const svg = await res.text();
        wrap.innerHTML = svg;

        // inject CSS
        if (!targetDoc.getElementById("tfan-style")) {
            const st = targetDoc.createElement("style");
            st.id = "tfan-style";
            st.textContent = `
        /* --- VISUAL STATES --- */

        /* COMMON DEFAULTS */
        .tfan svg { overflow: visible; }
        #fanbody, #amtri, #fwtri, #bwtri {
            stroke-width: 1px;
            transition: all 0.2s;
            vector-effect: non-scaling-stroke;
        }

        /* Default for Editor (No classes) */
        #amtri, #fwtri, #bwtri { fill: #ffffff; stroke: #000000; }
        #fanbody { fill: #ffffff; stroke: #000000; stroke-width: 2px; }

        /* --------------------------------------------------------- 
           1. GLOBAL STROKE (OUTLINE) COLORS
           Matches status: Running=Green, Stop=Black, Trip=Red
        --------------------------------------------------------- */
        .tfan.running #fanbody, .tfan.running #amtri, .tfan.running #fwtri, .tfan.running #bwtri { stroke: #22c55e; }
        .tfan.stopped #fanbody, .tfan.stopped #amtri, .tfan.stopped #fwtri, .tfan.stopped #bwtri { stroke: #000000; }
        .tfan.trip    #fanbody, .tfan.trip    #amtri, .tfan.trip    #fwtri, .tfan.trip    #bwtri { stroke: #ef4444; }
        
        .tfan.trip-unack #fanbody, .tfan.trip-unack #amtri, .tfan.trip-unack #fwtri, .tfan.trip-unack #bwtri { 
            animation: blinkStrokeRed 1s infinite; 
        }

        /* --------------------------------------------------------- 
           2. AM TRIANGLE (#amtri) FILL
           - Auto: Filled with Status Color.
           - Manual: White Fill (Unfilled).
        --------------------------------------------------------- */
        
        /* Auto Mode - Fill matches stroke */
        .tfan.auto.running #amtri { fill: #22c55e; }
        .tfan.auto.stopped #amtri { fill: #000000; }
        .tfan.auto.trip    #amtri { fill: #ef4444; }
        .tfan.auto.trip-unack #amtri { animation: blinkFillStrokeRed 1s infinite; }

        /* Manual Mode - Always White Fill */
        .tfan.manual #amtri { fill: #ffffff; } 
        /* Stroke is handled by Global Stroke rules above */


        /* --------------------------------------------------------- 
           3. DIRECTION TRIANGLES FILL
           - Active Direction: Filled Green (if Running).
           - Inactive: White Fill.
        --------------------------------------------------------- */

        /* Default Inactive Fill */
        #fwtri, #bwtri { fill: #ffffff; }

        /* Running FWD -> fwtri Green Fill */
        .tfan.running.fwd #fwtri { fill: #22c55e; }

        /* Running BWD -> bwtri Green Fill */
        .tfan.running.bwd #bwtri { fill: #22c55e; }

        /* Running FWD -> fwtri Green */
        .tfan.running.fwd #fwtri { fill: #22c55e; stroke: #22c55e; }

        /* Running BWD -> bwtri Green */
        .tfan.running.bwd #bwtri { fill: #22c55e; stroke: #22c55e; }


        /* --------------------------------------------------------- 
           3. FAN BODY (#fanbody)
        --------------------------------------------------------- */
        #fanbody { fill: #ffffff; stroke-width: 2px; }

        .tfan.running #fanbody { stroke: #22c55e; }
        .tfan.stopped #fanbody { stroke: #000000; }
        .tfan.trip    #fanbody { stroke: #ef4444; }
        .tfan.trip-unack #fanbody { animation: blinkStrokeRed 1s infinite; }


        /* --------------------------------------------------------- 
           ANIMATIONS 
        --------------------------------------------------------- */
        @keyframes blinkFillStrokeRed {
          0%, 100% { fill: #ef4444; stroke: #ef4444; }
          50%      { fill: #ffffff; stroke: #ef4444; }
        }
        @keyframes blinkStrokeRed {
          0%, 100% { stroke: #ef4444; }
          50%      { stroke: #cccccc; }
        }
      `;
            targetDoc.head.appendChild(st);
        }

        if (opts.faceplate) {
            wrap.style.cursor = "pointer";
            wrap.onclick = () => {
                if (SCADA?.UI?.Faceplate?.open) SCADA.UI.Faceplate.open(opts.faceplate);
            };
        }

        if (SCADA.Core?.BaseSymbol?.registerHighlight) {
            SCADA.Core.BaseSymbol.registerHighlight(wrap, opts.equipKey);
        }

        let lastStateHash = "";

        function update(visualState) {
            // visualState: { mode: 'auto'|'manual', status: 'running'|'stopped'|'trip'|'trip-unack', dir: 'fwd'|'bwd' }
            const s = wrap.querySelector("svg");
            if (!s) return;
            if (!s.classList.contains("tfan")) s.classList.add("tfan");

            // Sort keys to ensure hash consistency if obj creation varies (not really needed but safe)
            // Actually simpler: just use values if order guaranteed
            const hash = `${visualState.mode} -${visualState.status} -${visualState.dir} `;
            if (hash === lastStateHash) return;
            lastStateHash = hash;

            // Clean classes
            s.classList.remove("auto", "manual", "running", "stopped", "trip", "trip-unack", "fwd", "bwd");

            // Apply new
            s.classList.add(visualState.mode || "manual");
            s.classList.add(visualState.status || "stopped");
            if (visualState.dir) s.classList.add(visualState.dir);
        }

        function showOverride(flag) {
            const target = wrap;
            if (SCADA.Core?.BaseSymbol?.manageOverride) {
                SCADA.Core.BaseSymbol.manageOverride(target, !!flag);
            }
        }

        function getVisualClass(data, alarms, loc) {
            if (!data || !alarms || !loc) return { visualClass: {} };

            let prefix = "";
            if (opts?.equipKey) {
                // e.g. NBT-TVEN-TFAN001 -> TFAN001
                prefix = opts.equipKey.split("-").pop();
            }

            // Points
            const runPt = data.points.find(p => p.tag === `${prefix}.RunFb` && p.loc === loc);
            const dirPt = data.points.find(p => p.tag === `${prefix}.Direction` && p.loc === loc);
            const modePt = data.points.find(p => p.tag === `${prefix}.Mode` && p.loc === loc);
            const tripPt = data.points.find(p => p.tag === `${prefix}.Trip` && p.loc === loc);

            // Alarms
            const tripAlarm = alarms.find(a =>
                (a.tag === `${prefix}.Trip` || a.label === `${prefix}.Trip`) &&
                (!a.loc || a.loc.toUpperCase() === loc.toUpperCase())
            );

            // Values
            const isRun = runPt ? Number(runPt.value) === 1 : false;
            const isTrip = tripPt ? Number(tripPt.value) === 1 : false;
            const isAuto = modePt ? Number(modePt.value) === 1 : false; // 1=Auto
            const isBwd = dirPt ? Number(dirPt.value) === 1 : false; // 1=Backward (Assumed)

            const isTripUnack = (tripAlarm && (tripAlarm.ack === false || tripAlarm.acknowledged === false));

            // Determine State
            let status = "stopped";
            if (isTrip) status = isTripUnack ? "trip-unack" : "trip";
            else if (isRun) status = "running";

            let mode = isAuto ? "auto" : "manual";
            let dir = isBwd ? "bwd" : "fwd";

            // Result
            return {
                visualClass: { mode, status, dir },
                run: runPt,
                trip: tripPt,
                mode: modePt,
                dir: dirPt
            };
        }

        const api = { update, showOverride, getVisualClass };
        SCADA.Core.ActiveSymbols = SCADA.Core.ActiveSymbols || {};
        SCADA.Core.ActiveSymbols[opts.equipKey || containerId] = api;

        if (!opts.noAutoRefresh) {
            const scope = "system:" + opts.loc;
            const callback = (msg) => {
                if (msg.type === "snapshot" || msg.type === "update") {
                    const allPoints = msg.points ? Object.values(msg.points) : (msg.diffs?.points?.changed ? Object.values(msg.diffs.points.changed) : []);
                    // Filter logic
                    const relevant = allPoints.filter(p => p.tag.startsWith(opts.equipKey.split("-").pop()));
                    if (!relevant.length) return;

                    const data = { points: relevant };
                    const alarms = SCADA.Core.AlarmManager?.getAlarms?.() || [];
                    const cls = getVisualClass(data, alarms, opts.loc);
                    update(cls.visualClass);
                }
            };
            SCADA.Core.SocketManager.subscribe(scope, callback);

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

    NS.TFan = { init };
})(window.SCADA, window);
