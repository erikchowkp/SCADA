/*
===============================================================================
Override Manager (override.js)
-------------------------------------------------------------------------------
Handles adding/removing the "M" manual-override flag on symbol elements.
Now exported under SCADA.Core.Override.
===============================================================================
*/

;(function (SCADA, global) {
  const Override = {
  // Update override flag based on points (mo_i = manual override indicator)
  update(el, ...points) {
    if (!el) return;
    const active = points.some(p => p && p.mo_i);
    const FP = SCADA?.UI?.Faceplate;
    if (!FP) return;

    if (active) FP.addOverrideFlag(el);
    else FP.removeOverrideFlag(el);
  }
};

  // === New namespaced export ===
  SCADA.Core.Override = Override;

})(window.SCADA = window.SCADA || { Core:{}, Symbols:{}, UI:{}, State:{} }, window);
