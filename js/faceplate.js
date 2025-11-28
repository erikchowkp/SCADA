/*
===============================================================================
SCADA.UI.Faceplate (faceplate.js)
-------------------------------------------------------------------------------
Centralised faceplate overlay logic for equipment status, control, override,
and AI setting tabs.

Now registered under SCADA.UI.Faceplate.
===============================================================================
*/

; (function (SCADA, global) {
  // -------------------------------------------------------------
  // Module state
  // -------------------------------------------------------------
  let faceplateEquip = null;   // e.g. "SBT-TRA-SUP-001"
  let faceplateType = null;   // e.g. "SUP"

  // One-shot flag to force a refresh even when on "advance"/"setting" tabs
  SCADA.State.forceFaceplateRefresh = false;

  // -------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------
  function openFaceplate(fullName) {
    // Show overlay
    const overlay = document.getElementById("faceplate-overlay");
    if (overlay) overlay.style.display = "block";

    faceplateEquip = fullName;
    faceplateType = null;

    const fp = document.getElementById("faceplate");
    if (!fp) return;

    // Title
    const title = document.getElementById("fp-title");
    if (title) title.innerText = fullName;

    // Center within mimic panel
    const panel = document.getElementById("mimic-wrapper");
    if (panel) {
      const pRect = panel.getBoundingClientRect();
      const fWidth = 360;
      const fHeight = fp.offsetHeight || 200;
      const left = (pRect.width - fWidth) / 2;
      const top = (pRect.height - fHeight) / 2;
      fp.style.left = left + "px";
      fp.style.top = top + "px";
    }


    fp.classList.remove("hidden");
    showTab("status");
    refreshFaceplate();
  }

  function showTab(tab) {
    // hide all tabs
    document.querySelectorAll(".fp-tab").forEach(div => div.classList.add("hidden"));
    document.querySelectorAll(".fp-tabs button").forEach(btn => btn.classList.remove("active"));

    // clear Setting tab message whenever switching tabs
    const msgEl = document.getElementById("aiSettingMsg");
    if (msgEl) msgEl.textContent = "";

    // show selected + set active button
    if (tab === "status") {
      document.getElementById("tab-status")?.classList.remove("hidden");
      document.querySelector(".fp-tabs button:nth-child(1)")?.classList.add("active");
    } else if (tab === "control") {
      document.getElementById("tab-control")?.classList.remove("hidden");
      document.querySelector(".fp-tabs button:nth-child(2)")?.classList.add("active");
    } else if (tab === "advance") {
      document.getElementById("tab-advance")?.classList.remove("hidden");
      document.querySelector(".fp-tabs button:nth-child(3)")?.classList.add("active");
    } else if (tab === "setting") {
      document.getElementById("tab-setting")?.classList.remove("hidden");
      document.querySelector(".fp-tabs button:nth-child(4)")?.classList.add("active");
    }
  }

  function closeFaceplate() {
    const fp = document.getElementById("faceplate");
    if (fp) fp.classList.add("hidden");

    // Hide overlay
    const overlay = document.getElementById("faceplate-overlay");
    if (overlay) overlay.style.display = "none";

    // Clear Setting tab message on close
    const msgEl = document.getElementById("aiSettingMsg");
    if (msgEl) msgEl.textContent = "";
  }

  // -------------------------------------------------------------
  // Refresh (Status / Control / Advance / Setting)
  // -------------------------------------------------------------
  async function refreshFaceplate() {
    // pause refresh while user is editing in Advance/Setting tabs, unless forced once
    const activeTab = document.querySelector(".fp-tab:not(.hidden)");
    if (activeTab && (activeTab.id === "tab-advance" || activeTab.id === "tab-setting") && !SCADA.State.forceFaceplateRefresh) {
      return;
    }
    SCADA.State.forceFaceplateRefresh = false;


    if (!faceplateEquip) return;
    try {
      const [defsRes, alarmsRes] = await Promise.all([
        fetch("/api/read"),
        fetch("/api/alarms")
      ]);
      const data = await defsRes.json();
      const alarms = await alarmsRes.json();

      // points of this equipment
      const points = data.points.filter(p =>
        `${p.loc}-${p.sys}-${p.equipType}-${p.equipId}` === faceplateEquip
      );
      if (points.length === 0) return;

      // auto-detect type once
      if (!faceplateType) faceplateType = points[0].equipType;

      // ---- STATUS ----
      let state = "Unknown";
      if (faceplateType === "SUP" || faceplateType === "FAN") {
        const runFb = points.find(p => p.tag.includes("RunFb"));
        const trip = points.find(p => p.tag.includes("Trip"));
        if (trip && trip.value === 1) state = "Tripped";
        else if (runFb && runFb.value === 1) state = "Running";
        else state = "Stopped";
      } else if (faceplateType === "BRK") {
        const openFb = points.find(p => p.tag.includes("OpenFb"));
        const closeFb = points.find(p => p.tag.includes("CloseFb"));
        if (openFb && openFb.value === 1) state = "Open";
        else if (closeFb && closeFb.value === 1) state = "Closed";
      }

      const latestTs = points
        .map(p => new Date(p.ts))
        .reduce((a, b) => a > b ? a : b, new Date(0));
      const tsEl = document.getElementById("fp-ts");
      if (tsEl) tsEl.innerText = latestTs.getTime() > 0 ? latestTs.toISOString() : "--";

      // ---- STATUS list (points) ----
      const listDiv = document.getElementById("fp-points");
      if (listDiv) {
        listDiv.innerHTML = "";

        points.forEach(pt => {
          if (pt.signalType === "DO") return; // skip commands

          const wrapper = document.createElement("div");
          wrapper.style.marginBottom = "6px";

          const labelRow = document.createElement("div");
          labelRow.innerText = pt.desc || pt.label;
          labelRow.style.fontWeight = "bold";

          const valueRow = document.createElement("div");
          valueRow.style.marginLeft = "14px";

          // AI indicator (crit colour / blink)
          if (pt.signalType === "AI") {
            const indicator = document.createElement("span");
            indicator.className = "fp-indicator";
            const related = alarms.filter(a => a.tag === pt.tag && a.loc === pt.loc);
            const activeAlarm = related.find(a => a.state === "Active");
            const clearedUnack = related.find(a => a.state === "Cleared" && !a.ack);

            if (activeAlarm) {
              const crit = activeAlarm.crit || 0;
              const ack = !!activeAlarm.ack;
              if (crit === 3) indicator.classList.add(ack ? "alarm-red" : "blink-red");
              else if (crit === 2) indicator.classList.add(ack ? "alarm-orange" : "blink-orange");
              else if (crit === 1) indicator.classList.add(ack ? "alarm-yellow" : "blink-yellow");
            } else if (clearedUnack) {
              indicator.classList.add("blink-green");
            } else {
              indicator.classList.add("normal");
            }
            valueRow.appendChild(indicator);
          }

          // DI/Alarm indicator box (crit0/crit1)
          if ((pt.crit0 ?? 0) > 0 || (pt.crit1 ?? 0) > 0) {
            const indicator = document.createElement("span");
            indicator.className = "fp-indicator";
            const alarm = alarms.find(a => a.tag === pt.tag && a.loc === pt.loc);

            if (pt.value == 1 && (pt.crit1 ?? 0) > 0) {
              if (pt.crit1 === 3) indicator.classList.add(alarm && !alarm.ack ? "blink-red" : "alarm-red");
              else if (pt.crit1 === 2) indicator.classList.add(alarm && !alarm.ack ? "blink-orange" : "alarm-orange");
              else if (pt.crit1 === 1) indicator.classList.add(alarm && !alarm.ack ? "blink-yellow" : "alarm-yellow");
            } else {
              if (alarm && alarm.state === "Cleared" && !alarm.ack) {
                indicator.classList.add("blink-green");
              } else {
                indicator.classList.add("normal");
              }
            }
            valueRow.appendChild(indicator);
          }

          // value text
          const valueText = document.createElement("span");
          if (pt.signalType === "AI") {
            const val = parseFloat(pt.value);
            valueText.innerText = isNaN(val)
              ? "--"
              : val.toFixed(pt.decimals ?? 2) + (pt.unit ? " " + pt.unit : "");
          } else {
            valueText.innerText = (pt.value == 1 ? pt.state1 || "On" : pt.state0 || "Off");
          }
          valueRow.appendChild(valueText);

          // === Phase 9.2: Trend launch icon for AI ===
          if (pt.signalType === "AI") {
            const trendIcon = document.createElement("span");
            trendIcon.textContent = " 📈";
            trendIcon.style.cursor = "pointer";
            trendIcon.title = "Open Trend for this AI";
            trendIcon.addEventListener("click", () => {
              SCADA.UI.Faceplate.close();

              // Build a more descriptive label: full equipment + signal name
              const equipName = faceplateEquip || `${pt.loc}-${pt.sys}-${pt.equipType}-${pt.equipId}`;
              const signalName = pt.desc || pt.label || pt.tag;
              const labelText = `${equipName} – ${signalName}`;

              const initArgs = {
                point: `${pt.loc}:${pt.tag}`,
                label: labelText
              };

              SCADA.Core.Loader.loadSystem("TREND", undefined, initArgs);
            });

            valueRow.appendChild(trendIcon);
          }

          wrapper.appendChild(labelRow);
          wrapper.appendChild(valueRow);
          listDiv.appendChild(wrapper);
        });

        // Ack Page button
        const ackBtn = document.getElementById("fp-ack-page");
        if (ackBtn) {
          const unackAlarms = points
            .map(pt => alarms.find(a => a.tag === pt.tag && a.loc === pt.loc))
            .filter(a => a && !a.ack && (a.state === "Active" || a.state === "Cleared"));

          if (unackAlarms.length > 0) {
            ackBtn.disabled = false;
            ackBtn.onclick = async () => {
              for (const a of unackAlarms) {
                await fetch("/api/alarms/ack", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ tag: a.tag, loc: a.loc })
                });
              }
              refreshFaceplate();
            };
          } else {
            ackBtn.disabled = true;
            ackBtn.onclick = null;
          }
        }
      }

      // ---- CONTROL tab ----
      const controlTab = document.getElementById("tab-control");
      if (controlTab) {
        controlTab.innerHTML = "";

        if (faceplateType === "SUP" || faceplateType === "FAN") {
          const wrapper = document.createElement("div");
          wrapper.style.marginBottom = "10px";

          const label = document.createElement("div");
          label.innerText = "Pump Control:";
          label.style.fontWeight = "bold";
          wrapper.appendChild(label);

          const loc = points[0].loc;
          const equipLabel = points[0].label; // e.g. "SUP001"

          const startBtn = document.createElement("button");
          startBtn.innerText = "Start";
          startBtn.onclick = () => SCADA.Core.sendCmd(`${loc}:${equipLabel}.StartCmd`, 1);

          const stopBtn = document.createElement("button");
          stopBtn.innerText = "Stop";
          stopBtn.onclick = () => SCADA.Core.sendCmd(`${loc}:${equipLabel}.StopCmd`, 1);

          // disable in Local
          const remotePoint = data.points.find(p => p.tag === "Panel.LocalRemote" && p.loc === points[0].loc);
          const isLocal = remotePoint && remotePoint.value === 1;
          startBtn.disabled = isLocal;
          stopBtn.disabled = isLocal;

          // Disable Control tab if local
          const controlTabBtn = document.querySelector(".fp-tabs button:nth-child(2)");
          if (controlTabBtn) {
            if (isLocal) {
              controlTabBtn.classList.add("disabled");
              if (!document.getElementById("tab-control").classList.contains("hidden")) {
                showTab("status");
              }
            } else {
              controlTabBtn.classList.remove("disabled");
            }
          }

          const btns = document.createElement("div");
          btns.style.marginLeft = "14px";
          btns.style.display = "flex";
          btns.style.flexDirection = "row";
          btns.style.gap = "10px";
          btns.appendChild(startBtn);
          btns.appendChild(stopBtn);

          wrapper.appendChild(btns);
          controlTab.appendChild(wrapper);
        } else if (faceplateType === "BRK") {
          const wrapper = document.createElement("div");
          const label = document.createElement("div");
          label.innerText = "Breaker Control:";
          label.style.fontWeight = "bold";
          wrapper.appendChild(label);

          const closeBtn = document.createElement("button");
          closeBtn.innerText = "Close";
          closeBtn.onclick = () => SCADA.Core.sendCmd(points[0].label + ".CloseCmd", 1);

          const openBtn = document.createElement("button");
          openBtn.innerText = "Open";
          openBtn.onclick = () => SCADA.Core.sendCmd(points[0].label + ".OpenCmd", 1);


          const btns = document.createElement("div");
          btns.style.marginLeft = "14px";
          btns.style.display = "flex";
          btns.style.flexDirection = "column";
          btns.style.gap = "6px";
          btns.appendChild(closeBtn);
          btns.appendChild(openBtn);

          wrapper.appendChild(btns);
          controlTab.appendChild(wrapper);
        }
      }

      // hide Control tab if no DO
      const controlTabBtn = document.querySelector(".fp-tabs button:nth-child(2)");
      if (controlTabBtn) {
        const hasDO = points.some(pt => pt.signalType === "DO");
        if (!hasDO) {
          controlTabBtn.style.display = "none";
          if (!document.getElementById("tab-control").classList.contains("hidden")) showTab("status");
        } else controlTabBtn.style.display = "";
      }

      // hide Advance if no DI/AI
      const advTabBtn = document.querySelector(".fp-tabs button:nth-child(3)");
      const hasDIorAI = points.some(pt => pt.signalType === "DI" || pt.signalType === "AI");
      if (advTabBtn) {
        if (!hasDIorAI) {
          advTabBtn.style.display = "none";
          if (!document.getElementById("tab-advance").classList.contains("hidden")) showTab("status");
        } else advTabBtn.style.display = "";
      }

      // hide Setting if no AI
      const setTabBtn = document.querySelector(".fp-tabs button:nth-child(4)");
      const hasAI = points.some(pt => pt.signalType === "AI");
      if (setTabBtn) {
        if (!hasAI) {
          setTabBtn.style.display = "none";
          if (!document.getElementById("tab-setting").classList.contains("hidden")) showTab("status");
        } else setTabBtn.style.display = "";
      }

      // ---- ADVANCE tab (override) ----
      const advTab = document.getElementById("tab-advance");
      if (advTab) {
        const selPoint = advTab.querySelector("#ovrPoint");
        const valBox = advTab.querySelector("#ovrValue");
        const btnApply = advTab.querySelector("#applyOverrideBtn");
        const btnClear = advTab.querySelector("#clearOverrideBtn");

        const selectable = points.filter(p => p.signalType === "DI" || p.signalType === "AI");
        // drop-down
        selPoint.innerHTML = "";
        selectable.forEach(p => {
          const opt = document.createElement("option");
          opt.value = p.tag;
          opt.textContent = `${p.desc || p.label} (${p.signalType})`;
          selPoint.appendChild(opt);
        });

        function updateOverrideField() {
          // rebuild only if user not typing
          const existingInput = valBox.querySelector("input, select");
          if (existingInput && document.activeElement === existingInput) return;

          valBox.innerHTML = "";
          const tag = selPoint.value;
          const pt = selectable.find(p => p.tag === tag);
          if (!pt) return;

          if (pt.signalType === "AI") {
            const input = document.createElement("input");
            input.type = "number";
            input.step = "any";
            input.id = "ovrNumeric";
            input.className = "ovr-input";
            input.style.width = "330px";
            input.style.textAlign = "left";
            input.style.padding = "2px 2px";

            if (pt.mo_i === true && !isNaN(pt.value)) input.value = pt.value;
            else if (pt.mo_i !== true) input.value = pt.value ?? 0;

            if (pt.mo_i === true) {
              input.disabled = true;
              input.style.background = "#f5f5f5";
              input.title = "Manual override active – clear it to re-enable editing";
            } else {
              input.disabled = false;
              input.style.background = "white";
              input.title = "";
            }
            valBox.appendChild(input);
          } else {
            const sel = document.createElement("select");
            sel.id = "ovrDigital";
            sel.style.width = "100%";
            sel.style.padding = "6px";
            const opt0 = document.createElement("option");
            opt0.value = "0";
            opt0.textContent = pt.state0 || "State0";
            const opt1 = document.createElement("option");
            opt1.value = "1";
            opt1.textContent = pt.state1 || "State1";
            sel.appendChild(opt0);
            sel.appendChild(opt1);
            sel.value = String(pt.value);
            valBox.appendChild(sel);
          }
        }

        updateOverrideField();
        selPoint.addEventListener("change", updateOverrideField);

        // Apply override
        btnApply.onclick = async () => {
          const tag = selPoint.value;
          const pt = selectable.find(p => p.tag === tag);
          if (!pt) return;
          const loc = pt.loc;

          const val = (pt.signalType === "AI")
            ? parseFloat(document.getElementById("ovrNumeric").value)
            : Number(document.getElementById("ovrDigital").value);

          await fetch("/api/override", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ loc, tag, mo_i: true, value: val })
          });

          // 🟢 Immediately update shared PollManager cache and notify all mimics
          try {
            const PM = SCADA.Core?.PollManager;
            if (PM?.getCache && PM?.notifySubscribers) {
              const cache = PM.getCache();
              const points = cache?.data?.points;
              if (Array.isArray(points)) {
                const p = points.find(x => x.tag === tag && x.loc === loc);
                if (p) {
                  p.mo_i = true;
                  p.value = val;
                  console.log(`⚡ Updated cache for ${tag}: mo_i=true value=${val}`);
                }
              }
              PM.notifySubscribers();
            }
          } catch (err) {
            console.warn("⚠️ Immediate override push failed:", err);
          }

          SCADA.State.forceFaceplateRefresh = true;
          SCADA.UI.Faceplate.refresh();
        };


        // Clear override
        btnClear.onclick = async () => {
          const tag = selPoint.value;
          const pt = selectable.find(p => p.tag === tag);
          if (!pt) return;
          const loc = pt.loc;

          await fetch("/api/override", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ loc, tag, mo_i: false })
          });

          // 🟢 Immediately update shared PollManager cache and notify mimics
          try {
            const PM = SCADA.Core?.PollManager;
            if (PM?.getCache && PM?.notifySubscribers) {
              const cache = PM.getCache();
              const points = cache?.data?.points;
              if (Array.isArray(points)) {
                const p = points.find(x => x.tag === tag && x.loc === loc);
                if (p) {
                  p.mo_i = false;
                  console.log(`⚡ Updated cache for ${tag}: mo_i=false`);
                }
              }
              PM.notifySubscribers();
            }
          } catch (err) {
            console.warn("⚠️ Immediate clear push failed:", err);
          }

          setTimeout(() => {
            SCADA.State.forceFaceplateRefresh = true;
            SCADA.UI.Faceplate.refresh();
          }, 300);
        };

      }

      // ---- SETTING tab ----
      if (SCADA.UI?.AISetting?.init) {
        SCADA.UI.AISetting.init(points, alarms);
      }


    } catch (err) {
      console.error("Faceplate refresh error:", err);
    }
  }

  // -------------------------------------------------------------
  // Helpers for any symbol that needs to show the "M" override badge
  // -------------------------------------------------------------
  function addOverrideFlag(container) {
    if (!container) return;
    if (container.querySelector(".override-flag")) return;
    const div = document.createElement("div");
    div.className = "override-flag";
    div.textContent = "M";
    container.style.position = "relative";
    container.appendChild(div);
  }

  function removeOverrideFlag(container) {
    if (!container) return;
    const el = container.querySelector(".override-flag");
    if (el) el.remove();
  }

  // periodic refresh
  setInterval(refreshFaceplate, 2000);

  // -------------------------------------------------------------
  // Faceplate draggable (full-viewport constraint)
  // -------------------------------------------------------------
  window.addEventListener("DOMContentLoaded", () => {
    const fp = document.getElementById("faceplate");
    const header = fp?.querySelector(".fp-header");
    if (!fp || !header) return;

    let isDragging = false;
    let dragStartX = 0, dragStartY = 0;
    let startLeft = 0, startTop = 0;

    header.style.cursor = "move";

    header.addEventListener("mousedown", (e) => {
      isDragging = true;
      dragStartX = e.clientX;
      dragStartY = e.clientY;
      startLeft = fp.offsetLeft;
      startTop = fp.offsetTop;
      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
      e.preventDefault();
    });

    function onMouseMove(e) {
      if (!isDragging) return;

      const dx = e.clientX - dragStartX;
      const dy = e.clientY - dragStartY;

      // constrain within viewport
      const maxLeft = window.innerWidth - fp.offsetWidth;
      const maxTop = window.innerHeight - fp.offsetHeight;

      let newLeft = Math.max(0, Math.min(startLeft + dx, maxLeft));
      let newTop = Math.max(0, Math.min(startTop + dy, maxTop));

      fp.style.left = `${newLeft}px`;
      fp.style.top = `${newTop}px`;
    }

    function onMouseUp() {
      isDragging = false;
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    }
  });



  // ---------------------------------------------------------------------------
  // Namespace registration
  // ---------------------------------------------------------------------------
  SCADA.UI.Faceplate = {
    open: openFaceplate,
    close: closeFaceplate,
    showTab,
    refresh: refreshFaceplate,
    addOverrideFlag,
    removeOverrideFlag
  };

  console.log("✅ SCADA.UI.Faceplate registered (Phase 3)");

})(window.SCADA = window.SCADA || { Core: {}, Symbols: {}, UI: {}, State: {} }, window);
