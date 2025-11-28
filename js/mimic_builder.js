document.addEventListener('DOMContentLoaded', () => {
    const state = {
        symbols: [],
        systems: [],
        canvasElements: [],
        selectedElementId: null,
        nextId: 1,
        draggedItem: null,
        symbolContentCache: {}
    };

    const symbolList = document.getElementById('symbolList');
    const canvas = document.getElementById('mimicCanvas');
    const propertiesPanel = document.getElementById('propertiesPanel');
    const generateBtn = document.getElementById('generateBtn');
    const pageLocInput = document.getElementById('pageLoc');
    const pageSysInput = document.getElementById('pageSys');
    const loadBtn = document.getElementById('loadBtn');
    const loadFileInput = document.getElementById('loadFileInput');

    init();

    async function init() {
        await loadSymbols();
        await loadSystems();
        setupDragAndDrop();
        setupCanvasInteractions();

        generateBtn.addEventListener('click', handleGenerate);
        loadBtn.addEventListener('click', () => loadFileInput.click());
        loadFileInput.addEventListener('change', handleFileLoad);
    }

    async function loadSymbols() {
        try {
            const res = await fetch('/api/dev/symbols');
            const files = await res.json();
            state.symbols = files;
            renderSymbolList();
        } catch (err) {
            console.error('Failed to load symbols:', err);
            symbolList.innerHTML = '<div class="error">Failed to load symbols</div>';
        }
    }

    async function loadSystems() {
        try {
            const res = await fetch('/api/dev/systems');
            state.systems = await res.json();
        } catch (err) {
            console.error('Failed to load systems:', err);
        }
    }

    async function loadSystemIO(systemName) {
        try {
            const res = await fetch(`/api/dev/systems/${systemName}`);
            return await res.json();
        } catch (err) {
            console.error(`Failed to load I/O for ${systemName}:`, err);
            return null;
        }
    }

    async function getSymbolContent(symbolName) {
        if (state.symbolContentCache[symbolName]) {
            return state.symbolContentCache[symbolName];
        }
        try {
            const res = await fetch(`/api/dev/symbol_content/${symbolName}`);
            if (res.ok) {
                const data = await res.json();
                state.symbolContentCache[symbolName] = data.content;
                return data.content;
            }
        } catch (err) {
            console.error(`Failed to load content for ${symbolName}:`, err);
        }
        return null;
    }

    function renderSymbolList() {
        symbolList.innerHTML = '';
        state.symbols.forEach(symbol => {
            const el = document.createElement('div');
            el.className = 'tool-item';
            el.draggable = true;
            el.dataset.type = 'symbol';
            el.dataset.symbolType = symbol;
            el.innerHTML = `<span class="icon">📦</span> ${capitalize(symbol)}`;

            el.addEventListener('dragstart', (e) => {
                state.draggedItem = {
                    type: 'symbol',
                    symbolType: symbol
                };
                e.dataTransfer.effectAllowed = 'copy';
            });

            symbolList.appendChild(el);
        });
    }

    function capitalize(str) {
        return str.charAt(0).toUpperCase() + str.slice(1);
    }

    function setupDragAndDrop() {
        document.querySelectorAll('.tool-item[data-type^="static-"]').forEach(el => {
            el.addEventListener('dragstart', (e) => {
                state.draggedItem = {
                    type: el.dataset.type
                };
                e.dataTransfer.effectAllowed = 'copy';
            });
        });

        canvas.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
        });

        canvas.addEventListener('drop', (e) => {
            e.preventDefault();
            if (!state.draggedItem) return;

            const rect = canvas.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;

            addElement(state.draggedItem, x, y);
            state.draggedItem = null;
        });
    }

    async function addElement(itemData, x, y) {
        const id = `el_${state.nextId++}`;
        const element = {
            id,
            type: itemData.type,
            x,
            y,
            width: 100,
            height: 40,
            rotation: 0,
            text: '',
            fontSize: 12,
            fontWeight: 'normal',
            color: '#000000',
            backgroundColor: '#000000',
            symbolType: itemData.symbolType,
            system: '',
            equipment: '',
            tag: ''
        };

        if (element.type === 'static-line') {
            element.width = 100;
            element.height = 2;
        } else if (element.type === 'static-arrow') {
            element.width = 50;
            element.height = 2;
        } else if (element.type === 'symbol') {
            element.width = 60;
            element.height = 60;
        }

        state.canvasElements.push(element);
        await renderCanvasElement(element);
        selectElement(id);
    }

    async function renderCanvasElement(elData) {
        const el = document.createElement('div');
        el.id = elData.id;
        el.className = `canvas-element ${elData.type}`;
        el.style.left = `${elData.x}px`;
        el.style.top = `${elData.y}px`;
        el.style.position = 'absolute';

        if (elData.type === 'static-text') {
            el.textContent = elData.text;
            el.style.fontSize = `${elData.fontSize}px`;
            el.style.fontWeight = elData.fontWeight;
            el.style.color = elData.color;
        } else if (elData.type === 'static-line' || elData.type === 'static-arrow') {
            el.style.width = `${elData.width}px`;
            el.style.height = `${elData.height}px`;
            el.style.backgroundColor = elData.backgroundColor;
            el.style.transform = `rotate(${elData.rotation}deg)`;
        } else if (elData.type === 'symbol') {
            const content = await getSymbolContent(elData.symbolType);
            if (content) {
                el.innerHTML = content;
                const svg = el.querySelector('svg');
                if (svg) {
                    // Get original dimensions from SVG
                    const originalWidth = svg.getAttribute('width') || '60';
                    const originalHeight = svg.getAttribute('height') || '60';

                    // Update element data to store the original size (only if default 60x60)
                    if (elData.width === 60 && elData.height === 60) {
                        elData.width = parseInt(originalWidth);
                        elData.height = parseInt(originalHeight);
                    }

                    svg.style.width = `${elData.width}px`;
                    svg.style.height = `${elData.height}px`;
                    svg.style.display = 'block';
                }

                el.style.width = `${elData.width}px`;
                el.style.height = `${elData.height}px`;
            } else {
                el.textContent = elData.symbolType;
                el.style.border = '1px solid #ccc';
                el.style.padding = '5px';
                el.style.fontSize = '10px';
                el.style.width = `${elData.width}px`;
                el.style.height = `${elData.height}px`;
            }
        }

        canvas.appendChild(el);
    }

    function updateCanvasElement(elData) {
        const el = document.getElementById(elData.id);
        if (!el) return;

        el.style.left = `${elData.x}px`;
        el.style.top = `${elData.y}px`;

        if (elData.type === 'static-text') {
            el.textContent = elData.text;
            el.style.fontSize = `${elData.fontSize}px`;
            el.style.fontWeight = elData.fontWeight;
            el.style.color = elData.color;
        } else if (elData.type === 'static-line' || elData.type === 'static-arrow') {
            el.style.width = `${elData.width}px`;
            el.style.height = `${elData.height}px`;
            el.style.backgroundColor = elData.backgroundColor;
            el.style.transform = `rotate(${elData.rotation}deg)`;
        }
    }

    function setupCanvasInteractions() {
        let isDragging = false;
        let dragOffset = { x: 0, y: 0 };
        let activeElId = null;

        canvas.addEventListener('mousedown', (e) => {
            const element = e.target.closest('.canvas-element');
            if (element) {
                isDragging = true;
                activeElId = element.id;
                const rect = element.getBoundingClientRect();
                dragOffset.x = e.clientX - rect.left;
                dragOffset.y = e.clientY - rect.top;
                selectElement(activeElId);
                e.stopPropagation();
            } else {
                selectElement(null);
            }
        });

        window.addEventListener('mousemove', (e) => {
            if (isDragging && activeElId) {
                const rect = canvas.getBoundingClientRect();
                const x = e.clientX - rect.left - dragOffset.x;
                const y = e.clientY - rect.top - dragOffset.y;

                const elData = state.canvasElements.find(el => el.id === activeElId);
                if (elData) {
                    elData.x = x;
                    elData.y = y;
                    updateCanvasElement(elData);
                }
            }
        });

        window.addEventListener('mouseup', () => {
            isDragging = false;
            activeElId = null;
        });
    }

    function selectElement(id) {
        state.selectedElementId = id;

        document.querySelectorAll('.canvas-element').forEach(el => el.classList.remove('selected'));
        if (id) {
            const el = document.getElementById(id);
            if (el) el.classList.add('selected');
        }

        renderPropertiesPanel();
    }

    function renderPropertiesPanel() {
        propertiesPanel.innerHTML = '';
        if (!state.selectedElementId) {
            propertiesPanel.innerHTML = '<div class="empty-state">Select an element to edit properties</div>';
            return;
        }

        const elData = state.canvasElements.find(el => el.id === state.selectedElementId);
        if (!elData) return;

        let templateId = '';
        if (elData.type === 'symbol') templateId = 'symbol-props-template';
        else if (elData.type === 'static-text') templateId = 'text-props-template';
        else if (elData.type.startsWith('static-')) templateId = 'line-props-template';

        const template = document.getElementById(templateId);
        if (!template) return;

        const clone = template.content.cloneNode(true);
        propertiesPanel.appendChild(clone);

        bindPropertyInputs(elData);

        if (elData.type === 'symbol') {
            setupSymbolProperties(elData);
        }
    }

    function bindPropertyInputs(elData) {
        propertiesPanel.querySelectorAll('[data-prop]').forEach(input => {
            const prop = input.dataset.prop;
            if (elData[prop] !== undefined) {
                input.value = elData[prop];
            }

            input.addEventListener('input', (e) => {
                const val = e.target.type === 'number' ? Number(e.target.value) : e.target.value;
                elData[prop] = val;
                updateCanvasElement(elData);
            });
        });
    }

    async function setupSymbolProperties(elData) {
        const systemSelect = propertiesPanel.querySelector('[data-prop="systemSelect"]');
        const equipSelect = propertiesPanel.querySelector('[data-prop="equipSelect"]');
        const tagPreview = propertiesPanel.querySelector('[data-prop="tagPreview"]');
        const idInput = propertiesPanel.querySelector('[data-prop="id"]');

        idInput.value = elData.id;

        state.systems.forEach(sys => {
            const opt = document.createElement('option');
            opt.value = sys.name;
            opt.textContent = sys.name;
            if (elData.system === sys.name) opt.selected = true;
            systemSelect.appendChild(opt);
        });

        const loadEquip = async (sysName) => {
            equipSelect.innerHTML = '<option value="">Loading...</option>';
            equipSelect.disabled = true;

            const data = await loadSystemIO(sysName);
            equipSelect.innerHTML = '<option value="">Select Equipment...</option>';

            if (data && data.points) {
                const equipment = new Set();
                data.points.forEach(pt => {
                    if (pt.equipType && pt.equipId) {
                        equipment.add(`${pt.equipType}${pt.equipId}`);
                    }
                });

                Array.from(equipment).sort().forEach(eq => {
                    const opt = document.createElement('option');
                    opt.value = eq;
                    opt.textContent = eq;
                    if (elData.equipment === eq) opt.selected = true;
                    equipSelect.appendChild(opt);
                });
                equipSelect.disabled = false;
            }
        };

        if (elData.system) {
            await loadEquip(elData.system);
        }

        systemSelect.addEventListener('change', async (e) => {
            elData.system = e.target.value;
            elData.equipment = '';
            elData.tag = '';
            tagPreview.textContent = '-';
            if (elData.system) {
                await loadEquip(elData.system);
            } else {
                equipSelect.innerHTML = '<option value="">Select Equipment...</option>';
                equipSelect.disabled = true;
            }
        });

        equipSelect.addEventListener('change', (e) => {
            elData.equipment = e.target.value;
            updateTagPreview();
        });

        function updateTagPreview() {
            if (elData.system && elData.equipment) {
                const loc = pageLocInput.value || 'LOC';
                const sys = pageSysInput.value || elData.system;
                elData.tag = `${loc}-${sys}-${elData.equipment}`;
                tagPreview.textContent = elData.tag;
            } else {
                tagPreview.textContent = '-';
            }
        }

        pageLocInput.addEventListener('input', updateTagPreview);
        pageSysInput.addEventListener('input', updateTagPreview);
        updateTagPreview();
    }

    async function handleFileLoad(e) {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async (event) => {
            const content = event.target.result;
            await parseAndLoadMimic(content, file.name);
        };
        reader.readAsText(file);

        loadFileInput.value = '';
    }

    async function parseAndLoadMimic(htmlContent, filename) {
        state.canvasElements = [];
        canvas.innerHTML = '';
        state.nextId = 1;

        const parser = new DOMParser();
        const doc = parser.parseFromString(htmlContent, 'text/html');

        const scriptContent = Array.from(doc.scripts).find(s => s.textContent.includes('const LOC ='))?.textContent;
        if (scriptContent) {
            const locMatch = scriptContent.match(/const LOC = "([^"]+)"/);
            const sysMatch = scriptContent.match(/const SYS = "([^"]+)"/);
            if (locMatch) pageLocInput.value = locMatch[1];
            if (sysMatch) pageSysInput.value = sysMatch[1];
        }

        const container = doc.getElementById('systemMimic');
        if (container) {
            const children = Array.from(container.children);
            for (const child of children) {
                const style = child.getAttribute('style') || '';
                const leftMatch = style.match(/left:\s*(\d+(\.\d+)?)px/);
                const topMatch = style.match(/top:\s*(\d+(\.\d+)?)px/);

                if (leftMatch && topMatch) {
                    const x = parseFloat(leftMatch[1]);
                    const y = parseFloat(topMatch[1]);

                    const symbolDiv = child.querySelector('div[class$="-container"]');

                    if (symbolDiv) {
                        const cls = symbolDiv.className;
                        const symbolType = cls.replace('-container', '');
                        const labelDiv = child.querySelector('div[id$="Label"]');
                        const equipment = labelDiv ? labelDiv.textContent : '';

                        const element = {
                            id: `el_${state.nextId++}`,
                            type: 'symbol',
                            x,
                            y,
                            width: 60, height: 60,
                            symbolType,
                            system: pageSysInput.value,
                            equipment,
                            tag: ''
                        };

                        state.canvasElements.push(element);
                        await renderCanvasElement(element);

                    } else {
                        if (child.textContent.trim() && !child.children.length) {
                            const text = child.textContent.trim();
                            const fontSizeMatch = style.match(/font-size:\s*(\d+)px/);
                            const colorMatch = style.match(/color:\s*([^;]+)/);

                            const element = {
                                id: `el_${state.nextId++}`,
                                type: 'static-text',
                                x, y,
                                text,
                                fontSize: fontSizeMatch ? parseInt(fontSizeMatch[1]) : 12,
                                fontWeight: style.includes('bold') ? 'bold' : 'normal',
                                color: colorMatch ? colorMatch[1].trim() : '#000000'
                            };
                            state.canvasElements.push(element);
                            renderCanvasElement(element);
                        } else {
                            const wMatch = style.match(/width:\s*(\d+)px/);
                            const hMatch = style.match(/height:\s*(\d+)px/);
                            const rotMatch = style.match(/rotate\((\d+)deg\)/);
                            const bgMatch = style.match(/background-color:\s*([^;]+)/);

                            const hasArrowHead = child.querySelector('div');

                            const element = {
                                id: `el_${state.nextId++}`,
                                type: hasArrowHead ? 'static-arrow' : 'static-line',
                                x, y,
                                width: wMatch ? parseInt(wMatch[1]) : 100,
                                height: hMatch ? parseInt(hMatch[1]) : 2,
                                rotation: rotMatch ? parseInt(rotMatch[1]) : 0,
                                backgroundColor: bgMatch ? bgMatch[1].trim() : '#000000'
                            };
                            state.canvasElements.push(element);
                            renderCanvasElement(element);
                        }
                    }
                }
            }
        }

        alert('Mimic loaded successfully!');
    }

    async function handleGenerate() {
        const loc = pageLocInput.value;
        const sys = pageSysInput.value;

        if (!loc || !sys) {
            alert('Please enter Location (LOC) and System (SYS) before generating.');
            return;
        }

        const filename = `${loc}_${sys}.html`;

        if (!confirm(`Generate mimic page "${filename}"?`)) return;

        const content = generateHTML(loc, sys);

        try {
            const res = await fetch('/api/dev/mimic', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    filename,
                    content,
                    overwrite: true
                })
            });

            if (res.status === 409) {
                if (confirm('File already exists. Overwrite?')) {
                    // Retry
                }
            } else if (!res.ok) {
                throw new Error('Server error');
            } else {
                alert(`✅ Mimic page generated: systems/${filename}`);
            }
        } catch (err) {
            console.error(err);
            alert('Failed to generate mimic page.');
        }
    }

    function generateHTML(loc, sys) {
        const pumps = [];
        const pits = [];
        const ai_textb = [];
        const selectors = [];

        let layoutHTML = '';

        state.canvasElements.forEach(el => {
            const style = `position: absolute; left: ${el.x}px; top: ${el.y}px;`;

            if (el.type === 'symbol') {
                let domId = '';

                if (el.symbolType.toLowerCase().includes('pump')) {
                    pumps.push(el.equipment);
                    domId = `pump${pumps.length}`;
                } else if (el.symbolType.toLowerCase().includes('pit')) {
                    pits.push(el.equipment);
                    domId = `pit${pits.length}`;
                } else if (el.symbolType.toLowerCase().includes('ai')) {
                    ai_textb.push(el.equipment);
                    domId = `ai${ai_textb.length}`;
                } else if (el.symbolType.toLowerCase().includes('selector')) {
                    selectors.push(el.equipment);
                    domId = `selector${selectors.length}`;
                } else {
                    domId = el.id;
                }

                const needsLabel = !el.symbolType.toLowerCase().includes('selector');

                layoutHTML += `
    <div style="${style} text-align: center;">
        <div id="${domId}" class="${el.symbolType}-container"></div>${needsLabel ? `
        <div id="${domId}Label" style="font-size:12px; margin-top:4px;">${el.equipment}</div>` : ''}
    </div>`;

            } else if (el.type === 'static-text') {
                layoutHTML += `
    <div style="${style} font-size: ${el.fontSize}px; font-weight: ${el.fontWeight}; color: ${el.color}; white-space: nowrap;">
        ${el.text}
    </div>`;
            } else if (el.type === 'static-line' || el.type === 'static-arrow') {
                let inner = '';
                if (el.type === 'static-arrow') {
                    inner = `<div style="position: absolute; right: -6px; top: 50%; transform: translateY(-50%); border-top: 6px solid transparent; border-bottom: 6px solid transparent; border-left: 8px solid ${el.backgroundColor};"></div>`;
                }

                layoutHTML += `
    <div style="${style} width: ${el.width}px; height: ${el.height}px; background-color: ${el.backgroundColor}; transform: rotate(${el.rotation}deg); transform-origin: center;">
        ${inner}
    </div>`;
            }
        });

        return `
<style>
  button:disabled {
    background: #ddd !important;
    color: #777 !important;
    border: 1px solid #aaa !important;
    cursor: not-allowed !important;
    opacity: 0.6;
  }
  .pump-container, .selector-container { cursor: pointer; }
</style>

<div id="systemMimic" class="system-mimic" style="position: relative; width: 100%; height: 100%;">
${layoutHTML}
</div>

<script>
  const LOC = "${loc}";
  const SYS = "${sys}";

  const config = {
    pits: ${JSON.stringify(pits)},
    pumps: ${JSON.stringify(pumps)},
    ai_textb: ${JSON.stringify(ai_textb)}${selectors.length > 0 ? `,
    selectors: ${JSON.stringify(selectors)}` : ''}
  };

  window.SCADA = window.parent.SCADA;
  const Core = window.SCADA.Core;
  const Symbols = window.SCADA.Symbols;

  function registerInitialHighlights() {
    if (!Core.Highlight) return;
    const mapId = id => document.getElementById(id);
    
    config.pits.forEach((pitId, i) => {
      const el = mapId(\`pit\${i + 1}\`);
      const lbl = mapId(\`pit\${i + 1}Label\`);
      if (el && lbl) Core.Highlight.register(\`\${LOC}-\${SYS}-\${lbl.textContent}\`, el);
    });
    
    config.pumps.forEach((pumpId, i) => {
        const el = mapId(\`pump\${i + 1}\`);
        const lbl = mapId(\`pump\${i + 1}Label\`);
        if (el && lbl) Core.Highlight.register(\`\${LOC}-\${SYS}-\${lbl.textContent}\`, el);
    });

    config.ai_textb?.forEach((aiId, i) => {
      const el = mapId(\`ai\${i + 1}\`);
      if (el) Core.Highlight.register(\`\${LOC}-\${SYS}-\${aiId}\`, el);
    });
    
    config.selectors?.forEach((selId, i) => {
      const el = mapId(\`selector\${i + 1}\`);
      if (el) Core.Highlight.register(\`\${LOC}-\${SYS}-\${selId}\`, el);
    });
    
    Core.Highlight.equipIfPending();
  }

  function safeInit() {
    const checkExist = () => {
      if ((config.pumps.length && document.getElementById("pump1")) ||
          (config.pits.length && document.getElementById("pit1")) ||
          (config.ai_textb.length && document.getElementById("ai1")) ||
          (config.selectors && config.selectors.length && document.getElementById("selector1"))) { 
        initSymbols(); 
      } else { 
        setTimeout(checkExist, 50); 
      }
    };
    checkExist();
  }

  if (document.readyState === "complete") { safeInit(); } else { window.addEventListener("load", safeInit); }

  function refresh${sys}(pumps, pits, aiSymbols, selectors, PanelMode, PanelRemote, data, alarms) {
    if (!data || !alarms) return;
    try {
      config.pits.forEach((pitId, i) => {
        if (pits[i]) {
          const cls = pits[i].getVisualClass(data, alarms, LOC);
          pits[i].update(cls.pct, cls.visualClass);
          pits[i].showOverride(cls.override);
        }
      });

      pumps.forEach(pump => {
        const cls = pump.getVisualClass(data, alarms, LOC);
        pump.update(cls.visualClass);
        pump.showOverride((cls.run?.mo_i) || (cls.trip?.mo_i));
      });

      config.ai_textb?.forEach((aiId, i) => {
        if (aiSymbols[i]) {
          const cls = aiSymbols[i].getVisualClass(data, alarms, LOC);
          if (cls.value !== null) {
            aiSymbols[i].update(cls.value, cls.limits, cls.decimals, cls.flash);
            aiSymbols[i].showOverride(cls.override);
          }
        }
      });

      config.selectors?.forEach((selId, i) => {
        if (selectors[i]) {
          const cls = selectors[i].getVisualClass(data, alarms, LOC);
          selectors[i].update(cls.visualClass);
          selectors[i].showOverride(cls.override);
        }
      });

    } catch (err) {
      console.error("${sys} mimic refresh failed:", err);
    }
  }

  function initSymbols() {
    const initTasks = [];

    config.pumps.forEach((pumpId, i) => {
      initTasks.push(Symbols.Pump.init(\`pump\${i + 1}\`, {
        equipKey: \`\${LOC}-\${SYS}-\${pumpId}\`,
        faceplate: Core.Naming.buildFullName({ loc: LOC, sys: SYS, equipType: "SUP", equipId: pumpId.slice(-3) }),
        loc: LOC,
        noAutoRefresh: true,
        doc: document
      }));
    });

    config.pits.forEach((pitId, i) => {
      initTasks.push(Symbols.Pit.init(\`pit\${i + 1}\`, {
        equipKey: \`\${LOC}-\${SYS}-\${pitId}\`,
        faceplate: Core.Naming.buildFullName({ loc: LOC, sys: SYS, equipType: "SPT", equipId: pitId.slice(-3) }),
        loc: LOC,
        noAutoRefresh: true,
        doc: document
      }));
    });

    const aiSymbols = [];
    config.ai_textb?.forEach((aiId, i) => {
      initTasks.push(
        Symbols.AI_TEXTB.init(\`ai\${i + 1}\`, {
          loc: LOC, sys: SYS, equipId: aiId.slice(-3), equipType: "FLO", unit: "L/h",
          noAutoRefresh: true,
          doc: document
        }).then(api => {
          aiSymbols[i] = api;
          return api;
        })
      );
    });

    const selectorSymbols = [];
    config.selectors?.forEach((selId, i) => {
      initTasks.push(
        Symbols.Selector.init(\`selector\${i + 1}\`, {
          equipKey: \`\${LOC}-\${SYS}-\${selId}\`,
          type: "auto-manual",
          loc: LOC,
          noAutoRefresh: true,
          doc: document
        }).then(api => {
          selectorSymbols[i] = api;
          return api;
        })
      );
    });

    Promise.all(initTasks).then(symbols => {
      const pumpSymbols = symbols.slice(0, config.pumps.length);
      const pitSymbols = symbols.slice(config.pumps.length, config.pumps.length + config.pits.length);
      
      const PanelMode = { getVisualClass: () => ({}), update: () => {}, showOverride: () => {} };
      const PanelRemote = { getVisualClass: () => ({}), update: () => {}, showOverride: () => {} };

      if (Core.Highlight) {
        registerInitialHighlights();
        Core.Highlight.equipIfPending();
      }

      const sm = SCADA?.Core?.SocketManager;
      if (sm) {
        const scope = \`system:\${LOC}\`;
        console.log(\`📡 \${LOC}_\${SYS}: Direct WS subscription to \${scope}\`);

        let cachedPoints = {};
        let cachedAlarms = [];

        const handleSystemUpdate = (msg) => {
          if (msg.alarms) {
            cachedAlarms = Array.isArray(msg.alarms) ? msg.alarms : Object.values(msg.alarms);
            if (msg.type === 'alarms' || msg.type === 'alarm') {
              const data = { points: Object.values(cachedPoints) };
              refresh${sys}(pumpSymbols, pitSymbols, aiSymbols, selectorSymbols, PanelMode, PanelRemote, data, cachedAlarms);
              return;
            }
          }

          if (msg.type === 'snapshot' && msg.points) {
            cachedPoints = msg.points;
            const data = { points: Object.values(cachedPoints) };
            refresh${sys}(pumpSymbols, pitSymbols, aiSymbols, selectorSymbols, PanelMode, PanelRemote, data, cachedAlarms);
          }
          else if (msg.type === 'update' && msg.diffs?.points) {
            if (msg.diffs.points.changed) Object.assign(cachedPoints, msg.diffs.points.changed);
            if (msg.diffs.points.removed) msg.diffs.points.removed.forEach(key => delete cachedPoints[key]);
            
            const data = { points: Object.values(cachedPoints) };
            refresh${sys}(pumpSymbols, pitSymbols, aiSymbols, selectorSymbols, PanelMode, PanelRemote, data, cachedAlarms);
          }
        };

        sm.subscribe(scope, handleSystemUpdate);
        sm.subscribe('alarms', handleSystemUpdate);

        window.addEventListener('beforeunload', () => {
          try {
            sm.unsubscribe(scope, handleSystemUpdate);
            sm.unsubscribe('alarms', handleSystemUpdate);
          } catch (e) { }
        });
      }
    });

    console.log("✅ Mimic loaded");
    if (window.parent) { window.parent.postMessage({ type: "mimicReady" }, "*"); }
  }
</script>
`;
    }
});
