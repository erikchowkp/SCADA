//Requires: /symbols/baseSymbol.js

; (function (SCADA, global) {
  const NS = SCADA.Symbols = SCADA.Symbols || {};
  const pointCache = Object.create(null); // scope -> Map<key, point>
  const getPointKey = (pt) => pt ? `${(pt.loc || "").toUpperCase()}::${pt.tag}` : "";

  async function init(containerId, opts = {}) {
    const targetDoc = opts.doc || document;
    const wrap = targetDoc.getElementById(containerId);

    if (!wrap) throw new Error(`Pit.init: container #${containerId} not found`);

    // Load pit SVG
    const res = await fetch("/symbols/pit.html");
    const svg = await res.text();
    wrap.innerHTML = svg;

    // Faceplate click
    if (opts.faceplate) {
      wrap.style.cursor = "pointer";
      wrap.onclick = () => {
        if (SCADA.UI?.Faceplate?.open) {
          SCADA.UI.Faceplate.open(opts.faceplate);
        }
      };
    }

    const pitEquipKey = opts.equipKey || containerId;
    if (SCADA.Core?.BaseSymbol?.registerHighlight) {
      SCADA.Core.BaseSymbol.registerHighlight(wrap, opts.equipKey);
    }

    const pitId = opts.equipKey
      ? opts.equipKey.split("-").pop()
      : (opts.id || containerId || "");

    function update(levelPercent, visualClass) {
      const svgEl = wrap.querySelector("svg");
      if (!svgEl) return;

      const bar = svgEl.querySelector(".pit-fill");
      if (!bar) return;

      const prevClass = svgEl.dataset._lastClass || null;
      const prevPct = svgEl.dataset._lastPct || null;
      const pctSafe = String(Math.max(0, Math.min(100, Number(levelPercent) || 0)));

      if (prevClass === visualClass && prevPct === pctSafe) return;

      svgEl.dataset._lastClass = visualClass;
      svgEl.dataset._lastPct = pctSafe;

      const pct = Math.max(0, Math.min(100, Number(levelPercent) || 0));
      const h = pct * 2;
      bar.setAttribute("height", h);
      bar.setAttribute("y", 200 - h);

      if (!svgEl.classList.contains("pit")) svgEl.classList.add("pit");

      const toRemove = ["hh-blink", "hh", "high-blink", "high", "normal-blink", "normal"];
      toRemove.forEach(cls => {
        if (cls !== visualClass) svgEl.classList.remove(cls);
      });

      if (visualClass && !svgEl.classList.contains(visualClass)) {
        svgEl.classList.add(visualClass);
      }
    }

    function showOverride(flag) {
      if (SCADA.Core?.BaseSymbol?.manageOverride) {
        SCADA.Core.BaseSymbol.manageOverride(wrap, !!flag);
      }
    }

    function getVisualClass(data, alarms = [], loc = "") {
      const validAlarms = Array.isArray(alarms) ? alarms : [];
      const points = Array.isArray(data?.points) ? data.points : [];
      const pitNum = pitId.replace("SPT", "");

      const hhPoint = points.find(p =>
        p && p.loc === loc && p.sys === "TRA" && p.equipType === "SPT" && p.equipId === pitNum && p.tag.endsWith("HighHighLevel")
      );

      const highPoint = points.find(p =>
        p && p.loc === loc && p.sys === "TRA" && p.equipType === "SPT" && p.equipId === pitNum && p.tag.endsWith("HighLevel")
      );

      const hhAlarm = validAlarms.find(a =>
        a && a.loc === loc && a.sys === "TRA" && a.tag.endsWith("HighHighLevel") && `${a.loc}-TRA-${a.label}` === pitEquipKey
      );

      const highAlarm = validAlarms.find(a =>
        a && a.loc === loc && a.sys === "TRA" && a.tag.endsWith("HighLevel") && `${a.loc}-TRA-${a.label}` === pitEquipKey
      );

      let visualClass = "normal";
      let pct = 20;

      const isHHActive = hhAlarm?.state === "Active";
      const isHighActive = highAlarm?.state === "Active";

      const hasClearedUnacked = validAlarms.some(a => {
        const acked = a.ack === true || a.ack === "Acked" || a.ackState === "Acked";
        const isThisPit = a.label === pitId;
        return (isThisPit && a.state === "Cleared" && !acked && (a.tag.endsWith("HighLevel") || a.tag.endsWith("HighHighLevel")));
      });

      if (isHHActive) {
        visualClass = hhAlarm.ack === false ? "hh-blink" : "hh";
        pct = 90;
      } else if (isHighActive) {
        visualClass = highAlarm.ack === false ? "high-blink" : "high";
        pct = 70;
      } else if (hasClearedUnacked) {
        visualClass = "normal-blink";
        pct = 20;
      } else {
        visualClass = "normal";
        pct = hhPoint?.value ? 90 : highPoint?.value ? 70 : 20;
      }

      // Check override on ANY relevant point for this pit
      const override = points.some(p =>
        p && p.loc === loc && p.sys === "TRA" && p.equipType === "SPT" && p.equipId === pitNum &&
        (p.mo_i === true || p.q === "ManualOverride")
      );

      return { visualClass, pct, hh: hhPoint, high: highPoint, override };
    }

    const api = { update, showOverride, getVisualClass };
    SCADA.Core.ActiveSymbols = SCADA.Core.ActiveSymbols || {};
    SCADA.Core.ActiveSymbols[opts.equipKey || containerId] = api;

    // --- WebSocket subscription (only if not managed by page, not strictly required) ---
    if (!opts.noAutoRefresh) {
      const scope = "system:" + opts.loc;
      const cachedPoints = pointCache[scope] || (pointCache[scope] = new Map());

      const callback = (msg) => {
        let shouldUpdate = false;

        // 1. Snapshot: Strict Scope Check
        if (msg.type === "snapshot") {
          const isPointScope = msg.scopes?.includes("system:" + opts.loc);
          const isAlarmScope = msg.scopes?.includes("alarms");
          if (isPointScope || isAlarmScope) {
            if (msg.points) Object.values(msg.points).forEach(pt => cachedPoints.set(getPointKey(pt), pt));
            shouldUpdate = true;
          }
        }

        // 2. Update/Diff: Loose Check (Fixes "Badge not appearing" if scopes missing in payload)
        if (msg.type === "update") {
          // Always process alarm diffs
          if (msg.diffs?.alarms) shouldUpdate = true;

          // Process point diffs if they match our location
          if (msg.diffs?.points?.changed) {
            Object.values(msg.diffs.points.changed).forEach(pt => {
              // If point belongs to this location, update cache and trigger render
              if (pt.loc === opts.loc) {
                cachedPoints.set(getPointKey(pt), pt);
                shouldUpdate = true;
              }
            });
          }
        }

        if (!shouldUpdate) return;

        const data = { points: Array.from(cachedPoints.values()) };
        const alarms = SCADA.Core.AlarmManager?.getAlarms() || [];

        const cls = getVisualClass(data, alarms, opts.loc);

        update(cls.pct, cls.visualClass);
        showOverride(cls.override);
      };

      // --- Initial state hydration (HTTP) ---
      (async () => {
        try {
          const [respPoints, respAlarms] = await Promise.all([
            fetch("/api/read", { cache: "no-store" }),
            fetch("/api/alarms", { cache: "no-store" })
          ]);
          const full = await respPoints.json();
          const initialAlarms = await respAlarms.json();

          const pts = full.points.filter(p => p.loc === opts.loc);
          cachedPoints.clear();
          pts.forEach(pt => cachedPoints.set(getPointKey(pt), pt));

          const cls = getVisualClass({ points: pts }, initialAlarms, opts.loc);
          update(cls.pct, cls.visualClass);
          showOverride(cls.override);
        } catch (e) {
          console.warn(`[Pit ${containerId}] Hydration failed:`, e);
          // Show default state instead of staying blank
          update(20, "normal");
        }
      })();

      // Subscribe to WebSocket scopes (store callback for cleanup)
      if (!api._wsCallback) {
        api._wsCallback = callback;
        SCADA.Core.SocketManager.subscribe(scope, callback);
        SCADA.Core.SocketManager.subscribe("alarms", callback);
      }

      // Cleanup
      const observer = SCADA.Core.BaseSymbol.observeDestruction(wrap, () => {
        SCADA.Core.SocketManager.unsubscribe(scope, callback);
        SCADA.Core.SocketManager.unsubscribe("alarms", callback);
      });
    }
    return api;
  }

  NS.Pit = { init };
})(window.SCADA, window);