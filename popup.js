document.addEventListener("DOMContentLoaded", () => {
  const inputLat          = document.getElementById("input-lat");
  const inputLon          = document.getElementById("input-lon");
  const btnSaveLocation   = document.getElementById("btn-save-location");
  const btnFindCoords     = document.getElementById("btn-find-coords");
  const locationDisplay   = document.getElementById("location-display");
  const radiusSelect      = document.getElementById("radius");
  const watchlistDiv      = document.getElementById("watchlist");
  const inputAircraft     = document.getElementById("input-aircraft");
  const btnAddAircraft    = document.getElementById("btn-add-aircraft");
  const statusDisplay     = document.getElementById("status-display");
  const btnToggle         = document.getElementById("btn-toggle");

  // Load saved settings
  chrome.storage.local.get(["location", "radius", "watchlist", "monitoring"], (data) => {
    if (data.location) {
      inputLat.value = data.location.lat;
      inputLon.value = data.location.lon;
      locationDisplay.textContent = `📍 Saved: ${data.location.lat}, ${data.location.lon}`;
    }
    if (data.radius) {
      radiusSelect.value = data.radius;
    }
    if (data.watchlist) {
      data.watchlist.forEach(item => addWatchlistTag(item));
    }
    if (data.monitoring) {
      statusDisplay.textContent = "👀 Monitoring active!";
      statusDisplay.className = "active";
      btnToggle.textContent = "Stop Monitoring";
    }
  });

  // Save location manually
  btnSaveLocation.addEventListener("click", () => {
    const lat = parseFloat(inputLat.value.trim());
    const lon = parseFloat(inputLon.value.trim());

    if (isNaN(lat) || isNaN(lon)) {
      locationDisplay.textContent = "⚠️ Please enter valid numbers!";
      return;
    }

    chrome.storage.local.set({ location: { lat, lon } });
    locationDisplay.textContent = `📍 Saved: ${lat}, ${lon}`;
  });

  // Open Google Maps so user can find their coords
  // chrome.tabs.create opens a new tab from the extension
  btnFindCoords.addEventListener("click", () => {
    chrome.tabs.create({ url: "https://www.google.com/maps" });
  });

  radiusSelect.addEventListener("change", () => {
    chrome.storage.local.set({ radius: radiusSelect.value });
  });

  btnAddAircraft.addEventListener("click", () => {
    const name = inputAircraft.value.trim();
    if (!name) return;
    chrome.storage.local.get(["watchlist"], (data) => {
      const current = data.watchlist || [];
      if (current.includes(name)) return;
      const updated = [...current, name];
      chrome.storage.local.set({ watchlist: updated });
      addWatchlistTag(name);
      inputAircraft.value = "";
    });
  });

  inputAircraft.addEventListener("keydown", (e) => {
    if (e.key === "Enter") btnAddAircraft.click();
  });

  function addWatchlistTag(name) {
    const tag = document.createElement("span");
    tag.textContent = name;
    tag.className = "tag";
    const removeBtn = document.createElement("button");
    removeBtn.textContent = "×";
    removeBtn.addEventListener("click", () => {
      tag.remove();
      chrome.storage.local.get(["watchlist"], (data) => {
        const updated = (data.watchlist || []).filter(item => item !== name);
        chrome.storage.local.set({ watchlist: updated });
      });
    });
    tag.appendChild(removeBtn);
    watchlistDiv.appendChild(tag);
  }

  btnToggle.addEventListener("click", () => {
    chrome.storage.local.get(["monitoring"], (data) => {
      const nowMonitoring = !data.monitoring;
      chrome.storage.local.set({ monitoring: nowMonitoring });
      if (nowMonitoring) {
        statusDisplay.textContent = "👀 Monitoring active!";
        statusDisplay.className = "active";
        btnToggle.textContent = "Stop Monitoring";
        chrome.runtime.sendMessage({ action: "start" });
      } else {
        statusDisplay.textContent = "Monitoring off";
        statusDisplay.className = "";
        btnToggle.textContent = "Start Monitoring";
        chrome.runtime.sendMessage({ action: "stop" });
      }
    });
  });
});
