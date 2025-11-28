/*
===============================================================================
Mimic Map (mimicMap.js)
-------------------------------------------------------------------------------
Maps a (LOC-SYS-LABEL) key to the corresponding system token or mimic name.
Now exported under SCADA.Core.MimicMap.
===============================================================================
*/

;(function (SCADA, global) {
  const MimicMap = {
    // --- SBT TRA LPS equipment ---
    "SBT-TRA-SPT001": "SBT_TRA",
    "SBT-TRA-SUP001": "SBT_TRA",
    "SBT-TRA-SUP002": "SBT_TRA",
    "SBT-TRA-SUP003": "SBT_TRA",
    "SBT-TRA-SPP001": "SBT_TRA",
    "SBT-TRA-FLO001": "SBT_TRA",

    // --- NBT TRA LPS equipment ---
    "NBT-TRA-SPT001": "NBT_TRA",
    "NBT-TRA-SUP001": "NBT_TRA",
    "NBT-TRA-SUP002": "NBT_TRA",
    "NBT-TRA-SUP003": "NBT_TRA",
    "NBT-TRA-SPP001": "NBT_TRA",
    "NBT-TRA-FLO001": "NBT_TRA",

    // (add more keys as new equipment/pages are introduced)
  };

  // === New namespaced export ===
  SCADA.Core.MimicMap = MimicMap;

})(window.SCADA = window.SCADA || { Core:{}, Symbols:{}, UI:{}, State:{} }, window);
