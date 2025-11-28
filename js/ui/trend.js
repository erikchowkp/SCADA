/*
===============================================================================
SCADA.UI.Trend  (Phase 9.2)
-------------------------------------------------------------------------------
Displays historical and live data from /api/trend for AI or diagnostic points.
Works standalone as systems/TREND.html. Accepts initial args via:
  - window.SCADA.PendingArgs = { point: "NBT:TRA.FLO001", label:"Flow Rate" }
===============================================================================
*/
; (function (global) {
    // ensure namespace
    global.SCADA = global.SCADA || { Core: {}, UI: {}, State: {} };
    const NS = global.SCADA.UI = global.SCADA.UI || {};
    const Core = global.SCADA.Core = global.SCADA.Core || {};

    const Trend = {
        _chart: null,
        _datasets: {},   // pointKey -> dataset
        _range: '24h',
        _isLive: false,
        _liveTimer: null,
        _step: '1s',   // sampling period (1s / 30s / 5m)

        init(args) {
            console.log('✅ SCADA.UI.Trend registered (Phase 9.2)', args);
            this._bindControls();
            this._applyTimeRangeLimit(); // set default picker range based on sampling
            // If launched with a point, add it
            const initPoint = args?.point;
            const initLabel = args?.label || args?.point || 'Point';
            if (initPoint) {
                console.log(`📈 Auto-loading point from faceplate: ${initPoint} (${initLabel})`);
                this._selectedPoint = { key: initPoint, label: initLabel };
                this._activePoint = initPoint;
                this._step = '1s';
                this._chartStep = '1s';
                this._range = '24h';

                this.addOrFocusPoint(initPoint, initLabel).then(() => {
                    this.refreshFromConfig().then(() => {
                        const allData = Object.values(this._datasets);
                        this._ensureChart(allData);
                    });
                });
            } else {
                this._ensureChart([]);
            }

        },

        _bindControls() {
            // === Config panel bindings ===
            const periodSel = document.getElementById('sample-period');
            if (periodSel) {
                periodSel.addEventListener('change', () => {
                    this._step = periodSel.value;
                    this._applyTimeRangeLimit();   // just set pickers, no auto refresh
                });
                this._autoRange = true;   // flag to auto-reset range each time sampling changes
                this._step = ''; // no default until user selects
            }


            // ✅ NEW, CORRECTED CODE
            const refreshBtn = document.getElementById('trend-refresh');
            if (refreshBtn) refreshBtn.addEventListener('click', async () => {
                const sel = this._selectedPoint;
                console.log('📋 [DEBUG:add-click] Selected =', sel);
                console.log('📋 [DEBUG:add-click] Datasets before add =', Object.keys(this._datasets));

                if (!sel) {
                    this._showAlert('Please select a point from the list first.');
                    return;
                }
                const step = this._step;
                if (!step) {
                    this._showAlert('Please select a sampling period.');
                    return;
                }

                this._activePoint = sel.key;

                // ✅ NEW, SIMPLIFIED CHECK:
                // Only block if it's an *exact* duplicate (same point, same sampling)
                if (this._datasets[sel.key] && this._chartStep === this._step) {
                    this._showAlert('⚠️ This point is already on the chart.');
                    return;
                }

                // Prepare dataset + label (this just ensures the key exists)
                await this.addOrFocusPoint(sel.key, sel.label);
                console.log('📋 [DEBUG:add-click] Datasets after addOrFocusPoint =', Object.keys(this._datasets));

                // Fetch data for the selected range/sampling
                // refreshFromConfig will now handle ALL other logic (resampling, blocking, etc.)
                await this.refreshFromConfig();

                // Redraw all datasets
                const allData = Object.values(this._datasets);
                this._ensureChart(allData);
                // ✅ Reset selection after successful add
                this._selectedPoint = null;
                this._activePoint = null;

                // 🧍‍♂️ Deselect all highlighted AI points
                const listDiv = document.getElementById('trend-point-list');
                if (listDiv) {
                    listDiv.querySelectorAll('div').forEach(div => {
                        div.classList.remove('selected', 'active');
                        div.style.background = '';
                    });
                }

                console.log('🧹 Cleared previous selected point after adding to chart.');

            });



            // (These remain harmless if not present — we removed toolbar in HTML)
            const liveBtn = document.getElementById('trend-live');
            if (liveBtn) liveBtn.addEventListener('click', () => this.toggleLive());
            const exp = document.getElementById('trend-export');
            if (exp) exp.addEventListener('click', () => this.exportCSV());

            const resetZoomBtn = document.getElementById('trend-resetZoom');
            if (resetZoomBtn) {
            resetZoomBtn.addEventListener('click', () => {
                if (this._chart) this._chart.resetZoom();
            });
            }

            const clearBtn = document.getElementById('trend-clear');
            if (clearBtn) clearBtn.addEventListener('click', () => {
                // 🧹 Destroy chart instance
                if (this._chart) {
                    this._chart.destroy();
                    this._chart = null;
                }
console.log('🧹 [DEBUG:clear] datasets before clear =', Object.keys(this._datasets));

                // 🧾 Fully reset Trend state (prevent false duplicate blocks)
                this._datasets = {};
                this._chartStep = null;
                this._activePoint = null;
                this._selectedPoint = null;
                this._range = '24h';
                this._isLive = false;
                if (this._liveTimer) {
                    clearInterval(this._liveTimer);
                    this._liveTimer = null;
                }

                // 🧍‍♂️ Deselect all highlighted AI points
                const listDiv = document.getElementById('trend-point-list');
                if (listDiv) {
                    listDiv.querySelectorAll('div').forEach(div => {
                        div.classList.remove('selected', 'active');
                        div.style.background = '';
                    });
                }

                this._showAlert('🧹 Chart cleared. All selections removed.', '#107c10');
                console.log('🧹 Trend state fully cleared.');
            });


        },

        _showAlert(msg, color = '#b00020') {
            const el = document.getElementById('trend-alert');
            if (!el) {
                console.warn('Alert:', msg);
                return;
            }
            el.style.color = color;
            el.textContent = msg;
            // Auto-clear after 5 seconds
            clearTimeout(this._alertTimer);
            this._alertTimer = setTimeout(() => { el.textContent = ''; }, 5000);
        },


        _applyTimeRangeLimit() {
            const fromEl = document.getElementById('from-time');
            const toEl   = document.getElementById('to-time');
            if (!fromEl || !toEl) return;

            const now = new Date();
            let maxSpanMs = 24 * 3600e3; // default 24h (for 1s)

            if (this._step === '30s') maxSpanMs = 7 * 24 * 3600e3;        // 7 days
            if (this._step === '5m')  maxSpanMs = 365 * 24 * 3600e3;      // 365 days

            const minAllowed = new Date(now.getTime() - maxSpanMs);
            const iso = d => d.toISOString().slice(0,16);

            // Limit selectable window
            fromEl.min = iso(minAllowed);
            fromEl.max = iso(now);
            toEl.min   = iso(minAllowed);
            toEl.max   = iso(now);

            // 🕓 Auto-default the pickers to the maximum range for this sampling
            if (!fromEl.value || !toEl.value || this._autoRange) {
                fromEl.value = iso(minAllowed);
                toEl.value   = iso(now);
            }

            // Store current range span for later use (used by Add)
            this._currentFrom = fromEl.value;
            this._currentTo   = toEl.value;

        },


        async refreshFromConfig() {
        const fromEl = document.getElementById('from-time');
        const toEl   = document.getElementById('to-time');
        const step = this._step;
        const point = this._activePoint;
        if (!point) {
            this._showAlert('Please select a point first.');
            return;
        }

        // 🧠 Handle sampling / duplicate / resampling logic
        const datasetKeys  = Object.keys(this._datasets);
        const datasetCount = datasetKeys.length;

        // CASE 1️⃣: No datasets yet → always allow
        if (datasetCount === 0) {
            this._chartStep = step;
        }

        // CASE 2️⃣: Exactly one dataset in chart
        else if (datasetCount === 1) {
            const existingKey = datasetKeys[0];

            if (this._datasets[point]) {
                // Same point → resample
                console.log(`🔁 Resampling same point ${point} (${this._chartStep} → ${step})`);
                delete this._datasets[point];
                this._chartStep = step;
            } 
            else if (this._chartStep !== step) {
                // Different point + different sampling → block
                this._showAlert(
                    `⚠️ Chart uses ${this._chartStep} sampling.\nPlease clear chart before adding ${step}.`
                );
                return;
            }
            // ✅ Different point, same sampling → allow
        }

        // CASE 3️⃣: Multiple datasets in chart
        else {
            // Step mismatch → block
            if (this._chartStep !== step) {
                this._showAlert(
                    `⚠️ Chart has multiple points using ${this._chartStep} sampling.\nPlease clear chart before changing to ${step}.`
                );
                return;
            }
            // ✅ Same step, different point → continue normally
        }
        
console.log('📊 [DEBUG:refreshFromConfig] before fetch', Object.keys(this._datasets));

        
        // Continue to add or fetch data if all checks passed




        const from = new Date(fromEl.value).getTime();
        const to   = new Date(toEl.value).getTime();

        // build correct API query per Phase 9.1 design
        let agg = 'avg';
        if (step === '1s') agg = 'raw';

        const url = `/api/trend?point=${encodeURIComponent(point)}&agg=${agg}&step=${step}&from=${from}&to=${to}`;
        console.log('➕ Adding point trend:', url);

        const res = await fetch(url);
        if (!res.ok) {
        console.error('❌ Trend API error:', res.status, await res.text());
        return;
        }

        

        const json = await res.json();
        console.log('✅ Trend response:', json);

        const entries = (json.entries || [])
            .map(e => ({
                x: new Date(Number(e.ts)),
                y: Number(e.value)
            }))
            .sort((a, b) => a.x - b.x);


        // store data into dataset
        // ✅ Ensure the friendly label is used for the first commit
        const displayLabel =
            (this._datasets[point] && this._datasets[point].label) ||                      // already resolved by addOrFocusPoint
            (this._selectedPoint && this._selectedPoint.key === point && this._selectedPoint.label) || // from the selector
            point;                                                                         // final fallback

        // Store/replace atomically to avoid any race with Chart reading partial object
        this._datasets[point] = { label: displayLabel, data: entries };
        console.log(`🏷️ Legend label bound: "${this._datasets[point].label}" for ${point}`);

        // draw all datasets
        this._ensureChart(Object.values(this._datasets));
        console.log(`✅ Dataset updated for ${point} (${step}, ${entries.length} samples)`);
        this._showAlert(`✅ Dataset updated for ${point} (${step}, ${entries.length} samples)`, '#107c10');


    },




    async addOrFocusPoint(pointKey, labelText) {
        this._activePoint = pointKey;
        let finalLabel = labelText || pointKey;

        try {
            // 1️⃣ Try to detect system from label (preferred)
            let sysKey = null;
            if (labelText) {
                const mLabel = labelText.match(/[-:]([A-Z]{3,})[-.]/);
                if (mLabel) sysKey = mLabel[1];
            }

            // 2️⃣ Otherwise detect from point key
            if (!sysKey) {
                const mPoint = pointKey.match(/:(\w+)\./);
                if (mPoint) sysKey = mPoint[1];
            }

            // 3️⃣ Default fallback if all fails
            if (!sysKey) sysKey = 'TRA';

            // --- Load defs (cached) ---
            let defs = this._defsCache?.[sysKey];
            if (!defs) {
                const res = await fetch(`/defs/${sysKey}.json`);
                if (!res.ok) throw new Error('defs fetch failed');
                defs = await res.json();
                this._defsCache = this._defsCache || {};
                this._defsCache[sysKey] = defs;
            }

            // --- Match the IO entry ---
            const defsPoints = Array.isArray(defs) ? defs : defs.points || [];
            const [locPart, tagPart] = pointKey.split(':'); // e.g. ["SBT", "FLO001.Value"]

            // Try to match both location and tag (case-insensitive)
            const io = defsPoints.find(p =>
            String(p.loc || '').toUpperCase() === String(locPart || '').toUpperCase() &&
            String(p.tag || '').toUpperCase() === String(tagPart || '').toUpperCase()
            );


            if (io) {
                const name = `${io.loc}-${io.sys}-${io.equipType}-${io.equipId}`;
                const desc = io.desc || '';
                const eu = io.unit || io.eu || '';
                // only append unit if not already contained in description
                const unitPart = eu && !desc.includes(`(${eu})`) ? ` (${eu})` : '';
                finalLabel = `${name} ${desc}${unitPart}`;

                console.log('🧩 Trend label matched:', finalLabel);
            } else {
                console.warn('⚠️ Trend: no matching IO found for', pointKey);
            }

        } catch (err) {
            console.warn('⚠️ Trend label lookup failed', err);
        }

        this._datasets[pointKey] = this._datasets[pointKey] || { label: finalLabel, data: [] };
        this._datasets[pointKey].label = finalLabel;
        console.log('📊 [DEBUG:addOrFocusPoint] datasets now =', Object.keys(this._datasets));

    },



        async _reloadAll() {
            const keys = Object.keys(this._datasets);
            if (keys.length === 0) return;
            const results = await Promise.all(keys.map(k => this._fetchRange(k, this._range)));
            keys.forEach((k, i) => { this._datasets[k].data = results[i]; });
            this._ensureChart(Object.values(this._datasets));
        },

        toggleLive() {
            this._isLive = !this._isLive;
            const liveBtn = document.getElementById('trend-live');
            if (liveBtn) liveBtn.style.color = this._isLive ? 'lime' : '#fff';
            if (this._isLive) {
                this._liveTimer = setInterval(async () => {
                    const keys = Object.keys(this._datasets);
                    if (keys.length === 0) return;
                    // Pull last minute for each, replot
                    const now = Date.now();
                    const from = now - 60 * 1000;
                    const batches = await Promise.all(keys.map(k => this._fetchRawWindow(k, from, now)));
                    keys.forEach((k, i) => { if (batches[i].length) this._datasets[k].data = batches[i]; });
                    this._ensureChart(Object.values(this._datasets));
                }, 2000);
            } else {
                clearInterval(this._liveTimer);
            }
        },

        async exportCSV() {
            const keys = Object.keys(this._datasets);
            if (keys.length === 0) return;
            const first = keys[0];

            // derive step/agg from current setting
            const step = this._step || '1s';
            const agg = step === '1s' ? 'raw' : 'avg';

            const fromEl = document.getElementById('from-time');
            const toEl = document.getElementById('to-time');
            const from = new Date(fromEl.value).getTime();
            const to = new Date(toEl.value).getTime();

            const url = this._buildUrl(first, { format: 'csv', step, agg, from, to });
            console.log('⬇️ Export CSV:', url);
            window.open(url, '_blank');
        },


        async _fetchRange(pointKey, range) {
            const now = Date.now();
            let step = '1s', agg = 'raw', spanMs = 24 * 3600e3; // default 24 h

            if (range === '7d') { step = '30s'; agg = 'avg'; spanMs = 7 * 24 * 3600e3; }
            if (range === '365d') { step = '5m'; agg = 'avg'; spanMs = 365 * 24 * 3600e3; }

            const from = now - spanMs;
            const url = this._buildUrl(pointKey, { from, to: now, step, agg });
            console.log(`📡 Trend fetch: step=${step}, agg=${agg}, span=${range}`);
            const res = await fetch(url);
            if (!res.ok) {
                console.error('❌ Trend fetch failed', res.status);
                return [];
            }
            const json = await res.json();
            return (json.entries || []).map(e => ({ x: e.ts || e.time || e.timestamp, y: e.value }));
        },


        async _fetchRawWindow(pointKey, from, to) {
            const url = this._buildUrl(pointKey, { from, to, agg: 'raw' });
            const res = await fetch(url);
            const json = await res.json();
            return (json.entries || []).map(e => ({ x: e.ts || e.time || e.timestamp, y: e.value }));
        },

        _buildUrl(pointKey, opts = {}) {
            const q = new URLSearchParams();
            q.set('point', pointKey);
            if (opts.from) q.set('from', String(opts.from));
            if (opts.to) q.set('to', String(opts.to));
            if (opts.step) q.set('step', String(opts.step));
            if (opts.agg) q.set('agg', String(opts.agg));
            if (opts.format) q.set('format', String(opts.format));
            return `/api/trend?${q.toString()}`;
        },


        _drawChart(entries) {
        if (!entries || !entries.length) {
            console.warn("⚠️ No entries to plot");
            return;
        }

        const ctx = document.getElementById('trend-canvas').getContext('2d');
        const points = entries.map(e => ({
            x: new Date(Number(e.ts)),   // timestamps are already UTC in ms
            y: Number(e.value)
        }));


        if (this._chart) this._chart.destroy();

        this._chart = new Chart(ctx, {
            type: 'line',
            data: {
            datasets: [{
                label: this._datasets[this._activePoint]?.label || this._activePoint || 'Trend',
                data: points,
                borderColor: '#0078d4',
                borderWidth: 1.5,
                pointRadius: 0,
                tension: 0
            }]
            },
            options: {
            parsing: false,
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'nearest', intersect: false },
            scales: {
                x: {
                    type: 'time',
                    time: {
                        tooltipFormat: 'HH:mm:ss',
                        displayFormats: {
                            second: 'HH:mm:ss',
                            minute: 'HH:mm',
                            hour: 'dd HH:mm'
                        }
                    },
                    adapters: {
                        date: { zone: 'utc' } 
                    },
                    ticks: { color: '#222' },
                    title: { display: true, text: 'Time (UTC)', color: '#222' },
                },
                y: {
                    ticks: { color: '#222' },
                    title: { display: true, text: 'Value' }
                }
            },

            plugins: {
                legend: { labels: { color: '#222' } },
                tooltip: { mode: 'index', intersect: false },
                zoom: {
                    zoom: {
                        wheel: { enabled: true },           // allow zoom with mouse wheel
                        drag: { enabled: true, modifierKey: null }, // allow drag to zoom (no key)
                        mode: 'x',                          // zoom only in x direction (time)
                    },
                    pan: {
                        enabled: true,
                        mode: 'x',                          // allow horizontal pan
                    },
                    limits: {
                        x: { min: 'original', max: 'original' },
                        y: { min: 'original', max: 'original' }
                    }
                },
            },
            
        }
        });
        },




        _ensureChart(datasets = []) {
            console.log('📊 [DEBUG:ensureChart] datasets =', Object.keys(this._datasets));

            const canvas = document.getElementById('trend-canvas');
            if (!canvas) {
                console.error('❌ trend-canvas not found');
                return;
            }
            const ctx = canvas.getContext('2d');

            const validSets = (datasets || []).filter(d => Array.isArray(d.data) && d.data.length > 0);
            const totalPoints = validSets.reduce((sum, d) => sum + d.data.length, 0);
            console.log(`📊 ensureChart: ${validSets.length} dataset(s), total ${totalPoints} points`);

            // Destroy any existing chart
            if (this._chart) {
                try { this._chart.destroy(); } catch(e) {}
            }

            // Create an empty chart first
            this._chart = new Chart(ctx, {
                type: 'line',
                data: { datasets: [] },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    parsing: false,
                    animation: false,
                    scales: {
                        x: {
                            type: 'time',
                            time: {
                                tooltipFormat: (() => {
                                    const step = this._step || '1s';
                                    if (step === '1s')  return 'dd MMM HH:mm:ss';
                                    if (step === '30s') return 'dd MMM HH:mm:ss';
                                    if (step === '5m')  return 'dd MMM yyyy HH:mm';
                                    return 'dd MMM HH:mm';
                                })(),
                                displayFormats: {
                                    millisecond: 'dd MMM HH:mm',
                                    second:      'dd MMM HH:mm',
                                    minute:      'dd MMM HH:mm',
                                    hour:        'dd MMM HH:mm',
                                    day:         'dd MMM HH:mm',
                                    week:        'dd MMM HH:mm',
                                    month:       'dd MMM HH:mm',
                                    year:        'dd MMM yyyy HH:mm'
                                }
                            },
                            ticks: {
                                source: 'auto',
                                autoSkip: true,
                                maxRotation: 45,
                                minRotation: 0,
                                callback: function (val, idx, ticks) {
                                    const chart = this.chart;
                                    const xScale = chart?.scales?.x;
                                    const span = xScale ? (xScale.max - xScale.min) : 0; // milliseconds
                                    const oneDayMs = 24 * 3600 * 1000;
                                    const showDate = span > oneDayMs; // condition: range > 1 day

                                    const date = new Date(val);
                                    const pad = n => String(n).padStart(2, '0');
                                    const d   = pad(date.getDate());
                                    const m   = date.toLocaleString('en-GB', { month: 'short' });
                                    const h   = pad(date.getHours());
                                    const mi  = pad(date.getMinutes());

                                    // Always display both for long spans, only time for short spans
                                    if (showDate) return `${d} ${m} ${h}:${mi}`;
                                    return `${h}:${mi}`;
                                }
                            },
                            title: { display: true, text: 'Time (UTC)' }
                        },
                        y: {
                            beginAtZero: false,
                            title: { display: true, text: 'Value' }
                        }
                    },
                    plugins: {
                        legend: { display: true },
                        tooltip: { mode: 'nearest', intersect: false },
                        zoom: {
                            zoom: { wheel: { enabled: true }, mode: 'x' },
                            pan: { enabled: true, mode: 'x' }
                        }
                    }
                }
            });

            const palette = [
                '#0078d4', '#d83b01', '#107c10', '#ff8c00', '#5c2d91',
                '#038387', '#498205', '#e3008c', '#8e562e', '#b146c2'
            ];
            this._chart.data.datasets = validSets.map((d, i) => ({
                label: d.label,
                data: d.data,
                borderColor: palette[i % palette.length],
                borderWidth: 1.5,
                pointRadius: 0,
                tension: 0.1
            }));


            // 🔎 Calculate full x-range (milliseconds) across all datasets
            const allPts = validSets.flatMap(d => d.data || []);
            if (allPts.length) {
            const minX = Math.min(...allPts.map(p => +new Date(p.x)));
            const maxX = Math.max(...allPts.map(p => +new Date(p.x)));
            // Force initial view to full data extent
            this._chart.options.scales.x.min = minX;
            this._chart.options.scales.x.max = maxX;
            }

            // Now render with the enforced bounds
            this._chart.update();
            console.log('📈 Chart updated successfully with auto-fit range');
            // (Do NOT call resetZoom here; we already set min/max explicitly)
            
        }


    };

    NS.Trend = Trend;

    // ======================================================
    // Point Selector UI logic (Phase 9.3 enhancement)
    // ======================================================
    async function initPointSelector() {
    const sysSel = document.getElementById('trend-system');
    const locSel = document.getElementById('trend-location');
    const listDiv = document.getElementById('trend-point-list');
    if (!sysSel || !locSel || !listDiv) return;

    // 1️⃣ Hardcode systems for now (since defs folder isn’t browsable)
    const systems = ['TRA'];
    // Add a neutral placeholder so nothing is selected by default
    const placeholderSys = document.createElement('option');
    placeholderSys.value = '';
    placeholderSys.textContent = '-- Select System --';
    placeholderSys.disabled = true;
    placeholderSys.selected = true;
    sysSel.appendChild(placeholderSys);

    systems.forEach(s => {
        const opt = document.createElement('option');
        opt.value = s;
        opt.textContent = s;
        sysSel.appendChild(opt);
    });

    sysSel.addEventListener('change', async () => {
        locSel.innerHTML = '';
        listDiv.innerHTML = '';
        const sys = sysSel.value;
        // Always use absolute path from root (not relative to /systems/)
        const res = await fetch(`/defs/${sys}.json`);
        if (!res.ok) {
        console.error('Failed to load defs for', sys, res.status);
        return;
        }
        const defs = await res.json();
        const points = Array.isArray(defs) ? defs : defs.points || [];

        // Build unique location list
        const locations = [...new Set(points.map(p => p.loc || p.Location || 'Unknown'))];
        locations.sort();
        const placeholderLoc = document.createElement('option');
        placeholderLoc.value = '';
        placeholderLoc.textContent = '-- Select Location --';
        placeholderLoc.disabled = true;
        placeholderLoc.selected = true;
        locSel.appendChild(placeholderLoc);

        locations.forEach(l => {
        const opt = document.createElement('option');
        opt.value = l;
        opt.textContent = l;
        locSel.appendChild(opt);
        });
    });

    locSel.addEventListener('change', async () => {
        listDiv.innerHTML = '';
        const sys = sysSel.value;
        const loc = locSel.value;
        const res = await fetch(`/defs/${sys}.json`);
        if (!res.ok) return;
        const defs = await res.json();
        const points = Array.isArray(defs) ? defs : defs.points || [];

        points.filter(p =>
            String(p.signalType || p.type || p.Type || '').toUpperCase() === 'AI' &&
            String(p.loc || p.Location || '').toUpperCase() === loc.toUpperCase()
        )

        .forEach(p => {
            const key = `${p.loc}:${p.tag || p.Tag || p.name || ''}`;
            const label = `${p.loc}-${p.sys}-${p.equipType}-${p.equipId} ${p.desc || p.Desc || ''}`.trim();
            const div = document.createElement('div');
            div.textContent = label;
            div.title = key;
            div.onclick = () => {
                // highlight selection visually
                const allDivs = listDiv.querySelectorAll('div');
                allDivs.forEach(d => d.style.background = '');
                div.style.background = '#d0e9ff';

                // store the selected point (but don't add yet)
                Trend._selectedPoint = { key, label };
                console.log('✅ Selected point:', key);
            };

            listDiv.appendChild(div);
        });
    });

    }



    // Boot when the iframe DOM is ready
    document.addEventListener('DOMContentLoaded', () => {
    // Phase 9.2 Fix: get args from parent if not local
    let args = {};
    try {
        args = global.SCADA?.PendingArgs 
            || global.parent?.SCADA?.PendingArgs 
            || {};
    } catch (e) {
        console.warn("⚠️ Unable to read PendingArgs from parent:", e);
    }
    Trend.init(args);
    initPointSelector();
    });

})(window);
