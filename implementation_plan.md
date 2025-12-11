# Decouple Symbol Configuration from Page Defaults

## Goal Description
Enable symbols (e.g., pumps, fans) to have explicit Location and System configurations independent of the page's global settings. This allows a mimic page (e.g., in STSB) to control equipment from other locations (e.g., NBT).

## User Review Required
> [!IMPORTANT]
> This changes the UI of the Property Panel for symbols. Users will need to select Location first, then System, then Equipment. Old pages will default to their page settings if loaded.

## Proposed Changes

### Frontend
#### [MODIFY] [mimic_builder.html](file:///c:/Users/erik.chow/Desktop/SCADA/mimic_builder.html)
- Add `Location` dropdown to `symbol-props-template`.

#### [MODIFY] [js/mimic_builder.js](file:///c:/Users/erik.chow/Desktop/SCADA/js/mimic_builder.js)
- Populate Location dropdown from `navData`.
- Implement cascading updates: Location -> System -> Equipment.
- Update `generateHTML` to include `loc` and `sys` in the symbol initialization block.
- Update `parseAndLoadMimic` to respect explicit `data-location` and `data-system` if present (or infer from execution script?).
    - Actually, storing them in `data-` attributes on the `div` is the cleanest way to persist them for reloading into the builder.

## Verification Plan
### Manual Verification
1. Open Mimic Builder.
2. Set Page Location to "STSB", System to "Layout".
3. Add a Pump symbol.
4. In Properties, select Location "NBT", System "TRA".
5. Verify Equipment list shows NBT-TRA pumps.
6. Select a pump (e.g., SUP001).
7. Save the page.
8. Verify generated HTML has correct `init` call with `loc: 'NBT'` and `sys: 'TRA'`.
9. Reload the page in Builder and verify properties are restored.
