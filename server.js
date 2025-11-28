const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();
const port = 3000;

app.use(express.json());
app.use(express.static(__dirname)); // serve index.html, Simulator.html, event.html, defs/

// -----------------------------------------------------------------------------
// PATHS
// -----------------------------------------------------------------------------
const defsPath = path.join(__dirname, "defs", "TRA.json");
const eventsPath = path.join(__dirname, "events.json");
const alarmsPath = path.join(__dirname, "alarm.json");
const plcDefsPath = path.join(__dirname, "plc_defs", "TRA_plc.json");

// ============================================================================
// Phase 9.1 – Historian Core (sql.js portable)
// ============================================================================
const initSqlJs = require("sql.js");

const DB_DIR = path.join(__dirname, "db");
const DB_PATH = path.join(DB_DIR, "historian.sqlite");
fs.mkdirSync(DB_DIR, { recursive: true });

let db;
let SQL;

(async () => {
  SQL = await initSqlJs();

  // Load or create DB
  if (fs.existsSync(DB_PATH)) {
    console.log(`📂 Loading historian from ${DB_PATH}`);
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
  } else {
    console.log(`🆕 Creating new historian DB`);
    db = new SQL.Database();
  }

  // Schema check
  db.run(`
    CREATE TABLE IF NOT EXISTS samples_raw (id INTEGER PRIMARY KEY AUTOINCREMENT, point TEXT, ts INTEGER, value REAL, quality INT);
    CREATE TABLE IF NOT EXISTS samples_30s (id INTEGER PRIMARY KEY AUTOINCREMENT, point TEXT, ts INTEGER, avg REAL, min REAL, max REAL, count INT);
    CREATE TABLE IF NOT EXISTS samples_5m  (id INTEGER PRIMARY KEY AUTOINCREMENT, point TEXT, ts INTEGER, avg REAL, min REAL, max REAL, count INT);
  `);

  // Auto-save only after DB loaded
  setInterval(() => {
    if (!db) return;
    const data = db.export();
    fs.writeFileSync(DB_PATH, Buffer.from(data));
    console.log("💾 Historian auto-saved");
  }, 60_000);

  console.log("✅ Historian (sql.js) initialised and ready");
})();


function saveDb() {
  if (!db) return;
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(DB_PATH, buffer);
}

// Insert
function insertSample(point, value, quality = 0) {
  if (!db) return;
  const stmt = db.prepare("INSERT INTO samples_raw(point, ts, value, quality) VALUES (?,?,?,?)");
  stmt.run([point, Date.now(), value, quality]);
  stmt.free();
  saveDb();
}

// Simple deadband + throttle
const HISTORIAN = { last: new Map(), minPeriodMs: 1000, deadbandFrac: 0.001 };
function shouldLog(point, value, now = Date.now()) {
  const v = Number(value);
  const last = HISTORIAN.last.get(point);
  if (!last) { HISTORIAN.last.set(point, { ts: now, value: v }); return true; }
  if (now - last.ts < HISTORIAN.minPeriodMs) return false;
  const dv = Math.abs(v - last.value);
  const fb = Math.max(Math.abs(last.value), 1);
  if (dv >= fb * HISTORIAN.deadbandFrac) { HISTORIAN.last.set(point, { ts: now, value: v }); return true; }
  return false;
}


// -----------------------------------------------------------------------------
// JSON helpers (PLC/SCADA safe read/write)
// -----------------------------------------------------------------------------
function readJsonFileSafe(filePath) {
  try {
    const txt = fs.readFileSync(filePath, "utf8");
    return JSON.parse(txt);
  } catch (e) {
    console.error("readJsonFileSafe error:", filePath, e.message);
    return null;
  }
}

function writeJsonFileSafe(filePath, obj) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(obj, null, 2), "utf8");
    return true;
  } catch (e) {
    console.error("writeJsonFileSafe error:", filePath, e.message);
    return false;
  }
}

// Normalise to { points: [...] }
function ensurePointsArray(jsonLike) {
  let points = [];
  if (!jsonLike) points = [];
  else if (Array.isArray(jsonLike)) points = jsonLike;
  else if (Array.isArray(jsonLike.points)) points = jsonLike.points;

  // 🔄 MIGRATION SUPPORT: Compute tag if missing but signal exists
  // This allows "SUP001.RunFb" to be derived from label="SUP001", signal="RunFb"
  points.forEach(p => {
    if (!p.tag && p.signal && p.label) {
      p.tag = `${p.label}.${p.signal}`;
    }
  });

  return { points };
}
// -----------------------------------------------------------------------------
// First-run seeding: if plc_defs missing, seed it from defs
// -----------------------------------------------------------------------------
(function seedPlcIfMissing() {
  try {
    if (!fs.existsSync(path.join(__dirname, "plc_defs"))) {
      fs.mkdirSync(path.join(__dirname, "plc_defs"));
    }
    if (!fs.existsSync(plcDefsPath)) {
      const scadaJson = readJsonFileSafe(defsPath) || { points: [] };
      // strip mo_i from seed if present
      const scada = ensurePointsArray(scadaJson);
      const plcSeed = {
        points: scada.points.map(p => {
          const { mo_i, ...rest } = p;
          return rest;
        })
      };
      writeJsonFileSafe(plcDefsPath, plcSeed);
      console.log("Seeded plc_defs/TRA_plc.json from defs/TRA.json");
    }
  } catch (e) {
    console.error("Seed PLC defs failed:", e.message);
  }
})();


// -----------------------------------------------------------------------------
// LOAD INITIAL DATA
// -----------------------------------------------------------------------------
let defs = { system: "TRA", points: [] };
if (fs.existsSync(defsPath)) {
  defs = JSON.parse(fs.readFileSync(defsPath, "utf8"));
  // 🔄 MIGRATION FIX: Ensure tags are computed for SCADA points too
  const normalized = ensurePointsArray(defs);
  defs.points = normalized.points;
  console.log("Loaded defs/NBT_TRA.json with", defs.points.length, "points");
}

let events = [];
if (fs.existsSync(eventsPath)) {
  events = JSON.parse(fs.readFileSync(eventsPath, "utf8"));
  console.log("Loaded", events.length, "existing events");
}

// -----------------------------------------------------------------------------
// HELPERS
// -----------------------------------------------------------------------------
function saveDefs() {
  fs.writeFileSync(defsPath, JSON.stringify(defs, null, 2), "utf8");
}
function saveEvents() {
  fs.writeFileSync(eventsPath, JSON.stringify(events, null, 2), "utf8");
}

// Return system-local time in ISO 8601 format with milliseconds and correct offset
function isoLocalWithMs(d) {
  const pad = (n, len = 2) => String(Math.floor(Math.abs(n))).padStart(len, "0");
  const tzOffset = -d.getTimezoneOffset(); // minutes east of UTC
  const sign = tzOffset >= 0 ? "+" : "-";
  const offsetHours = pad(Math.floor(Math.abs(tzOffset) / 60));
  const offsetMinutes = pad(Math.abs(tzOffset) % 60);

  return (
    d.getFullYear() + "-" +
    pad(d.getMonth() + 1) + "-" +
    pad(d.getDate()) + "  " +
    pad(d.getHours()) + ":" +
    pad(d.getMinutes()) + ":" +
    pad(d.getSeconds()) + "." +
    pad(d.getMilliseconds(), 3)
    //+sign + offsetHours + ":" + offsetMinutes
  );
}




function updateAlarmsFromPoint(pt, value) {

  const tag = pt.tag; // 🔑 unique key
  const label = pt.label || (pt.equipType + pt.equipId);
  const desc = pt.desc || tag;
  const sys = pt.sys || defs.system || "-";
  const loc = pt.loc || "-";
  // Ensure point timestamp is local
  pt.ts = isoLocalWithMs(new Date());
  // Derive state & crit from point config
  let state = String(value);
  let crit = 0;
  if (value === 0 && "state0" in pt) { state = pt.state0; crit = pt.crit0 ?? 0; }
  if (value === 1 && "state1" in pt) { state = pt.state1; crit = pt.crit1 ?? 0; }

  // Skip points only if truly no alarm or analogue threshold data
  if (
    (pt.signalType !== "AI") &&
    (pt.crit0 ?? 0) === 0 &&
    (pt.crit1 ?? 0) === 0
  ) {
    return;
  }


  // Load current alarms
  let alarms = [];
  if (fs.existsSync(alarmsPath)) {
    alarms = JSON.parse(fs.readFileSync(alarmsPath, "utf8"));
  }

  // Find existing alarm by both loc + tag
  let found = alarms.find(a => a.tag === tag && a.loc === loc);


  if (crit > 0) {
    if (found) {
      if (found.state === "Cleared") {
        found.ack = false; // new raise resets ack
      }

      // 🔹 If the alarm stays Active but the criticality level changes, reset ack
      if (found.state === "Active" && found.ack === true && found.crit !== crit) {
        console.log(`[ALARM REACTIVATED] [${loc}] ${tag} - criticality changed ${found.crit}→${crit}`);
        found.ack = false;
      }


      found.state = "Active";   // lifecycle
      console.log(`[ALARM RAISED] [${loc}] ${tag} - ${desc}`);
      found.crit = crit;
      found.time = pt.ts;
      found.description = desc;
      found.status = state;      // IO condition string (e.g. "High-High Level")
    } else {
      alarms.push({
        tag,
        time: pt.ts,
        loc,
        sys,
        label,
        description: desc,
        crit,
        state: "Active",         // lifecycle
        status: state,           // IO condition string
        ack: false
      });
    }
  } else {
    if (found) {
      found.state = "Cleared";
      console.log(`[ALARM CLEARED] [${loc}] ${tag} - ${desc}`);
      found.crit = 0;
      found.time = pt.ts;
      found.status = state;

      if (found.ack) {
        // 🔥 SEND FINAL WS FRAME BEFORE DELETE
        wsBroadcastAlarms([{
          ...found,
          state: "Cleared",
          ack: true,
          status: "Normal"
        }]);

        // 🔥 NOW it is safe to delete from alarm.json
        alarms = alarms.filter(a => !(a.tag === tag && a.loc === loc));
      }
    }

  }



  // Save updated list
  fs.writeFileSync(alarmsPath, JSON.stringify(alarms, null, 2));
  // Push updated alarms to WebSocket subscribers
  wsBroadcastAlarms(alarms);

}





let currentUser = "TC";

// -----------------------------------------------------------------------------
// API: HEALTH
// -----------------------------------------------------------------------------
app.get("/api/ping", (req, res) => res.json({ ok: true }));

// -----------------------------------------------------------------------------
// API: DEV TOOLS
// -----------------------------------------------------------------------------
const devApi = require("./dev_api");
app.use("/api/dev", devApi);

// -----------------------------------------------------------------------------
// PLC → SCADA sync (Option A)
//   - SCADA = defs/TRA.json (HMI consumes this)
//   - PLC   = plc_defs/TRA_plc.json (sim writes here)
//   - If SCADA point has mo_i === true, DO NOT copy PLC value into it
// -----------------------------------------------------------------------------
function syncPlcToScada() {
  const plcJson = readJsonFileSafe(plcDefsPath);
  if (!plcJson) return;

  const plc = ensurePointsArray(plcJson);

  // 🔑 Use global `defs` object instead of reading from disk
  // This eliminates race condition with /api/override
  if (!defs || !defs.points) {
    console.warn("syncPlcToScada: global defs not initialized");
    return;
  }

  // 📸 Snapshot state BEFORE sync for WebSocket broadcast comparison
  const prevPointsSnapshot = {};
  for (const p of defs.points) prevPointsSnapshot[`${p.loc}.${p.tag}`] = { ...p };



  // Build quick lookup for SCADA by (loc+tag) key
  const scadaMap = new Map();
  defs.points.forEach(p => {
    const key = `${p.loc}::${p.tag}`;
    scadaMap.set(key, p);
  });

  let dirty = false;
  const nowIso = isoLocalWithMs(new Date());

  plc.points.forEach(plcPt => {
    const key = `${plcPt.loc}::${plcPt.tag}`;
    const sPt = scadaMap.get(key);
    if (!sPt) return; // not defined in SCADA db

    const overridden = sPt.mo_i === true;

    // 1) Sync PLC → SCADA only when NOT overridden
    if (!overridden) {
      const nextVal = plcPt.value;
      const nextTs = plcPt.ts || nowIso;
      const nextQ = plcPt.q || "Good";

      if (firstSyncDone && sPt.value !== nextVal) {
        sPt.value = nextVal;
        sPt.ts = nextTs;
        sPt.q = nextQ;
        dirty = true;

        // Discrete alarms update here
        if (sPt.signalType !== "AI") {
          updateAlarmsFromPoint(sPt, nextVal);
        }

        // Discrete event log (AI + DO skipped here)
        if (sPt.signalType !== "AI" && sPt.signalType !== "DO") {
          const state =
            nextVal === 1 && "state1" in sPt ? sPt.state1 :
              nextVal === 0 && "state0" in sPt ? sPt.state0 :
                String(nextVal);

          const crit =
            nextVal === 1 && "crit1" in sPt ? sPt.crit1 :
              nextVal === 0 && "crit0" in sPt ? sPt.crit0 : 0;

          const ev = {
            ts: sPt.ts,
            loc: sPt.loc || "-",
            sys: sPt.sys || defs.system || "-",
            label: sPt.label || (sPt.equipType + sPt.equipId),
            desc: sPt.desc || sPt.tag,
            state,
            crit,
            type: "Status",
            ack: false
          };
          events.push(ev);
          saveEvents();
          console.log(`[EVENT] [${ev.loc}] ${ev.label} - ${ev.desc} (${state})`);
        }
      }
    }
    // 1b) Always sync static alarm thresholds from PLC → SCADA
    //     (these must update even if the point is in Manual Override)
    const limitKeys = ["warn", "high", "hh", "warn_low", "low", "ll", "direction"];
    for (const key of limitKeys) {
      if (plcPt[key] !== undefined) {
        if (sPt[key] !== plcPt[key]) {
          sPt[key] = plcPt[key];
          dirty = true;
        }
      }
    }

    // 2) AI alarm evaluation — ALWAYS run, even if overridden (uses SCADA value)
    if (sPt.signalType === "AI") {
      // Helper to interpret numeric or "x"
      const numOrNull = v =>
        (v === undefined || v === null || v === "x" || v === "X" || v === "") ? null : Number(v);

      const warn = numOrNull(sPt.warn);
      const high = numOrNull(sPt.high);
      const hh = numOrNull(sPt.hh);
      const warn_low = numOrNull(sPt.warn_low);
      const low = numOrNull(sPt.low);
      const ll = numOrNull(sPt.ll);
      const value = Number(sPt.value);

      let newState = "normal";

      // --- High-side evaluation ---
      if (hh != null && value >= hh) newState = "hh";
      else if (high != null && value >= high) newState = "high";
      else if (warn != null && value >= warn) newState = "warn";

      // --- Low-side evaluation ---
      if (ll != null && value <= ll) newState = "ll";
      else if (low != null && value <= low) newState = "low";
      else if (warn_low != null && value <= warn_low) newState = "warn_low";

      // --- Only act on state change ---
      const prevState = sPt.ai_lastState || "normal";
      if (prevState !== newState) {
        const label = sPt.label || `${sPt.equipType}${sPt.equipId}`;
        const stateLabels = {
          warn: "Warning (High)",
          high: "High",
          hh: "Very High",
          warn_low: "Warning (Low)",
          low: "Low",
          ll: "Very Low",
          normal: "Normal"
        };
        const levelText = stateLabels[newState] || newState;

        const valueText = Number.isFinite(value)
          ? (Math.round(value * 100) / 100).toString()
          : String(value);
        const unitText = (sPt.unit || "").trim();
        const statusText = (newState === "normal")
          ? "Normal"
          : `${levelText}: ${valueText}${unitText ? " " + unitText : ""}`;

        // Severity mapping
        const sevMap = {
          warn_low: 1, warn: 1,
          low: 2, high: 2,
          ll: 3, hh: 3,
          normal: 0
        };
        const sev = sevMap[newState] ?? 0;

        if (sev === 0) {
          console.log(`[AI ALARM CLEARED] [${sPt.loc}] ${label}`);
          updateAlarmsFromPoint({ ...sPt, state0: "Normal" }, 0);
        } else {
          console.log(`[AI ALARM RAISED] [${sPt.loc}] ${label} (${statusText})`);
          updateAlarmsFromPoint({ ...sPt, crit1: sev, state1: statusText }, 1);
        }

        // --- Event logging ---
        const ev = {
          ts: sPt.ts,
          loc: sPt.loc,
          sys: sPt.sys,
          label,
          desc: sPt.desc || sPt.tag,
          state: statusText,
          crit: sev,
          type: "AI",
          ack: false
        };
        events.push(ev);
        saveEvents();
        console.log(`[EVENT] [${ev.loc}] ${ev.label} - ${ev.desc} (${ev.state})`);

        // Persist last known state
        sPt.ai_lastState = newState;
        dirty = true;
      }
    }


  });

  // 3) Persist SCADA if we copied anything from PLC
  if (dirty) {
    saveDefs(); // Use existing saveDefs() helper
  }
  if (!firstSyncDone) firstSyncDone = true;

  // === Phase 9.1: Historian sampling (AI only) ==============================
  try {
    // Use global defs.points for historian sampling
    const nowMs = Date.now();
    for (const p of defs.points) {
      if (p.signalType !== "AI") continue;
      const tagKey = `${p.loc || "-"}:${p.tag}`;    // e.g. "SBT:TankLevel"
      const val = Number(p.value);
      if (!Number.isFinite(val)) continue;

      if (shouldLog(tagKey, val, nowMs)) {
        insertSample(tagKey, val, 0, nowMs);
      }
    }
  } catch (e) {
    console.warn("Historian sampling error:", e.message);
  }

  // === Phase 7: WebSocket diff broadcast after each PLC→SCADA sync ===========
  try {
    // Build index of all SCADA points (system.loc.tag) from global defs
    const nextPoints = {};
    for (const p of defs.points) nextPoints[`${p.loc}.${p.tag}`] = p;

    // Compare with previous snapshot (captured before sync)
    const pointsDiff = diffMaps(prevPointsSnapshot, nextPoints);
    const hasPointChanges =
      Object.keys(pointsDiff.changed).length || pointsDiff.removed.length;

    if (hasPointChanges) {
      cursor += 1;
      sharedCache.points = nextPoints;

      // Determine system scopes from changed tags
      const systemScopes = new Set();
      for (const tag of Object.keys(pointsDiff.changed)) {
        const sys = tag.split('.')[0];
        systemScopes.add(`system:${sys}`);
      }
      for (const tag of pointsDiff.removed) {
        const sys = tag.split('.')[0];
        systemScopes.add(`system:${sys}`);
      }

      console.log(`[WS BROADCAST] cursor=${cursor}, scopes=${[...systemScopes].join(',')}`);
      broadcastTo([...systemScopes], {
        type: 'update',
        cursor,
        diffs: {
          points: pointsDiff,
          alarms: { added: [], updated: [], clearedIds: [] },
          events: { added: [] }
        }
      });
    }
  } catch (err) {
    console.error('Broadcast in syncPlcToScada failed:', err);
  }

}

let firstSyncDone = false;


// -----------------------------------------------------------------------------
// API: DEFS  (merged SCADA + PLC)
// -----------------------------------------------------------------------------
app.get("/api/read", (req, res) => {
  res.set("Cache-Control", "no-store");
  try {
    // Use global defs object for SCADA data
    const plcJson = readJsonFileSafe(plcDefsPath) || { points: [] };
    const plc = ensurePointsArray(plcJson);

    // Merge by (loc + tag)
    const mergedMap = new Map();

    // Start from global SCADA defs
    defs.points.forEach(pt => {
      const key = `${pt.loc || "-"}::${pt.tag}`;
      mergedMap.set(key, { ...pt });
    });

    // Overlay PLC values
    plc.points.forEach(pt => {
      const key = `${pt.loc || "-"}::${pt.tag}`;
      const existing = mergedMap.get(key);
      if (existing) {
        // ⚙️ Preserve manual override (MO)
        const isManual = existing.mo_i === true || existing.mo === true;

        mergedMap.set(key, {
          ...existing,
          // only overwrite value if NOT manual
          value: isManual ? existing.value : pt.value,
          q: pt.q || existing.q,
          ts: pt.ts || existing.ts,
          warn: pt.warn ?? existing.warn,
          high: pt.high ?? existing.high,
          hh: pt.hh ?? existing.hh
        });
      } else {
        mergedMap.set(key, { ...pt });
      }
    });


    const merged = {
      system: defs.system || "TRA",
      points: Array.from(mergedMap.values())
    };

    res.json(merged);
  } catch (err) {
    console.error("Error merging defs + PLC for /api/read:", err.message);
    res.status(500).json({ error: "Failed to merge defs and PLC" });
  }
});


// Read the PLC definition (plc_defs/TRA_plc.json)
app.get("/api/read_plc", (req, res) => {
  res.set("Cache-Control", "no-store");
  try {
    const plcDefsPath = path.join(__dirname, "plc_defs", "TRA_plc.json");
    const plcJson = JSON.parse(fs.readFileSync(plcDefsPath, "utf8"));
    res.json(plcJson);
  } catch (e) {
    console.error("read_plc error:", e.message);
    res.status(500).json({ error: "Failed to read PLC defs" });
  }
});


// -----------------------------------------------------------------------------
// API: EVENTS
// -----------------------------------------------------------------------------
app.get("/api/events", (req, res) => {
  res.set("Cache-Control", "no-store");
  res.json(events);
});

app.post("/api/events/clear", (req, res) => {
  events = [];
  saveEvents();
  res.json({ ok: true, cleared: true });
});

// -----------------------------------------------------------------------------
// API: WRITE (update tag + log event + maybe alarm later)
// -----------------------------------------------------------------------------
app.post("/api/write", (req, res) => {
  const { tag, value } = req.body;
  // Support location-qualified tags like "NBT:Pump1.Trip" or fallback
  let loc = null;
  let baseTag = tag;
  if (tag.includes(":")) {
    [loc, baseTag] = tag.split(":");
  }

  // Try find the point in SCADA defs first; if not found, fall back to PLC defs
  let pt = defs.points.find(p =>
    (loc ? p.loc === loc : true) && p.tag === baseTag
  );

  if (!pt) {
    const plcJson = readJsonFileSafe(plcDefsPath) || { points: [] };
    const plc = ensurePointsArray(plcJson);
    pt = plc.points.find(p =>
      (loc ? p.loc === loc : true) && p.tag === baseTag
    );
  }

  // If still not found, abort
  if (!pt) return res.status(404).json({ error: `Tag not found: ${tag}` });



  const next = (typeof pt.value === "number") ? Number(value) : value;
  const oldVal = pt.value;
  const changed = oldVal !== next;

  if (changed) {
    pt.value = next;
    pt.q = "Good";
    pt.ts = isoLocalWithMs(new Date());
    saveDefs();

    // Decide if we should log an event
    const isDO = (pt.signalType === "DO");
    const shouldLog = true;

    if (shouldLog) {
      let state = String(next);
      let crit = 0;
      if (next === 0 && "state0" in pt) { state = pt.state0; crit = pt.crit0 ?? 0; }
      if (next === 1 && "state1" in pt) { state = pt.state1; crit = pt.crit1 ?? 0; }

      let desc = pt.desc || pt.tag;
      if (isDO) {
        desc = `(${currentUser}) ${desc}`;
      }

      const ev = {
        ts: pt.ts,
        loc: pt.loc || "-",
        sys: pt.sys || defs.system || "-",
        label: pt.label || (pt.equipType + pt.equipId),
        desc,
        state,
        crit,
        type: isDO ? "Cmd" : null,
        ack: false
      };

      events.push(ev);
      saveEvents();
      console.log(`[EVENT] [${ev.loc}] ${ev.label} - ${ev.desc}`);
      // --- Update alarms for points with crit>0 ---
      updateAlarmsFromPoint(pt, next);
    }

    console.log(`[WRITE] [${pt.loc}] ${tag} ${oldVal} -> ${next}`);
  }

  res.json({ ok: true, tag, value: pt.value, changed });
});

// -----------------------------------------------------------------------------
// PLC WRITE API (location-aware + Cmd event logging)
// -----------------------------------------------------------------------------
app.post("/api/plc_write", (req, res) => {
  try {
    const { tag, value } = req.body || {};
    if (typeof tag !== "string" || typeof value === "undefined") {
      return res.status(400).json({ error: "tag and value are required" });
    }

    // 1️⃣ Split "LOC:Tag"  →  e.g.  "SBT:Pump1.StartCmd"
    const [locPart, baseTag] = tag.includes(":") ? tag.split(":") : [null, tag];

    // 2️⃣ Load PLC defs
    const plcJson = readJsonFileSafe(plcDefsPath);
    if (!plcJson || !plcJson.points)
      return res.status(500).json({ error: "PLC defs missing" });

    const plc = ensurePointsArray(plcJson);

    // 3️⃣ Find matching point by both tag + location
    const pt = plc.points.find(
      p => p.tag === baseTag && (!locPart || p.loc === locPart)
    );

    if (!pt) {
      console.warn(`[PLC_WRITE] Point not found for tag ${tag}`);
      return res.status(404).json({ error: `PLC point not found: ${tag}` });
    }

    // 4️⃣ Update PLC value
    const next = Number(value);
    pt.value = next;
    pt.q = "Good";
    pt.ts = isoLocalWithMs(new Date());
    writeJsonFileSafe(plcDefsPath, plc);

    // 5️⃣ Log Cmd event only for DO points when user triggers (value = 1)
    if (pt.signalType === "DO" && Number(value) === 1) {
      const ev = {
        ts: pt.ts,
        loc: pt.loc || "-",
        sys: pt.sys || "TRA",
        label: pt.label || pt.tag,
        desc: `(${currentUser}) ${pt.desc || pt.tag}`,
        state: next === 1 ? pt.state1 || "On" : pt.state0 || "Off",
        crit: 0,
        type: "Cmd",
        ack: false
      };
      events.push(ev);
      saveEvents();
      console.log(`[EVENT CMD] [${ev.loc}] ${ev.label} - ${ev.desc} (${ev.state})`);
    }

    res.json({ ok: true, tag, value: pt.value });
  } catch (err) {
    console.error("/api/plc_write error:", err.message);
    res.status(500).json({ error: "PLC write failed" });
  }
});



// -----------------------------------------------------------------------------
// Touch PLC point timestamp manually (for simulator inflow mapping)
// -----------------------------------------------------------------------------
app.post("/api/plc_touch", (req, res) => {
  const { loc, tag } = req.body || {};
  try {
    const plcJson = readJsonFileSafe(plcDefsPath);
    if (!plcJson) return res.status(500).json({ error: "PLC defs missing" });

    const plc = ensurePointsArray(plcJson);
    const fullKey = `${loc}:${tag}`;
    const pt = plc.points.find(p => `${p.loc}:${p.tag}` === fullKey);
    if (!pt) {
      return res.status(404).json({ error: `Point ${fullKey} not found` });
    }
    pt.ts = isoLocalWithMs(new Date());
    writeJsonFileSafe(plcDefsPath, plc);
    console.log(`[PLC TOUCH] Updated ts for ${fullKey}`);
    res.json({ ok: true, ts: pt.ts });
  } catch (err) {
    console.error("/api/plc_touch error:", err.message);
    res.status(500).json({ error: err.message });
  }
});



// -----------------------------------------------------------------------------
// API: ALARMS
// -----------------------------------------------------------------------------
app.post("/api/alarms/ack", (req, res) => {
  const { tag, loc } = req.body;
  if (!tag) return res.status(400).json({ error: "Tag required" });

  try {
    let alarms = JSON.parse(fs.readFileSync(alarmsPath, "utf8"));

    const idx = alarms.findIndex(a =>
      a.tag === tag && (!loc || a.loc === loc)
    );

    if (idx === -1) {
      return res.json({ ok: false, tag, message: "Alarm not found" });
    }

    const a = alarms[idx];
    // 🔹 Skip duplicate ACKs – already acknowledged
    if (a.ack === true) {
      return res.json({ ok: true, skipped: true, message: "Already acknowledged" });
    }

    // --- always log the ACK action ---
    const ev = {
      ts: isoLocalWithMs(new Date()),
      loc: a.loc,
      sys: a.sys,
      label: a.label,
      desc: `(${currentUser}) ACK: ${a.description}`,
      state: a.status || a.state,
      crit: 0,
      type: "Ack",
      ack: true
    };
    events.push(ev);
    saveEvents();
    console.log(`[ACK] [${a.loc}] ${tag} logged as event`);

    // --- update alarm list ---
    a.ack = true;

    if (a.state === "Cleared") {
      // If alarm is already cleared, remove it from list
      alarms.splice(idx, 1);
    } else {
      // Keep it in list if still active
      alarms[idx] = a;
    }

    fs.writeFileSync(alarmsPath, JSON.stringify(alarms, null, 2));
    try { wsBroadcastAlarms(alarms); } catch (e) { console.warn("WS alarm broadcast after ACK failed:", e.message); }


    return res.json({ ok: true, tag });
  } catch (err) {
    console.error("ACK error:", err);
    return res.status(500).json({ error: "Failed to update alarm.json" });
  }
});




// -----------------------------------------------------------------------------
// API: ALARMS
// -----------------------------------------------------------------------------

// Get alarms (always fresh from disk)
app.get("/api/alarms", (req, res) => {
  try {
    const alarms = JSON.parse(fs.readFileSync(alarmsPath, "utf8"));
    res.set("Cache-Control", "no-store");
    res.json(alarms);
  } catch (err) {
    res.status(500).json({ error: "Failed to read alarm.json" });
  }
});

// -----------------------------------------------------------------------------
// Manual Override API
// body: { loc, tag, mo_i, value }
// - If mo_i === true  → set sPt.mo_i = true and sPt.value = value (0/1), ts = now, q = "ManualOverride"
// - If mo_i === false → set sPt.mo_i = false (next sync will copy PLC again)
// -----------------------------------------------------------------------------
app.post("/api/override", (req, res) => {
  try {
    const { loc, tag, mo_i, value } = req.body || {};
    if (!loc || !tag || typeof mo_i !== "boolean") {
      return res.status(400).json({ error: "loc, tag, mo_i are required" });
    }

    // 1️⃣  Use global defs object (eliminates race with syncPlcToScada)
    const sPt = defs.points.find(p => p.loc === loc && p.tag === tag);
    if (!sPt) return res.status(404).json({ error: "Point not found in SCADA defs" });

    // 3️⃣  Snapshot BEFORE changes
    const before = JSON.parse(JSON.stringify(sPt));

    // 4️⃣  Apply requested override
    sPt.mo_i = mo_i;
    if (mo_i) {
      // manual value
      if (typeof value === "number") sPt.value = value;
      sPt.q = "ManualOverride";
      sPt.ts = isoLocalWithMs(new Date());
      updateAlarmsFromPoint(sPt, sPt.value);
    } else {
      // clear override → pull latest PLC value
      try {
        const plcJson = readJsonFileSafe(plcDefsPath);
        const plc = ensurePointsArray(plcJson);
        const plcPt = plc.points.find(p => p.loc === loc && p.tag === tag);
        if (plcPt) {
          sPt.value = plcPt.value;
          sPt.q = plcPt.q || "Good";
          sPt.ts = plcPt.ts || new Date().toISOString();
        }
      } catch (err) {
        console.warn("PLC read during MO clear failed:", err.message);
      }
      updateAlarmsFromPoint(sPt, sPt.value);
    }

    // 5️⃣  Save defs to disk
    saveDefs();

    // 6️⃣  Determine if a real change happened
    const moChanged = before.mo_i !== sPt.mo_i;
    const valChanged = before.value !== sPt.value;

    if (moChanged || valChanged) {
      const action = sPt.mo_i ? "Manual Override SET" : "Manual Override CLEARED";

      // --- build readable state text ---
      let stateText = "";
      if (sPt.signalType === "AI") {
        const shownValue = sPt.value;
        const rounded = Number.isFinite(shownValue)
          ? Math.round(shownValue * 100) / 100
          : shownValue;
        stateText = `${rounded}${sPt.unit ? " " + sPt.unit : ""}`;
      } else if (sPt.signalType === "DI" || sPt.signalType === "DO") {
        const valNum = Number(sPt.value);
        stateText = valNum === 1 ? (sPt.state1 || "On") : (sPt.state0 || "Off");
      } else {
        stateText = String(sPt.value);
      }

      const ev = {
        ts: isoLocalWithMs(new Date()),
        loc,
        sys: sPt.sys || defs.system || "-",
        label: sPt.label || (sPt.equipType + sPt.equipId),
        tag,
        desc: `(${currentUser}) ${action}: ${sPt.desc || tag}`,
        state: stateText,
        value: sPt.value,
        type: "ManO",
        ack: false
      };

      events.push(ev);
      saveEvents();
      console.log(`[OVERRIDE] [${loc}] ${tag} - ${action} (${stateText})`);

      // 🔥 IMMEDIATE WEBSOCKET BROADCAST FOR INSTANT M BADGE UPDATE
      try {
        // Update sharedCache
        const pointKey = `${loc}.${tag}`;
        if (!sharedCache.points) sharedCache.points = {};
        sharedCache.points[pointKey] = sPt;

        // Broadcast diff immediately
        cursor += 1;
        const systemScope = `system:${loc}`;
        broadcastTo([systemScope], {
          type: 'update',
          cursor,
          scopes: [systemScope],
          diffs: {
            points: {
              changed: { [pointKey]: sPt },
              removed: []
            },
            alarms: { added: [], updated: [], clearedIds: [] },
            events: { added: [] }
          }
        });
        console.log(`[WS OVERRIDE BROADCAST] ${systemScope} - ${tag} mo_i=${sPt.mo_i}`);
      } catch (wsErr) {
        console.warn("WebSocket broadcast after override failed:", wsErr.message);
      }
    } else {
      console.log(`[OVERRIDE] [${loc}] ${tag} - skipped duplicate`);
    }

    res.json({ ok: true, point: { loc: sPt.loc, tag: sPt.tag, mo_i: sPt.mo_i, value: sPt.value } });
  } catch (err) {
    console.error("/api/override error:", err.message);
    res.status(500).json({ error: "Override failed" });
  }
});

// -----------------------------------------------------------------------------
// START SERVER
// -----------------------------------------------------------------------------

// Start PLC → SCADA sync every 1s
setInterval(syncPlcToScada, 1000);
// Do an immediate sync on boot


// -----------------------------------------------------------------------------
// API: Update AI thresholds (warn / high / hh / warn_low / low / ll)
// body: { loc, tag, warn, high, hh, warn_low, low, ll }
// Writes directly to plc_defs/TRA_plc.json so the simulator uses new limits
// -----------------------------------------------------------------------------
app.post("/api/ai_settings", (req, res) => {
  try {
    const { loc, tag, warn, high, hh, warn_low, low, ll } = req.body;
    if (!loc || !tag) return res.status(400).json({ error: "loc and tag required" });

    const plcJson = readJsonFileSafe(plcDefsPath) || { points: [] };
    const plc = ensurePointsArray(plcJson);
    const pPt = plc.points.find(p => p.loc === loc && p.tag === tag);
    if (!pPt) return res.status(404).json({ error: "AI point not found in PLC defs" });
    if (pPt.signalType !== "AI") return res.status(400).json({ error: "Not an AI point" });

    // Interpret "x" (string) or empty as disabled → keep as "x"
    const normalize = v => (v === "x" || v === "X" || v === "" || v === null || isNaN(v)) ? "x" : Number(v);

    pPt.warn = normalize(warn);
    pPt.high = normalize(high);
    pPt.hh = normalize(hh);
    pPt.warn_low = normalize(warn_low);
    pPt.low = normalize(low);
    pPt.ll = normalize(ll);

    pPt.ts = isoLocalWithMs(new Date());
    writeJsonFileSafe(plcDefsPath, plc);

    console.log(`[AI SETTINGS UPDATED] [${loc}] ${tag}: W=${pPt.warn} H=${pPt.high} HH=${pPt.hh} WL=${pPt.warn_low} L=${pPt.low} LL=${pPt.ll}`);

    // --- Log simple event for successful AI setting update ---
    const ev = {
      ts: isoLocalWithMs(new Date()),
      loc,
      sys: pPt.sys || "TRA",
      label: pPt.label || tag,
      desc: `(${currentUser}) ${pPt.desc || tag} AI setting update`,
      state: "Successful",
      crit: 0,
      type: "Setting",
      ack: false
    };
    events.push(ev);
    saveEvents();
    console.log(`[EVENT] [${loc}] ${ev.label} - ${ev.state}`);

    res.json({ ok: true, tag, loc, ...pPt });

  } catch (err) {
    console.error("/api/ai_settings error:", err.message);
    res.status(500).json({ error: "Failed to update PLC AI thresholds" });
  }
});

// ============================================================================
// Phase 9.1 – Rollup and Retention (sql.js version)
// ============================================================================

// Every minute: roll RAW → 30s
setInterval(() => {
  if (!db) return;
  const now = Date.now();

  const rollupCutoff = now - 30_000;         // roll-up anything older than 30 s
  const purgeCutoff = now - 24 * 3600_000;  // keep 24 h of raw data

  try {
    const rows = [];
    const stmt = db.prepare(`
      SELECT point,
             CAST(ts/30000 AS INT)*30000 AS bucket,
             AVG(value) AS avg, MIN(value) AS min, MAX(value) AS max,
             COUNT(value) AS cnt
      FROM samples_raw
      WHERE ts < $rollcut
      GROUP BY point, bucket;
    `);
    stmt.bind({ $rollcut: rollupCutoff });

    while (stmt.step()) {
      const r = stmt.getAsObject();
      rows.push(r);
    }
    stmt.free();

    const insert = db.prepare(
      "INSERT INTO samples_30s(point, ts, avg, min, max, count) VALUES (?,?,?,?,?,?)"
    );
    for (const r of rows) {
      insert.run([r.point, r.bucket, r.avg, r.min, r.max, r.cnt]);
    }
    insert.free();

    // Delete only data older than 24 h
    const del = db.prepare("DELETE FROM samples_raw WHERE ts < ?");
    del.run([purgeCutoff]);

    del.free();

    if (rows.length) console.log(`🕒 Rollup RAW→30s: ${rows.length} buckets`);
    saveDb();
  } catch (e) {
    console.error("Rollup RAW→30s error:", e.message);
  }
}, 60_000);

// Every 5 minutes: roll 30s → 5m
setInterval(() => {
  if (!db) return;
  const now = Date.now();

  const rollupCutoff = now - 5 * 60_000;         // roll up 30s data older than 5 min
  const purgeCutoff = now - 7 * 24 * 3600_000;  // keep 7 days of 30 s data

  try {
    const rows = [];
    const stmt = db.prepare(`
      SELECT point,
             CAST(ts/300000 AS INT)*300000 AS bucket,
             AVG(avg) AS avg, MIN(min) AS min, MAX(max) AS max,
             SUM(count) AS cnt
      FROM samples_30s
      WHERE ts < $rollcut
      GROUP BY point, bucket;
    `);
    stmt.bind({ $rollcut: rollupCutoff });

    while (stmt.step()) {
      const r = stmt.getAsObject();
      rows.push(r);
    }
    stmt.free();

    // prevent duplicates by replacing existing rows
    const insert = db.prepare(`
      INSERT OR REPLACE INTO samples_5m (point, ts, avg, min, max, count)
      VALUES (?,?,?,?,?,?)
    `);
    for (const r of rows) {
      insert.run([r.point, r.bucket, r.avg, r.min, r.max, r.cnt]);
    }
    insert.free();

    // purge 30 s rows older than 7 days
    const del = db.prepare("DELETE FROM samples_30s WHERE ts < ?");
    del.run([purgeCutoff]);
    del.free();

    if (rows.length) console.log(`🕔 Rollup 30s→5m: ${rows.length} buckets`);
    saveDb();
  } catch (e) {
    console.error("Rollup 30s→5m error:", e.message);
  }
}, 5 * 60_000);


// Hourly: retention purge
setInterval(() => {
  if (!db) return;
  try {
    const now = Date.now();
    const rawKeep = now - 24 * 3600_000;
    const s30Keep = now - 7 * 24 * 3600_000;
    const s5mKeep = now - 365 * 24 * 3600_000;
    for (const [table, cutoff] of [
      ["samples_raw", rawKeep],
      ["samples_30s", s30Keep],
      ["samples_5m", s5mKeep],
    ]) {
      const stmt = db.prepare(`DELETE FROM ${table} WHERE ts < ?`);
      stmt.run([cutoff]);
      stmt.free();
    }
    saveDb();
  } catch (err) {
    console.error("Retention purge error:", err.message);
  }
}, 3600_000);



// -----------------------------------------------------------------------------
// START SERVER (Phase 7 upgrade — attach HTTP + WebSocket)
// -----------------------------------------------------------------------------
const http = require("http");
const { WebSocketServer } = require("ws");

const server = http.createServer(app).listen(port, () => {
  console.log(`✅ SCADA server running at http://localhost:${port}`);

  // Create lock file to prevent I/O config changes while server is running
  const lockFilePath = path.join(__dirname, 'server.lock');
  fs.writeFileSync(lockFilePath, `${process.pid}\n${new Date().toISOString()}`);
  console.log(`🔒 Lock file created: server.lock`);
});

// === Phase 7 WebSocket endpoint (/ws) =======================================
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? new Set(process.env.ALLOWED_ORIGINS.split(",").map(s => s.trim()))
  : null;



const wss = new WebSocketServer({ server, path: "/ws" });

// Shared in-memory model + cursor
let cursor = 0;
const sharedCache = {
  points: {},   // { "<SYS>.<TAG>": {val, ts, ...} }
  alarms: {},   // { id: alarmObj }
  events: {}    // { id: eventObj }
};




// === Phase 9.5: Alarm broadcast helper =====================================
function wsBroadcastAlarms(alarms) {
  try {
    // Ensure cache object exists
    if (!sharedCache.alarms) {
      sharedCache.alarms = {};
    }

    // --- 1) Previous keys (before this push) ---
    const prevKeys = Object.keys(sharedCache.alarms);

    // --- 2) Build new map from the current alarms list ---
    const nextMap = {};
    const added = [];

    for (const a of alarms) {
      const key = `${a.loc || "-"}::${a.tag}`;
      nextMap[key] = a;
      added.push(a);
    }

    // --- 3) Compute which alarms disappeared -> clearedIds (by tag only) ---
    const clearedIds = [];
    for (const k of prevKeys) {
      if (!nextMap[k]) {
        // Extract the tag portion after the last "::"
        const tag = k.includes("::") ? k.split("::").slice(1).join("::") : k;
        clearedIds.push(tag);
      }
    }

    // --- 4) Update the shared cache to the new map ---
    sharedCache.alarms = nextMap;

    // --- 5) Build and send the WS diff frame ---
    cursor += 1;

    const msg = {
      type: "update",
      cursor,
      scopes: ["alarms"],
      diffs: {
        points: {
          changed: sharedCache.points || {},
          removed: []
        },
        alarms: {
          added,
          updated: [],
          clearedIds
        },
        events: { added: [] }
      }
    };

    broadcastTo(["alarms"], msg);
    console.log("[WS] Broadcast alarms:", {
      added: added.length,
      clearedIds
    });
  } catch (err) {
    console.warn("WS alarm broadcast failed:", err);
  }
}


// Seed alarms cache on boot so subscribers get a proper snapshot
try {
  if (fs.existsSync(alarmsPath)) {
    const bootAlarms = JSON.parse(fs.readFileSync(alarmsPath, "utf8"));
    sharedCache.alarms = {};
    for (const a of bootAlarms) {
      sharedCache.alarms[`${a.loc || '-'}::${a.tag}`] = a;
    }
    console.log(`🔔 Seeded WS alarm cache with ${bootAlarms.length} alarms`);
  }
} catch (e) {
  console.warn("Alarm cache seed failed:", e.message);
}


// scope → Set<WebSocket>
const scopeSubscribers = new Map();
function ensureScope(scope) {
  if (!scopeSubscribers.has(scope)) scopeSubscribers.set(scope, new Set());
  return scopeSubscribers.get(scope);
}
function validateOrigin(req) {
  if (!ALLOWED_ORIGINS) return true;
  const origin = req.headers.origin;
  return origin && ALLOWED_ORIGINS.has(origin);
}
function safeSend(ws, obj) {
  if (ws.readyState === ws.OPEN) {
    try { ws.send(JSON.stringify(obj)); } catch { }
  }
}
function diffMaps(prev, next) {
  const changed = {}, removed = [];
  for (const k in next)
    if (!prev[k] || JSON.stringify(prev[k]) !== JSON.stringify(next[k])) changed[k] = next[k];
  for (const k in prev)
    if (!next[k]) removed.push(k);
  return { changed, removed };
}
function broadcastTo(scopes, payload) {
  // 🚨 CRITICAL FIX: Include scopes in the message so clients can route to subscribers
  const messageWithScopes = { ...payload, scopes };

  const sent = new Set();
  for (const scope of scopes) {
    const subs = scopeSubscribers.get(scope);
    if (!subs) continue;
    for (const ws of subs) {
      if (!sent.has(ws)) { safeSend(ws, messageWithScopes); sent.add(ws); }
    }
  }
}
function buildSnapshotFor(scopes) {
  const out = { points: {}, alarms: [], events: [] };
  for (const scope of scopes) {
    if (scope.startsWith("system:")) {
      const sys = scope.slice("system:".length);
      for (const [tag, obj] of Object.entries(sharedCache.points))
        if (tag.startsWith(sys + ".")) out.points[tag] = obj;
    } else if (scope === "alarms") out.alarms = Object.values(sharedCache.alarms);
    else if (scope === "events") out.events = Object.values(sharedCache.events);
  }
  return out;
}

// Heartbeats
const HEARTBEAT_MS = 25000;


// --- Early sync: populate sharedCache before any WS clients subscribe ---
try {
  console.log("⏳ Performing early PLC→SCADA sync before WebSocket accepts clients...");
  syncPlcToScada();
  console.log("✅ Early PLC→SCADA sync completed");
} catch (err) {
  console.warn("⚠️ Early sync failed:", err.message);
}


function noop() { }
function heartbeat() { this.isAlive = true; }

wss.on("connection", (ws, req) => {
  if (!validateOrigin(req)) { ws.close(1008, "Origin not allowed"); return; }
  ws.isAlive = true;
  ws.on("pong", heartbeat);
  ws._scopes = new Set();

  safeSend(ws, { type: "welcome", serverTime: Date.now(), heartbeatMs: HEARTBEAT_MS });

  ws.on("message", data => {
    let msg;

    try { msg = JSON.parse(data); } catch {
      safeSend(ws, { type: "error", code: "BAD_JSON", message: "Invalid JSON" });
      return;
    }

    switch (msg.type) {
      case "hello": return;
      case "ping": safeSend(ws, { type: "pong", ts: msg.ts || Date.now() }); return;
      case "subscribe": {
        if (!Array.isArray(msg.scopes) || !msg.scopes.length) {
          safeSend(ws, { type: "error", code: "BAD_SUBSCRIBE", message: "scopes required" }); return;
        }
        for (const s of msg.scopes) { ensureScope(s).add(ws); ws._scopes.add(s); }
        const snapshot = buildSnapshotFor(msg.scopes);
        safeSend(ws, { type: "snapshot", cursor, scopes: msg.scopes, ...snapshot });
        return;
      }
      case "unsubscribe": {
        if (!Array.isArray(msg.scopes)) return;
        for (const s of msg.scopes) {
          const set = scopeSubscribers.get(s);
          if (set) set.delete(ws);
          ws._scopes.delete(s);
        }
        return;
      }

      case "update": {
        // UPDATE messages come from SCADA backend, not the client.
        // Forward them to the subscriber scopes.
        if (msg.diffs) {
          // Broadcast to subscribers of "alarms", "events", or any system:<loc>
          const scopes = msg.scopes || [];
          if (scopes.length === 0) {
            // alarms/event broadcasts do not list scopes in the payload
            // so we determine by the content of msg.diffs
            if (msg.diffs.alarms && msg.diffs.alarms.added.length)
              broadcastTo(["alarms"], msg);
            if (msg.diffs.events && msg.diffs.events.added.length)
              broadcastTo(["events"], msg);
          } else {
            broadcastTo(scopes, msg);
          }
        }
        return;
      }

      default:
        safeSend(ws, { type: "error", code: "BAD_TYPE", message: `Unknown type: ${msg.type}` });
    }
  });

  ws.on("close", () => {
    for (const s of ws._scopes) {
      const set = scopeSubscribers.get(s);
      if (set) set.delete(ws);
    }
    ws._scopes.clear();
  });
});

// Kill dead sockets
const interval = setInterval(() => {
  wss.clients.forEach(ws => {
    if (ws.isAlive === false) return ws.terminate();
    ws.isAlive = false;
    ws.ping(noop);
  });
}, HEARTBEAT_MS + 5000);

wss.on("close", () => clearInterval(interval));

// === Phase 8.1: Core Metrics Endpoints =====================================
const os = require("os");
const startTime = Date.now();
let wsBroadcastCount = 0;
let wsClients = () => (wss ? wss.clients.size : 0);

// Hook into broadcastTo to count WS sends
if (typeof broadcastTo === "function") {
  const origBroadcast = broadcastTo;
  broadcastTo = function (scopes, payload) {
    wsBroadcastCount++;
    return origBroadcast(scopes, payload);
  };
}

// ── /api/metrics ───────────────────────────────────────────────────────────
app.get("/api/metrics", (req, res) => {
  const mem = process.memoryUsage();
  const cpuLoad = os.loadavg()[0]; // 1-min load average
  const uptime = (Date.now() - startTime) / 1000;

  res.json({
    timestamp: Date.now(),
    uptime,
    cpuLoad,
    memoryMB: (mem.rss / 1024 / 1024).toFixed(1),
    wsClients: wsClients(),
    wsBroadcasts: wsBroadcastCount,
    pid: process.pid
  });
});

// === Phase 8.3: Metrics Logging / Persistence Layer =========================
const METRIC_LOG_LIMIT = 900; // ~30 min @ 2 s
let metricsLog = [];

// Helper to append snapshots safely
function logMetricsSnapshot(snapshot) {
  try {
    const copy = JSON.parse(JSON.stringify(snapshot));
    metricsLog.push(copy);
    if (metricsLog.length > METRIC_LOG_LIMIT) metricsLog.shift();
  } catch (e) { console.warn('⚠️ Metrics snapshot error', e); }
}

// Hook into existing /api/metrics output
try {
  const route = app._router.stack.find(r => r.route && r.route.path === '/api/metrics');
  if (route) {
    const original = route.route.stack[0].handle;
    route.route.stack[0].handle = function (req, res, next) {
      const oldJson = res.json.bind(res);
      res.json = (data) => {
        data.loggedAt = Date.now();
        logMetricsSnapshot(data);
        return oldJson(data);
      };
      return original(req, res, next);
    };
    console.log('✅ Phase 8.3: Metrics logging hooked');
    // Delay the first sync until WS/sharedCache are initialised
    setTimeout(() => {
      try {
        syncPlcToScada();
        console.log("✅ Initial PLC→SCADA sync completed after WS init");
      } catch (err) {
        console.warn("Initial sync failed:", err.message);
      }
    }, 500);

  }
} catch (err) { console.warn('⚠️ Could not attach metrics hook', err); }

// ── /api/metrics/log ─────────────────────────────────────────────────────────
app.get('/api/metrics/log', (req, res) => {
  const range = req.query.range || 'all';
  let cutoff = 0;
  if (range.endsWith('m')) {
    const mins = parseInt(range, 10);
    cutoff = Date.now() - mins * 60 * 1000;
  }
  const result = cutoff ? metricsLog.filter(e => e.loggedAt >= cutoff) : metricsLog;
  res.json({ count: result.length, entries: result });
});

// ── /api/metrics/export ──────────────────────────────────────────────────────
app.get('/api/metrics/export', (req, res) => {
  const fmt = (req.query.format || 'csv').toLowerCase();
  if (fmt !== 'csv') return res.status(400).send('Only CSV supported');
  const header = ['timestamp', 'cpuLoad', 'memoryMB', 'wsClients', 'wsBroadcasts'];
  const rows = metricsLog.map(e => [
    new Date(e.loggedAt).toISOString(),
    e.cpuLoad,
    e.memoryMB,
    e.wsClients,
    e.wsBroadcasts
  ].join(','));
  const csv = [header.join(','), ...rows].join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="metrics_log.csv"');
  res.send(csv);
});


// ── /api/health ────────────────────────────────────────────────────────────
app.get("/api/health", (req, res) => {
  res.json({
    status: "OK",
    uptimeSec: ((Date.now() - startTime) / 1000).toFixed(0),
    clients: wsClients(),
    time: new Date().toISOString()
  });
});

// ── /api/buildinfo ─────────────────────────────────────────────────────────
app.get("/api/buildinfo", (req, res) => {
  res.json({
    project: "SCADA Web-Based Simulator",
    version: "8.0.0-dev",
    phase: "8.1 Core Metrics",
    node: process.version,
    platform: os.platform(),
    buildTime: new Date().toISOString()
  });
});

// ============================================================================
// Phase 9.1 – Trend & History APIs
// ============================================================================

// GET /api/trend?point=NBT:FLO001.Value&from=...&to=...&agg=raw|min|max|avg&step=30s|5m
app.get("/api/trend", (req, res) => {
  if (!db) return res.status(503).json({ error: "Historian not initialised yet" });

  try {
    const { point, from, to, agg = "raw", step } = req.query;
    if (!point) return res.status(400).json({ error: "Missing point" });

    const fromTs = parseInt(from) || Date.now() - 3600 * 1000;
    const toTs = parseInt(to) || Date.now();

    let table = "samples_raw";
    if (agg === "avg" && step === "30s") table = "samples_30s";
    if (agg === "avg" && step === "5m") table = "samples_5m";

    let sql;
    if (table === "samples_raw") {
      // ✅ Raw values: direct select, protect with try/catch
      sql = `
        SELECT ts, value
        FROM samples_raw
        WHERE point = $point AND ts BETWEEN $from AND $to
        ORDER BY ts ASC
        LIMIT 10000;
      `;
    } else {
      // ✅ Aggregated: group by point+ts to prevent duplicates
      sql = `
        SELECT ts, AVG(avg) AS value
        FROM ${table}
        WHERE point = $point AND ts BETWEEN $from AND $to
        GROUP BY point, ts
        ORDER BY ts ASC
        LIMIT 10000;
      `;
    }

    const stmt = db.prepare(sql);
    stmt.bind({ $point: point, $from: fromTs, $to: toTs });

    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free?.();

    res.json({
      point,
      from: fromTs,
      to: toTs,
      agg,
      step,
      count: rows.length,
      entries: rows,
    });
  } catch (err) {
    console.error("Trend query error", err);
    res.status(500).json({ error: "Trend query failed" });
  }
});



// GET /api/history?source=diagnostics
app.get("/api/history", (req, res) => {
  if (!db) return res.status(503).json({ error: "Historian not initialised yet" });

  try {
    const tables = ["samples_raw", "samples_30s", "samples_5m"];
    const pointsSet = new Set();

    for (const tbl of tables) {
      const stmt = db.prepare(`SELECT DISTINCT point FROM ${tbl}`);
      while (stmt.step()) {
        const row = stmt.getAsObject();
        if (row.point) pointsSet.add(row.point);
      }
      stmt.free();
    }

    res.json({
      source: req.query.source || "scada",
      points: Array.from(pointsSet),
      retention: { raw: "24h", short: "7d (30s)", long: "365d (5m)" },
      now: Date.now()
    });
  } catch (err) {
    console.error("/api/history error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// =============================================================================
// Lock file cleanup on shutdown
// =============================================================================
const lockFilePath = path.join(__dirname, 'server.lock');

function cleanupLockFile() {
  if (fs.existsSync(lockFilePath)) {
    fs.unlinkSync(lockFilePath);
    console.log('🔓 Lock file removed');
  }
}

process.on('SIGINT', () => {
  cleanupLockFile();
  process.exit(0);
});

process.on('SIGTERM', () => {
  cleanupLockFile();
  process.exit(0);
});

process.on('exit', () => {
  cleanupLockFile();
});

