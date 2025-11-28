/*
===============================================================================
AI Setting UI Module  (ai_setting.js)
-------------------------------------------------------------------------------
Handles configuration and saving of AI thresholds.
Now exported under SCADA.UI.AISetting.init(points, alarms)
===============================================================================
*/

;(function (SCADA, global) {
  // --- Module definition ---
  const AISetting = {};

  AISetting.init = function (points, alarms) {
    const settingTab = document.getElementById("tab-setting");
    if (!settingTab) return;

    const sel = settingTab.querySelector("#aiSettingSelect");
    const warnInput = settingTab.querySelector("#aiWarn");
    const highInput = settingTab.querySelector("#aiHigh");
    const hhInput = settingTab.querySelector("#aiHH");
    const warnLowInput = settingTab.querySelector("#aiWarnLow");
    const lowInput = settingTab.querySelector("#aiLow");
    const llInput = settingTab.querySelector("#aiLL");

    const chkWarn = settingTab.querySelector("#chkWarn");
    const chkHigh = settingTab.querySelector("#chkHigh");
    const chkHH = settingTab.querySelector("#chkHH");
    const chkWarnLow = settingTab.querySelector("#chkWarnLow");
    const chkLow = settingTab.querySelector("#chkLow");
    const chkLL = settingTab.querySelector("#chkLL");

    const saveBtn = settingTab.querySelector("#saveAISettingsBtn");
    const msgEl = document.getElementById("aiSettingMsg");

    const aiPoints = points.filter(p => p.signalType === "AI");
    sel.innerHTML = "";
    aiPoints.forEach(p => {
      const opt = document.createElement("option");
      opt.value = p.tag;
      opt.textContent = `${p.desc || p.label} (${p.unit || ""})`;
      sel.appendChild(opt);
    });

    async function loadThresholds(forceReload = false) {
      let pt;
      if (forceReload) {
        try {
          const res = await fetch("/api/read");
          const data = await res.json();
          pt = data.points.find(p => p.tag === sel.value);
        } catch (err) {
          console.warn("⚠ Failed to reload SCADA defs:", err);
        }
      } else {
        pt = aiPoints.find(p => p.tag === sel.value);
      }
      if (!pt) return;

      const parseVal = v => (v === "x" ? "" : v ?? "");
      warnInput.value = parseVal(pt.warn);
      highInput.value = parseVal(pt.high);
      hhInput.value = parseVal(pt.hh);
      warnLowInput.value = parseVal(pt.warn_low);
      lowInput.value = parseVal(pt.low);
      llInput.value = parseVal(pt.ll);

      chkWarn.checked = pt.warn !== "x";
      chkHigh.checked = pt.high !== "x";
      chkHH.checked = pt.hh !== "x";
      chkWarnLow.checked = pt.warn_low !== "x";
      chkLow.checked = pt.low !== "x";
      chkLL.checked = pt.ll !== "x";

      const toggleBox = (chk, inp) => (inp.disabled = !chk.checked);
      [[chkWarn, warnInput], [chkHigh, highInput], [chkHH, hhInput],
       [chkWarnLow, warnLowInput], [chkLow, lowInput], [chkLL, llInput]
      ].forEach(([chk, inp]) => {
        toggleBox(chk, inp);
        chk.addEventListener("change", () => toggleBox(chk, inp));
      });
    }

    sel.addEventListener("change", loadThresholds);
    loadThresholds();

    saveBtn.onclick = async () => {
      msgEl.style.color = "inherit";
      msgEl.textContent = "";

      const tag = sel.value;
      const pt = aiPoints.find(p => p.tag === tag);
      if (!pt) return;
      const loc = pt.loc;

      const warnVal = parseFloat(warnInput.value);
      const highVal = parseFloat(highInput.value);
      const hhVal = parseFloat(hhInput.value);
      const warnLowVal = parseFloat(warnLowInput.value);
      const lowVal = parseFloat(lowInput.value);
      const llVal = parseFloat(llInput.value);

      const active = (chk, val) => chk.checked && !isNaN(val);

      const showWarn = msg => {
        msgEl.style.color = "#eab308";
        msgEl.textContent = msg;
      };

      if (active(chkWarn, warnVal) && active(chkHigh, highVal) && warnVal > highVal)
        return showWarn("⚠ Warning (High) cannot be higher than High limit.") || loadThresholds(true);
      if (active(chkHigh, highVal) && active(chkHH, hhVal) && highVal > hhVal)
        return showWarn("⚠ High cannot be higher than High-High limit.") || loadThresholds(true);
      if (active(chkLL, llVal) && active(chkLow, lowVal) && llVal > lowVal)
        return showWarn("⚠ Low-Low cannot be higher than Low limit.") || loadThresholds(true);
      if (active(chkLow, lowVal) && active(chkWarnLow, warnLowVal) && lowVal > warnLowVal)
        return showWarn("⚠ Low cannot be higher than Warning (Low) limit.") || loadThresholds(true);

      const highs = [];
      if (chkWarn.checked && !isNaN(warnVal)) highs.push(warnVal);
      if (chkHigh.checked && !isNaN(highVal)) highs.push(highVal);
      if (chkHH.checked && !isNaN(hhVal)) highs.push(hhVal);

      const lows = [];
      if (chkLL.checked && !isNaN(llVal)) lows.push(llVal);
      if (chkLow.checked && !isNaN(lowVal)) lows.push(lowVal);
      if (chkWarnLow.checked && !isNaN(warnLowVal)) lows.push(warnLowVal);

      if (highs.length && lows.length) {
        const lowestHigh = Math.min(...highs);
        const highestLow = Math.max(...lows);
        if (highestLow >= lowestHigh)
          return showWarn("⚠ Low-side limits cannot overlap or exceed High-side limits.") || loadThresholds(true);
      }

      const payload = {
        loc, tag,
        warn: chkWarn.checked ? warnVal : "x",
        high: chkHigh.checked ? highVal : "x",
        hh: chkHH.checked ? hhVal : "x",
        warn_low: chkWarnLow.checked ? parseFloat(warnLowInput.value) : "x",
        low: chkLow.checked ? parseFloat(lowInput.value) : "x",
        ll: chkLL.checked ? parseFloat(llInput.value) : "x"
      };

      const res = await fetch("/api/ai_settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        msgEl.style.color = "#22c55e";
        msgEl.textContent = "✅ AI settings updated successfully.";
        setTimeout(() => {
          SCADA.State.forceFaceplateRefresh = true;
          SCADA.UI.Faceplate?.refreshFaceplate?.();
        }, 500);
      } else {
        const err = await res.json().catch(() => ({}));
        msgEl.style.color = "#ef4444";
        msgEl.textContent = `❌ Update failed: ${err.error || "Unknown error"}`;
        SCADA.UI.Faceplate?.refreshFaceplate?.();
      }
    };
  };

  // --- Namespace registration ---
  SCADA.UI.AISetting = AISetting;

  console.log("✅ SCADA.UI.AISetting registered (Phase 3)");

})(window.SCADA = window.SCADA || { Core: {}, Symbols: {}, UI: {}, State: {} }, window);
