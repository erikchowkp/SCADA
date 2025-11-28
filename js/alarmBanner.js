/* ================= ALARM BANNER NAMESPACE START ================= */
;(function (SCADA, global) {
  // ensure namespace exists
  SCADA.UI = SCADA.UI || {};

// -----------------------------------------------------------------------------
// Render alarm banner and counters
// -----------------------------------------------------------------------------
function renderAlarmBanner(alarms) {
  try {
    // --- Counter logic ---
    const unack = alarms.filter(a => !a.ack && (a.state === "Active" || a.state === "Cleared") && a.crit > 0);
    const all   = alarms.filter(a => a.crit > 0);

    document.getElementById("unackTotal").innerText    = unack.length;
    document.getElementById("unackSuper").innerText    = unack.filter(a => a.crit === 3).length;
    document.getElementById("unackCritical").innerText = unack.filter(a => a.crit === 2).length;
    document.getElementById("unackWarning").innerText  = unack.filter(a => a.crit === 1).length;

    document.getElementById("allTotal").innerText      = all.length;
    document.getElementById("allSuper").innerText      = all.filter(a => a.crit === 3).length;
    document.getElementById("allCritical").innerText   = all.filter(a => a.crit === 2).length;
    document.getElementById("allWarning").innerText    = all.filter(a => a.crit === 1).length;

    // --- Display rows ---
    const bannerAlarms = alarms
      .filter(a => (a.state === "Active") || (a.state === "Cleared" && !a.ack))
      .sort((a, b) => b.crit - a.crit || new Date(b.time) - new Date(a.time))
      .slice(0, 3); // show top 3

    const tbody = document.querySelector("#alarmTable tbody");
    if (!tbody) return;
    tbody.innerHTML = "";

    bannerAlarms.forEach(a => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${a.time}</td>
        <td>${a.loc}</td>
        <td>${a.sys}</td>
        <td>${a.label}</td>
        <td>${a.description}</td>
        <td>${a.status}</td>
        <td><button class="ack-btn">Ack</button></td>
      `;

      // bind event listener instead of inline handler
      tr.querySelector(".ack-btn").addEventListener("click", () => {
        SCADA.UI.AlarmBanner.ack(a.tag, a.loc);
      });


      // colour / blink logic
      if (a.state === "Active" && !a.ack) tr.classList.add(`crit-${a.crit}`, "blink");
      else if (a.state === "Active" && a.ack) tr.classList.add(`crit-${a.crit}`);
      else if (a.state === "Cleared" && !a.ack) tr.classList.add("cleared-unack");

      // double-click to open related mimic (namespaced)
      tr.style.cursor = "pointer";
      tr.addEventListener("dblclick", e => {
        e.stopPropagation();

        const key = `${(a.loc||"").toUpperCase()}-${(a.sys||"").toUpperCase()}-${(a.label||"").toUpperCase()}`;
        const mapped = (global.mimicMap && global.mimicMap[key]) ? global.mimicMap[key] : null;

        // hand a one-shot highlight key to the mimic page
        global.__highlightEquipKey = key;

        if (mapped && typeof SCADA?.UI?.selectMimicFile === "function") {
          // exact file like "NBT_TRA"
          SCADA.UI.selectMimicFile(mapped);
        } else if (typeof SCADA?.UI?.selectSystem === "function") {
          // fallback: use loc/sys directly
          SCADA.State.currentLocation = (a.loc || "").toUpperCase();
          SCADA.UI.selectSystem((a.sys || "").toUpperCase());
        }
      });


      tbody.appendChild(tr);
    });

    // pad rows to fixed height
    const maxRows = 3;
    for (let i = bannerAlarms.length; i < maxRows; i++) {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td style="height:28px;"></td><td></td><td></td><td></td><td></td><td></td><td></td>`;
      tbody.appendChild(tr);
    }

  } catch (err) {
    console.error("Banner render error:", err);
  }
}

// -----------------------------------------------------------------------------
// Acknowledge single alarm
// -----------------------------------------------------------------------------
function ackAlarm(tag, loc){
  fetch("/api/alarms/ack", {
    method:"POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tag, loc })
  })
  .then(res => res.json())
  .then(() => {
    if (window.latestAlarms) renderAlarmBanner(window.latestAlarms);
  })
  .catch(err => console.error("Ack error:", err));
}

// -----------------------------------------------------------------------------
// Background refresh loop
// -----------------------------------------------------------------------------
const refreshTimer = setInterval(async () => {
  try {
    const res = await fetch("/api/alarms");
    const alarms = await res.json();
    window.latestAlarms = alarms;
    renderAlarmBanner(alarms);
  } catch (err) {
    console.error("Alarm refresh error:", err);
  }
}, 1000);

// -----------------------------------------------------------------------------
// Expose globals
// -----------------------------------------------------------------------------

  // === Namespace registration (Phase 5) ===
  SCADA.UI.AlarmBanner = {
    render: renderAlarmBanner,
    ack: ackAlarm,
    refreshTimer
  };

  console.log("✅ SCADA.UI.AlarmBanner registered (Phase 5)");
})(window.SCADA = window.SCADA || { Core:{}, Symbols:{}, UI:{}, State:{} }, window);
/* ================= ALARM BANNER NAMESPACE END ================= */

