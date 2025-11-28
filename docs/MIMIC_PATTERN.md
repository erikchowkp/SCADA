
# Mimic Page Pattern

This document defines the standardized pattern for creating SCADA mimic pages. All mimic pages should follow this structure for consistency and maintainability.

---

## Core Architecture

### 1. Page Structure
```html
<style>
  /* Custom styles for this mimic */
  button:disabled { /* standard disabled state */ }
  .pump-container, .selector-container { cursor: pointer; }
</style>

<div id="systemMimic" class="system-mimic" style="margin:20px;"></div>

<script>
  const LOC = "XXX";  // Location identifier (NBT, SBT, etc.)
  const SYS = "YYY";  // System identifier (TRA, LPS, etc.)
  
  const config = {
    // Equipment configuration
    pits: ["SPT001"],
    pumps: ["SUP001", "SUP002", "SUP003"],
    panel: "SPP001",
    ai_textb: ["FLO001"]
  };
</script>
```

### 2. Required Functions

Every mimic page must implement these five core functions:

#### **`buildLayout()`**
- Dynamically creates the DOM structure
- Builds equipment containers from config
- Assigns unique IDs to each symbol container
- Should be called early in initialization

#### **`registerInitialHighlights()`**
- Registers equipment with the Highlight system
- Maps DOM elements to equipment keys
- Called after symbols are initialized

#### **`safeInit()`**
- Ensures DOM is ready before symbol initialization
- Handles both immediate and delayed loading scenarios

#### **`initSymbols()`**
- Initializes all symbols with `noAutoRefresh: true`
- Sets up WebSocket subscriptions for real-time updates
- Wires up the refresh cycle

#### **`refresh[SystemName]()`**
- Central update function called by WebSocket handler
- Updates all symbols using their API methods
- Handles data and alarm state synchronization

---

## Symbol Initialization Pattern

### Page-Managed Mode (Recommended)

All symbols should be initialized with `noAutoRefresh: true` so the page controls updates:

```javascript
function initSymbols() {
  const initTasks = [];

  // Initialize pumps
  config.pumps.forEach((pumpId, i) => {
    initTasks.push(Symbols.Pump.init(`pump${i + 1}`, {
      equipKey: `${LOC}-${SYS}-${pumpId}`,
      faceplate: Core.Naming.buildFullName({ 
        loc: LOC, sys: SYS, 
        equipType: "SUP", 
        equipId: pumpId.slice(-3) 
      }),
      loc: LOC,
      noAutoRefresh: true,  // ← Page manages updates
      doc: document
    }));
  });

  // Initialize pits
  config.pits.forEach((pitId, i) => {
    initTasks.push(Symbols.Pit.init(`pit${i + 1}`, {
      equipKey: `${LOC}-${SYS}-${pitId}`,
      faceplate: Core.Naming.buildFullName({ 
        loc: LOC, sys: SYS, 
        equipType: "SPT", 
        equipId: pitId.slice(-3) 
      }),
      loc: LOC,
      noAutoRefresh: true,
      doc: document
    }));
  });

  // Initialize AI text boxes
  const aiSymbols = [];
  config.ai_textb?.forEach((aiId, i) => {
    initTasks.push(
      Symbols.AI_TEXTB.init(`ai${i + 1}`, {
        loc: LOC, sys: SYS, 
        equipId: aiId.slice(-3), 
        equipType: "FLO", 
        unit: "L/h",
        noAutoRefresh: true,
        doc: document
      }).then(api => {
        aiSymbols[i] = api;
        return api;
      })
    );
  });

  // Initialize selectors
  initTasks.push(Symbols.Selector.init("panelMode", {
    equipKey: `${LOC}-${SYS}-${config.panel}`,
    faceplate: Core.Naming.buildFullName({ 
      loc: LOC, sys: SYS, 
      equipType: "SPP", 
      equipId: config.panel.slice(-3) 
    }),
    loc: LOC, 
    type: "mode", 
    doc: document
  }));

  Promise.all(initTasks).then(symbols => {
    const pumpSymbols = symbols.slice(0, config.pumps.length);
    const pitSymbols = symbols.slice(config.pumps.length, config.pumps.length + config.pits.length);
    const [PanelMode, PanelRemote] = symbols.slice(-2);
    
    // Setup WebSocket subscriptions...
  });
}
```

---

## WebSocket Subscription Pattern

### Direct WebSocket Mode (Current Standard)

```javascript
const sm = SCADA?.Core?.SocketManager;
if (sm) {
  const scope = `system:${LOC}`;
  console.log(`📡 ${LOC}_${SYS}: Direct WS subscription to ${scope}`);

  // State cache for merging incremental updates
  let cachedPoints = {};
  let cachedAlarms = [];

  const handleSystemUpdate = (msg) => {
    // 1. Handle ALARMS (standalone or embedded)
    if (msg.alarms) {
      cachedAlarms = Array.isArray(msg.alarms) 
        ? msg.alarms 
        : Object.values(msg.alarms);

      if (msg.type === 'alarms' || msg.type === 'alarm') {
        const data = { points: Object.values(cachedPoints) };
        refreshSystem(pumpSymbols, pitSymbols, aiSymbols, PanelMode, PanelRemote, data, cachedAlarms);
        return;
      }
    }

    // 2. Handle SNAPSHOT (full state)
    if (msg.type === 'snapshot' && msg.points) {
      cachedPoints = msg.points;
      const data = { points: Object.values(cachedPoints) };
      refreshSystem(pumpSymbols, pitSymbols, aiSymbols, PanelMode, PanelRemote, data, cachedAlarms);
    }

    // 3. Handle UPDATE (incremental)
    else if (msg.type === 'update' && msg.diffs?.points) {
      const changed = msg.diffs.points.changed || {};
      const removed = msg.diffs.points.removed || [];
      const count = Object.keys(changed).length + removed.length;

      if (count > 0) {
        if (msg.diffs.points.changed) {
          Object.assign(cachedPoints, msg.diffs.points.changed);
        }
        if (msg.diffs.points.removed) {
          msg.diffs.points.removed.forEach(key => delete cachedPoints[key]);
        }

        const data = { points: Object.values(cachedPoints) };
        refreshSystem(pumpSymbols, pitSymbols, aiSymbols, PanelMode, PanelRemote, data, cachedAlarms);
      }
    }
  };

  sm.subscribe(scope, handleSystemUpdate);
  sm.subscribe('alarms', handleSystemUpdate);

  // Cleanup on unload
  window.addEventListener('beforeunload', () => {
    try {
      sm.unsubscribe(scope, handleSystemUpdate);
      sm.unsubscribe('alarms', handleSystemUpdate);
    } catch (e) { }
  });
}
```

---

## Refresh Function Pattern

The central refresh function updates all symbols using their exposed APIs:

```javascript
function refreshSystem(pumps, pits, aiSymbols, PanelMode, PanelRemote, data, alarms) {
  if (!data || !alarms) return;
  
  try {
    // --- Pit updates ---
    config.pits.forEach((pitId, i) => {
      if (pits[i]) {
        const cls = pits[i].getVisualClass(data, alarms, LOC);
        pits[i].update(cls.pct, cls.visualClass);
        pits[i].showOverride(cls.override);
      }
    });

    // --- Pump updates ---
    pumps.forEach(pump => {
      const cls = pump.getVisualClass(data, alarms, LOC);
      pump.update(cls.visualClass);
      pump.showOverride((cls.run?.mo_i) || (cls.trip?.mo_i));
    });

    // --- Selector updates ---
    const modeCls = PanelMode.getVisualClass(data, LOC, "Panel.Mode");
    const remoteCls = PanelRemote.getVisualClass(data, LOC, "Panel.LocalRemote");
    
    if (modeCls.state) PanelMode.update(modeCls.state);
    if (remoteCls.state) PanelRemote.update(remoteCls.state);
    PanelMode.showOverride(modeCls.override);
    PanelRemote.showOverride(remoteCls.override);

    // --- AI_TEXTB updates ---
    config.ai_textb?.forEach((aiId, i) => {
      if (aiSymbols[i]) {
        const cls = aiSymbols[i].getVisualClass(data, alarms, LOC);
        if (cls.value !== null) {
          aiSymbols[i].update(cls.value, cls.limits, cls.decimals, cls.flash);
          aiSymbols[i].showOverride(cls.override);
        }
      }
    });

  } catch (err) {
    console.error(`${SYS} mimic refresh failed:`, err);
  }
}
```

---

## Dynamic Label Updates

Update equipment labels from live data:

```javascript
// Update pit labels
config.pits.forEach((pitId, i) => {
  const pitPoint = data.points.find(p => p.tag === "Pit.HighLevel" && p.loc === LOC);
  const labelEl = document.getElementById(`pit${i + 1}Label`);
  if (labelEl && pitPoint) labelEl.textContent = pitPoint.label;
});

// Update pump labels
config.pumps.forEach((pumpId, i) => {
  const runTag = `${pumpId}.RunFb`;
  const startTag = `${pumpId}.StartCmd`;
  const pumpPoint = data.points.find(p => p.tag === runTag && p.loc === LOC)
    || data.points.find(p => p.tag === startTag && p.loc === LOC);
  const labelEl = document.getElementById(`pump${i + 1}Label`);
  if (labelEl && pumpPoint) labelEl.textContent = pumpPoint.label;
});
```

---

## Layout Building Pattern

### Dynamic DOM Creation

```javascript
function buildLayout() {
  const container = document.getElementById("systemMimic");
  container.innerHTML = "";

  // --- Pits row ---
  const pitRow = document.createElement("div");
  pitRow.style.display = "flex";
  pitRow.style.alignItems = "flex-start";
  pitRow.style.gap = "40px";

  config.pits.forEach((pitId, i) => {
    const wrap = document.createElement("div");
    wrap.style.textAlign = "center";
    
    const pitDiv = document.createElement("div");
    pitDiv.id = `pit${i + 1}`;
    pitDiv.className = "pit-container";
    pitDiv.style.position = "relative";
    
    const label = document.createElement("div");
    label.id = `pit${i + 1}Label`;
    label.style.cssText = "font-size:12px; margin-top:4px;";
    label.textContent = pitId;
    
    wrap.append(pitDiv, label);
    pitRow.appendChild(wrap);
  });

  container.appendChild(pitRow);
}
```

---

## Complete Initialization Sequence

```javascript
// 1. Access parent SCADA API
window.SCADA = window.parent.SCADA;
const Core = window.SCADA.Core;
const Symbols = window.SCADA.Symbols;

// 2. Build layout
buildLayout();

// 3. Safe initialization wrapper
function safeInit() {
  const checkExist = () => {
    if (document.getElementById("pump1")) { 
      initSymbols(); 
    } else { 
      setTimeout(checkExist, 50); 
    }
  };
  checkExist();
}

// 4. Start when ready
if (document.readyState === "complete") { 
  safeInit(); 
} else { 
  window.addEventListener("load", safeInit); 
}
```

---

## Highlight System Integration

```javascript
function registerInitialHighlights() {
  if (!Core.Highlight) return;
  
  const mapId = id => document.getElementById(id);
  
  // Register pits
  config.pits.forEach((pitId, i) => {
    const el = mapId(`pit${i + 1}`);
    const lbl = mapId(`pit${i + 1}Label`);
    if (el && lbl) {
      Core.Highlight.register(`${LOC}-${SYS}-${lbl.textContent}`, el);
    }
  });

  // Register AI text boxes
  config.ai_textb.forEach((aiId, i) => {
    const el = mapId(`ai${i + 1}`);
    if (el) {
      Core.Highlight.register(`${LOC}-${SYS}-${aiId}`, el);
    }
  });

  // Register selectors
  ["panelMode", "panelRemote"].forEach(id => {
    const el = mapId(id);
    const text = document.getElementById("panelLabel")?.textContent || "";
    if (el) {
      Core.Highlight.register(`${LOC}-${SYS}-${text}`, el);
    }
  });

  Core.Highlight.equipIfPending();
}
```

---

## Ready Signal

Signal to parent frame when mimic is loaded:

```javascript
console.log(`✅ ${LOC}_${SYS} mimic loaded`);
if (window.parent) { 
  window.parent.postMessage({ type: "mimicReady" }, "*"); 
}
```

---

## Creating a New Mimic Page

### Step 1: Copy Template
Start with an existing mimic page that most closely matches your needs (e.g., `NBT_TRA.html`).

### Step 2: Update Configuration
```javascript
const LOC = "XXX";  // Your location
const SYS = "YYY";  // Your system

const config = {
  pits: ["SPT001", "SPT002"],      // Update with actual equipment
  pumps: ["SUP001", "SUP002"],     // Update with actual equipment
  panel: "SPP001",
  ai_textb: ["FLO001", "FLO002"]
};
```

### Step 3: Customize Layout
Modify `buildLayout()` to match your system's physical arrangement.

### Step 4: Update Symbol Types
Ensure symbol initialization matches your equipment types:
- Use correct `equipType` for faceplate naming
- Add/remove symbol types as needed (valves, tanks, etc.)

### Step 5: Customize Refresh Logic
Adapt `refresh[SystemName]()` to handle your specific data points and update patterns.

### Step 6: Test WebSocket Subscription
Verify the scope matches your location:
```javascript
const scope = `system:${LOC}`;
```

---

## Key Differences from Symbol Pattern

| Aspect | Symbol Pattern | Mimic Pattern |
|--------|----------------|---------------|
| **Update control** | Symbols can auto-refresh OR be page-managed | Mimic pages ALWAYS manage symbol updates |
| **WebSocket** | Optional internal subscription if standalone | Required page-level subscription |
| **Configuration** | Single equipment instance | Multiple equipment instances in config |
| **Refresh function** | Internal `update()` method | Central `refreshSystem()` coordinates all symbols |
| **State management** | Self-contained | Aggregates state from multiple symbols |

---

## Benefits of This Pattern

✅ **Consistent** - All mimic pages follow the same structure  
✅ **Real-time** - WebSocket-driven updates with intelligent caching  
✅ **Scalable** - Easy to add/remove equipment by updating config  
✅ **Maintainable** - Clear separation of layout, initialization, and updates  
✅ **Flexible** - Can easily adapt to different system configurations  
✅ **Clean** - Proper cleanup prevents memory leaks  

---

## Common Symbol APIs Used in Mimics

### Pump Symbol
```javascript
pump.getVisualClass(data, alarms, LOC)  // Returns { visualClass, run, trip }
pump.update(visualClass)                 // Updates pump visual state
pump.showOverride(flag)                  // Shows/hides override badge
```

### Pit Symbol
```javascript
pit.getVisualClass(data, alarms, LOC)   // Returns { visualClass, pct, hh, high, override }
pit.update(pct, visualClass)             // Updates fill level and state
pit.showOverride(flag)                   // Shows/hides override badge
```

### Selector Symbol
```javascript
selector.getVisualClass(data, LOC, tag)  // Returns { state, override, point }
selector.update(state)                   // Updates selector position
selector.showOverride(flag)              // Shows/hides override badge
```

### AI_TEXTB Symbol
```javascript
ai.getVisualClass(data, alarms, LOC)    // Returns { value, limits, decimals, flash, override }
ai.update(value, limits, decimals, flash) // Updates displayed value
ai.showOverride(flag)                    // Shows/hides override badge
```
