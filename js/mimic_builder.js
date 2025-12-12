document.addEventListener('DOMContentLoaded', () => {
    // --- State ---
    let symbols = [];
    let systems = [];
    let navData = { locations: [] };
    let selectedLoc = null;
    let selectedSys = null;
    let currentFilename = null;

    // --- Page Settings (Added for Zoom Support) ---
    let currentBackground = null;
    let canvasWidth = 1200;
    let canvasHeight = 800;

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
    let selectedElements = []; // Changed to array
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
        } else if (item.type === 'static-rect') {
            el.props = {
                width: 50,
                height: 50,
                backgroundColor: 'transparent',
                borderColor: '#000000',
                borderWidth: 2,
                rotation: 0
            };
        }

        canvasElements.push(el);
        renderCanvas(); // Render the new element
        selectedElements = [el];
        updateSelectionVisuals();
        renderProperties(el);
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

            if (selectedElements.includes(el)) div.classList.add('selected');

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
                div.style.transformOrigin = '0 50%';
            } else if (el.type === 'static-arrow') {
                div.style.width = el.props.width + 'px';
                div.style.height = el.props.height + 'px';
                div.style.backgroundColor = el.props.backgroundColor;
                div.style.transform = `rotate(${el.props.rotation}deg)`;
                div.style.transformOrigin = '0 50%';

                // Simple arrow: Line + Triangle
                // Scale head based on thickness
                const thickness = Math.max(1, el.props.height);
                const headSize = Math.max(6, thickness * 3); // Border Top/Bottom
                const headLen = Math.max(8, thickness * 4);  // Border Left
                const offset = -(headLen * 0.75); // Overlap slightly

                div.innerHTML = `<div style="position: absolute; right: ${offset}px; top: 50%; transform: translateY(-50%); border-top: ${headSize}px solid transparent; border-bottom: ${headSize}px solid transparent; border-left: ${headLen}px solid ${el.props.backgroundColor};"></div>`;
            } else if (el.type === 'static-rect') {
                div.style.width = el.props.width + 'px';
                div.style.height = el.props.height + 'px';
                div.style.backgroundColor = el.props.backgroundColor;
                div.style.border = `${el.props.borderWidth || 1}px solid ${el.props.borderColor || '#000'}`;
                div.style.transform = `rotate(${el.props.rotation}deg)`;
            }

            // Interaction
            // Interaction
            div.addEventListener('mousedown', (e) => {
                e.preventDefault(); // Prevent native drag (images, text)
                e.stopPropagation();

                try {
                    selectElement(el, e.ctrlKey || e.metaKey);
                } catch (err) {
                    console.error("Selection error:", err);
                }

                startDraggingElement(e, el);
            });

            canvas.appendChild(div);
        });
    }

    function updateSelectionVisuals() {
        // Efficiently update .selected class without re-rendering DOM
        // 1. Remove from all
        // 1. Remove from all
        document.querySelectorAll('.canvas-element.selected').forEach(el => {
            el.classList.remove('selected');
            // Remove handles
            el.querySelectorAll('.resize-handle').forEach(h => h.remove());
        });

        // 2. Add to selected
        selectedElements.forEach(el => {
            const div = document.getElementById(el.id);
            if (div) {
                div.classList.add('selected');

                // Add Resize Handles if Line or Arrow
                if (el.type === 'static-line' || el.type === 'static-arrow') {
                    // Start Handle
                    if (!div.querySelector('.resize-handle.start')) {
                        const startHandle = document.createElement('div');
                        startHandle.className = 'resize-handle start';
                        startHandle.dataset.handle = 'start';
                        div.appendChild(startHandle);
                    }
                    // End Handle
                    if (!div.querySelector('.resize-handle.end')) {
                        const endHandle = document.createElement('div');
                        endHandle.className = 'resize-handle end';
                        endHandle.dataset.handle = 'end';
                        div.appendChild(endHandle);
                    }
                }
                // Add Resize Handles if Rect
                else if (el.type === 'static-rect') {
                    const positions = ['nw', 'ne', 'se', 'sw', 'n', 's', 'e', 'w'];
                    positions.forEach(pos => {
                        if (!div.querySelector(`.resize-handle.${pos}`)) {
                            const h = document.createElement('div');
                            h.className = `resize-handle ${pos}`;
                            h.dataset.handle = pos;
                            div.appendChild(h);
                        }
                    });
                }
            }
        });
    }

    function selectElement(el, ctrlKey = false) {
        if (ctrlKey) {
            // Toggle
            if (selectedElements.includes(el)) {
                selectedElements = selectedElements.filter(e => e !== el);
            } else {
                selectedElements.push(el);
            }
        } else {
            // Single Select (unless already selected and we might drag)
            // If we click an unselected item, clear others. 
            // If we click a selected item, keeping it selected is fine. 
            // But if we have [A, B] and click A without Ctrl, valid behavior is clear others and select A? 
            // Standard behavior: 
            // - Mousedown on unselected: Clear, Select New
            // - Mousedown on selected: Keep selection (for potential drag)
            if (!selectedElements.includes(el)) {
                selectedElements = [el];
            }
            // If already selected, do nothing on mousedown (wait for click/mouseup to clear if no drag? simplistic for now)
            // Simplistic: Always clear unless Ctrl? No, that breaks dragging a group.
            // Let's stick to: If not in selection, select only it.
            // Let's stick to: If not in selection, select only it.
        }

        updateSelectionVisuals();

        // Properties: Show info for last selected or clear if multiple?
        if (selectedElements.length === 1) {
            renderProperties(selectedElements[0]);
        } else {
            renderProperties(null); // Or show "Multiple items selected"
            if (selectedElements.length > 1) {
                propertiesPanel.innerHTML = `<div class="empty-state">${selectedElements.length} items selected</div>`;
            }
        }
    }

    function startDraggingElement(e, clickedEl) {
        // Check if we clicked the resize handle
        if (e.target.classList.contains('resize-handle')) {
            startResizingElement(e, clickedEl);
            return;
        }

        const startX = e.clientX;
        const startY = e.clientY;

        // Capture original positions for ALL selected elements
        selectedElements.forEach(item => {
            item._origX = item.x;
            item._origY = item.y;
        });

        // Set Body Cursor
        document.body.style.cursor = 'move';

        function onMouseMove(e) {
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;

            // Move all selected elements
            selectedElements.forEach(item => {
                item.x = item._origX + dx;
                item.y = item._origY + dy;

                // Update DOM
                const div = document.getElementById(item.id);
                if (div) {
                    div.style.left = item.x + 'px';
                    div.style.top = item.y + 'px';
                }
            });
        }

        function onMouseUp() {
            document.body.style.cursor = ''; // Reset immediate
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
        }

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    }

        function startResizingElement(e, el) {
        e.stopPropagation(); 
        const handleType = e.target.dataset.handle; // start, end, nw, ne, se, sw, n, s, e, w

        // Initial Properties
        const originalX = el.x;
        const originalY = el.y;
        const originalW = el.props.width;
        const originalH = el.props.height || 0;
        const rotDeg = el.props.rotation || 0;
        const rotRad = rotDeg * (Math.PI / 180);

        // --- Logic for Lines/Arrows (Start/End) ---
        if (handleType === 'start' || handleType === 'end') {
            const isStartHandle = (handleType === 'start');
            // Calculate End Point
            const originalEndX = originalX + originalW * Math.cos(rotRad);
            const originalEndY = originalY + originalW * Math.sin(rotRad);
            
            // Anchor
            const anchorX = isStartHandle ? originalEndX : originalX;
            const anchorY = isStartHandle ? originalEndY : originalY;

            document.body.style.cursor = 'nwse-resize';

            function onLineMove(e) {
                const rect = canvas.getBoundingClientRect();
                const mx = e.clientX - rect.left - canvas.scrollLeft;
                const my = e.clientY - rect.top - canvas.scrollTop;
                
                const dx = mx - anchorX;
                const dy = my - anchorY;
                const newDist = Math.sqrt(dx*dx + dy*dy);
                
                el.props.width = Math.max(10, newDist);

                let angleRad;
                if (isStartHandle) {
                     angleRad = Math.atan2(anchorY - my, anchorX - mx);
                     el.x = mx;
                     el.y = my;
                } else {
                     angleRad = Math.atan2(dy, dx);
                }
                el.props.rotation = angleRad * (180 / Math.PI);
                
                updateDOM(el);
            }
            
            function onLineUp() {
                document.body.style.cursor = '';
                document.removeEventListener('mousemove', onLineMove);
                document.removeEventListener('mouseup', onLineUp);
            }
            document.addEventListener('mousemove', onLineMove);
            document.addEventListener('mouseup', onLineUp);
            return;
        }

        // --- Logic for Rectangles (8 Points) ---
        const cx = originalX + originalW / 2;
        const cy = originalY + originalH / 2;
        
        // Initial Local Bounds
        const bounds = {
            left: -originalW / 2,
            right: originalW / 2,
            top: -originalH / 2,
            bottom: originalH / 2
        };

        // Determine which edges drift based on handle
        const moveTop = handleType.includes('n');
        const moveBottom = handleType.includes('s');
        const moveLeft = handleType.includes('w');
        const moveRight = handleType.includes('e');

        // Set cursor based on handle
        let cursor = 'crosshair';
        if (moveTop && moveLeft) cursor = 'nwse-resize';
        else if (moveTop && moveRight) cursor = 'nesw-resize';
        else if (moveBottom && moveLeft) cursor = 'nesw-resize';
        else if (moveBottom && moveRight) cursor = 'nwse-resize';
        else if (moveTop || moveBottom) cursor = 'ns-resize';
        else if (moveLeft || moveRight) cursor = 'ew-resize';
        
        document.body.style.cursor = cursor;

        function onRectMove(e) {
            const rect = canvas.getBoundingClientRect();
            const mx = e.clientX - rect.left - canvas.scrollLeft;
            const my = e.clientY - rect.top - canvas.scrollTop;

            // 1. Unrotate Mouse around Center to Local Space
            const dx = mx - cx;
            const dy = my - cy;
            const cos = Math.cos(-rotRad);
            const sin = Math.sin(-rotRad);
            const mx_local = (dx * cos - dy * sin); 
            const my_local = (dx * sin + dy * cos);

            // 2. Update Bounds based on active handle
            let newLeft = bounds.left;
            let newRight = bounds.right;
            let newTop = bounds.top;
            let newBottom = bounds.bottom;

            if (moveLeft) newLeft = Math.min(mx_local, bounds.right - 10);
            if (moveRight) newRight = Math.max(mx_local, bounds.left + 10);
            if (moveTop) newTop = Math.min(my_local, bounds.bottom - 10);
            if (moveBottom) newBottom = Math.max(my_local, bounds.top + 10);

            // 3. New Center in Unrotated Local Space
            const newW = newRight - newLeft;
            const newH = newBottom - newTop;
            const newCx_local = (newLeft + newRight) / 2;
            const newCy_local = (newTop + newBottom) / 2;

            // 4. Rotate New Center back to Global
            const cos2 = Math.cos(rotRad);
            const sin2 = Math.sin(rotRad);
            const finalCx = cx + (newCx_local * cos2 - newCy_local * sin2);
            const finalCy = cy + (newCx_local * sin2 + newCy_local * cos2);

            // 5. Update Props
            el.props.width = newW;
            el.props.height = newH;
            
            // 6. Update Position (Top-Left of unrotated box)
            el.x = finalCx - newW / 2;
            el.y = finalCy - newH / 2;

            updateDOM(el);
        }

        function onRectUp() {
            document.body.style.cursor = '';
            document.removeEventListener('mousemove', onRectMove);
            document.removeEventListener('mouseup', onRectUp);
        }
        document.addEventListener('mousemove', onRectMove);
        document.addEventListener('mouseup', onRectUp);
    }

    function updateDOM(el) {
        const div = document.getElementById(el.id);
        if (div) {
            div.style.left = el.x + 'px';
            div.style.top = el.y + 'px';
            div.style.width = el.props.width + 'px';
            if (el.type === 'static-rect' || el.type === 'static-arrow') {
                div.style.height = el.props.height + 'px';
            }
            div.style.transform = `rotate(${el.props.rotation}deg)`;
        }
    }

    function setupCanvasInteractions() {
        // Selection State
        let isSelecting = false;
        let selectionStart = { x: 0, y: 0 };

        // Ensure Selection Box exists
        let selectionBox = document.getElementById('selectionBox');
        if (!selectionBox) {
            selectionBox = document.createElement('div');
            selectionBox.id = 'selectionBox';
            document.body.appendChild(selectionBox); // Append to body to overlay everything
        }

        canvas.addEventListener('mousedown', (e) => {
            // Only start if clicking on the canvas background directly
            if (e.target === canvas) {
                isSelecting = true;
                selectionStart = { x: e.clientX, y: e.clientY };

                // Reset Selection unless Ctrl is held (optional, usually click background = clear)
                if (!e.ctrlKey) {
                    selectedElements = [];
                    updateSelectionVisuals();
                    renderProperties(null);
                }

                // Initialize Box
                selectionBox.style.display = 'block';
                selectionBox.style.left = e.clientX + 'px';
                selectionBox.style.top = e.clientY + 'px';
                selectionBox.style.width = '0px';
                selectionBox.style.height = '0px';
                selectionBox.classList.remove('touch-select');
            }
        });

        window.addEventListener('mousemove', (e) => {
            if (!isSelecting) return;

            const currentX = e.clientX;
            const currentY = e.clientY;

            // Dimensions
            const width = Math.abs(currentX - selectionStart.x);
            const height = Math.abs(currentY - selectionStart.y);
            const left = Math.min(currentX, selectionStart.x);
            const top = Math.min(currentY, selectionStart.y);

            // Update Box Style
            selectionBox.style.width = width + 'px';
            selectionBox.style.height = height + 'px';
            selectionBox.style.left = left + 'px';
            selectionBox.style.top = top + 'px';

            // Check Direction for Mode: Right-to-Left (Touch) vs Left-to-Right (Inside)
            // If currentX < startX -> We are dragging LEFT -> Touch Mode
            if (currentX < selectionStart.x) {
                selectionBox.classList.add('touch-select');
            } else {
                selectionBox.classList.remove('touch-select');
            }
        });

        window.addEventListener('mouseup', (e) => {
            if (!isSelecting) return;
            isSelecting = false;
            selectionBox.style.display = 'none';

            // Calculate Final Box in Canvas Coordinates
            // We need to convert screen coords (clientX) to canvas coords
            // Canvas might be offset? check canvas.getBoundingClientRect()
            const rect = canvas.getBoundingClientRect();

            // Get Box Coords relative to Canvas
            // Box left/top are screen coords. 
            // Box Relative:
            const boxScreenLeft = parseInt(selectionBox.style.left);
            const boxScreenTop = parseInt(selectionBox.style.top);
            const boxWidth = parseInt(selectionBox.style.width);
            const boxHeight = parseInt(selectionBox.style.height);

            const boxLeft = boxScreenLeft - rect.left;
            const boxTop = boxScreenTop - rect.top;
            const boxRight = boxLeft + boxWidth;
            const boxBottom = boxTop + boxHeight;

            // Mode
            const isTouchMode = selectionBox.classList.contains('touch-select');

            // Find Elements
            canvasElements.forEach(el => {
                // Element Dimensions (approx if not stored)
                // We'll trust el.props.width/height for static, or assume symbol size
                // Best to get from DOM if possible, or fallbacks
                let elW = 50; let elH = 50;
                if (el.type === 'static-line' || el.type === 'static-arrow') {
                    // Lines are tricky, use bounding box of updated coords
                    const div = document.getElementById(el.id);
                    if (div) { elW = div.offsetWidth; elH = div.offsetHeight; }
                } else if (el.props.width) {
                    elW = parseInt(el.props.width);
                    elH = parseInt(el.props.height);
                } else {
                    // Try to get from DOM
                    const div = document.getElementById(el.id);
                    if (div) { elW = div.offsetWidth; elH = div.offsetHeight; }
                }

                const elLeft = el.x;
                const elTop = el.y;
                const elRight = el.x + elW;
                const elBottom = el.y + elH;

                let isSelected = false;

                if (isTouchMode) {
                    // Intersection
                    // !(elLeft > boxRight || elRight < boxLeft || elTop > boxBottom || elBottom < boxTop)
                    if (elLeft < boxRight && elRight > boxLeft && elTop < boxBottom && elBottom > boxTop) {
                        isSelected = true;
                    }
                } else {
                    // Inside
                    // elLeft >= boxLeft && elRight <= boxRight && elTop >= boxTop && elBottom <= boxBottom
                    if (elLeft >= boxLeft && elRight <= boxRight && elTop >= boxTop && elBottom <= boxBottom) {
                        isSelected = true;
                    }
                }

                if (isSelected) {
                    if (!selectedElements.includes(el)) selectedElements.push(el);
                }
            });

            updateSelectionVisuals();
            if (selectedElements.length === 1) renderProperties(selectedElements[0]);
            else if (selectedElements.length > 1) renderProperties(null);
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
    else if (el.type === 'static-rect') template = document.getElementById('rect-props-template');

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

            // Special handling for Location Select
            if (prop === 'locationSelect') {
                input.innerHTML = '<option value="">Select Location...</option>';
                if (navData && navData.locations) {
                    navData.locations.forEach(loc => {
                        const opt = document.createElement('option');
                        opt.value = loc.id;
                        opt.text = `${loc.name} (${loc.id})`;
                        input.appendChild(opt);
                    });
                }
                input.value = el.props.location || '';

                input.addEventListener('change', () => {
                    el.props.location = input.value;
                    renderCanvas();
                });
            }
            // Special handling for System Select
            else if (prop === 'systemSelect') {
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
            delBtn.addEventListener('click', deleteSelectedElements);
        }
    }

    function deleteSelectedElements() {
        if (selectedElements.length === 0) return;

        // Confirmation for multiple items
        if (selectedElements.length > 1) {
            if (!confirm(`Are you sure you want to delete ${selectedElements.length} items?`)) {
                return;
            }
        }

        canvasElements = canvasElements.filter(e => !selectedElements.includes(e));
        selectedElements = [];
        renderCanvas();
        renderProperties(null);
    }

    // --- Keyboard Interaction ---
    document.addEventListener('keydown', (e) => {
        // Only Delete key (User explicitly requested "just delete button, no backspace")
        if (e.key === 'Delete') {
            // Avoid deleting if user is typing in an input
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

            deleteSelectedElements();
        }

        // Arrow Keys for Nudging
        if (selectedElements.length > 0 && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
            // Prevent scrolling
            e.preventDefault();

            // Delta: 1px normal, 10px with Shift
            const delta = e.shiftKey ? 10 : 1;

            selectedElements.forEach(el => {
                let dx = 0; let dy = 0;
                if (e.key === 'ArrowLeft') dx = -delta;
                if (e.key === 'ArrowRight') dx = delta;
                if (e.key === 'ArrowUp') dy = -delta;
                if (e.key === 'ArrowDown') dy = delta;

                el.x += dx;
                el.y += dy;

                // Update DOM directly for performance
                const div = document.getElementById(el.id);
                if (div) {
                    div.style.left = el.x + 'px';
                    div.style.top = el.y + 'px';
                }
            });
        }
    });

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

        // 1. Generate HTML Content (Updated with zoom parameters)
        const htmlContent = generateHTML(loc, sys, title, canvasWidth, canvasHeight, currentBackground);

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

                    // Sync to Navigation Data
                    if (navData && navData.locations) {
                        let found = false;
                        navData.locations.forEach(l => {
                            if (found) return;
                            l.systems.forEach(s => {
                                if (found) return;
                                const page = s.pages.find(p => p.file === filename);
                                if (page) {
                                    page.title = title;
                                    found = true;
                                }
                            });
                        });

                        if (found) {
                            await fetch('/api/dev/navigation', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify(navData)
                            });
                        }
                    }
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


    function generateHTML(loc, sys, title, width = 1200, height = 800, backgroundImage = null) {
        // Use global state for width/height/background if available, or defaults
        const w = (typeof canvasWidth !== 'undefined') ? canvasWidth : width;
        const h = (typeof canvasHeight !== 'undefined') ? canvasHeight : height;
        const bg = (typeof currentBackground !== 'undefined') ? currentBackground : backgroundImage;

        // Construct the full HTML for the mimic page
        let elementsHTML = '';

        // Group elements by type for config generation
        const pumps = [];
        const pits = [];
        const ai_textb = [];
        const tfans = [];
        const selectors = [];

        const usedIds = new Set();

        canvasElements.forEach((el, index) => {
            if (el.type === 'symbol') {
                const type = el.props.symbol;
                let domId = el.props.id || `${type}${index + 1}`;

                // Ensure uniqueness
                let originalId = domId;
                let counter = 1;
                while (usedIds.has(domId)) {
                    domId = `${originalId}_${counter}`;
                    counter++;
                }
                usedIds.add(domId);

                // Loc/Sys overrides
                const sLoc = el.props.location || '';
                const sSys = el.props.system || '';

                // Add to config arrays
                if (type === 'pump') pumps.push({ domId, equip: el.props.equip, loc: sLoc, sys: sSys });
                else if (type === 'pit') pits.push({ domId, equip: el.props.equip, loc: sLoc, sys: sSys });
                else if (type === 'ai_textb') ai_textb.push({ domId, equip: el.props.equip, loc: sLoc, sys: sSys });
                else if (type === 'tfan') tfans.push({ domId, equip: el.props.equip, loc: sLoc, sys: sSys });
                else if (type.includes('selector')) {
                    const isMode = (el.props.tag && el.props.tag.includes('Mode')) || (el.props.symbol === 'selector-mode');
                    selectors.push({ domId, equip: el.props.equip, type: isMode ? 'mode' : 'remote', loc: sLoc, sys: sSys });
                }

                elementsHTML += `
    <div style="position: absolute; left: ${el.x}px; top: ${el.y}px; text-align: center;" data-equipment="${el.props.equip}" data-location="${sLoc}" data-system="${sSys}">
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

        // Determine if we need zoom
        const hasBackground = bg && bg.trim().length > 0;

        // Generate Script Content
        const scriptContent = `
  const LOC = "${loc}";
  const SYS = "${sys}";

  const config = {
    pits: ${JSON.stringify(pits.map(p => ({ id: p.domId, equipment: p.equip, loc: p.loc, sys: p.sys })))},
    pumps: ${JSON.stringify(pumps.map(p => ({ id: p.domId, equipment: p.equip, loc: p.loc, sys: p.sys })))},
    ai_textb: ${JSON.stringify(ai_textb.map(p => ({ id: p.domId, equipment: p.equip, loc: p.loc, sys: p.sys })))},
    tfans: ${JSON.stringify(tfans.map(p => ({ id: p.domId, equipment: p.equip, loc: p.loc, sys: p.sys })))},
    selectors: ${JSON.stringify(selectors.map(s => ({ id: s.domId, equipment: s.equip, type: s.type, loc: s.loc, sys: s.sys })))}
  };

  window.SCADA = window.parent.SCADA;
  const Core = window.SCADA.Core;
  const Symbols = window.SCADA.Symbols;

  function registerInitialHighlights() {
    if (!Core.Highlight) return;
    const mapId = id => document.getElementById(id);
    
    ${pits.map(p => `if(mapId('${p.domId}')) Core.Highlight.register('${p.loc || loc}-${p.sys || sys}-${p.equip}', mapId('${p.domId}'));`).join('\n    ')}
    ${pumps.map(p => `if(mapId('${p.domId}')) Core.Highlight.register('${p.loc || loc}-${p.sys || sys}-${p.equip}', mapId('${p.domId}'));`).join('\n    ')}
    ${ai_textb.map(p => `if(mapId('${p.domId}')) Core.Highlight.register('${p.loc || loc}-${p.sys || sys}-${p.equip}', mapId('${p.domId}'));`).join('\n    ')}
    ${tfans.map(p => `if(mapId('${p.domId}')) Core.Highlight.register('${p.loc || loc}-${p.sys || sys}-${p.equip}', mapId('${p.domId}'));`).join('\n    ')}
    ${selectors.map(s => `if(mapId('${s.domId}')) Core.Highlight.register('${s.loc || loc}-${s.sys || sys}-${s.equipment}', mapId('${s.domId}'));`).join('\n    ')}
    
    Core.Highlight.equipIfPending();
  }

  function safeInit() {
    const checkExist = () => {
      const ready = 
        (!config.pumps.length || document.getElementById("${pumps[0]?.domId}")) &&
        (!config.pits.length || document.getElementById("${pits[0]?.domId}")) &&
        (!config.ai_textb.length || document.getElementById("${ai_textb[0]?.domId}")) &&
        (!config.tfans.length || document.getElementById("${tfans[0]?.domId}")) &&
        (!config.selectors.length || document.getElementById("${selectors[0]?.domId}"));
        
      if (ready) { initSymbols(); } else { setTimeout(checkExist, 50); }
    };
    checkExist();
  }

  if (document.readyState === "complete") { safeInit(); } else { window.addEventListener("load", safeInit); }

  function refresh${sys}(pumps, pits, aiSymbols, tfanSymbols, selectorSymbols, PanelMode, PanelRemote, data, alarms) {
    if (!data || !alarms) return;
    try {
      // console.log("Refresh ${sys} Triggered", data.points.length, "points");
      config.pits.forEach((pConf, i) => {
        if (pits[i]) {
          const symLoc = pConf.loc || LOC;
          const cls = pits[i].getVisualClass(data, alarms, symLoc);
          pits[i].update(cls.pct, cls.visualClass);
          pits[i].showOverride(cls.override);
        }
      });
      config.pumps.forEach((pConf, i) => {
        if (pumps[i]) {
          const symLoc = pConf.loc || LOC;
          const cls = pumps[i].getVisualClass(data, alarms, symLoc);
          pumps[i].update(cls.visualClass);
          pumps[i].showOverride((cls.run?.mo_i) || (cls.trip?.mo_i));
        }
      });
      config.ai_textb?.forEach((pConf, i) => {
        if (aiSymbols[i]) {
          const symLoc = pConf.loc || LOC;
          const cls = aiSymbols[i].getVisualClass(data, alarms, symLoc);
          if (cls.value !== null) {
            aiSymbols[i].update(cls.value, cls.limits, cls.decimals, cls.flash);
            aiSymbols[i].showOverride(cls.override);
          }
        }
      });
      config.tfans?.forEach((pConf, i) => {
        if (tfanSymbols[i]) {
          const symLoc = pConf.loc || LOC;
          const cls = tfanSymbols[i].getVisualClass(data, alarms, symLoc);
          tfanSymbols[i].update(cls.visualClass);
          tfanSymbols[i].showOverride((cls.run?.mo_i) || (cls.trip?.mo_i) || (cls.mode?.mo_i) || (cls.dir?.mo_i));
        }
      });
      config.selectors?.forEach((sConf, i) => {
          if (selectorSymbols[i]) {
              const tagSuffix = sConf.type === 'mode' ? 'Panel.Mode' : 'Panel.LocalRemote';
              const symLoc = sConf.loc || LOC;
              const cls = selectorSymbols[i].getVisualClass(data, symLoc, tagSuffix);
              if (cls.state) selectorSymbols[i].update(cls.state);
              selectorSymbols[i].showOverride(cls.override);
          }
      });
    } catch (err) { console.error("Error in refresh${sys}:", err); }
  }

  function initSymbols() {
    const initTasks = [];

    ${pumps.map(p => `
    initTasks.push(Symbols.Pump.init('${p.domId}', {
        equipKey: '${p.loc || loc}-${p.sys || sys}-${p.equip || "000"}',
        faceplate: Core.Naming.buildFullName({ loc: "${p.loc || loc}", sys: "${p.sys || sys}", equipType: "SUP", equipId: "${p.equip ? p.equip.slice(-3) : '000'}" }),
        loc: "${p.loc || loc}",
        noAutoRefresh: true,
        doc: document
    }));`).join('')}

    ${pits.map(p => `
    initTasks.push(Symbols.Pit.init('${p.domId}', {
        equipKey: '${p.loc || loc}-${p.sys || sys}-${p.equip || "000"}',
        faceplate: Core.Naming.buildFullName({ loc: "${p.loc || loc}", sys: "${p.sys || sys}", equipType: "SPT", equipId: "${p.equip ? p.equip.slice(-3) : '000'}" }),
        loc: "${p.loc || loc}",
        noAutoRefresh: true,
        doc: document
    }));`).join('')}

    const aiSymbols = [];
    ${ai_textb.map((p, i) => `
    initTasks.push(
        Symbols.AI_TEXTB.init('${p.domId}', {
          loc: "${p.loc || loc}", sys: "${p.sys || sys}", equipId: "${p.equip ? p.equip.slice(-3) : '000'}", equipType: "FLO", unit: "L/h",
          noAutoRefresh: true,
          doc: document
        }).then(api => { aiSymbols[${i}] = api; return api; })
    );`).join('')}

    const tfanSymbols = [];
    ${tfans.map((p, i) => `
    initTasks.push(
        Symbols.TFan.init('${p.domId}', {
          equipKey: '${p.loc || loc}-${p.sys || sys}-${p.equip || "000"}',
          faceplate: Core.Naming.buildFullName({ loc: "${p.loc || loc}", sys: "${p.sys || sys}", equipType: "TFAN", equipId: "${p.equip ? p.equip.slice(-3) : '000'}" }),
          loc: "${p.loc || loc}",
          noAutoRefresh: true,
          doc: document
        }).then(api => { tfanSymbols[${i}] = api; return api; })
    );`).join('')}

    const selectorSymbols = [];
    ${selectors.map((s, i) => `
    initTasks.push(
        Symbols.Selector.init('${s.domId}', {
          equipKey: '${s.loc || loc}-${s.sys || sys}-${s.equip || "000"}',
          type: "${s.type}", 
          tag: "${s.type === 'mode' ? 'Panel.Mode' : 'Panel.LocalRemote'}",
          faceplate: Core.Naming.buildFullName({ loc: "${s.loc || loc}", sys: "${s.sys || sys}", equipType: "SPP", equipId: "${s.equip ? s.equip.slice(-3) : '000'}" }),
          loc: "${s.loc || loc}",
          doc: document
        }).then(api => { selectorSymbols[${i}] = api; return api; })
    );`).join('')}

    Promise.all(initTasks).then(symbols => {
      let offset = 0;
      const pumpSymbols = symbols.slice(offset, offset + ${pumps.length}); offset += ${pumps.length};
      const pitSymbols = symbols.slice(offset, offset + ${pits.length}); offset += ${pits.length};
      const aiSyms = symbols.slice(offset, offset + ${ai_textb.length}); offset += ${ai_textb.length};
      const tfanSyms = symbols.slice(offset, offset + ${tfans.length}); offset += ${tfans.length};
      const selSyms = symbols.slice(offset, offset + ${selectors.length});

      const PanelMode = { getVisualClass: () => ({}), update: () => {}, showOverride: () => {} };
      const PanelRemote = { getVisualClass: () => ({}), update: () => {}, showOverride: () => {} };

      if (Core.Highlight) {
        registerInitialHighlights();
        Core.Highlight.equipIfPending();
      }

      const sm = SCADA?.Core?.SocketManager;
      if (sm) {
        let cachedPoints = {};
        let cachedAlarms = [];

        const handleSystemUpdate = (msg) => {
          if (msg.alarms) {
            cachedAlarms = Array.isArray(msg.alarms) ? msg.alarms : Object.values(msg.alarms);
            if (msg.type === 'alarms' || msg.type === 'alarm') {
              const data = { points: Object.values(cachedPoints) };
              refresh${sys}(pumpSymbols, pitSymbols, aiSyms, tfanSyms, selSyms, PanelMode, PanelRemote, data, cachedAlarms);
              return;
            }
          }

          if (msg.type === 'snapshot' && msg.points) {
            Object.assign(cachedPoints, msg.points);
            const data = { points: Object.values(cachedPoints) };
            refresh${sys}(pumpSymbols, pitSymbols, aiSyms, tfanSyms, selSyms, PanelMode, PanelRemote, data, cachedAlarms);
          }
          else if (msg.type === 'update' && msg.diffs?.points) {
            if (msg.diffs.points.changed) Object.assign(cachedPoints, msg.diffs.points.changed);
            if (msg.diffs.points.removed) msg.diffs.points.removed.forEach(key => delete cachedPoints[key]);
            
            const data = { points: Object.values(cachedPoints) };
            refresh${sys}(pumpSymbols, pitSymbols, aiSyms, tfanSyms, selSyms, PanelMode, PanelRemote, data, cachedAlarms);
          }
        };

        ${(() => {
                const locs = new Set([loc]);
                [...pumps, ...pits, ...ai_textb, ...tfans, ...selectors].forEach(p => { if (p.loc) locs.add(p.loc); });
                return Array.from(locs).map(l => `sm.subscribe('system:${l}', handleSystemUpdate);`).join('\n        ');
            })()}
        
        sm.subscribe('alarms', handleSystemUpdate);

        const scope = \`system:\${LOC}\`;
        sm.subscribe(scope, handleSystemUpdate); 

        window.addEventListener('beforeunload', () => {
          try {
             ${(() => {
                const locs = new Set([loc]);
                [...pumps, ...pits, ...ai_textb, ...tfans, ...selectors].forEach(p => { if (p.loc) locs.add(p.loc); });
                return Array.from(locs).map(l => `sm.unsubscribe('system:${l}', handleSystemUpdate);`).join('\n             ');
            })()}
            sm.unsubscribe('alarms', handleSystemUpdate);
            sm.unsubscribe('events', handleSystemUpdate);
          } catch (e) { }
        });
      }
    });

    console.log("✅ Mimic loaded");
    if (window.parent) { window.parent.postMessage({ type: "mimicReady" }, "*"); }
  }
`;

        const styleContent = `
        body { margin: 0; padding: 0; background: #ffffff; overflow: hidden; font-family: 'Segoe UI', sans-serif; user-select: none; }
        .symbol-container { position: absolute; }
        .pump-container, .pit-container, .selector-container, .ai_textb-container, .tfan-container { cursor: pointer; }
        ${hasBackground ? `
        /* Zoom Container */
        #zoom-container { position: relative; width: 100vw; height: 100vh; overflow: hidden; display: flex; justify-content: center; align-items: center; background: #fff; cursor: default; }
        .dragging { cursor: grabbing !important; }
        
        #mimic-wrapper { 
            position: absolute; top: 0; left: 0;
            width: ${w}px; height: ${h}px; 
            background-color: #fff; box-shadow: none;
            transform-origin: 0 0; transition: none; 
            background-image: url('${bg.startsWith('/') ? '' : '/layout/'}${bg}'); 
            background-size: cover; background-repeat: no-repeat;
        }
        
        #zoom-controls {
            position: fixed; bottom: 20px; right: 20px; z-index: 9999;
            display: flex; flex-direction: column; gap: 5px;
        }
        .zoom-btn {
            width: 36px; height: 36px; background: #444; color: #fff; border: 1px solid #666; 
            border-radius: 4px; cursor: pointer; font-size: 18px; display: flex; align-items: center; justify-content: center;
        }
        .zoom-btn:hover { background: #666; }
        ` : `
        #mimic-container { position:relative; width:100%; height:100%; }
        `}
        `;

        const bodyContent = hasBackground ? `
<div id="zoom-container">
    <div id="mimic-wrapper">
        ${elementsHTML}
    </div>
</div>
<div id="zoom-controls">
    <button class="zoom-btn" onclick="zoomIn()" title="Zoom In">+</button>
    <button class="zoom-btn" onclick="zoomReset()" title="Reset">1:1</button>
    <button class="zoom-btn" onclick="zoomOut()" title="Zoom Out">-</button>
</div>` : `<div id="mimic-container">${elementsHTML}</div>`;

        const zoomScript = hasBackground ? `
    // --- Zoom & Pan Logic ---
    const wrapper = document.getElementById('mimic-wrapper');
    const container = document.getElementById('zoom-container');
    let scale = 1; let panX = 0; let panY = 0;
    
    function centerView() {
        if (!container || !wrapper) return;
        const cw = container.clientWidth; const ch = container.clientHeight;
        const ww = ${w}; const wh = ${h};
        panX = (cw - ww * scale) / 2; panY = (ch - wh * scale) / 2;
        updateTransform();
    }
    window.onload = function() { centerView(); };
    function updateTransform() { if (wrapper) wrapper.style.transform = \`translate(\${panX}px, \${panY}px) scale(\${scale})\`; }
    window.zoomIn = function() { const cx = container.clientWidth / 2; const cy = container.clientHeight / 2; zoomToPoint(1.2, cx, cy); };
    window.zoomOut = function() { const cx = container.clientWidth / 2; const cy = container.clientHeight / 2; zoomToPoint(1/1.2, cx, cy); };
    window.zoomReset = function() { scale = 1; centerView(); };
    function zoomToPoint(factor, cx, cy) {
        const newScale = scale * factor;
        if (newScale < 0.1 || newScale > 10) return;
        const worldX = (cx - panX) / scale; const worldY = (cy - panY) / scale;
        panX = cx - worldX * newScale; panY = cy - worldY * newScale;
        scale = newScale; updateTransform();
    }
    if (container) {
        container.addEventListener('wheel', (e) => { e.preventDefault(); zoomToPoint(e.deltaY < 0 ? 1.05 : 0.95, e.clientX, e.clientY); }, { passive: false });
        let isDragging = false; let lastX = 0; let lastY = 0;
        container.addEventListener('mousedown', (e) => { if (e.button === 1) { isDragging = true; container.classList.add('dragging'); lastX = e.clientX; lastY = e.clientY; e.preventDefault(); } });
        window.addEventListener('mousemove', (e) => { if (isDragging) { const dx = e.clientX - lastX; const dy = e.clientY - lastY; panX += dx; panY += dy; lastX = e.clientX; lastY = e.clientY; updateTransform(); } });
        window.addEventListener('mouseup', () => { isDragging = false; container.classList.remove('dragging'); });
    }
` : '';

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>${title}</title>
    <style>${styleContent}</style>
</head>
<body>
    ${bodyContent}
    <script>${scriptContent}${zoomScript}</script>
</body>
</html>`;
    }

    function handleFileLoad(e) {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (ev) => {
            const content = ev.target.result;
            // Extract filename from input (just basename)
            const filename = file.name;
            currentFilename = filename;
            parseAndLoadMimic(filename, content);
        };
        reader.readAsText(file);
    }

    function parseAndLoadMimic(filename, content) {
        // Parse the HTML content to extract elements
        const parser = new DOMParser();
        const doc = parser.parseFromString(content, 'text/html');

        // Extract LOC/SYS from filename or content
        let loc = '', sys = '';
        const nameMatch = filename.match(/^([a-zA-Z0-9]+)_([a-zA-Z0-9]+)/);
        if (nameMatch) {
            loc = nameMatch[1];
            sys = nameMatch[2];
        }

        pageLocInput.value = loc;
        pageSysInput.value = sys;

        const titleTag = doc.querySelector('title');
        if (titleTag) pageTitleInput.value = titleTag.innerText;

        // Reset
        canvasElements = [];
        selectedElement = null;

        // Extract Zoom Logic / Global Page Settings
        // width/height from #mimic-wrapper if present
        // Check inline styles or css
        // We'll search the full content for the CSS block we generate
        const wrapperMatch = content.match(/#mimic-wrapper\s*{([^}]+)}/);
        if (wrapperMatch) {
            const css = wrapperMatch[1];
            const wMatch = css.match(/width:\s*(\d+)px/);
            const hMatch = css.match(/height:\s*(\d+)px/);
            const bgMatch = css.match(/background-image:\s*url\(['"]?([^'"]+)['"]?\)/);

            if (wMatch) canvasWidth = parseInt(wMatch[1]);
            if (hMatch) canvasHeight = parseInt(hMatch[1]);
            if (bgMatch) {
                let bg = bgMatch[1];
                if (bg.startsWith('/layout/')) bg = bg.replace('/layout/', '');
                // Also remove quotes if they persist? regex matching ([^'"]+) usually handles it
                currentBackground = bg;
            } else {
                currentBackground = null;
            }
        } else {
            // Defaults if not found
            currentBackground = null;
            canvasWidth = 1200;
            canvasHeight = 800;
        }

        // Parse Elements
        // Check for mimic-wrapper first
        let container = doc.getElementById('mimic-wrapper');
        if (!container) container = doc.getElementById('mimic-container');
        if (!container) container = doc.body; // Fallback

        // Find all symbol-like divs
        // Our generator struct: <div style="left... data-equip..."> <div id class="...-container">
        // So we look for the OUTER divs that have style.left/top
        const divs = container.querySelectorAll('div[data-equipment]');

        divs.forEach(div => {
            const x = parseInt(div.style.left);
            const y = parseInt(div.style.top);
            const equip = div.dataset.equipment || '';
            const sLoc = div.dataset.location || '';
            const sSys = div.dataset.system || '';

            let type = 'unknown';
            let props = {
                id: '',
                equip: equip,
                location: sLoc,
                system: sSys,
                symbol: ''
            };

            const inner = div.querySelector('div[id]');
            if (inner) {
                props.id = inner.id;

                if (inner.classList.contains('pump-container')) { type = 'symbol'; props.symbol = 'pump'; }
                else if (inner.classList.contains('pit-container')) { type = 'symbol'; props.symbol = 'pit'; }
                else if (inner.classList.contains('ai_textb-container')) { type = 'symbol'; props.symbol = 'ai_textb'; }
                else if (inner.classList.contains('tfan-container')) { type = 'symbol'; props.symbol = 'tfan'; }
                else if (inner.classList.contains('selector-container')) {
                    type = 'symbol';
                    // Determine sub-type
                    // We need to check if we can infer mode vs remote
                    // In generated HTML, we lose the specific tag "Panel.Mode" unless we parse the SCRIPT
                    // But we can check if it says 'mode' in DOM structure? No.
                    // But we can check the dataset? No.
                    // Wait, we pushed objects to 'selectors' config with type 'mode'/'remote'.
                    // We can regex the script to find the selector config!
                    props.symbol = 'selector';
                }
            }

            if (type !== 'unknown') {
                const el = {
                    id: props.id || 'el_' + Date.now() + Math.random(),
                    type: type,
                    x: x,
                    y: y,
                    props: props
                };
                canvasElements.push(el);
            }
        });

        // Parse Text
        const texts = container.querySelectorAll('div[style*="font-size"]');
        texts.forEach(div => {
            const x = parseInt(div.style.left);
            const y = parseInt(div.style.top);
            const text = div.innerText.trim();
            const fontSize = parseInt(div.style.fontSize);
            const color = div.style.color;
            const fontWeight = div.style.fontWeight;

            canvasElements.push({
                id: 'txt_' + Date.now() + Math.random(),
                type: 'static-text',
                x, y,
                props: { text, fontSize, color, fontWeight }
            });
        });

        // Parse Lines
        const lines = container.querySelectorAll('div[style*="transform:rotate"]');
        lines.forEach(div => {
            // Differentiate line vs arrow
            // arrow has inner triangle div
            const isArrow = div.querySelector('div[style*="border-left"]');

            const x = parseInt(div.style.left);
            const y = parseInt(div.style.top);
            const w = parseInt(div.style.width);
            const h = parseInt(div.style.height);
            const bg = div.style.backgroundColor;
            const rotMatch = div.style.transform.match(/rotate\(([-\d.]+)deg\)/);
            const rot = rotMatch ? parseFloat(rotMatch[1]) : 0;

            canvasElements.push({
                id: 'line_' + Date.now() + Math.random(),
                type: isArrow ? 'static-arrow' : 'static-line',
                x, y,
                props: { width: w, height: h, backgroundColor: bg, rotation: rot }
            });
        });

        // Recover Selector Types from Script
        // Look for `selectors: [...]` in script
        const scriptMatch = content.match(/selectors:\s*(\[[^\]]+\])/);
        if (scriptMatch) {
            try {
                // It's JSON-like but might have non-strict quotes?
                // The generator uses JSON.stringify, so it should be valid JSON.
                const selConfig = JSON.parse(scriptMatch[1]);
                selConfig.forEach(s => {
                    const el = canvasElements.find(e => e.props.id === s.id);
                    if (el && el.props.symbol === 'selector') {
                        if (s.type === 'mode') {
                            el.props.symbol = 'selector-mode';
                            el.props.tag = 'Panel.Mode';
                        } else {
                            el.props.symbol = 'selector-remote';
                            el.props.tag = 'Panel.LocalRemote';
                        }
                    }
                });
            } catch (e) {
                console.error("Failed to parse selector config:", e);
            }
        }

        renderCanvas();
        updateEditorState();
        updateBackgroundUI(); // <--- Added this call
        alert("Mimic loaded!");
    }

    function updateEditorState() {
        if (currentFilename) {
            const nameDisplay = document.getElementById('currentFilenameDisplay');
            if (nameDisplay) nameDisplay.innerText = currentFilename;
            loadBtn.innerText = "Load Mimic (" + currentFilename + ")";
        }
    }

    loadBtn.addEventListener('click', () => {
        loadFileInput.click();
    });

    loadFileInput.addEventListener('change', handleFileLoad);
    generateBtn.addEventListener('click', handleSaveClick);


    // --- Navigation & Layouts ---
    async function loadNavigation() {
        try {
            const res = await fetch('/api/dev/navigation');
            navData = await res.json();
        } catch (e) {
            console.error("Failed to load navigation:", e);
        }
    }

    // --- Background Control ---
    function setupBackgroundControls() {
        // Elements
        const bgSelectBtn = document.getElementById('bgSelectBtn');
        const bgFitBtn = document.getElementById('bgFitBtn');
        const bgClearBtn = document.getElementById('bgClearBtn');
        const canvasWInput = document.getElementById('canvasWidth');
        const canvasHInput = document.getElementById('canvasHeight');

        // Modal Elements
        const layoutModal = document.getElementById('layoutModal');
        const layoutList = document.getElementById('layoutList');
        const layoutConfirmBtn = document.getElementById('layoutConfirmBtn');
        const layoutCloseBtn = document.getElementById('layoutCloseBtn');

        let selectedLayoutFile = null;

        // Open Modal
        if (bgSelectBtn) {
            bgSelectBtn.addEventListener('click', async () => {
                if (layoutModal) layoutModal.style.display = 'block';
                if (layoutList) layoutList.innerHTML = '<div class="loading">Loading layouts...</div>';
                if (layoutConfirmBtn) layoutConfirmBtn.disabled = true;
                selectedLayoutFile = null;

                try {
                    const res = await fetch('/api/dev/layouts');
                    const files = await res.json();

                    if (layoutList) {
                        layoutList.innerHTML = '';
                        if (files.length === 0) {
                            layoutList.innerHTML = '<div style="padding:10px;">No layout files found in /layout directory.</div>';
                        } else {
                            files.forEach(f => {
                                const div = document.createElement('div');
                                div.className = 'file-item';
                                div.innerText = f;
                                div.addEventListener('click', () => {
                                    layoutList.querySelectorAll('.file-item').forEach(i => i.classList.remove('selected'));
                                    div.classList.add('selected');
                                    selectedLayoutFile = f;
                                    if (layoutConfirmBtn) layoutConfirmBtn.disabled = false;
                                });
                                layoutList.appendChild(div);
                            });
                        }
                    }
                } catch (e) {
                    if (layoutList) layoutList.innerHTML = '<div class="error">Error loading layouts.</div>';
                    console.error(e);
                }
            });
        }

        if (layoutCloseBtn) {
            layoutCloseBtn.addEventListener('click', () => {
                layoutModal.style.display = 'none';
            });
        }

        if (layoutConfirmBtn) {
            layoutConfirmBtn.addEventListener('click', () => {
                if (selectedLayoutFile) {
                    currentBackground = selectedLayoutFile;
                    updateBackgroundUI();
                    layoutModal.style.display = 'none';
                }
            });
        }

        if (bgFitBtn) {
            bgFitBtn.addEventListener('click', () => {
                if (!currentBackground) return;
                const img = new Image();
                img.onload = () => {
                    canvasWidth = img.width;
                    canvasHeight = img.height;
                    if (canvasWInput) canvasWInput.value = canvasWidth;
                    if (canvasHInput) canvasHInput.value = canvasHeight;
                    updateBackgroundUI();
                };
                img.src = currentBackground.startsWith('/') ? currentBackground : '/layout/' + currentBackground;
            });
        }

        if (bgClearBtn) {
            bgClearBtn.addEventListener('click', () => {
                currentBackground = null;
                updateBackgroundUI();
            });
        }

        // Dimensions Inputs
        if (canvasWInput) {
            canvasWInput.addEventListener('change', () => {
                canvasWidth = parseInt(canvasWInput.value) || 1200;
                updateBackgroundUI();
            });
            canvasWInput.value = canvasWidth;
        }
        if (canvasHInput) {
            canvasHInput.addEventListener('change', () => {
                canvasHeight = parseInt(canvasHInput.value) || 800;
                updateBackgroundUI();
            });
            canvasHInput.value = canvasHeight;
        }

        updateBackgroundUI();
    }

    function updateBackgroundUI() {
        const bgPreview = document.getElementById('bgPreview');
        const bgClearBtn = document.getElementById('bgClearBtn');
        const canvas = document.getElementById('mimicCanvas');

        // Update Canvas Style
        if (canvas) {
            canvas.style.width = canvasWidth + 'px';
            canvas.style.height = canvasHeight + 'px';

            const gridPattern = `
                linear-gradient(to right, rgba(0,0,0,0.1) 1px, transparent 1px),
                linear-gradient(to bottom, rgba(0,0,0,0.1) 1px, transparent 1px)
            `;
            const gridSize = '20px 20px';

            if (currentBackground) {
                if (bgPreview) bgPreview.innerText = currentBackground;
                if (bgClearBtn) bgClearBtn.style.display = 'block';

                const url = currentBackground.startsWith('/') ? currentBackground : '/layout/' + currentBackground;

                // Layer grid ON TOP of background image
                canvas.style.backgroundImage = `${gridPattern}, url('${url}')`;

                // Grid repeats, image covers
                canvas.style.backgroundSize = `${gridSize}, ${gridSize}, cover`;
                canvas.style.backgroundRepeat = 'repeat, repeat, no-repeat';
                canvas.style.backgroundPosition = '0 0, 0 0, 0 0';

            } else {
                if (bgPreview) bgPreview.innerText = "No background set.";
                if (bgClearBtn) bgClearBtn.style.display = 'none';

                // Just the grid
                canvas.style.backgroundImage = gridPattern;
                canvas.style.backgroundSize = gridSize;
                canvas.style.backgroundRepeat = 'repeat';
            }
        }
    }

    function setupSaveModalInteractions() {
        const modal = document.getElementById('saveModal');
        const confirmBtn = document.getElementById('saveConfirmBtn');
        const closeBtn = document.getElementById('saveCloseBtn');
        const nameInput = document.getElementById('saveFilenameInput');

        if (confirmBtn) {
            confirmBtn.addEventListener('click', () => {
                const filename = nameInput.value.trim();
                if (!filename) {
                    alert("Please enter a filename.");
                    return;
                }
                if (!filename.toLowerCase().endsWith('.html')) {
                    alert("Filename must end with .html");
                    return;
                }

                performSave(filename).then(() => {
                    modal.style.display = 'none';
                });
            });
        }

        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                modal.style.display = 'none';
            });
        }
    }

    function setupNavigationManager() {
        const modal = document.getElementById('navModal');
        const btn = document.getElementById('navBtn');
        const closeBtn = document.getElementById('navCloseBtn');
        const saveBtn = document.getElementById('navSaveBtn');

        // Lists
        const listLoc = document.getElementById('navListLoc');
        const listSys = document.getElementById('navListSys');
        const listPage = document.getElementById('navListPage');

        // Add Buttons
        const addLocBtn = document.getElementById('navAddLocBtn');
        const addSysBtn = document.getElementById('navAddSysBtn');
        const addPageBtn = document.getElementById('navAddPageBtn');

        let tempNavData = JSON.parse(JSON.stringify(navData)); // Local copy for editing
        let activeLoc = null;
        let activeSys = null;
        let activePage = null; // Track selected page

        const navRemovePageBtn = document.getElementById('navRemovePageBtn');
        if (navRemovePageBtn) {
            navRemovePageBtn.addEventListener('click', () => {
                if (!activeSys || !activePage) return;

                if (confirm(`Are you sure you want to remove page "${activePage.title}" from this system?`)) {
                    // Remove from array
                    activeSys.pages = activeSys.pages.filter(p => p.file !== activePage.file);
                    activePage = null;
                    renderNavManager();
                }
            });
        }

        if (btn) {
            btn.addEventListener('click', async () => {
                await loadNavigation(); // Fetch latest from server
                tempNavData = JSON.parse(JSON.stringify(navData));
                activeLoc = null;
                activeSys = null;
                activePage = null;
                renderNavManager();
                modal.style.display = 'block';
            });
        }

        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                modal.style.display = 'none';
            });
        }

        if (saveBtn) {
            saveBtn.addEventListener('click', async () => {
                // Save to server
                try {
                    const res = await fetch('/api/dev/navigation', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(tempNavData)
                    });
                    if (res.ok) {
                        alert("Navigation saved!");
                        navData = JSON.parse(JSON.stringify(tempNavData));
                        modal.style.display = 'none';
                    } else {
                        alert("Failed to save navigation.");
                    }
                } catch (e) { console.error(e); alert("Error saving."); }
            });
        }

        function renderNavManager() {
            renderLocList();
            renderSysList();
            renderPageList();
        }

        function renderLocList() {
            if (!listLoc) return;
            listLoc.innerHTML = '';

            const navRemoveLocBtn = document.getElementById('navRemoveLocBtn');
            if (navRemoveLocBtn) navRemoveLocBtn.disabled = !activeLoc;

            (tempNavData.locations || []).forEach(loc => {
                const li = document.createElement('li');
                li.className = 'nav-item';
                li.innerHTML = `<span class="nav-item-title">${loc.name}</span> <span class="nav-item-subtitle">(${loc.id})</span>`;
                if (activeLoc && activeLoc.id === loc.id) li.classList.add('selected');
                li.addEventListener('click', () => {
                    activeLoc = loc;
                    activeSys = null;
                    activePage = null; // Reset page selection
                    renderNavManager();
                });
                listLoc.appendChild(li);
            });
        }

        function renderSysList() {
            if (!listSys) return;
            listSys.innerHTML = '';
            addSysBtn.disabled = !activeLoc;

            const navRemoveSysBtn = document.getElementById('navRemoveSysBtn');
            if (navRemoveSysBtn) navRemoveSysBtn.disabled = !activeSys;

            if (!activeLoc) return;

            (activeLoc.systems || []).forEach(sys => {
                const li = document.createElement('li');
                li.className = 'nav-item';
                li.innerHTML = `<span class="nav-item-title">${sys.name}</span> <span class="nav-item-subtitle">(${sys.id})</span>`;
                if (activeSys && activeSys.id === sys.id) li.classList.add('selected');
                li.addEventListener('click', () => {
                    activeSys = sys;
                    activePage = null; // Reset page selection
                    renderPageList();
                    // Re-highlight sys
                    const all = listSys.querySelectorAll('li');
                    all.forEach(x => x.classList.remove('selected'));
                    li.classList.add('selected');

                    // Enable remove button
                    const btn = document.getElementById('navRemoveSysBtn');
                    if (btn) btn.disabled = false;
                });
                listSys.appendChild(li);
            });
        }

        function renderPageList() {
            if (!listPage) return;
            listPage.innerHTML = '';

            addPageBtn.disabled = !activeSys;
            const navRemovePageBtn = document.getElementById('navRemovePageBtn');
            if (navRemovePageBtn) {
                navRemovePageBtn.disabled = !activePage;
            }

            if (!activeSys) return;

            (activeSys.pages || []).forEach(pg => {
                const li = document.createElement('li');
                li.className = 'nav-item';
                li.innerHTML = `<span class="nav-item-title">${pg.title}</span> <span class="nav-item-subtitle">(${pg.file})</span>`;

                if (activePage && activePage.file === pg.file) {
                    li.classList.add('selected');
                }

                li.addEventListener('click', () => {
                    activePage = pg;
                    renderPageList();
                });

                listPage.appendChild(li);
            });
        }

        // Helper to show a custom prompt since native prompt might be blocked/ignored
        function showCustomPrompt(message, callback) {
            let overlay = document.getElementById('customPromptOverlay');
            if (!overlay) {
                overlay = document.createElement('div');
                overlay.id = 'customPromptOverlay';
                overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:10000;display:flex;justify-content:center;align-items:center;';
                overlay.innerHTML = `
                    <div style="background:white;padding:20px;border-radius:5px;box-shadow:0 0 10px rgba(0,0,0,0.5);width:300px;">
                        <h3 id="customPromptMsg" style="margin-top:0;"></h3>
                        <input type="text" id="customPromptInput" style="width:100%;padding:5px;margin:10px 0;box-sizing:border-box;">
                        <div style="display:flex;justify-content:flex-end;gap:10px;">
                            <button id="customPromptCancel">Cancel</button>
                            <button id="customPromptOk" class="primary-btn">OK</button>
                        </div>
                    </div>
                `;
                document.body.appendChild(overlay);
            }

            const msgEl = overlay.querySelector('#customPromptMsg');
            const inputEl = overlay.querySelector('#customPromptInput');
            const cancelBtn = overlay.querySelector('#customPromptCancel');
            const okBtn = overlay.querySelector('#customPromptOk');

            msgEl.textContent = message;
            inputEl.value = '';
            overlay.style.display = 'flex';
            inputEl.focus();

            const cleanup = () => {
                cancelBtn.onclick = null;
                okBtn.onclick = null;
                overlay.style.display = 'none';
            };

            cancelBtn.onclick = () => {
                cleanup();
                callback(null);
            };

            okBtn.onclick = () => {
                const val = inputEl.value.trim();
                cleanup();
                callback(val);
            };
        }

        function showFileSelectionDialog(files, titles, callback) {
            let overlay = document.getElementById('fileSelectionOverlay');
            if (!overlay) {
                overlay = document.createElement('div');
                overlay.id = 'fileSelectionOverlay';
                overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:99999;display:flex;justify-content:center;align-items:center;';
                overlay.innerHTML = `
                    <div style="background:white;padding:20px;border-radius:5px;box-shadow:0 0 10px rgba(0,0,0,0.5);width:400px;max-height:80vh;display:flex;flex-direction:column;">
                        <h3 style="margin-top:0;">Select Page</h3>
                        <div id="fileSelectionList" style="flex:1;overflow-y:auto;border:1px solid #ccc;margin:10px 0;"></div>
                        <div style="display:flex;justify-content:flex-end;gap:10px;">
                            <button id="fileSelectionCancel">Cancel</button>
                        </div>
                    </div>
                `;
                document.body.appendChild(overlay);
            }

            const listEl = overlay.querySelector('#fileSelectionList');
            const cancelBtn = overlay.querySelector('#fileSelectionCancel');

            listEl.innerHTML = '';
            files.forEach(f => {
                const key = f.replace('.html', '');
                const title = titles[key] || titles[f] || f;
                const div = document.createElement('div');
                div.style.cssText = 'padding:8px;cursor:pointer;border-bottom:1px solid #eee;';
                div.innerHTML = `<b>${title}</b><br><small style="color:gray">${f}</small>`;
                div.onmouseover = () => div.style.background = '#f0f0f0';
                div.onmouseout = () => div.style.background = 'white';
                div.onclick = () => {
                    cleanup();
                    callback(f);
                };
                listEl.appendChild(div);
            });

            overlay.style.display = 'flex';

            const cleanup = () => {
                cancelBtn.onclick = null;
                overlay.style.display = 'none';
            };

            cancelBtn.onclick = () => {
                cleanup();
                callback(null);
            };
        }

        // Add Handlers
        if (addLocBtn) {
            addLocBtn.addEventListener('click', () => {
                console.log("Add Location Clicked");
                showCustomPrompt("Location ID (e.g. NBT):", (id) => {
                    if (!id) return;
                    showCustomPrompt("Location Name:", (name) => {
                        if (!name) return;
                        if (!tempNavData.locations) tempNavData.locations = [];
                        tempNavData.locations.push({ id, name, systems: [] });
                        renderNavManager();
                    });
                });
            });
        }

        if (addSysBtn) {
            addSysBtn.addEventListener('click', () => {
                console.log("Add System Clicked");
                if (!activeLoc) return;
                showCustomPrompt("System ID (e.g. TRA):", (id) => {
                    if (!id) return;
                    showCustomPrompt("System Name:", (name) => {
                        if (!name) return;
                        if (!activeLoc.systems) activeLoc.systems = [];
                        activeLoc.systems.push({ id, name, pages: [] });
                        renderNavManager();
                    });
                });
            });
        }

        if (addPageBtn) {
            addPageBtn.addEventListener('click', async () => {
                if (!activeLoc || !activeSys) return;

                try {
                    const [filesRes, titlesRes] = await Promise.all([
                        fetch('/api/dev/mimic_files'),
                        fetch('/api/dev/titles')
                    ]);
                    const files = await filesRes.json();
                    const titles = await titlesRes.json();

                    // Filter: must start with LOC_SYS_ (case insensitive)
                    const prefix = `${activeLoc.id}_${activeSys.id}_`.toUpperCase();
                    const relevantFiles = files.filter(f => f.toUpperCase().startsWith(prefix));

                    if (relevantFiles.length === 0) {
                        alert(`No files found for this system (${prefix}*). Please create a file first.`);
                        return;
                    }

                    showFileSelectionDialog(relevantFiles, titles, (selectedFile) => {
                        if (!selectedFile) return;

                        // Auto-resolve title
                        const key = selectedFile.replace('.html', '');
                        const title = titles[key] || titles[selectedFile] || selectedFile;

                        if (!activeSys.pages) activeSys.pages = [];
                        activeSys.pages.push({ file: selectedFile, title });
                        renderNavManager();
                    });

                } catch (err) {
                    console.error("Error fetching files:", err);
                    alert("Failed to load file list.");
                }
            });
        }

        const navRemoveLocBtn = document.getElementById('navRemoveLocBtn');
        if (navRemoveLocBtn) {
            navRemoveLocBtn.addEventListener('click', () => {
                if (!activeLoc) return;

                if (confirm(`Are you sure you want to remove Location "${activeLoc.name}" (${activeLoc.id}) and all its systems?`)) {
                    tempNavData.locations = tempNavData.locations.filter(l => l.id !== activeLoc.id);
                    activeLoc = null;
                    activeSys = null;
                    activePage = null;
                    renderNavManager();
                }
            });
        }

        const navRemoveSysBtn = document.getElementById('navRemoveSysBtn');
        if (navRemoveSysBtn) {
            navRemoveSysBtn.addEventListener('click', () => {
                if (!activeLoc || !activeSys) return;

                if (confirm(`Are you sure you want to remove System "${activeSys.name}" (${activeSys.id}) and all its pages?`)) {
                    activeLoc.systems = activeLoc.systems.filter(s => s.id !== activeSys.id);
                    activeSys = null;
                    activePage = null;
                    renderNavManager();
                }
            });
        }

    }

    loadNavigation();
    setupBackgroundControls();
    setupSaveModalInteractions();
    setupNavigationManager();

    // Initial Load
    loadSymbols();
    loadSystems();
    setupDragAndDrop();
    setupCanvasInteractions();
    renderCanvas();
});
