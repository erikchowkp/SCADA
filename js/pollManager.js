/*
===============================================================================
SCADA CORE POLL MANAGER — PHASE 2 FINAL (2025-10)
-------------------------------------------------------------------------------
• Fully under SCADA.Core namespace (no Symbols / global shims)
• Unified 2 s polling for /api/read + /api/alarms
• Exposes:
    - subscribe(cb)
    - start()
    - stop()
    - countSubscribers()
    - getCache()
• Uses TimerManager if available; safe standalone otherwise
===============================================================================
*/

; (function (SCADA, global) {
  const Core = SCADA.Core = SCADA.Core || {};
  // Stop PollManager from starting inside iframes
  if (window.self !== window.top) {
    console.log("⏸️ PollManager disabled in iframe context");
    return;
  }

  // ---------------------------------------------------------------------------
  // Shared internal state
  // ---------------------------------------------------------------------------
  const shared = {
    subscribers: new Set(),
    interval: null,
    data: null,
    alarms: null,
    isRunning: false, // ✅ Prevent duplicate starts
  };


  // ---------------------------------------------------------------------------
  // Subscribe
  // ---------------------------------------------------------------------------
  function subscribe(cb) {
    shared.subscribers.add(cb);

    // Send cached data immediately if available (don't require events)
    if (shared.data && shared.alarms) {
      try {
        cb({ points: shared.data?.points, alarms: shared.alarms, events: shared.events || [] });
      } catch { }
    }


    console.log("📣 New subscriber:", cb.name || '(anonymous)', cb.toString().slice(0, 80));

    start();

    // Return unsubscribe function
    return () => {
      shared.subscribers.delete(cb);
      if (shared.subscribers.size === 0) stop();
    };
  }

  // ---------------------------------------------------------------------------
  // Start polling loop
  // ---------------------------------------------------------------------------
  function start() {
    // Check if polling is disabled (pure WebSocket mode)
    if (Core.Config?.DISABLE_POLLING) {
      console.log("⚡ PollManager: WebSocket-only mode (polling disabled)");
      shared.isRunning = true;  // Mark as "running" to prevent re-entry
      return;  // Skip polling interval entirely
    }

    // Prevent duplicate start attempts
    if (shared.isRunning || shared.interval || Core.TimerManager?.has?.("CorePoll")) return;
    shared.isRunning = true;

    pollOnce(); // immediate first run

    const period = Core.Config?.POLL_INTERVAL || 2000;

    if (Core.TimerManager?.register) {
      Core.TimerManager.register("CorePoll", setInterval(pollOnce, period));
    } else {
      shared.interval = setInterval(pollOnce, period);
    }
  }


  // ---------------------------------------------------------------------------
  // Stop polling loop
  // ---------------------------------------------------------------------------
  function stop() {
    // Clear TimerManager-backed interval if present
    try { SCADA.Core?.TimerManager?.clear?.("CorePoll"); } catch { }
    if (shared.interval) {
      clearInterval(shared.interval);
      shared.interval = null;
    }
    shared.isRunning = false;
    console.log("🛑 SCADA.Core.PollManager: stopped (no subscribers)");
  }

  // ---------------------------------------------------------------------------
  // One poll cycle
  // ---------------------------------------------------------------------------
  async function pollOnce() {
    try {
      const [readRes, alarmsRes, eventsRes] = await Promise.all([
        fetch("/api/read"),
        fetch("/api/alarms"),
        fetch("/api/events"),
      ]);

      const [data, alarms, events] = await Promise.all([
        readRes.json(),
        alarmsRes.json(),
        eventsRes.json(),
      ]);

      // cache all
      shared.data = data;
      shared.alarms = alarms;
      shared.events = events;

      // broadcast to all subscribers
      for (const cb of shared.subscribers) {
        try { cb({ points: data?.points, alarms, events }); } catch { }
      }


      //   console.log("SCADA.Core.PollManager: update", {
      //     points: data?.points?.length,
      //     alarms: alarms?.length,
      //   });
    } catch (err) {
      console.warn("PollManager error:", err.message);
    }
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------
  Core.PollManager = {
    subscribe,
    start,
    stop,
    countSubscribers: () => shared.subscribers.size,
    getCache: () => ({ data: shared.data, alarms: shared.alarms, events: shared.events }),

    // 🔄 Force-update all subscribers immediately (for manual overrides etc.)
    notifySubscribers() {
      if (!shared.data) return;
      for (const cb of shared.subscribers) {
        try {
          cb({ points: shared.data?.points, alarms: shared.alarms, events: shared.events });
        } catch (err) {
          console.warn("PollManager notify error:", err);
        }
      }
      console.log("🔁 Manual notify to PollManager subscribers");
    },

    // 🧹 Clear all subscribers (used when unloading mimics)
    clearAll() {
      const count = shared.subscribers.size;
      shared.subscribers.clear();
      stop();
      console.log(`🧹 PollManager: cleared ${count} subscriber(s)`);
    },
  };
  // === Phase 7.2 Socket hooks ===============================================
  // Helper: turn points array <-> index {"LOC.TAG": point}
  function _pointsArrayToIndex(arr) {
    const idx = {};
    for (const p of (arr || [])) {
      const key = `${p.loc}.${p.tag}`;
      idx[key] = p;
    }
    return idx;
  }
  function _indexToArray(idx) { return Object.values(idx || {}); }

  // Receive a full snapshot from SocketManager
  Core.PollManager.applySnapshot = function (msg) {
    try {
      // msg.points is a map {"LOC.TAG": pointObj}
      const pointsArr = msg.points ? Object.values(msg.points) : [];
      shared.data = { system: shared.data?.system || "TRA", points: pointsArr };
      shared.alarms = Array.isArray(msg.alarms) ? msg.alarms : [];
      shared.events = Array.isArray(msg.events) ? msg.events : [];

      // Push to all current subscribers
      Core.PollManager.notifySubscribers();
      console.log("🧩 PollManager snapshot applied", {
        points: pointsArr.length, alarms: shared.alarms.length, events: shared.events.length
      });
    } catch (e) {
      console.warn("applySnapshot error:", e);
    }
  };

  // Receive diffs from SocketManager
  Core.PollManager.applyDiffs = function (diffs) {
    try {
      if (!shared.data) shared.data = { system: "TRA", points: [] };
      let idx = _pointsArrayToIndex(shared.data.points);

      // --- Points
      if (diffs?.points) {
        const ch = diffs.points.changed || {};
        const rm = diffs.points.removed || [];
        for (const k of Object.keys(ch)) idx[k] = ch[k];
        for (const k of rm) delete idx[k];
        shared.data.points = _indexToArray(idx);
      }

      // --- Alarms
      if (diffs?.alarms) {
        const map = {};
        for (const a of (shared.alarms || [])) map[`${a.loc || "-"}::${a.tag}`] = a;
        for (const a of (diffs.alarms.added || [])) map[`${a.loc || "-"}::${a.tag}`] = a;
        for (const a of (diffs.alarms.updated || [])) map[`${a.loc || "-"}::${a.tag}`] = a;
        for (const id of (diffs.alarms.clearedIds || [])) {
          // clearedIds may be tag keys; remove by tag match
          for (const k of Object.keys(map)) if (k.endsWith(`::${id}`)) delete map[k];
        }
        shared.alarms = Object.values(map);
      }

      // --- Events (append, unique by ts)
      if (diffs?.events?.added) {
        const byTs = {};
        for (const e of (shared.events || [])) byTs[e.ts] = e;
        for (const e of diffs.events.added) byTs[e.ts] = e;
        shared.events = Object.values(byTs).sort((a, b) => (a.ts > b.ts ? 1 : -1));
      }

      Core.PollManager.notifySubscribers();
      // console.log("🧩 PollManager diffs applied");
    } catch (e) {
      console.warn("applyDiffs error:", e);
    }
  };


  console.log("✅ SCADA.Core.PollManager initialised (Phase 2 Final)");
})(window.SCADA, window);
