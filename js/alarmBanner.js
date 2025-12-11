/* ================= ALARM BANNER NAMESPACE START ================= */
; (function (SCADA, global) {
  // ensure namespace exists
  SCADA.UI = SCADA.UI || {};

  // -----------------------------------------------------------------------------
  // Render alarm banner and counters
  // -----------------------------------------------------------------------------
  function renderAlarmBanner(alarms) {
    try {
      // --- Counter logic ---
      const unack = alarms.filter(a => !a.ack && (a.state === "Active" || a.state === "Cleared") && a.crit > 0);
      const all = alarms.filter(a => a.crit > 0);

      document.getElementById("unackTotal").innerText = unack.length;
      document.getElementById("unackSuper").innerText = unack.filter(a => a.crit === 3).length;
      document.getElementById("unackCritical").innerText = unack.filter(a => a.crit === 2).length;
      document.getElementById("unackWarning").innerText = unack.filter(a => a.crit === 1).length;

      document.getElementById("allTotal").innerText = all.length;
      document.getElementById("allSuper").innerText = all.filter(a => a.crit === 3).length;
      document.getElementById("allCritical").innerText = all.filter(a => a.crit === 2).length;
      document.getElementById("allWarning").innerText = all.filter(a => a.crit === 1).length;

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

          const key = `${(a.loc || "").toUpperCase()}-${(a.sys || "").toUpperCase()}-${(a.label || "").toUpperCase()}`;
          global.__highlightEquipKey = key;

          fetch(`/api/navigation/lookup?tag=${key}`)
            .then(res => res.json())
            .then(data => {
              if (data.files && data.files.length === 1) {
                if (typeof SCADA?.UI?.selectMimicFile === "function") {
                  SCADA.UI.selectMimicFile(data.files[0]);
                }
              } else if (data.files && data.files.length > 1) {
                showNavigationMenu(data.files, e.pageX, e.pageY);
              } else {
                if (typeof SCADA?.UI?.selectSystem === "function") {
                  SCADA.State.currentLocation = (a.loc || "").toUpperCase();
                  SCADA.UI.selectSystem((a.sys || "").toUpperCase());
                }
              }
            })
            .catch(err => {
              console.error("Banner nav lookup failed:", err);
              if (typeof SCADA?.UI?.selectSystem === "function") {
                SCADA.State.currentLocation = (a.loc || "").toUpperCase();
                SCADA.UI.selectSystem((a.sys || "").toUpperCase());
              }
            });
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

  // --- Helper for Multiple Matches ---
  function showNavigationMenu(files, x, y) {
    const menu = document.createElement('div');
    menu.style.position = 'fixed';
    // Adjust Y to appear ABOVE the cursor since banner is at bottom
    menu.style.left = x + 'px';
    menu.style.bottom = (window.innerHeight - y) + 'px';
    menu.style.top = 'auto'; // override default
    menu.style.background = '#fff';
    menu.style.border = '1px solid #ccc';
    menu.style.boxShadow = '0 2px 10px rgba(0,0,0,0.2)';
    menu.style.zIndex = '9999';
    menu.style.padding = '5px 0';
    menu.style.minWidth = '150px';

    const title = document.createElement('div');
    title.textContent = "Select Page:";
    title.style.padding = '4px 10px';
    title.style.fontWeight = 'bold';
    title.style.background = '#eee';
    menu.appendChild(title);

    files.forEach(file => {
      const item = document.createElement('div');
      item.textContent = file;
      item.style.padding = '6px 10px';
      item.style.cursor = 'pointer';
      item.onmouseover = () => item.style.background = '#f0f0f0';
      item.onmouseout = () => item.style.background = '#fff';
      item.onclick = () => {
        if (typeof SCADA?.UI?.selectMimicFile === "function") {
          SCADA.UI.selectMimicFile(file);
        }
        menu.remove();
      };
      menu.appendChild(item);
    });

    document.body.appendChild(menu);

    // Close on outside click
    setTimeout(() => {
      document.addEventListener('click', function closeMenu(e) {
        if (!menu.contains(e.target)) {
          menu.remove();
          document.removeEventListener('click', closeMenu);
        }
      });
    }, 100);
  }

  // -----------------------------------------------------------------------------
  // Acknowledge single alarm
  // -----------------------------------------------------------------------------
  function ackAlarm(tag, loc) {
    fetch("/api/alarms/ack", {
      method: "POST",
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
})(window.SCADA = window.SCADA || { Core: {}, Symbols: {}, UI: {}, State: {} }, window);
/* ================= ALARM BANNER NAMESPACE END ================= */
