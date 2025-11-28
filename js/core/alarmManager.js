/*
===============================================================================
SCADA.Core.AlarmManager  —  Phase 9.5
-------------------------------------------------------------------------------
Listens to WebSocket "alarms" scope and maintains a live in-memory cache.
Other modules (Pump, Pit, AlarmBanner, etc.) can call getAlarms()
to obtain latest ack/state data without polling.
===============================================================================
*/

;(function (global) {
  if (!global.SCADA) global.SCADA = { Core: {} };
  const Core = global.SCADA.Core;

  const cache = { alarms: [] };
  const listeners = new Set();

  const AlarmManager = {
      init() {
        const sm = Core.SocketManager;
        if (!sm) {
        console.warn("AlarmManager: SocketManager not ready");
        return;
        }

        // Avoid double-patching
        if (sm._alarmNotifyPatched) {
        console.log("AlarmManager: SocketManager already patched");
        return;
        }

        const origNotify = sm._notify
        ? sm._notify.bind(sm)
        : function () {};

        sm._notify = function (scopes, msg) {
            try {
                // 1) Handle WS snapshot alarms. Only overwrite cache on a full snapshot.
                if (msg?.type === 'snapshot' && Array.isArray(msg?.alarms)) {
                    // Always overwrite old cache — prevents stale alarms like PIT
                    cache.alarms = msg.alarms;

                    for (const fn of listeners) {
                        try { fn(cache.alarms); } catch {}
                    }

                    return origNotify(scopes, msg);
                }

                // 2) Handle WS update/diff alarms
                if (msg && msg.diffs && msg.diffs.alarms) {
                    const diff = msg.diffs.alarms;
                    const byKey = {};

                    for (const a of cache.alarms || []) {
                        const key = `${a.loc}::${a.tag}`;
                        byKey[key] = a;
                    }

                    for (const a of diff.added || []) {
                        const key = `${a.loc}::${a.tag}`;
                        byKey[key] = a;
                    }

                    for (const a of diff.updated || []) {
                        const key = `${a.loc}::${a.tag}`;
                        byKey[key] = a;
                    }

                    for (const id of diff.clearedIds || []) {
                        for (const k of Object.keys(byKey)) {
                            if (k.endsWith(`::${id}`)) delete byKey[k];
                        }
                    }

                    cache.alarms = Object.values(byKey);
                    for (const fn of listeners) {
                        try { fn(cache.alarms); } catch {}
                    }
                }
            } catch (e) {
                console.warn("AlarmManager notify hook error:", e);
            }

            return origNotify(scopes, msg);
        };


        sm._alarmNotifyPatched = true;
        console.log("✅ SCADA.Core.AlarmManager initialised (notify-hook mode)");
    },


    getAlarms() {
      return cache.alarms;
    },

    onChange(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    }
  };

  Core.AlarmManager = AlarmManager;

  // Auto-init when SocketManager is ready (only once)
  if (Core.SocketManager && !Core.SocketManager._alarmNotifyPatched) {
    try {
      Core.AlarmManager.init();
    } catch (e) {
      console.warn("AlarmManager auto-init failed:", e);
    }
  }
})(window);
