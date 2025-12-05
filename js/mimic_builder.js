document.addEventListener('DOMContentLoaded', () => {
    // --- State ---
    let symbols = [];
    let systems = [];
    let navData = { locations: [] };
    let selectedLoc = null;
    let selectedSys = null;
    let currentFilename = null;

    // --- Elements ---
    const symbolList = document.getElementById('symbolList');
    const canvas = document.getElementById('mimicCanvas');
    const propertiesPanel = document.getElementById('propertiesPanel');
    const generateBtn = document.getElementById('generateBtn');
    const loadBtn = document.getElementById('loadBtn');
    const loadFileInput = document.getElementById('loadFileInput');

    // Page Settings Inputs
    const pageLocInput = document.getElementById('pageLoc');
    const pageSysInput = document.getElementById('pageSys');
    const pageTitleInput = document.getElementById('pageTitle');

    // --- Templates ---
    const symbolPropsTemplate = document.getElementById('symbol-props-template');
    const textPropsTemplate = document.getElementById('text-props-template');
    const linePropsTemplate = document.getElementById('line-props-template');

    // --- Canvas State ---
    let canvasElements = [];
    let selectedElement = null;
    let draggedItem = null; // Item being dragged from sidebar

    // Shared Navigation State (Already declared above)

    // --- Initialization ---
    async function loadSymbols() {
        try {
            const res = await fetch('/api/dev/symbols');
            const files = await res.json();
            symbols = files;
            renderSymbolList();
        } catch (e) {
            console.error("Failed to load symbols:", e);
            symbolList.innerHTML = '<div class="error">Failed to load symbols</div>';
        }
    }

    function renderSymbolList() {
        symbolList.innerHTML = '';
        symbols.forEach(sym => {
            if (sym === 'selector') {
                // Split into two tools
                ['selector-mode', 'selector-remote'].forEach(subType => {
                    const div = document.createElement('div');
                    div.className = 'tool-item';
                    div.draggable = true;
                    div.dataset.type = 'symbol';
                    div.dataset.symbol = subType; // Use sub-type as symbol name for drag
                    div.innerHTML = `<span class="icon">⚡</span> ${subType === 'selector-mode' ? 'Selector (Mode)' : 'Selector (Remote)'}`;

                    div.addEventListener('dragstart', (e) => {
                        draggedItem = { type: 'symbol', symbol: subType };
                        e.dataTransfer.effectAllowed = 'copy';
                    });
                    symbolList.appendChild(div);
                });
            } else {
                const div = document.createElement('div');
                div.className = 'tool-item';
                div.draggable = true;
                div.dataset.type = 'symbol';
                div.dataset.symbol = sym;
                div.innerHTML = `<span class="icon">⚡</span> ${sym}`;

                div.addEventListener('dragstart', (e) => {
                    draggedItem = { type: 'symbol', symbol: sym };
                    e.dataTransfer.effectAllowed = 'copy';
                });
                symbolList.appendChild(div);
            }
        });
    }

    async function loadSystems() {
        try {
            const res = await fetch('/api/dev/systems');
            systems = await res.json();
        } catch (e) {
            console.error("Failed to load systems:", e);
        }
    }

    // --- Drag and Drop ---
    function setupDragAndDrop() {
        // Static Tools Drag Start
        document.querySelectorAll('.tool-item[data-type^="static-"]').forEach(item => {
            item.addEventListener('dragstart', (e) => {
                draggedItem = { type: item.dataset.type };
                e.dataTransfer.effectAllowed = 'copy';
            });
        });

        // Canvas Drop Zone
        canvas.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
        });

        canvas.addEventListener('drop', (e) => {
            e.preventDefault();
            if (!draggedItem) return;

            const rect = canvas.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;

            addElement(draggedItem, x, y);
            draggedItem = null;
        });
    }

    // --- Canvas Interaction ---
    function addElement(item, x, y) {
        const id = 'el_' + Date.now();
        const el = {
            id,
            type: item.type,
            x,
            y,
            props: {}
        };

        // Default Props
        if (item.type === 'symbol') {
            if (item.symbol === 'selector-mode') {
                el.props = {
                    symbol: 'selector',
                    id: '',
                    system: '',
                    equip: '',
                    tag: 'Panel.Mode'
                };
            } else if (item.symbol === 'selector-remote') {
                el.props = {
                    symbol: 'selector',
                    id: '',
                    system: '',
                    equip: '',
                    tag: 'Panel.LocalRemote'
                };
            } else {
                el.props = {
                    symbol: item.symbol,
                    id: `sym_${canvasElements.length + 1}`, // Generic unique-ish ID
                    system: '',
                    equip: '',
                    tag: '' // Auto-generated
                };
            }
        } else if (item.type === 'static-text') {
            el.props = {
                text: 'New Text',
                fontSize: 12,
                color: '#000000',
                fontWeight: 'normal'
            };
        } else if (item.type === 'static-line') {
            el.props = {
                width: 100,
                height: 2,
                backgroundColor: '#000000',
                rotation: 0
            };
        } else if (item.type === 'static-arrow') {
            el.props = {
                width: 50,
                height: 2,
                backgroundColor: '#000000',
                rotation: 0
            };
        }

        canvasElements.push(el);
        renderCanvas();
        selectElement(el);
    }

    // --- Symbol Cache ---
    const symbolContentCache = {};

    async function getSymbolContent(symbolName) {
        // Map subtypes to actual files
        let fileName = symbolName;
        if (symbolName === 'selector-mode' || symbolName === 'selector-remote') {
            fileName = 'selector';
        }

        if (symbolContentCache[symbolName]) return symbolContentCache[symbolName];

        try {
            const res = await fetch(`symbols/${fileName}.html`);
            if (res.ok) {
                const text = await res.text();
                symbolContentCache[symbolName] = text;
                return text;
            }
        } catch (e) {
            console.error(`Failed to load symbol ${symbolName}:`, e);
        }
        return null;
    }

    function renderCanvas() {
        canvas.innerHTML = '';
        canvasElements.forEach(el => {
            const div = document.createElement('div');
            div.className = 'canvas-element';
            div.id = el.id;
            div.style.left = el.x + 'px';
            div.style.top = el.y + 'px';

            if (el === selectedElement) div.classList.add('selected');

            // Render Content
            if (el.type === 'symbol') {
                if (symbolContentCache[el.props.symbol]) {
                    div.innerHTML = symbolContentCache[el.props.symbol];
                    // Remove placeholder styling if actual content is loaded
                    div.style.border = 'none';
                    div.style.padding = '0';
                    div.style.background = 'transparent';

                    // Special handling for selector preview
                    if (el.props.symbol === 'selector') {
                        const isMode = el.props.tag && el.props.tag.includes('Mode');
                        // Add a small label or modify content to distinguish
                        const label = document.createElement('div');
                        label.style.position = 'absolute';
                        label.style.bottom = '-15px';
                        label.style.left = '0';
                        label.style.width = '100%';
                        label.style.textAlign = 'center';
                        label.style.fontSize = '10px';
                        label.style.color = '#666';
                        label.style.backgroundColor = 'rgba(255,255,255,0.8)'; // Add background for readability
                        label.innerText = isMode ? 'Mode' : 'Remote';
                        div.appendChild(label);
                    }
                } else {
                    // Placeholder while loading
                    div.innerHTML = `<div class="symbol-placeholder">${el.props.symbol}</div>`;
                    div.style.border = '1px dashed #ccc';
                    div.style.padding = '5px';
                    div.style.background = '#fff';

                    // Trigger load
                    getSymbolContent(el.props.symbol).then(content => {
                        if (content) renderCanvas(); // Re-render once loaded
                    });
                }
            } else if (el.type === 'static-text') {
                div.innerText = el.props.text;
                div.style.fontSize = el.props.fontSize + 'px';
                div.style.color = el.props.color;
                div.style.fontWeight = el.props.fontWeight;
                div.style.whiteSpace = 'nowrap';
            } else if (el.type === 'static-line') {
                div.style.width = el.props.width + 'px';
                div.style.height = el.props.height + 'px';
                div.style.backgroundColor = el.props.backgroundColor;
                div.style.transform = `rotate(${el.props.rotation}deg)`;
                div.style.transformOrigin = '0 0';
            } else if (el.type === 'static-arrow') {
                div.style.width = el.props.width + 'px';
                div.style.height = el.props.height + 'px';
                div.style.backgroundColor = el.props.backgroundColor;
                div.style.transform = `rotate(${el.props.rotation}deg)`;
                div.style.transformOrigin = 'center';

                // Simple arrow: Line + Triangle
                div.innerHTML = `<div style="position: absolute; right: -6px; top: 50%; transform: translateY(-50%); border-top: 6px solid transparent; border-bottom: 6px solid transparent; border-left: 8px solid ${el.props.backgroundColor};"></div>`;
            }

            // Interaction
            div.addEventListener('mousedown', (e) => {
                e.stopPropagation();
                selectElement(el);
                startDraggingElement(e, el);
            });

            canvas.appendChild(div);
        });
    }

    function selectElement(el) {
        selectedElement = el;
        renderCanvas(); // Update selection visual
        renderProperties(el);
    }

    function startDraggingElement(e, el) {
        const startX = e.clientX;
        const startY = e.clientY;
        const origX = el.x;
        const origY = el.y;

        function onMouseMove(e) {
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;
            el.x = origX + dx;
            el.y = origY + dy;

            // Update DOM directly for performance
            const div = document.getElementById(el.id);
            if (div) {
                div.style.left = el.x + 'px';
                div.style.top = el.y + 'px';
            }
        }

        function onMouseUp() {
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
        }

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    }

    function setupCanvasInteractions() {
        canvas.addEventListener('mousedown', (e) => {
            if (e.target === canvas) {
                selectedElement = null;
                renderCanvas();
                renderProperties(null);
            }
        });
    }

    // --- Properties Panel ---
    function renderProperties(el) {
        propertiesPanel.innerHTML = '';
        if (!el) {
            propertiesPanel.innerHTML = '<div class="empty-state">Select an element to edit properties</div>';
            return;
        }

        let template = null;
        if (el.type === 'symbol') template = symbolPropsTemplate;
        else if (el.type === 'static-text') template = textPropsTemplate;
        else if (el.type === 'static-line') template = linePropsTemplate;
        else if (el.type === 'static-arrow') template = linePropsTemplate;

        if (template) {
            const clone = template.content.cloneNode(true);
            propertiesPanel.appendChild(clone);
            bindProperties(el);
        }
    }

    function bindProperties(el) {
        const inputs = propertiesPanel.querySelectorAll('[data-prop]');
        inputs.forEach(input => {
            const prop = input.dataset.prop;

            // Special handling for System Select
            if (prop === 'systemSelect') {
                systems.forEach(sys => {
                    const opt = document.createElement('option');
                    opt.value = sys.name; // Using name as ID for now based on file structure
                    opt.text = sys.name;
                    input.appendChild(opt);
                });
                input.value = el.props.system || '';

                input.addEventListener('change', () => {
                    el.props.system = input.value;
                    updateEquipSelect(el); // Refresh equipment list
                    updateTagPreview(el);
                });

                // Initial population of equipment if system is selected
                if (el.props.system) updateEquipSelect(el);
            }
            // Special handling for Equipment Select
            else if (prop === 'equipSelect') {
                input.value = el.props.equip || '';
                input.addEventListener('change', () => {
                    el.props.equip = input.value;
                    updateTagPreview(el);
                });
            }
            // Standard Props
            else {
                if (el.props[prop] !== undefined) {
                    input.value = el.props[prop];
                }

                input.addEventListener('input', () => {
                    el.props[prop] = input.value;
                    if (prop === 'id') updateTagPreview(el);
                    renderCanvas(); // Re-render to show changes (e.g. text, color)
                });
            }
        });

        // Delete Button
        const delBtn = propertiesPanel.querySelector('[data-action="delete"]');
        if (delBtn) {
            delBtn.addEventListener('click', () => {
                canvasElements = canvasElements.filter(e => e !== el);
                selectedElement = null;
                renderCanvas();
                renderProperties(null);
            });
        }
    }

    async function updateEquipSelect(el) {
        const equipSelect = propertiesPanel.querySelector('[data-prop="equipSelect"]');
        if (!equipSelect) return;

        equipSelect.innerHTML = '<option value="">Select Equipment...</option>';
        equipSelect.disabled = true;

        if (!el.props.system) return;

        try {
            const res = await fetch(`/api/dev/systems/${el.props.system}`);
            if (res.ok) {
                const data = await res.json();

                // Group by Equipment Label (e.g. SUP001)
                const equipment = new Set();
                data.points.forEach(pt => {
                    if (pt.label) equipment.add(pt.label);
                    else if (pt.equipType && pt.equipId) equipment.add(pt.equipType + pt.equipId);
                });

                const sortedEquip = Array.from(equipment).sort();

                sortedEquip.forEach(eq => {
                    const opt = document.createElement('option');
                    opt.value = eq;
                    opt.text = eq;
                    equipSelect.appendChild(opt);
                });

                equipSelect.disabled = false;
                equipSelect.value = el.props.equip || '';
            }
        } catch (e) {
            console.error("Failed to load system points:", e);
        }
    }

    function updateTagPreview(el) {
        const preview = propertiesPanel.querySelector('[data-prop="tagPreview"]');
        if (!preview) return;

        let tag = el.props.equip || '-';

        // Special handling for selectors to preserve suffix
        if (el.props.symbol === 'selector') {
            const isMode = el.props.tag && el.props.tag.includes('Mode');
            const suffix = isMode ? 'Panel.Mode' : 'Panel.LocalRemote';
            // If equip is present, tag = equip + suffix? 
            // Or usually tag IS the suffix for these?
            // Let's assume tag = equip + '.' + suffix if equip exists
            if (el.props.equip) {
                tag = `${el.props.equip}.${suffix}`;
            } else {
                tag = suffix;
            }
        }

        preview.innerText = tag;
        el.props.tag = tag;
    }

    // --- Generation & Loading ---
    async function handleSaveClick() {
        const loc = pageLocInput.value.trim();
        const sys = pageSysInput.value.trim();

        if (!loc || !sys) {
            alert("Please enter Location and System codes.");
            return;
        }

        if (currentFilename) {
            // Edit Mode: Save directly
            await performSave(currentFilename);
        } else {
            // New Mode: Open Modal
            openSaveModal(loc, sys);
        }
    }

    async function performSave(filename) {
        const loc = pageLocInput.value.trim();
        const sys = pageSysInput.value.trim();
        const title = pageTitleInput.value.trim();

        // 1. Generate HTML Content
        const htmlContent = generateHTML(loc, sys, title);

        try {
            const res = await fetch('/api/dev/mimic', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    filename: filename,
                    content: htmlContent,
                    overwrite: true
                })
            });

            if (res.ok) {
                alert("Mimic saved successfully!");
                // Update state
                currentFilename = filename;
                updateEditorState();

                // Also update title in mimic_titles.json if title provided
                if (title) {
                    await saveTitle(filename, title);
                }
            } else {
                alert("Failed to save mimic.");
            }
        } catch (e) {
            console.error("Save error:", e);
            alert("Error saving mimic.");
        }
    }

    async function openSaveModal(loc, sys) {
        const modal = document.getElementById('saveModal');
        const list = document.getElementById('saveFileList');
        const input = document.getElementById('saveFilenameInput');

        modal.style.display = 'block';
        list.innerHTML = '<div class="loading">Loading existing files...</div>';

        // Fetch existing files to recommend name
        try {
            const res = await fetch('/api/dev/mimic_files');
            const allFiles = await res.json();

            // Filter by prefix
            const prefix = `${loc}_${sys}`;
            let existingFiles = allFiles.filter(f => f.startsWith(prefix));

            // Render list
            list.innerHTML = '';
            if (existingFiles.length === 0) {
                list.innerHTML = '<div style="padding:5px; color:#888;">No existing pages found in directory.</div>';
            } else {
                existingFiles.forEach(f => {
                    const div = document.createElement('div');
                    div.className = 'file-item';
                    div.innerText = f;
                    list.appendChild(div);
                });
            }

            // Recommend Name
            // Pattern: LOC_SYS.html, LOC_SYS_1.html ...
            const base = `${loc}_${sys}`;
            // Regex matches LOC_SYS.html or LOC_SYS_N.html
            const regex = new RegExp(`^${base}(?:_(\\d+))?\\.html$`, 'i');

            let maxNum = 0;
            let foundBase = false;
            let hasNumbered = false;

            existingFiles.forEach(f => {
                const match = f.match(regex);
                if (match) {
                    if (match[1]) {
                        const num = parseInt(match[1]);
                        if (num > maxNum) maxNum = num;
                        hasNumbered = true;
                    } else {
                        foundBase = true;
                    }
                }
            });

            let name;
            if (hasNumbered) {
                name = `${base}_${maxNum + 1}.html`;
            } else if (foundBase) {
                name = `${base}_1.html`;
            } else {
                name = `${base}.html`;
            }

            input.value = name;

        } catch (e) {
            console.error("Error preparing save modal:", e);
            list.innerHTML = 'Error loading list.';
        }
    }

    async function saveTitle(filename, title) {
        try {
            // Strip extension for saving title
            const key = filename.replace('.html', '');
            await fetch('/api/dev/titles', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ key: key, value: title })
            });
        } catch (e) {
            console.error("Failed to save title:", e);
        }
    }

    function generateHTML(loc, sys, title) {
        // Construct the full HTML for the mimic page
        let elementsHTML = '';
        const initTasks = [];

        // Group elements by type for config generation
        const pumps = [];
        const pits = [];
        const ai_textb = [];
        const selectors = [];

        const usedIds = new Set();

        canvasElements.forEach((el, index) => {
            if (el.type === 'symbol') {
                // Generate container

                const type = el.props.symbol; // e.g. pump, pit
                let domId = el.props.id || `${type}${index + 1}`; // e.g. pump1

                // Ensure uniqueness
                let originalId = domId;
                let counter = 1;
                while (usedIds.has(domId)) {
                    domId = `${originalId}_${counter}`;
                    counter++;
                }
                usedIds.add(domId);

                // Add to config arrays
                if (type === 'pump') pumps.push({ domId, equip: el.props.equip });
                else if (type === 'pit') pits.push({ domId, equip: el.props.equip });
                else if (type === 'ai_textb') ai_textb.push({ domId, equip: el.props.equip });
                else if (type.includes('selector')) {
                    // Infer type from tag. If tag contains 'Mode', it's mode. Else remote.
                    // Also check if the symbol name itself implies mode (e.g. from drag tool)
                    const isMode = (el.props.tag && el.props.tag.includes('Mode')) || (el.props.symbol === 'selector-mode');
                    selectors.push({ domId, equip: el.props.equip, type: isMode ? 'mode' : 'remote' });
                }

                // For selector, we need to know if it's mode or remote. 
                // In the editor, we might need a property for this. 
                // For now, let's default or try to infer.

                elementsHTML += `
    <div style="position: absolute; left: ${el.x}px; top: ${el.y}px; text-align: center;" data-equipment="${el.props.equip}">
        <div id="${domId}" class="${type.includes('selector') ? 'selector' : type}-container"></div>
    </div>
`;
            } else if (el.type === 'static-text') {
                elementsHTML += `
    <div style="position:absolute; left:${el.x}px; top:${el.y}px; font-size:${el.props.fontSize}px; color:${el.props.color}; font-weight:${el.props.fontWeight}; white-space:nowrap;">
        ${el.props.text}
    </div>
`;
            } else if (el.type === 'static-line') {
                elementsHTML += `
    <div style="position:absolute; left:${el.x}px; top:${el.y}px; width:${el.props.width}px; height:${el.props.height}px; background-color:${el.props.backgroundColor}; transform:rotate(${el.props.rotation}deg); transform-origin:0 0;"></div>
`;
            } else if (el.type === 'static-arrow') {
                elementsHTML += `
    <div style="position:absolute; left:${el.x}px; top:${el.y}px; width:${el.props.width}px; height:${el.props.height}px; background-color:${el.props.backgroundColor}; transform:rotate(${el.props.rotation}deg); transform-origin:center;">
        <div style="position: absolute; right: -6px; top: 50%; transform: translateY(-50%); border-top: 6px solid transparent; border-bottom: 6px solid transparent; border-left: 8px solid ${el.props.backgroundColor};"></div>
    </div>
`;
            }
        });

        // Generate Script Content
        const scriptContent = `
  const LOC = "${loc}";
  const SYS = "${sys}";

  const config = {
    pits: ${JSON.stringify(pits.map(p => ({ id: p.domId, equipment: p.equip })))},
    pumps: ${JSON.stringify(pumps.map(p => ({ id: p.domId, equipment: p.equip })))},
    ai_textb: ${JSON.stringify(ai_textb.map(p => ({ id: p.domId, equipment: p.equip })))},
    selectors: ${JSON.stringify(selectors.map(s => ({ id: s.domId, equipment: s.equip, type: s.type })))}
  };

  window.SCADA = window.parent.SCADA;
  const Core = window.SCADA.Core;
  const Symbols = window.SCADA.Symbols;

  function registerInitialHighlights() {
    if (!Core.Highlight) return;
    const mapId = id => document.getElementById(id);
    
    // Auto-generated highlight registration based on config
    // (Simplified for brevity, matching original pattern)
    ${pits.map(p => `if(mapId('${p.domId}')) Core.Highlight.register('${loc}-${sys}-${p.equip}', mapId('${p.domId}'));`).join('\n    ')}
    ${pumps.map(p => `if(mapId('${p.domId}')) Core.Highlight.register('${loc}-${sys}-${p.equip}', mapId('${p.domId}'));`).join('\n    ')}
    ${ai_textb.map(p => `if(mapId('${p.domId}')) Core.Highlight.register('${loc}-${sys}-${p.equip}', mapId('${p.domId}'));`).join('\n    ')}
    ${selectors.map(s => `if(mapId('${s.domId}')) Core.Highlight.register('${loc}-${sys}-${s.equipment}', mapId('${s.domId}'));`).join('\n    ')}
    
    Core.Highlight.equipIfPending();
  }

  function safeInit() {
    const checkExist = () => {
      // Check if first element of each type exists if configured
      const ready = 
        (!config.pumps.length || document.getElementById("${pumps[0]?.domId}")) &&
        (!config.pits.length || document.getElementById("${pits[0]?.domId}")) &&
        (!config.ai_textb.length || document.getElementById("${ai_textb[0]?.domId}")) &&
        (!config.selectors.length || document.getElementById("${selectors[0]?.domId}"));
        
      if (ready) { 
        initSymbols(); 
      } else { 
        setTimeout(checkExist, 50); 
      }
    };
    checkExist();
  }

  if (document.readyState === "complete") { safeInit(); } else { window.addEventListener("load", safeInit); }

  // Refresh Function (Generic)
  function refresh${sys}(pumps, pits, aiSymbols, selectorSymbols, PanelMode, PanelRemote, data, alarms) {
    if (!data || !alarms) return;
    try {
      // Pits
      config.pits.forEach((pitId, i) => {
        if (pits[i]) {
          const cls = pits[i].getVisualClass(data, alarms, LOC);
          pits[i].update(cls.pct, cls.visualClass);
          pits[i].showOverride(cls.override);
        }
      });

      // Pumps
      pumps.forEach(pump => {
        if (pump) {
          const cls = pump.getVisualClass(data, alarms, LOC);
          pump.update(cls.visualClass);
          pump.showOverride((cls.run?.mo_i) || (cls.trip?.mo_i));
        }
      });

      // AI
      config.ai_textb?.forEach((aiId, i) => {
        if (aiSymbols[i]) {
          const cls = aiSymbols[i].getVisualClass(data, alarms, LOC);
          if (cls.value !== null) {
            aiSymbols[i].update(cls.value, cls.limits, cls.decimals, cls.flash);
            aiSymbols[i].showOverride(cls.override);
          }
        }
      });

      // Selectors
      config.selectors.forEach((sel, i) => {
          if (selectorSymbols[i]) {
              const tagSuffix = sel.type === 'mode' ? 'Panel.Mode' : 'Panel.LocalRemote';
              const cls = selectorSymbols[i].getVisualClass(data, LOC, tagSuffix);
              if (cls.state) selectorSymbols[i].update(cls.state);
              selectorSymbols[i].showOverride(cls.override);
          }
      });

    } catch (err) {
      console.error("${sys} mimic refresh failed:", err);
    }
  }

  function initSymbols() {
    const initTasks = [];

    // Pumps
    ${pumps.map((p, i) => `
    initTasks.push(Symbols.Pump.init('${p.domId}', {
        equipKey: '${loc}-${sys}-${p.equip || "000"}',
        faceplate: Core.Naming.buildFullName({ loc: LOC, sys: SYS, equipType: "SUP", equipId: "${p.equip ? p.equip.slice(-3) : '000'}" }),
        loc: LOC,
        noAutoRefresh: true,
        doc: document
    }));`).join('')}

    // Pits
    ${pits.map((p, i) => `
    initTasks.push(Symbols.Pit.init('${p.domId}', {
        equipKey: '${loc}-${sys}-${p.equip || "000"}',
        faceplate: Core.Naming.buildFullName({ loc: LOC, sys: SYS, equipType: "SPT", equipId: "${p.equip ? p.equip.slice(-3) : '000'}" }),
        loc: LOC,
        noAutoRefresh: true,
        doc: document
    }));`).join('')}

    // AI
    const aiSymbols = [];
    ${ai_textb.map((p, i) => `
    initTasks.push(
        Symbols.AI_TEXTB.init('${p.domId}', {
          loc: LOC, sys: SYS, equipId: "${p.equip ? p.equip.slice(-3) : '000'}", equipType: "FLO", unit: "L/h",
          noAutoRefresh: true,
          doc: document
        }).then(api => { aiSymbols[${i}] = api; return api; })
    );`).join('')}

    // Selectors
    const selectorSymbols = [];
    ${selectors.map((s, i) => `
    initTasks.push(
        Symbols.Selector.init('${s.domId}', {
          equipKey: '${loc}-${sys}-${s.equip || "000"}',
          type: "${s.type}", // "mode" or "remote"
          tag: "${s.type === 'mode' ? 'Panel.Mode' : 'Panel.LocalRemote'}",
          faceplate: Core.Naming.buildFullName({ loc: LOC, sys: SYS, equipType: "SPP", equipId: "${s.equip ? s.equip.slice(-3) : '000'}" }),
          loc: LOC,
          doc: document
        }).then(api => { selectorSymbols[${i}] = api; return api; })
    );`).join('')}

    Promise.all(initTasks).then(symbols => {
      // Slice symbols back to arrays
      let offset = 0;
      const pumpSymbols = symbols.slice(offset, offset + ${pumps.length}); offset += ${pumps.length};
      const pitSymbols = symbols.slice(offset, offset + ${pits.length}); offset += ${pits.length};
      const aiSyms = symbols.slice(offset, offset + ${ai_textb.length}); offset += ${ai_textb.length};
      const selSyms = symbols.slice(offset, offset + ${selectors.length});

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
              refresh${sys}(pumpSymbols, pitSymbols, aiSyms, selSyms, PanelMode, PanelRemote, data, cachedAlarms);
              return;
            }
          }

          if (msg.type === 'snapshot' && msg.points) {
            cachedPoints = msg.points;
            const data = { points: Object.values(cachedPoints) };
            refresh${sys}(pumpSymbols, pitSymbols, aiSyms, selSyms, PanelMode, PanelRemote, data, cachedAlarms);
          }
          else if (msg.type === 'update' && msg.diffs?.points) {
            if (msg.diffs.points.changed) Object.assign(cachedPoints, msg.diffs.points.changed);
            if (msg.diffs.points.removed) msg.diffs.points.removed.forEach(key => delete cachedPoints[key]);
            
            const data = { points: Object.values(cachedPoints) };
            refresh${sys}(pumpSymbols, pitSymbols, aiSyms, selSyms, PanelMode, PanelRemote, data, cachedAlarms);
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
`;

        // Generate the full document
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>${title}</title>
    <style>
        body { margin: 0; padding: 0; background: #ffffff; overflow: hidden; }
        .symbol-container { position: absolute; }
        /* Add symbol specific container styles if needed */
        .pump-container, .pit-container, .selector-container, .ai_textb-container { cursor: pointer; }
    </style>
</head>
<body>
    <div id="mimic-container" style="position:relative; width:100%; height:100%;">
        ${elementsHTML}
    </div>

    <script>
        ${scriptContent}
    </script>
</body>
</html>`;
    }

    function handleFileLoad(e) {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            const content = event.target.result;
            parseAndLoadMimic(content, file.name);
        };
        reader.readAsText(file);
    }

    function parseAndLoadMimic(html, filename = null) {
        // Reset
        canvasElements = [];
        if (filename) currentFilename = filename;
        updateEditorState();

        // Create a temp DOM to parse
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');

        // Extract Title
        const title = doc.querySelector('title')?.innerText || '';
        pageTitleInput.value = title;

        // Extract Metadata from Script
        const scriptContent = doc.querySelector('script')?.innerText || '';
        const locMatch = scriptContent.match(/const LOC = "([^"]+)";/);
        const sysMatch = scriptContent.match(/const SYS = "([^"]+)";/);

        if (locMatch && locMatch[1]) pageLocInput.value = locMatch[1];
        if (sysMatch && sysMatch[1]) pageSysInput.value = sysMatch[1];

        // Extract Elements

        // 1. Static Text
        // Improved selector: look for divs with font-size style, excluding symbol containers
        doc.querySelectorAll('div[style*="font-size"]').forEach(div => {
            // Skip if it's inside a symbol container or is a symbol container
            if (div.closest('.symbol-container') || div.closest('[data-equipment]')) return;

            const style = div.style;
            canvasElements.push({
                id: 'el_' + Date.now() + Math.random(),
                type: 'static-text',
                x: parseFloat(style.left),
                y: parseFloat(style.top),
                props: {
                    text: div.innerText.trim(),
                    fontSize: parseFloat(style.fontSize) || 12,
                    color: style.color || '#000000',
                    fontWeight: style.fontWeight || 'normal'
                }
            });
        });

        // 2. Static Lines and Arrows
        // Look for divs with background-color but NO text and NO symbol class
        doc.querySelectorAll('div[style*="background-color"]').forEach(div => {
            // Skip if it's inside a symbol container or is a symbol container
            if (div.closest('.symbol-container') || div.closest('[data-equipment]')) return;
            if (div.innerText.trim().length > 0) return; // Skip text divs that might have bg

            const style = div.style;
            const width = parseFloat(style.width);
            const height = parseFloat(style.height);

            // Skip if invalid dimensions (e.g. 100% width containers)
            if (!width || !height) return;

            const rotMatch = style.transform.match(/rotate\(([-\d.]+)deg\)/);
            const rotation = rotMatch ? parseFloat(rotMatch[1]) : 0;

            // Check for arrow head
            const hasArrowHead = div.querySelector('div[style*="border-left"]');
            const type = hasArrowHead ? 'static-arrow' : 'static-line';

            canvasElements.push({
                id: 'el_' + Date.now() + Math.random(),
                type: type,
                x: parseFloat(style.left),
                y: parseFloat(style.top),
                props: {
                    width: width,
                    height: height,
                    backgroundColor: style.backgroundColor,
                    rotation: rotation
                }
            });
        });

        // 3. Symbols (Builder Format)
        doc.querySelectorAll('.symbol-container').forEach(div => {
            const style = div.style;
            const type = div.dataset.type;
            const id = div.id;

            canvasElements.push({
                id: id || 'el_' + Date.now() + Math.random(),
                type: 'symbol',
                x: parseFloat(style.left),
                y: parseFloat(style.top),
                props: {
                    symbol: type,
                    id: id,
                    system: '',
                    equip: '',
                    tag: ''
                }
            });
        });

        // 4. Symbols (Runtime Format - e.g. NBT_TRA_1.html)
        // Look for divs with data-equipment
        doc.querySelectorAll('div[data-equipment]').forEach(div => {
            const style = div.style;
            const equip = div.dataset.equipment;

            // Find inner symbol div
            const inner = div.firstElementChild;
            if (inner) {
                // Infer type from class (e.g. pump-container -> pump)
                let type = 'unknown';
                if (inner.classList.contains('pump-container')) type = 'pump';
                else if (inner.classList.contains('pit-container')) type = 'pit';
                else if (inner.classList.contains('selector-container')) type = 'selector';
                else if (inner.classList.contains('ai_textb-container')) type = 'ai_textb';

                // For selectors, try to infer if it's mode or remote
                let tag = equip;
                if (type === 'selector') {
                    // Try to find this ID in the script config
                    const id = inner.id;
                    const scriptContent = doc.querySelector('script')?.innerText || '';

                    // Robustly find the selector config in the script
                    // Look for: selectors: [ ... { id: "selector1", ... type: "mode" } ... ]
                    // We can try to extract the selectors array string
                    const selectorsMatch = scriptContent.match(/selectors:\s*(\[[\s\S]*?\])/);
                    if (selectorsMatch) {
                        try {
                            // This might be tricky if it's not valid JSON (keys not quoted)
                            // But our generator produces valid JSON for the array content: JSON.stringify(...)
                            const selectorsConfig = JSON.parse(selectorsMatch[1]);
                            const selConfig = selectorsConfig.find(s => s.id === id);

                            if (selConfig) {
                                if (selConfig.type === 'mode') {
                                    tag = 'Panel.Mode';
                                    // IMPORTANT: Set symbol to selector-mode so editor recognizes it
                                    // But wait, the loop below sets props.symbol = type (which is 'selector')
                                    // We need to override it later or change 'type' variable here?
                                    // Changing 'type' variable here affects the container class check which is already done.
                                    // We should set a flag or modify the pushed object.
                                } else {
                                    tag = 'Panel.LocalRemote';
                                }
                            }
                        } catch (e) {
                            console.warn("Failed to parse selectors config:", e);
                        }
                    }
                }


                canvasElements.push({
                    id: inner.id || 'el_' + Date.now() + Math.random(),
                    type: 'symbol',
                    x: parseFloat(style.left),
                    y: parseFloat(style.top),
                    props: {
                        symbol: (type === 'selector' && tag.includes('Mode')) ? 'selector-mode' :
                            (type === 'selector' && tag.includes('Remote')) ? 'selector-remote' : type,
                        id: inner.id,
                        system: '',
                        equip: equip,
                        tag: tag
                    }
                });
            }
        });

        renderCanvas();
        alert("Loaded mimic (Note: Some property bindings may be lost in reverse-parsing)");
    }

    // --- Navigation Manager Logic ---
    function initNavigation() {
        const navModal = document.getElementById('navModal');
        const navBtn = document.getElementById('navBtn');
        const closeBtn = document.getElementById('navCloseBtn');
        const saveBtn = document.getElementById('navSaveBtn');

        const listLoc = document.getElementById('navListLoc');
        const listSys = document.getElementById('navListSys');
        const listPage = document.getElementById('navListPage');

        const addLocBtn = document.getElementById('navAddLocBtn');
        const addSysBtn = document.getElementById('navAddSysBtn');
        const addPageBtn = document.getElementById('navAddPageBtn');

        // Open Modal
        navBtn.addEventListener('click', async () => {
            try {
                if (navData.locations.length === 0) await loadNavigationData();
                renderLocations();
                navModal.style.display = 'block';
            } catch (e) {
                console.error("Failed to load navigation:", e);
                alert("Failed to load navigation config.");
            }
        });

        // Close Modal
        closeBtn.addEventListener('click', () => {
            navModal.style.display = 'none';
        });

        window.addEventListener('click', (e) => {
            if (e.target === navModal) {
                navModal.style.display = 'none';
            }
        });

        // Save Changes
        saveBtn.addEventListener('click', async () => {
            try {
                const res = await fetch('/api/dev/navigation', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(navData)
                });
                if (res.ok) {
                    alert("Navigation saved successfully!");
                    navModal.style.display = 'none';
                } else {
                    throw new Error("Save failed");
                }
            } catch (e) {
                console.error("Failed to save navigation:", e);
                alert("Failed to save navigation.");
            }
        });

        // Render Locations
        function renderLocations() {
            listLoc.innerHTML = '';
            listSys.innerHTML = '';
            listPage.innerHTML = '';
            addSysBtn.disabled = true;
            addPageBtn.disabled = true;
            selectedLoc = null;
            selectedSys = null;

            navData.locations.forEach((loc, idx) => {
                const li = document.createElement('li');
                li.className = 'nav-item';
                li.innerHTML = `
                    <div class="nav-item-content">
                        <div class="nav-item-title">${loc.id}</div>
                        <div class="nav-item-subtitle">${loc.name}</div>
                    </div>
                    <span class="delete-icon" title="Delete Location">&times;</span>
                `;
                li.onclick = (e) => {
                    if (e.target.classList.contains('delete-icon')) {
                        if (confirm(`Delete location ${loc.id}?`)) {
                            navData.locations.splice(idx, 1);
                            renderLocations();
                        }
                        return;
                    }
                    document.querySelectorAll('#navListLoc .nav-item').forEach(el => el.classList.remove('selected'));
                    li.classList.add('selected');
                    selectedLoc = loc;
                    renderSystems();
                };
                listLoc.appendChild(li);
            });
        }

        // Render Systems
        function renderSystems() {
            listSys.innerHTML = '';
            listPage.innerHTML = '';
            addPageBtn.disabled = true;
            selectedSys = null;

            if (!selectedLoc) {
                addSysBtn.disabled = true;
                return;
            }
            addSysBtn.disabled = false;

            if (!selectedLoc.systems) selectedLoc.systems = [];

            selectedLoc.systems.forEach((sys, idx) => {
                const li = document.createElement('li');
                li.className = 'nav-item';
                li.innerHTML = `
                    <div class="nav-item-content">
                        <div class="nav-item-title">${sys.id}</div>
                        <div class="nav-item-subtitle">${sys.name}</div>
                    </div>
                    <span class="delete-icon" title="Delete System">&times;</span>
                `;
                li.onclick = (e) => {
                    if (e.target.classList.contains('delete-icon')) {
                        if (confirm(`Delete system ${sys.id}?`)) {
                            selectedLoc.systems.splice(idx, 1);
                            renderSystems();
                        }
                        return;
                    }
                    document.querySelectorAll('#navListSys .nav-item').forEach(el => el.classList.remove('selected'));
                    li.classList.add('selected');
                    selectedSys = sys;
                    renderPages();
                };
                listSys.appendChild(li);
            });
        }

        // Render Pages
        function renderPages() {
            listPage.innerHTML = '';
            if (!selectedSys) {
                addPageBtn.disabled = true;
                return;
            }
            addPageBtn.disabled = false;

            if (!selectedSys.pages) selectedSys.pages = [];

            selectedSys.pages.forEach((page, idx) => {
                const li = document.createElement('li');
                li.className = 'nav-item';
                li.innerHTML = `
                    <div class="nav-item-content">
                        <div class="nav-item-title">${page.title}</div>
                        <div class="nav-item-subtitle">${page.file}</div>
                    </div>
                    <span class="delete-icon" title="Delete Page">&times;</span>
                `;
                li.onclick = (e) => {
                    if (e.target.classList.contains('delete-icon')) {
                        if (confirm(`Delete page ${page.title}?`)) {
                            selectedSys.pages.splice(idx, 1);
                            renderPages();
                        }
                        return;
                    }
                    // Edit Page
                    const newTitle = prompt("Edit Page Title:", page.title);
                    if (newTitle !== null) {
                        page.title = newTitle;
                        renderPages();
                    }
                };
                listPage.appendChild(li);
            });
        }

        addLocBtn.addEventListener('click', () => {
            const id = prompt("Enter Location ID (e.g. NBT):");
            if (!id) return;
            const name = prompt("Enter Location Name (e.g. Northbound Tunnel):");
            navData.locations.push({ id, name: name || id, systems: [] });
            renderLocations();
        });

        addSysBtn.addEventListener('click', () => {
            const id = prompt("Enter System ID (e.g. TRA):");
            if (!id) return;
            const name = prompt("Enter System Name (e.g. Drainage):");
            selectedLoc.systems.push({ id, name: name || id, pages: [] });
            renderSystems();
        });

        addPageBtn.addEventListener('click', async () => {
            const loc = selectedLoc.id;
            const sys = selectedSys.id;

            // 1. Calculate next number for auto-generation (for default or "Create New")
            let nextNum = 1;
            const regex = new RegExp(`^${loc}_${sys}_(\\d+)\\.html$`);
            selectedSys.pages.forEach(p => {
                const match = p.file.match(regex);
                if (match) {
                    const num = parseInt(match[1]);
                    if (num >= nextNum) nextNum = num + 1;
                }
            });
            const autoFilename = `${loc}_${sys}_${nextNum}.html`;

            // 2. Open File Selection Modal
            const fileModal = document.getElementById('fileSelectModal');
            const fileList = document.getElementById('fileList');
            const confirmBtn = document.getElementById('fileSelectConfirmBtn');
            const createNewBtn = document.getElementById('fileCreateNewBtn');
            const closeBtn = document.getElementById('fileSelectCloseBtn');

            let selectedFile = null;
            let titleMap = {}; // Store titles

            confirmBtn.disabled = true;
            fileList.innerHTML = '<div style="padding:10px; color:#666;">Loading files...</div>';
            fileModal.style.display = 'block';

            // Fetch files AND titles
            try {
                const [filesRes, titlesRes] = await Promise.all([
                    fetch('/api/dev/mimic_files'),
                    fetch('/api/dev/titles')
                ]);

                if (filesRes.ok && titlesRes.ok) {
                    const files = await filesRes.json();
                    titleMap = await titlesRes.json();

                    const relevant = files.filter(f => f.startsWith(`${loc}_${sys}`));

                    fileList.innerHTML = '';
                    if (relevant.length === 0) {
                        fileList.innerHTML = '<div style="padding:10px; color:#666;">No existing files found for this system.</div>';
                    } else {
                        relevant.forEach(f => {
                            const div = document.createElement('div');
                            div.className = 'file-item';

                            // Strip extension for title lookup
                            const key = f.replace('.html', '');
                            const title = titleMap[key] ? ` <span style="color:#888; font-size:0.9em;">(${titleMap[key]})</span>` : '';

                            div.innerHTML = `<div class="file-item-name">${f}${title}</div>`;

                            div.onclick = () => {
                                document.querySelectorAll('.file-item').forEach(el => el.classList.remove('selected'));
                                div.classList.add('selected');
                                selectedFile = f;
                                confirmBtn.disabled = false;
                            };
                            fileList.appendChild(div);
                        });
                    }
                } else {
                    fileList.innerHTML = '<div style="padding:10px; color:red;">Failed to load data.</div>';
                }
            } catch (e) {
                console.error("Failed to fetch data:", e);
                fileList.innerHTML = '<div style="padding:10px; color:red;">Error loading data.</div>';
            }

            // Handlers
            const closeModal = () => {
                fileModal.style.display = 'none';
            };

            closeBtn.onclick = closeModal;

            createNewBtn.onclick = () => {
                closeModal();
                addPage(autoFilename);
            };

            confirmBtn.onclick = () => {
                if (selectedFile) {
                    closeModal();
                    addPage(selectedFile);
                }
            };

            async function addPage(filename) {
                // Pre-fill title if available
                const key = filename.replace('.html', '');
                const defaultTitle = titleMap[key] || "New Page";

                // If this is a new file (auto-generated name), prompt for title
                // If it's an existing file (selectedFile), we might not need to prompt, or maybe we do to confirm?
                // The user flow: "Select Existing" -> "Confirm" -> Load it.
                // "Create New" -> Prompt Title -> Create empty.

                if (filename === selectedFile) {
                    // Loading existing file
                    try {
                        const res = await fetch(`/systems/${filename}`);
                        if (res.ok) {
                            const content = await res.text();
                            parseAndLoadMimic(content, filename);
                            // Update inputs
                            pageLocInput.value = loc;
                            pageSysInput.value = sys;
                            pageTitleInput.value = defaultTitle;

                            // Add to navigation list if not already present
                            if (selectedSys && selectedSys.pages) {
                                const existingPage = selectedSys.pages.find(p => p.file === filename);
                                if (!existingPage) {
                                    selectedSys.pages.push({ file: filename, title: defaultTitle });
                                    renderPages();
                                }
                            }
                        } else {
                            alert("Failed to load file content.");
                        }
                    } catch (e) {
                        console.error("Error loading file:", e);
                        alert("Error loading file.");
                    }
                } else {
                    // Creating new file
                    const title = prompt("Enter Page Title:", defaultTitle);
                    if (title === null) return;

                    // Add to list (visual only until saved)
                    selectedSys.pages.push({ file: filename, title });
                    renderPages();

                    // Reset canvas for new page
                    canvasElements = [];
                    currentFilename = null;
                    updateEditorState();
                    renderCanvas();
                    renderProperties(null);

                    pageLocInput.value = loc;
                    pageSysInput.value = sys;
                    pageTitleInput.value = title;
                }
            }
        });
    }

    async function loadNavigationData() {
        try {
            const res = await fetch('/api/dev/navigation');
            navData = await res.json();
            if (!navData.locations) navData.locations = [];
        } catch (e) {
            console.error("Failed to load navigation:", e);
        }
    }

    async function init() {
        await loadSymbols();
        await loadSystems();
        await loadNavigationData(); // Ensure navData is available
        setupDragAndDrop();
        setupCanvasInteractions();
        initNavigation();

        generateBtn.addEventListener('click', handleSaveClick);
        loadBtn.addEventListener('click', () => loadFileInput.click());
        loadFileInput.addEventListener('change', handleFileLoad);

        // Save Modal Listeners
        const saveModal = document.getElementById('saveModal');
        const saveCloseBtn = document.getElementById('saveCloseBtn');
        const saveConfirmBtn = document.getElementById('saveConfirmBtn');
        const saveFilenameInput = document.getElementById('saveFilenameInput');

        if (saveCloseBtn) saveCloseBtn.onclick = () => saveModal.style.display = 'none';

        if (saveConfirmBtn) {
            saveConfirmBtn.onclick = () => {
                const name = saveFilenameInput.value.trim();
                if (name) {
                    saveModal.style.display = 'none';
                    performSave(name);
                }
            };
        }

        // Initial title load if inputs have values
        updateTitle();
        updateEditorState();
    }

    function updateEditorState() {
        const display = document.getElementById('currentFileDisplay');
        const btn = document.getElementById('generateBtn');

        if (currentFilename) {
            display.style.display = 'block';
            display.innerText = `Editing: ${currentFilename}`;
            btn.innerText = "Save Changes";
            btn.classList.remove('primary-btn');
            btn.style.backgroundColor = '#28a745'; // Green for save
        } else {
            display.style.display = 'none';
            btn.innerText = "Generate";
            btn.classList.add('primary-btn');
            btn.style.backgroundColor = ''; // Reset
        }
    }

    init();
});
