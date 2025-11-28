
### 1. Exposed API
```javascript
const api = { 
  update,           // Updates visual state
  showOverride,     // Shows/hides override badge  
  getVisualClass    // Calculates visual state from data
};
```

### 2. Conditional Subscription Block
```javascript
if (!opts.noAutoRefresh) {
  // Internal WebSocket subscriptions
  // Only runs when symbol is standalone
}
```

---

## Pit.js Implementation

### API Methods

**`update(levelPercent, visualClass)`**
- Updates pit fill height and CSS class
- `levelPercent`: 0-100 (determines fill bar height)
- `visualClass`: "normal" | "high" | "high-blink" | "hh" | "hh-blink" | "normal-blink"

**`getVisualClass(data, alarms, loc)`**
- Returns `{ visualClass, pct, hh, high, override }`
- Determines state based on HighLevel and HighHighLevel alarms
- Checks acknowledgment status for blinking

**`showOverride(flag)`**
- Shows/hides override badge on pit element

### Usage in NBT_TRA.html

**Initialization:**
```javascript
await Symbols.Pit.init(`pit${i + 1}`, {
  equipKey: `${LOC}-${SYS}-${pitId}`,
  faceplate: Core.Naming.buildFullName({...}),
  loc: LOC,
  noAutoRefresh: true,  // ← Page-managed mode
  doc: document
});
```

**Page-Level Updates:**
```javascript
function refreshTRA(pumps, pits, PanelMode, PanelRemote, data, alarms) {
  // Update pits
  config.pits.forEach((pitId, i) => {
    if (pits[i]) {
      const cls = pits[i].getVisualClass(data, alarms, LOC);
      pits[i].update(cls.pct, cls.visualClass);
      pits[i].showOverride(cls.override);
    }
  });
}
```

---

## Pump.js Implementation

### API Methods

**`update(visualClass)`**
- Updates pump CSS class
- `visualClass`: "running" | "stopped" | "trip" | "trip-unack"

**`getVisualClass(data, alarms, loc)`**
- Returns `{ visualClass, run, trip }`
- Priority: trip > running > stopped
- Checks trip acknowledgment for blinking

**`showOverride(flag)`**
- Shows/hides override badge on pump element

### Usage in NBT_TRA.html

**Initialization:**
```javascript
await Symbols.Pump.init(`pump${i + 1}`, {
  equipKey: `${LOC}-${SYS}-${pumpId}`,
  faceplate: Core.Naming.buildFullName({...}),
  loc: LOC,
  noAutoRefresh: true,  // ← Page-managed mode
  doc: document
});
```

**Page-Level Updates:**
```javascript
function refreshTRA(pumps, pits, PanelMode, PanelRemote, data, alarms) {
  // Update pumps
  pumps.forEach(pump => {
    const cls = pump.getVisualClass(data, alarms, LOC);
    pump.update(cls.visualClass);
    pump.showOverride((cls.run?.mo_i) || (cls.trip?.mo_i));
  });
}
```

---

## Selector.js Implementation

### API Methods

**`update(state)`**
- Updates selector visual state
- `state`: "auto" | "manual" | "remote" | "local"

**`getVisualClass(data, loc, tag)`**
- Returns `{ state, override, point }`
- Determines state based on tag type (Mode or LocalRemote)
- Maps point values: 0 = auto/remote, 1 = manual/local

**`showOverride(flag)`**
- Shows/hides override badge on selector element

### Usage in NBT_TRA.html

**Initialization:**
```javascript
await Symbols.Selector.init('panelMode', {
  equipKey: `${LOC}-${SYS}-SPP001`,
  faceplate: 'NBT-TRA-SPP-001',
  loc: LOC,
  type: 'mode',  // or omit for remote selector
  noAutoRefresh: true,  // ← Page-managed mode
  doc: document
});
```

**Page-Level Updates:**
```javascript
function refreshTRA(pumps, pits, PanelMode, PanelRemote, data, alarms) {
  // Update selectors
  const modeCls = PanelMode.getVisualClass(data, LOC, "Panel.Mode");
  const remoteCls = PanelRemote.getVisualClass(data, LOC, "Panel.LocalRemote");
  
  if (modeCls.state) PanelMode.update(modeCls.state);
  if (remoteCls.state) PanelRemote.update(remoteCls.state);
  PanelMode.showOverride(modeCls.override);
  PanelRemote.showOverride(remoteCls.override);
}
```

---

## Key Differences

| Aspect | Pit.js | Pump.js | Selector.js |
|--------|--------|---------|-------------|
| **Update params** | `update(pct, visualClass)` | `update(visualClass)` | `update(state)` |
| **Visual states** | 6 states (normal, high, hh + blinks) | 4 states (stopped, running, trip + unack) | 4 states (auto, manual, remote, local) |
| **getVisualClass params** | `(data, alarms, loc)` | `(data, alarms, loc)` | `(data, loc, tag)` |
| **Override check** | Returns boolean from `getVisualClass` | Checks `mo_i` on run/trip points | Returns boolean from `getVisualClass` |
| **Data source** | Alarm-based (HighLevel, HighHighLevel) | Alarm-based (Trip) | Point value-based (Panel.Mode, Panel.LocalRemote) |

---

## Adding New Symbols

To create a new symbol following this pattern:

### 1. Symbol File Structure
```javascript
async function init(containerId, opts = {}) {
  // 1. Load SVG
  // 2. Setup faceplate click
  // 3. Define update() function
  // 4. Define getVisualClass() function  
  // 5. Define showOverride() function
  
  const api = { update, showOverride, getVisualClass };
  SCADA.Core.ActiveSymbols[opts.equipKey || containerId] = api;
  
  // 6. Conditional WebSocket subscription
  if (!opts.noAutoRefresh) {
    // Subscribe to SocketManager
    // Setup observeDestruction cleanup
  }
  
  return api;
}
```

### 2. Page Integration

**In your page HTML (e.g., SBT_TRA.html):**

```javascript
// Initialize symbols
const mySymbols = await Promise.all(
  config.items.forEach((itemId, i) => 
    Symbols.MySymbol.init(`item${i+1}`, {
      equipKey: `${LOC}-${SYS}-${itemId}`,
      loc: LOC,
      noAutoRefresh: true,  // ← Page manages updates
      doc: document
    })
  )
);

// Subscribe to PollManager
const unsubscribe = Core.PollManager.subscribe((payload) => {
  const data = payload?.points ? { points: payload.points } : payload.data || payload;
  const alarms = payload?.alarms || [];
  refreshPage(mySymbols, data, alarms);
});

// Update function
function refreshPage(symbols, data, alarms) {
  symbols.forEach(symbol => {
    const cls = symbol.getVisualClass(data, alarms, LOC);
    symbol.update(cls.state);
    symbol.showOverride(cls.override);
  });
}
```

---

## Benefits of This Pattern

✅ **Flexible** - Works standalone or page-managed
✅ **Consistent** - Same pattern across all symbols
✅ **Clean** - No memory leaks with proper cleanup
✅ **Testable** - Can test symbols in isolation
✅ **Scalable** - Easy to add new pages/symbols
