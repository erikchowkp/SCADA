/*
===============================================================================
SCADA.UI.Diagnostics
-------------------------------------------------------------------------------
Displays real-time backend and frontend metrics using SCADA.Core.Metrics.
Accessible from the "Options ▾" dropdown menu.
===============================================================================
*/

;(function (global) {
  const NS = global.SCADA.UI;
  const Core = global.SCADA.Core;

  const Diagnostics = {
    _panel: null,
    _isOpen: false,
    _charts: {},
    _dataBuffer: { cpu: [], mem: [], fps: [], timestamps: [] },

    init() {
      console.log('✅ SCADA.UI.Diagnostics registered (Phase 8.2)');
      const menu = document.querySelector('#options-dropdown');
      if (menu) {
        const diagItem = menu.querySelector('[data-action="diagnostics"]');
        if (diagItem) diagItem.addEventListener('click', () => this.togglePanel());
      }
      Core.Metrics.onUpdate = (metrics) => this._update(metrics);
    },

    togglePanel() {
      if (this._isOpen) return this.closePanel();
      this.openPanel();
    },

    openPanel() {
      if (this._panel) this._panel.remove();

      const div = document.createElement('div');
      div.id = 'diagnostics-panel';
      div.style.cssText = `
         position:fixed;
         top:10%;
         right:10%;
         width:480px;
         height:70%;
         background:#222;
         color:#fff;
         border:2px solid #555;
         border-radius:6px;
         padding:12px;
         z-index:2000;
         box-shadow:0 4px 20px rgba(0,0,0,0.5);
         overflow-y:auto;
      `;

     // 🔹 show dim background overlay (reuse faceplate overlay)
     const overlay = document.getElementById('faceplate-overlay');
     if (overlay) overlay.style.display = 'block';

      div.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <h2 style="margin:0;font-size:18px;">Diagnostics Console</h2>
          <button id="diag-close"
                  style="background:#444;color:#fff;border:none;padding:4px 8px;cursor:pointer;">✖</button>
        </div>
        <hr style="border:1px solid #555;">
        <div id="diag-summary"></div>
        <canvas id="diag-chart-cpu" height="100"></canvas>
        <canvas id="diag-chart-mem" height="100"></canvas>
        <canvas id="diag-chart-fps" height="100"></canvas>
        <hr style="border:1px solid #555;">
        
        <h3>Subscriptions</h3>
        <table id="diag-subs" style="width:100%;font-size:12px;border-collapse:collapse;">
          <thead><tr><th>Scope</th><th>Count</th></tr></thead>
          <tbody></tbody>
        </table>
      `;
      // === Phase 8.3: View History button ===================================
      const histBtn = document.createElement('button');
      histBtn.id = 'btn-history';
      histBtn.textContent = 'View History';
      histBtn.style.cssText =
        'margin-top:8px;background:#444;color:#fff;border:none;padding:4px 8px;cursor:pointer;border-radius:6px;';
      histBtn.addEventListener('click', () => this._showHistory());

      // Place the button just before the "Subscriptions" heading
      const firstHr = div.querySelectorAll('hr')[1]; // the second <hr> before Subscriptions
      firstHr.insertAdjacentElement('afterend', histBtn);
      
      document.body.appendChild(div);
      this._panel = div;
      this._isOpen = true;
     // Allow dragging by header
     const header = div.querySelector('h2');
     let drag = {active:false,x:0,y:0};
     header.style.cursor = 'move';
     header.addEventListener('mousedown', e => {
        drag.active = true;
        drag.x = e.clientX;
        drag.y = e.clientY;
     });
     window.addEventListener('mouseup', () => drag.active = false);
     window.addEventListener('mousemove', e => {
        if (!drag.active) return;
        const dx = e.clientX - drag.x;
        const dy = e.clientY - drag.y;
        drag.x = e.clientX;
        drag.y = e.clientY;
        const rect = div.getBoundingClientRect();
        div.style.top  = rect.top + dy + 'px';
        div.style.left = rect.left + dx + 'px';
     });

      document.getElementById('diag-close').addEventListener('click', () => this.closePanel());
      document.addEventListener('keydown', this._escHandler = (e) => { if (e.key === 'Escape') this.closePanel(); });

      this._initCharts();
      this._refreshSummary(Core.Metrics.getSnapshot() || {});
    },

    closePanel() {
        if (this._panel) this._panel.remove();
        this._isOpen = false;
        document.removeEventListener('keydown', this._escHandler);

        // 🔹 hide overlay again
        const overlay = document.getElementById('faceplate-overlay');
        if (overlay) overlay.style.display = 'none';
    },


    _initCharts() {
      if (!window.Chart) {
        console.warn('Chart.js not detected – skipping charts');
        return;
      }
      const makeChart = (id, label, color) => new Chart(
        document.getElementById(id).getContext('2d'),
        {
          type: 'line',
          data: { labels: [], datasets: [{ label, borderColor: color, fill: false, data: [] }] },
          options: { responsive: true, animation: false, scales: { x: { display: false } } }
        }
      );
      this._charts.cpu = makeChart('diag-chart-cpu', 'CPU %', 'lime');
      this._charts.mem = makeChart('diag-chart-mem', 'Memory MB', 'orange');
      this._charts.fps = makeChart('diag-chart-fps', 'FPS', 'aqua');
    },

    _update(metrics) {
      if (!this._isOpen) return;
      this._refreshSummary(metrics);
      this._updateCharts(metrics);
    },

    _refreshSummary(metrics) {
      const s = metrics.backend || {};
      const f = metrics.frontend || {};
      const div = document.getElementById('diag-summary');
      if (!div) return;

      div.innerHTML = `
        <table style="width:100%;font-size:13px;">
          <tr><td>Status</td><td>${f.socketState === 'OPEN' ? '🟢 Live' : '🔴 Offline'}</td></tr>
          <tr><td>Clients</td><td>${s.wsClients ?? '-'}</td></tr>
          <tr><td>CPU Load</td><td>${(s.cpuLoad*100).toFixed(1)}%</td></tr>
          <tr><td>Memory</td><td>${s.memoryMB ?? '-'} MB</td></tr>
          <tr><td>FPS</td><td>${f.fps ?? '-'}</td></tr>
          <tr><td>Heap Used</td><td>${f.heapUsedMB ?? '-'} MB</td></tr>
          <tr><td>Uptime</td><td>${s.uptime ? (s.uptime/60).toFixed(1)+' min' : '-'}</td></tr>
          <tr><td>Broadcasts</td><td>${s.wsBroadcasts ?? '-'}</td></tr>
        </table>
      `;

      const subsTable = document.querySelector('#diag-subs tbody');
      if (subsTable && Core.SocketManager?._subscriptions) {
        subsTable.innerHTML = '';
        Core.SocketManager._subscriptions.forEach((set, scope) => {
          subsTable.innerHTML += `<tr><td>${scope}</td><td>${set.size}</td></tr>`;
        });
      }
    },

    _updateCharts(metrics) {
      const s = metrics.backend || {};
      const f = metrics.frontend || {};
      const ts = new Date(metrics.timestamp || Date.now()).toLocaleTimeString();

      this._dataBuffer.timestamps.push(ts);
      this._dataBuffer.cpu.push((s.cpuLoad * 100) || 0);
      this._dataBuffer.mem.push(Number(s.memoryMB) || 0);
      this._dataBuffer.fps.push(Number(f.fps) || 0);

      const maxPoints = 20;
      for (const key of ['timestamps', 'cpu', 'mem', 'fps']) {
        const arr = this._dataBuffer[key];
        if (arr.length > maxPoints) arr.shift();
      }

      for (const [key, chart] of Object.entries(this._charts)) {
        if (!chart) continue;
        const field = key === 'cpu' ? 'cpu' : key;
        chart.data.labels = this._dataBuffer.timestamps;
        chart.data.datasets[0].data = this._dataBuffer[field];
        chart.update();
      }
    },
    
    // === Phase 8.3: History view ============================================
    _showHistory() {
      const data = Core.Metrics.getLog(15);
      console.log('📊 Diagnostics History (15 min):', data);
      alert(`History buffer contains ${data.length} records (see console for details).`);
    },

  };

  NS.Diagnostics = Diagnostics;
  document.addEventListener('DOMContentLoaded', () => Diagnostics.init());
})(window);
