# Mimic Editor Technical Guide

## Overview
The Mimic Editor (`mimic_builder.js`) allows users to visually design SCADA mimic pages. It supports dragging and dropping symbols (Pumps, Pits, Selectors) and static elements (Text, Lines, Arrows) onto a canvas, configuring their properties, and saving the result as an HTML file that can be loaded by the main SCADA runtime.

## Key Features & Architecture

### 1. Selectors (Mode vs. Remote)
Selectors are unique because they map to different points on the same equipment but share a common visual style.
-   **Tools:** The editor provides two distinct tools:
    -   **Selector (Mode):** Maps to `Panel.Mode` (Auto/Manual).
    -   **Selector (Remote):** Maps to `Panel.LocalRemote` (Remote/Local).
-   **Runtime Config:** When generating the runtime HTML, the editor creates a `config` object in the embedded script. For selectors, this config includes a `type` property (`mode` or `remote`) to tell the runtime which point to bind to.
    ```javascript
    // Example generated config
    const config = {
      selectors: [
        { id: "selector1", equip: "SPP001", type: "mode" },
        { id: "selector1_1", equip: "SPP001", type: "remote" }
      ]
    };
    ```
-   **Loading Logic:** When loading a saved mimic, `parseAndLoadMimic` parses this embedded config to restore the correct tool type (`selector-mode` or `selector-remote`), ensuring the editor remains editable and consistent.

### 2. Static Arrows
-   **Type:** `static-arrow`
-   **Implementation:** Rendered as a line `div` with a nested triangle `div` for the arrowhead.
-   **Properties:** Supports Width, Height, Color, and Rotation. These are editable via the Properties Panel.

### 3. Robust Loading (`parseAndLoadMimic`)
The editor includes a robust parser to reverse-engineer the canvas state from the saved HTML file.
-   **Symbol Detection:** Identifies symbols by their `data-equipment` attribute and internal class names (e.g., `.pump-container`).
-   **Config Parsing:** Extracts the `config` object from the embedded script to recover metadata that isn't stored in the DOM (like the specific selector type).
-   **Unique IDs:** The generator enforces unique DOM IDs (appending `_1`, `_2`, etc.) to prevent collisions when multiple symbols map to the same equipment (e.g., two selectors for `SPP001`).

### 4. Faceplate Integration
-   **Type:** `SPP` (Selector)
-   **Logic:** The `faceplate.js` module has been updated to handle `SPP` equipment. It checks for both `Mode` and `LocalRemote` tags to display the correct status ("Auto/Manual" or "Remote/Local") and lists all associated points.

## Best Practices for Future Development
-   **Unique IDs:** Always ensure generated DOM IDs are unique to avoid runtime errors.
-   **Config Persistence:** If adding new symbol types that require specific runtime logic, store that metadata in the embedded `config` object and update `parseAndLoadMimic` to read it back.
-   **Backward Compatibility:** When modifying the save format, ensure `parseAndLoadMimic` can still handle older files or gracefully upgrade them.
