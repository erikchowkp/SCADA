/*
===============================================================================
Naming Utility (naming.js)
-------------------------------------------------------------------------------
Provides helper functions for building consistent equipment keys.
Now exported under SCADA.Core.Naming.
===============================================================================
*/

;(function (SCADA, global) {
  const Naming = {
    // Build full equipment key: LOC-SYS-TYPE-ID
    buildFullName(obj) {
      if (typeof obj === "string") return obj;
      return `${obj.loc}-${obj.sys}-${obj.equipType}-${obj.equipId}`;
    }
  };

  // === New namespaced export ===
  SCADA.Core.Naming = Naming;

})(window.SCADA = window.SCADA || { Core:{}, Symbols:{}, UI:{}, State:{} }, window);
