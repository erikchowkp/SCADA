(function () {
    const systemSelect = document.getElementById('systemSelect');
    const ioTableBody = document.querySelector('#ioTable tbody');
    const refreshBtn = document.getElementById('refreshBtn');
    const editBtn = document.getElementById('editBtn');
    const addRowBtn = document.getElementById('addRowBtn');
    const addEquipSetBtn = document.getElementById('addEquipSetBtn');
    const saveBtn = document.getElementById('saveBtn');
    const cancelBtn = document.getElementById('cancelBtn');
    const serverWarning = document.getElementById('serverWarning');

    let currentSystem = null;
    let currentData = null;
    let isEditMode = false;
    let originalData = null;

    // Equipment Templates
    const equipmentTemplates = {
        SUP: [
            { signal: 'RunFb', signalType: 'DI', desc: 'Running Status', state0: 'Stopped', crit0: 0, state1: 'Running', crit1: 0 },
            { signal: 'Trip', signalType: 'DI', desc: 'Trip Status', state0: 'Healthy', crit0: 0, state1: 'Tripped', crit1: 3 },
            { signal: 'StartCmd', signalType: 'DO', desc: 'Start Command', state1: 'Start', crit1: 0 },
            { signal: 'StopCmd', signalType: 'DO', desc: 'Stop Command', state1: 'Stop', crit1: 0 }
        ],
        SPT: [
            { signal: 'HighLevel', signalType: 'DI', desc: 'High Level Alarm', state0: 'Normal', crit0: 0, state1: 'High Level', crit1: 2 },
            { signal: 'HighHighLevel', signalType: 'DI', desc: 'High-High Level Alarm', state0: 'Normal', crit0: 0, state1: 'High-High Level', crit1: 3 }
        ],
        SPP: [
            { signal: 'Mode', signalType: 'DI', desc: 'Auto/Manual Selector', state0: 'Auto', crit0: 0, state1: 'Manual', crit1: 3 },
            { signal: 'LocalRemote', signalType: 'DI', desc: 'Local/Remote Selector', state0: 'Remote', crit0: 0, state1: 'Local', crit1: 2 }
        ]
    };

    // API Calls
    async function fetchSystems() {
        try {
            const res = await fetch('/api/dev/systems');
            if (!res.ok) throw new Error('Failed to fetch systems');
            return await res.json();
        } catch (err) {
            console.error(err);
            alert('Error fetching systems');
            return [];
        }
    }

    async function fetchSystemIO(systemName) {
        try {
            const res = await fetch(`/api/dev/systems/${systemName}`);
            if (!res.ok) throw new Error(`Failed to fetch I/O for ${systemName}`);
            return await res.json();
        } catch (err) {
            console.error(err);
            alert(`Error fetching I/O for ${systemName}`);
            return null;
        }
    }

    async function saveSystemIO(systemName, data) {
        try {
            const res = await fetch(`/api/dev/systems/${systemName}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });

            if (res.status === 423) {
                const err = await res.json();
                alert(`⚠️ ${err.error}\n\nPlease stop the server and try again.`);
                showServerWarning(true);
                return null;
            }

            if (!res.ok) throw new Error('Failed to save');
            return await res.json();
        } catch (err) {
            console.error(err);
            alert('Error saving I/O data');
            return null;
        }
    }

    function showServerWarning(show) {
        if (show) {
            serverWarning.classList.add('show');
        } else {
            serverWarning.classList.remove('show');
        }
    }

    // Validation
    function validateField(field, value, allPoints, currentPoint) {
        switch (field) {
            case 'signalType':
                return ['DI', 'DO', 'AI', 'AO'].includes(value) ? { valid: true } : { valid: false, error: 'Must be DI, DO, AI, or AO' };
            case 'crit0':
            case 'crit1':
                const num = Number(value);
                return [0, 1, 2, 3].includes(num) ? { valid: true } : { valid: false, error: 'Must be 0, 1, 2, or 3' };
            case 'value':
                if (currentPoint.signalType === 'DI' || currentPoint.signalType === 'DO') {
                    const v = Number(value);
                    return [0, 1].includes(v) ? { valid: true } : { valid: false, error: 'Must be 0 or 1' };
                }
                return !isNaN(Number(value)) ? { valid: true } : { valid: false, error: 'Must be a number' };
            default:
                return { valid: true };
        }
    }

    // Rendering
    function renderSystems(systems) {
        systemSelect.innerHTML = '<option value="" disabled selected>Select System</option>';
        systems.forEach(sys => {
            const option = document.createElement('option');
            option.value = sys.name;
            option.textContent = sys.name;
            systemSelect.appendChild(option);
        });
        if (systems.find(s => s.name === 'TRA')) {
            systemSelect.value = 'TRA';
            loadSystem('TRA');
        }
    }

    function deleteRow(pt) {
        if (!confirm(`Delete I/O point: ${pt.tag}?`)) return;
        const index = currentData.points.indexOf(pt);
        if (index > -1) {
            currentData.points.splice(index, 1);
            renderTable(currentData.points, isEditMode);
        }
    }

    function renderTable(points, editable = false) {
        ioTableBody.innerHTML = '';
        if (!points || points.length === 0) {
            ioTableBody.innerHTML = '<tr><td colspan="15">No points found</td></tr>';
            return;
        }

        const groups = {};
        points.forEach(pt => {
            const equipKey = `${pt.loc}-${pt.sys}-${pt.equipType}${pt.equipId}`;
            if (!groups[equipKey]) groups[equipKey] = { key: equipKey, points: [] };
            groups[equipKey].points.push(pt);
        });

        const sortedGroups = Object.values(groups).sort((a, b) => a.key.localeCompare(b.key));

        sortedGroups.forEach(group => {
            const headerRow = document.createElement('tr');
            headerRow.className = 'group-header';
            headerRow.dataset.equipKey = group.key;
            headerRow.innerHTML = `<td colspan="15" style="background: #333; font-weight: bold; cursor: pointer; user-select: none;"><span class="toggle-icon">−</span> ${group.key} (${group.points.length} points)</td>`;
            ioTableBody.appendChild(headerRow);

            headerRow.addEventListener('click', () => {
                const icon = headerRow.querySelector('.toggle-icon');
                const rows = ioTableBody.querySelectorAll(`tr[data-parent="${group.key}"]`);
                const isCollapsed = icon.textContent === '+';
                icon.textContent = isCollapsed ? '−' : '+';
                rows.forEach(r => r.style.display = isCollapsed ? '' : 'none');
            });

            const formatCrit = (crit) => {
                if (crit === undefined || crit === null) return '-';
                const c = Number(crit);
                if (c === 0) return '<span style="color: #81c784">0</span>';
                if (c === 1) return '<span style="color: #fff176">1</span>';
                if (c === 2) return '<span style="color: #ffb74d">2</span>';
                if (c === 3) return '<span style="color: #e57373">3</span>';
                return c;
            };

            group.points.forEach(pt => {
                const tr = document.createElement('tr');
                tr.dataset.parent = group.key;
                const signalTypeClass = `type-${pt.signalType}`;

                if (editable) {
                    tr.innerHTML = `
                        <td><input type="text" value="${pt.loc || ''}" data-field="loc" class="edit-input" disabled></td>
                        <td><input type="text" value="${pt.sys || ''}" data-field="sys" class="edit-input" disabled></td>
                        <td><input type="text" value="${pt.equipType || ''}" data-field="equipType" class="edit-input" disabled></td>
                        <td><input type="text" value="${pt.equipId || ''}" data-field="equipId" class="edit-input" disabled></td>
                        <td><input type="text" value="${pt.label || ''}" data-field="label" class="edit-input" disabled></td>
                        <td><input type="text" value="${pt.tag}" data-field="tag" class="edit-input tag-cell" disabled></td>
                        <td><select data-field="signalType" class="edit-input type-cell ${signalTypeClass}">
                            <option value="DI" ${pt.signalType === 'DI' ? 'selected' : ''}>DI</option>
                            <option value="DO" ${pt.signalType === 'DO' ? 'selected' : ''}>DO</option>
                            <option value="AI" ${pt.signalType === 'AI' ? 'selected' : ''}>AI</option>
                            <option value="AO" ${pt.signalType === 'AO' ? 'selected' : ''}>AO</option>
                        </select></td>
                        <td><input type="text" value="${pt.desc || ''}" data-field="desc" class="edit-input"></td>
                        <td><input type="text" value="${pt.state0 || ''}" data-field="state0" class="edit-input"></td>
                        <td><input type="number" value="${pt.crit0 !== undefined ? pt.crit0 : ''}" data-field="crit0" class="edit-input" min="0" max="3"></td>
                        <td><input type="text" value="${pt.state1 || ''}" data-field="state1" class="edit-input"></td>
                        <td><input type="number" value="${pt.crit1 !== undefined ? pt.crit1 : ''}" data-field="crit1" class="edit-input" min="0" max="3"></td>
                        <td><input type="text" value="${pt.value !== undefined ? pt.value : ''}" data-field="value" class="edit-input"></td>
                        <td><input type="text" value="${pt.q || ''}" data-field="q" class="edit-input"></td>
                        <td><button class="delete-btn">Delete</button></td>
                    `;

                    tr.querySelector('.delete-btn').addEventListener('click', () => deleteRow(pt));

                    tr.querySelectorAll('.edit-input:not([disabled])').forEach(input => {
                        input.addEventListener('blur', (e) => {
                            const field = e.target.dataset.field;
                            const value = e.target.value;
                            const validation = validateField(field, value, currentData.points, pt);

                            if (!validation.valid) {
                                e.target.style.borderColor = 'red';
                                e.target.title = validation.error;
                            } else {
                                e.target.style.borderColor = '';
                                e.target.title = '';
                                pt[field] = field === 'crit0' || field === 'crit1' || field === 'value' ? Number(value) : value;
                            }
                        });
                    });
                } else {
                    tr.innerHTML = `
                        <td>${pt.loc || '-'}</td>
                        <td>${pt.sys || '-'}</td>
                        <td>${pt.equipType || '-'}</td>
                        <td>${pt.equipId || '-'}</td>
                        <td>${pt.label || '-'}</td>
                        <td class="tag-cell">${pt.tag}</td>
                        <td class="type-cell ${signalTypeClass}">${pt.signalType || '-'}</td>
                        <td>${pt.desc || '-'}</td>
                        <td>${pt.state0 || '-'}</td>
                        <td>${formatCrit(pt.crit0)}</td>
                        <td>${pt.state1 || '-'}</td>
                        <td>${formatCrit(pt.crit1)}</td>
                        <td>${pt.value !== undefined ? pt.value : '-'}</td>
                        <td>${pt.q || '-'}</td>
                        <td>-</td>
                    `;
                }
                ioTableBody.appendChild(tr);
            });
        });
    }

    async function loadSystem(name) {
        ioTableBody.innerHTML = '<tr><td colspan="15">Loading...</td></tr>';
        const data = await fetchSystemIO(name);
        if (data && data.points) {
            currentSystem = name;
            currentData = data;
            renderTable(data.points, isEditMode);
        } else {
            renderTable([]);
        }
    }

    editBtn.addEventListener('click', () => {
        if (!currentData) return;
        isEditMode = true;
        originalData = JSON.parse(JSON.stringify(currentData));
        editBtn.style.display = 'none';
        addRowBtn.style.display = 'inline-block';
        addEquipSetBtn.style.display = 'inline-block';
        saveBtn.style.display = 'inline-block';
        cancelBtn.style.display = 'inline-block';
        systemSelect.disabled = true;
        renderTable(currentData.points, true);
    });

    addRowBtn.addEventListener('click', () => {
        const loc = prompt('Enter Location (e.g., NBT):');
        if (!loc) return;
        const sys = prompt('Enter System (e.g., TRA):');
        if (!sys) return;
        const equipType = prompt('Enter Equipment Type (e.g., SPT, SUP):');
        if (!equipType) return;
        const equipId = prompt('Enter Equipment ID (3 digits, e.g., 001):');
        if (!equipId) return;
        const signal = prompt('Enter Signal (e.g., HighLevel, RunFb):');
        if (!signal) return;

        const label = `${equipType}${equipId}`;
        const tag = `${label}.${signal}`;
        const now = new Date();
        const pad = (n) => String(n).padStart(2, '0');
        const ts = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}  ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}.${String(now.getMilliseconds()).padStart(3, '0')}`;

        const newPoint = {
            mo_i: false,
            loc, sys, equipType, equipId, label, tag,
            signalType: 'DI',
            desc: '',
            state0: '',
            crit0: 0,
            state1: '',
            crit1: 0,
            value: 0,
            q: 'Good',
            ts: ts,
            signal: signal
        };

        currentData.points.push(newPoint);
        renderTable(currentData.points, true);
    });

    addEquipSetBtn.addEventListener('click', () => {
        const templateNames = Object.keys(equipmentTemplates).join(', ');
        const equipType = prompt(`Enter Equipment Type (${templateNames}):`);
        if (!equipType || !equipmentTemplates[equipType]) {
            alert(`Invalid equipment type. Available: ${templateNames}`);
            return;
        }

        const loc = prompt('Enter Location (e.g., NBT):');
        if (!loc) return;
        const sys = prompt('Enter System (e.g., TRA):');
        if (!sys) return;
        const equipId = prompt('Enter Equipment ID (3 digits, e.g., 001):');
        if (!equipId) return;

        const label = `${equipType}${equipId}`;
        const template = equipmentTemplates[equipType];
        const now = new Date();
        const pad = (n) => String(n).padStart(2, '0');
        const ts = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}  ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}.${String(now.getMilliseconds()).padStart(3, '0')}`;

        template.forEach(tmpl => {
            const newPoint = {
                mo_i: false,
                loc, sys, equipType, equipId, label,
                tag: `${label}.${tmpl.signal}`,
                signalType: tmpl.signalType,
                desc: tmpl.desc,
                state0: tmpl.state0 || '',
                crit0: tmpl.crit0 !== undefined ? tmpl.crit0 : 0,
                state1: tmpl.state1 || '',
                crit1: tmpl.crit1 !== undefined ? tmpl.crit1 : 0,
                value: 0,
                q: 'Good',
                ts: ts,
                signal: tmpl.signal
            };
            currentData.points.push(newPoint);
        });

        alert(`Created ${template.length} I/O points for ${label}`);
        renderTable(currentData.points, true);
    });

    saveBtn.addEventListener('click', async () => {
        let hasErrors = false;
        document.querySelectorAll('.edit-input:not([disabled])').forEach(input => {
            if (input.style.borderColor === 'red') hasErrors = true;
        });

        if (hasErrors) {
            alert('Please fix validation errors before saving');
            return;
        }

        const result = await saveSystemIO(currentSystem, currentData);
        if (result && result.ok) {
            alert(`✅ Saved ${result.saved} points successfully!\n\nYou can now restart the server.`);
            isEditMode = false;
            editBtn.style.display = 'inline-block';
            addRowBtn.style.display = 'none';
            addEquipSetBtn.style.display = 'none';
            saveBtn.style.display = 'none';
            cancelBtn.style.display = 'none';
            systemSelect.disabled = false;
            renderTable(currentData.points, false);
            showServerWarning(false);
        }
    });

    cancelBtn.addEventListener('click', () => {
        currentData = originalData;
        isEditMode = false;
        editBtn.style.display = 'inline-block';
        addRowBtn.style.display = 'none';
        addEquipSetBtn.style.display = 'none';
        saveBtn.style.display = 'none';
        cancelBtn.style.display = 'none';
        systemSelect.disabled = false;
        renderTable(currentData.points, false);
    });

    systemSelect.addEventListener('change', (e) => {
        const name = e.target.value;
        if (name) loadSystem(name);
    });

    refreshBtn.addEventListener('click', () => {
        if (currentSystem) loadSystem(currentSystem);
    });

    (async () => {
        const systems = await fetchSystems();
        renderSystems(systems);
    })();

})();
