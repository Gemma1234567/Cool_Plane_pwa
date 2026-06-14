let map;
let userMarker;
let planeMarkers = {};
let monitoring = false;
let checkInterval = null;
let userLocation = null;
let watchlist = [];
let radius = 20;
let alreadyAlerted = new Set();

const EMAILJS_SERVICE_ID  = "service_fz9beef";
const EMAILJS_TEMPLATE_ID = "template_kosubwo";
const EMAILJS_PUBLIC_KEY  = "0WY6kEh21_wLqvc6T";

function initMap() {
  map = L.map("map", { center: [51.5, -0.5], zoom: 9, zoomControl: true });
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "© OpenStreetMap contributors",
    maxZoom: 18
  }).addTo(map);
}

function detectLocation() {
  navigator.geolocation.getCurrentPosition((position) => {
    userLocation = { lat: position.coords.latitude, lon: position.coords.longitude };
    localStorage.setItem("location", JSON.stringify(userLocation));
    document.getElementById("location-display").textContent =
      `📍 ${userLocation.lat.toFixed(4)}, ${userLocation.lon.toFixed(4)}`;
    map.setView([userLocation.lat, userLocation.lon], 10);
    if (userMarker) {
      userMarker.setLatLng([userLocation.lat, userLocation.lon]);
    } else {
      userMarker = L.marker([userLocation.lat, userLocation.lon], {
        icon: L.divIcon({ className: "", html: "📍", iconSize: [24, 24], iconAnchor: [12, 24] })
      }).addTo(map).bindPopup("You are here!");
    }
  }, (err) => {
    console.error("Location error:", err);
    alert("Couldn't get location. Please allow location access!");
  });
}

async function getAircraftType(icao) {
  try {
    const r = await fetch(`https://api.adsbdb.com/v0/aircraft/${icao}`);
    if (!r.ok) return "Unknown aircraft";
    const json = await r.json();
    if (json.response && json.response.aircraft) {
      const ac = json.response.aircraft;
      return `${ac.manufacturer || ""} ${ac.type || ""}`.trim() || "Unknown aircraft";
    }
    return "Unknown aircraft";
  } catch (err) {
    return "Unknown aircraft";
  }
}

function getDistanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat/2)*Math.sin(dLat/2) +
            Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)*Math.sin(dLon/2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function toRad(deg) { return deg * (Math.PI / 180); }

function getBearing(lat1, lon1, lat2, lon2) {
  const dLon = toRad(lon2 - lon1);
  const y = Math.sin(dLon) * Math.cos(toRad(lat2));
  const x = Math.cos(toRad(lat1))*Math.sin(toRad(lat2)) -
            Math.sin(toRad(lat1))*Math.cos(toRad(lat2))*Math.cos(dLon);
  return ((Math.atan2(y, x) * (180/Math.PI)) + 360) % 360;
}

function isInteresting(callsign) {
  if (!watchlist || watchlist.length === 0) return true;
  const cs = (callsign || "").toLowerCase();
  return watchlist.some(term => cs.includes(term.toLowerCase()));
}

function updateMapMarkers(states) {
  const currentCallsigns = new Set();
  for (const state of states) {
    const callsign  = (state[1] || "").trim();
    const longitude = state[5];
    const latitude  = state[6];
    const trueTrack = state[10];
    if (!latitude || !longitude || !callsign) continue;
    currentCallsigns.add(callsign);
    const interesting = isInteresting(callsign);
    const icon = L.divIcon({
      className: "",
      html: `<div class="plane-marker ${interesting ? "interesting" : ""}" style="transform:rotate(${trueTrack||0}deg)">✈️</div>`,
      iconSize: [24, 24],
      iconAnchor: [12, 12]
    });
    if (planeMarkers[callsign]) {
      planeMarkers[callsign].setLatLng([latitude, longitude]);
      planeMarkers[callsign].setIcon(icon);
    } else {
      const marker = L.marker([latitude, longitude], { icon })
        .addTo(map).bindPopup(`<b>${callsign}</b><br>Loading details...`);
      marker.on("click", async () => {
        const icao = (state[0] || "").trim();
        const type = await getAircraftType(icao);
        const dist = userLocation ? Math.round(getDistanceKm(userLocation.lat, userLocation.lon, latitude, longitude)) : "?";
        const alt  = state[7] ? Math.round(state[7] * 3.281) + "ft" : "unknown";
        const spd  = state[9] ? Math.round(state[9] * 2.237) + "mph" : "unknown";
        marker.setPopupContent(`<b>${callsign}</b><br>${type}<br>${dist}km away<br>${alt} · ${spd}`);
      });
      planeMarkers[callsign] = marker;
    }
  }
  for (const callsign in planeMarkers) {
    if (!currentCallsigns.has(callsign)) {
      map.removeLayer(planeMarkers[callsign]);
      delete planeMarkers[callsign];
    }
  }
  document.getElementById("plane-count").textContent =
    `${currentCallsigns.size} plane${currentCallsigns.size !== 1 ? "s" : ""}`;
}

async function sendEmailAlert(callsign, aircraftType, distance, altFt, speedMph, etaString) {
  await fetch("https://api.emailjs.com/api/v1.0/email/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      service_id: EMAILJS_SERVICE_ID,
      template_id: EMAILJS_TEMPLATE_ID,
      user_id: EMAILJS_PUBLIC_KEY,
      template_params: {
        callsign, aircraft_type: aircraftType,
        distance: Math.round(distance), altitude: altFt,
        speed: speedMph, eta: etaString,
        time: new Date().toLocaleTimeString()
      }
    })
  });
}

function addAlertToLog(callsign, aircraftType, distance, etaString) {
  const log = document.getElementById("alerts-log");
  const placeholder = log.querySelector("p");
  if (placeholder) placeholder.remove();
  const item = document.createElement("div");
  item.className = "alert-item";
  item.innerHTML = `
    <div class="alert-title">✈️ ${callsign} — ${aircraftType}</div>
    <div class="alert-detail">${Math.round(distance)}km away · ${etaString}<br>${new Date().toLocaleTimeString()}</div>
  `;
  log.insertBefore(item, log.firstChild);
}

async function checkForPlanes() {
  if (!userLocation) return;
  const deg   = radius / 111;
  const lamin = userLocation.lat - deg;
  const lamax = userLocation.lat + deg;
  const lomin = userLocation.lon - deg;
  const lomax = userLocation.lon + deg;
  try {
    const url = `https://opensky-network.org/api/states/all?lamin=${lamin}&lomin=${lomin}&lamax=${lamax}&lomax=${lomax}`;
    const response = await fetch(url);
    if (!response.ok) return;
    const json = await response.json();
    if (!json.states) return;
    updateMapMarkers(json.states);
    for (const state of json.states) {
      const icao      = (state[0] || "").trim();
      const callsign  = (state[1] || "").trim();
      const longitude = state[5];
      const latitude  = state[6];
      const altitude  = state[7];
      const velocity  = state[9];
      const trueTrack = state[10];
      if (!latitude || !longitude) continue;
      if (alreadyAlerted.has(callsign)) continue;
      if (!isInteresting(callsign)) continue;
      const distance = getDistanceKm(userLocation.lat, userLocation.lon, latitude, longitude);
      if (distance <= radius) {
        alreadyAlerted.add(callsign);
        const altFt    = altitude ? Math.round(altitude * 3.281) : "unknown";
        const speedMph = velocity ? Math.round(velocity * 2.237) : "unknown";
        const speedKmh = velocity ? velocity * 3.6 : null;
        let etaString = "not heading your way";
        if (speedKmh && trueTrack !== null) {
          const bearingToUs = getBearing(latitude, longitude, userLocation.lat, userLocation.lon);
          const headingDiff = Math.abs(((trueTrack - bearingToUs + 180) % 360) - 180);
          if (headingDiff <= 45) {
            const mins = Math.round((distance / speedKmh) * 60);
            etaString = `~${mins} min until overhead`;
          }
        }
        const aircraftType = icao ? await getAircraftType(icao) : "Unknown aircraft";
        if (Notification.permission === "granted") {
          new Notification(`✈️ ${aircraftType}`, {
            body: `${callsign} — ${Math.round(distance)}km away (${etaString})`,
            icon: "/icon.png"
          });
        }
        await sendEmailAlert(callsign, aircraftType, distance, altFt, speedMph, etaString);
        addAlertToLog(callsign, aircraftType, distance, etaString);
      }
    }
  } catch (err) {
    console.error("checkForPlanes error:", err);
  }
}

function startMonitoring() {
  monitoring = true;
  document.getElementById("status-dot").classList.add("active");
  document.getElementById("btn-toggle").textContent = "Stop Monitoring";
  if (Notification.permission === "default") Notification.requestPermission();
  checkForPlanes();
  checkInterval = setInterval(checkForPlanes, 30000);
  setInterval(() => alreadyAlerted.clear(), 10 * 60 * 1000);
}

function stopMonitoring() {
  monitoring = false;
  document.getElementById("status-dot").classList.remove("active");
  document.getElementById("btn-toggle").textContent = "Start Monitoring";
  clearInterval(checkInterval);
  checkInterval = null;
}

function addWatchlistTag(name) {
  const tag = document.createElement("span");
  tag.className = "tag";
  tag.textContent = name;
  const removeBtn = document.createElement("button");
  removeBtn.textContent = "×";
  removeBtn.addEventListener("click", () => {
    tag.remove();
    watchlist = watchlist.filter(item => item !== name);
    localStorage.setItem("watchlist", JSON.stringify(watchlist));
  });
  tag.appendChild(removeBtn);
  document.getElementById("watchlist").appendChild(tag);
}

function loadSettings() {
  const savedLocation  = localStorage.getItem("location");
  const savedRadius    = localStorage.getItem("radius");
  const savedWatchlist = localStorage.getItem("watchlist");
  if (savedLocation) {
    userLocation = JSON.parse(savedLocation);
    document.getElementById("location-display").textContent =
      `📍 ${userLocation.lat.toFixed(4)}, ${userLocation.lon.toFixed(4)}`;
    map.setView([userLocation.lat, userLocation.lon], 10);
  }
  if (savedRadius) {
    radius = parseFloat(savedRadius);
    document.getElementById("radius").value = savedRadius;
  }
  if (savedWatchlist) {
    watchlist = JSON.parse(savedWatchlist);
    watchlist.forEach(item => addWatchlistTag(item));
  }
}

document.addEventListener("DOMContentLoaded", () => {
  initMap();
  loadSettings();

  document.getElementById("btn-locate").addEventListener("click", detectLocation);

  document.getElementById("radius").addEventListener("change", (e) => {
    radius = parseFloat(e.target.value);
    localStorage.setItem("radius", e.target.value);
  });

  document.getElementById("btn-add").addEventListener("click", () => {
    const name = document.getElementById("input-aircraft").value.trim();
    if (!name || watchlist.includes(name)) return;
    watchlist.push(name);
    localStorage.setItem("watchlist", JSON.stringify(watchlist));
    addWatchlistTag(name);
    document.getElementById("input-aircraft").value = "";
  });

  document.getElementById("input-aircraft").addEventListener("keydown", (e) => {
    if (e.key === "Enter") document.getElementById("btn-add").click();
  });

  document.getElementById("btn-toggle").addEventListener("click", () => {
    if (monitoring) {
      stopMonitoring();
    } else {
      if (!userLocation) { alert("Please set your location first!"); return; }
      startMonitoring();
    }
  });

  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
      document.querySelectorAll(".tab-content").forEach(c => c.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById(`tab-${btn.dataset.tab}`).classList.add("active");
    });
  });
});
