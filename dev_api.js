const express = require("express");
const fs = require("fs");
const path = require("path");

const router = express.Router();
const plcDefsDir = path.join(__dirname, "plc_defs");
const lockFile = path.join(__dirname, "server.lock");

// Helper to read JSON safely
function readJsonFileSafe(filePath) {
    try {
        if (!fs.existsSync(filePath)) return null;
        const txt = fs.readFileSync(filePath, "utf8");
        return JSON.parse(txt);
    } catch (e) {
        console.error(`[DEV] Error reading ${filePath}: ${e.message}`);
        return null;
    }
}

// GET /api/dev/systems - List all system I/O files
router.get("/systems", (req, res) => {
    try {
        if (!fs.existsSync(plcDefsDir)) {
            return res.json([]);
        }
        const files = fs.readdirSync(plcDefsDir)
            .filter(f => f.endsWith("_plc.json"))
            .map(f => {
                const name = f.replace("_plc.json", "");
                return { name, filename: f };
            });
        res.json(files);
    } catch (e) {
        console.error("Error listing systems:", e);
        res.status(500).json({ error: "Failed to list systems" });
    }
});

// GET /api/dev/systems/:name - Read specific system I/O
router.get("/systems/:name", (req, res) => {
    const sysName = req.params.name;
    const safeName = sysName.replace(/[^a-zA-Z0-9_-]/g, "");
    const filename = `${safeName}_plc.json`;
    const filePath = path.join(plcDefsDir, filename);

    const data = readJsonFileSafe(filePath);
    if (!data) {
        return res.status(404).json({ error: `System '${sysName}' not found` });
    }
    res.json(data);
});

// POST /api/dev/systems/:name - Save specific system I/O (only when server stopped)
router.post("/systems/:name", (req, res) => {
    // ⚠️ CRITICAL: Check if server is running
    if (fs.existsSync(lockFile)) {
        return res.status(423).json({
            error: 'Server is running. Stop the server before making I/O configuration changes.',
            locked: true,
            lockFile: lockFile
        });
    }

    const sysName = req.params.name;
    const safeName = sysName.replace(/[^a-zA-Z0-9_-]/g, "");
    const plcFilename = `${safeName}_plc.json`;
    const defsFilename = `${safeName}.json`;
    const plcFilePath = path.join(plcDefsDir, plcFilename);
    const defsFilePath = path.join(__dirname, 'defs', defsFilename);

    const data = req.body;

    // Validate data structure
    if (!data || !Array.isArray(data.points)) {
        return res.status(400).json({ error: "Invalid data format. Expected { points: [...] }" });
    }

    // Read existing defs file to preserve mo_i values
    let existingDefs = readJsonFileSafe(defsFilePath);
    const existingMoiMap = {};
    if (existingDefs && existingDefs.points) {
        existingDefs.points.forEach(pt => {
            if (pt.tag) {
                existingMoiMap[pt.tag] = pt.mo_i !== undefined ? pt.mo_i : false;
            }
        });
    }

    // Prepare points for defs (with mo_i preserved/added)
    const defsPoints = data.points.map(pt => {
        const pointWithMoi = { ...pt };
        // Preserve existing mo_i or use the one from incoming data, default to false
        const existingMoi = existingMoiMap[pt.tag];
        pointWithMoi.mo_i = existingMoi !== undefined ? existingMoi : (pt.mo_i !== undefined ? pt.mo_i : false);
        return pointWithMoi;
    });

    // Prepare points for plc_defs (without mo_i)
    const plcPoints = data.points.map(pt => {
        const pointWithoutMoi = { ...pt };
        delete pointWithoutMoi.mo_i;
        return pointWithoutMoi;
    });

    // Write to plc_defs folder (without mo_i)
    try {
        const plcData = { points: plcPoints };
        fs.writeFileSync(plcFilePath, JSON.stringify(plcData, null, 2), "utf8");
        console.log(`[DEV API] Saved ${plcPoints.length} points to ${plcFilename} (without mo_i)`);
    } catch (e) {
        console.error("Error saving to plc_defs:", e);
        return res.status(500).json({ error: "Failed to save to plc_defs" });
    }

    // Write to defs folder (with mo_i preserved)
    try {
        const defsData = {
            version: "1.1",
            system: safeName,
            points: defsPoints
        };
        fs.writeFileSync(defsFilePath, JSON.stringify(defsData, null, 2), "utf8");
        console.log(`[DEV API] Saved ${defsPoints.length} points to defs/${defsFilename} (with mo_i preserved)`);
    } catch (e) {
        console.error("Error saving to defs:", e);
        return res.status(500).json({ error: "Failed to save to defs" });
    }

    res.json({ ok: true, saved: data.points.length });
});


// GET /api/dev/symbols - List available symbols
router.get("/symbols", (req, res) => {
    try {
        const symbolsDir = path.join(__dirname, "symbols");
        if (!fs.existsSync(symbolsDir)) {
            return res.json([]);
        }
        const files = fs.readdirSync(symbolsDir)
            .filter(f => f.endsWith(".js") && !f.endsWith("baseSymbol.js"))
            .map(f => f.replace(".js", ""));
        res.json(files);
    } catch (e) {
        console.error("Error listing symbols:", e);
        res.status(500).json({ error: "Failed to list symbols" });
    }
});

// POST /api/dev/mimic - Save generated mimic page
router.post("/mimic", (req, res) => {
    // ⚠️ CRITICAL: Check if server is running (optional, but good practice if we want to enforce offline edits for safety)
    // For mimic pages, it might be safe to edit while running, but let's stick to the pattern if requested.
    // However, the user requirement didn't explicitly say mimic creation needs to be offline, only I/O config.
    // We will allow online creation for now as it's just an HTML file.

    const { filename, content, overwrite } = req.body;

    if (!filename || !content) {
        return res.status(400).json({ error: "Filename and content are required" });
    }

    if (!filename.endsWith(".html")) {
        return res.status(400).json({ error: "Filename must end with .html" });
    }

    const systemsDir = path.join(__dirname, "systems");
    const filePath = path.join(systemsDir, filename);

    if (fs.existsSync(filePath) && !overwrite) {
        return res.status(409).json({ error: "File already exists", exists: true });
    }

    try {
        if (!fs.existsSync(systemsDir)) {
            fs.mkdirSync(systemsDir, { recursive: true });
        }
        fs.writeFileSync(filePath, content, "utf8");
        console.log(`[DEV API] Saved mimic page: ${filename}`);
        res.json({ ok: true, saved: filename });
    } catch (e) {
        console.error("Error saving mimic page:", e);
        res.status(500).json({ error: "Failed to save mimic page" });
    }
});



// GET /api/dev/mimic_files - List all available mimic files
router.get("/mimic_files", (req, res) => {
    try {
        const systemsDir = path.join(__dirname, "systems");
        if (!fs.existsSync(systemsDir)) {
            return res.json([]);
        }
        const files = fs.readdirSync(systemsDir)
            .filter(f => f.endsWith(".html"));
        res.json(files);
    } catch (e) {
        console.error("Error listing mimic files:", e);
        res.status(500).json({ error: "Failed to list mimic files" });
    }
});

// GET /api/dev/mimic/:filename - Read existing mimic page
router.get("/mimic/:filename", (req, res) => {
    const filename = req.params.filename;
    // Basic security check
    if (filename.includes("..") || filename.includes("/") || filename.includes("\\")) {
        return res.status(400).json({ error: "Invalid filename" });
    }

    const systemsDir = path.join(__dirname, "systems");
    const filePath = path.join(systemsDir, filename);

    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: "File not found" });
    }

    try {
        const content = fs.readFileSync(filePath, "utf8");
        res.json({ content });
    } catch (e) {
        console.error("Error reading mimic page:", e);
        res.status(500).json({ error: "Failed to read mimic page" });
    }
});

// GET /api/dev/symbol_content/:name - Read symbol HTML content
router.get("/symbol_content/:name", (req, res) => {
    const symbolName = req.params.name;
    const safeName = symbolName.replace(/[^a-zA-Z0-9_-]/g, "");

    // Try .html first, then maybe check inside .js if needed (but usually symbols have .html)
    // Based on file list: pump.html, pit.html, etc. exist.
    const symbolsDir = path.join(__dirname, "symbols");
    const htmlPath = path.join(symbolsDir, `${safeName}.html`);

    if (fs.existsSync(htmlPath)) {
        try {
            const content = fs.readFileSync(htmlPath, "utf8");
            res.json({ content });
        } catch (e) {
            console.error("Error reading symbol content:", e);
            res.status(500).json({ error: "Failed to read symbol content" });
        }
    } else {
        // Fallback: If no HTML file, maybe it's purely JS generated?
        // Or maybe check for SVG file if we had them.
        // For now return 404 or empty.
        res.status(404).json({ error: "Symbol content not found" });
    }
});

// GET /api/dev/titles - Read mimic titles
router.get("/titles", (req, res) => {
    const titlesPath = path.join(__dirname, "mimic_titles.json");
    const data = readJsonFileSafe(titlesPath);
    if (!data) {
        return res.json({}); // Return empty object if file doesn't exist
    }
    res.json(data);
});

// POST /api/dev/titles - Update mimic titles
router.post("/titles", (req, res) => {
    const titlesPath = path.join(__dirname, "mimic_titles.json");
    const newTitles = req.body;

    if (!newTitles || typeof newTitles !== 'object') {
        return res.status(400).json({ error: "Invalid data format" });
    }

    try {
        // Read existing to merge (optional, but safer) or just overwrite?
        // Let's read existing and merge to avoid losing other keys if partial update sent (though editor likely sends full or single key update)
        // Actually, let's assume the client sends a patch or we handle merging here.
        // For simplicity, let's support merging a single key-value pair or a full object.

        let currentTitles = readJsonFileSafe(titlesPath) || {};

        // If body has "key" and "value", update single entry
        if (newTitles.key && newTitles.value) {
            currentTitles[newTitles.key] = newTitles.value;
        } else {
            // Assume full object merge
            currentTitles = { ...currentTitles, ...newTitles };
        }

        fs.writeFileSync(titlesPath, JSON.stringify(currentTitles, null, 2), "utf8");
        console.log(`[DEV API] Updated mimic titles`);
        res.json({ ok: true });
    } catch (e) {
        console.error("Error saving mimic titles:", e);
        res.status(500).json({ error: "Failed to save mimic titles" });
    }
});

// GET /api/dev/navigation - Read navigation config
router.get("/navigation", (req, res) => {
    const navPath = path.join(__dirname, "navigation.json");
    const data = readJsonFileSafe(navPath);
    if (!data) {
        return res.json({ locations: [] });
    }
    res.json(data);
});

// POST /api/dev/navigation - Update navigation config
router.post("/navigation", (req, res) => {
    const navPath = path.join(__dirname, "navigation.json");
    const newNav = req.body;

    if (!newNav || typeof newNav !== 'object') {
        return res.status(400).json({ error: "Invalid data format" });
    }

    try {
        fs.writeFileSync(navPath, JSON.stringify(newNav, null, 2), "utf8");
        console.log(`[DEV API] Updated navigation config`);
        res.json({ ok: true });
    } catch (e) {
        console.error("Error saving navigation config:", e);
        res.status(500).json({ error: "Failed to save navigation config" });
    }
});

module.exports = router;
