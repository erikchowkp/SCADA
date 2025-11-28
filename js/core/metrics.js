/*
===============================================================================
SCADA.Core.Metrics
-------------------------------------------------------------------------------
Collects backend + frontend runtime metrics for Diagnostics Console.
===============================================================================
*/
;(function (global) {
  const NS = global.SCADA.Core;

  const Metrics = {
    _last: {},
    _logBuffer: [],
    _LOG_LIMIT: 900, // ~30 min @ 2 s
    _interval: null,
    _fpsSamples: [],
    _frameCount: 0,
    _startTime: performance.now(),

    init() {
      console.log("✅ SCADA.Core.Metrics (Phase 8.1) initialised");
      this._pollBackend();
      this._measureFPS();
      this._interval = setInterval(() => this._pollBackend(), 2000);
    },

    async _pollBackend() {
      try {
        const resp = await fetch("/api/metrics");
        if (!resp.ok) throw new Error(resp.statusText);
        const data = await resp.json();
        this._last.backend = data;
      } catch (e) {
        console.warn("Metrics fetch failed", e);
      }

      // Client-side additions
      this._last.frontend = {
        fps: this._fps,
        heapUsedMB: (performance.memory
          ? performance.memory.usedJSHeapSize / 1024 / 1024
          : 0
        ).toFixed(1),
        socketState: NS.SocketManager
          ? NS.SocketManager.getConnectionState()
          : "N/A",
        loaderCache: NS.Loader && NS.Loader._cache
          ? {
              defs: NS.Loader._cache.defs.size,
              symbols: NS.Loader._cache.symbols.size
            }
          : { defs: 0, symbols: 0 }
      };

      this._last.timestamp = Date.now();
      // Phase 8.3 — append snapshot to local buffer
      const rec = {
        ts: Date.now(),
        cpuLoad: this._last.backend?.cpuLoad ?? 0,
        memoryMB: this._last.backend?.memoryMB ?? 0,
        wsClients: this._last.backend?.wsClients ?? 0,
        fps: this._last.frontend?.fps ?? 0,
        heapMB: this._last.frontend?.heapUsedMB ?? 0
      };
      this._logBuffer.push(rec);
      if (this._logBuffer.length > this._LOG_LIMIT) this._logBuffer.shift();

      if (this.onUpdate) this.onUpdate(this._last);
      
    },

    _measureFPS() {
      const loop = (t) => {
        this._frameCount++;
        const elapsed = t - this._startTime;
        if (elapsed >= 1000) {
          this._fps = this._frameCount;
          this._fpsSamples.push(this._fps);
          if (this._fpsSamples.length > 30) this._fpsSamples.shift();
          this._frameCount = 0;
          this._startTime = t;
        }
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    },

    getSnapshot() {
      return this._last;
    },

    // === Phase 8.3 additions ==========================================
    getLog(rangeMinutes) {
      if (!rangeMinutes) return [...this._logBuffer];
      const cutoff = Date.now() - rangeMinutes * 60 * 1000;
      return this._logBuffer.filter(r => r.ts >= cutoff);
    },

    exportCSV() {
      const header = ['timestamp','cpuLoad','memoryMB','wsClients','fps','heapMB'];
      const rows = this._logBuffer.map(r => [
        new Date(r.ts).toISOString(),
        r.cpuLoad, r.memoryMB, r.wsClients, r.fps, r.heapMB
      ].join(','));
      return [header.join(','), ...rows].join('\n');
    }
  };

  NS.Metrics = Metrics;
  document.addEventListener("DOMContentLoaded", () => Metrics.init());
})(window);

