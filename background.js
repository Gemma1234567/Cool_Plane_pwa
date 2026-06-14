const EMAILJS_SERVICE_ID = "service_fz9beef";
const EMAILJS_TEMPLATE_ID = "template_kosubwo";
const EMAILJS_PUBLIC_KEY = "0WY6kEh21_wLqvc6T";

function getDistanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toRad(deg) {
  return deg * (Math.PI / 180);
}

function isInteresting(callsign, watchlist) {
  if (!watchlist || watchlist.length === 0) return true;
  const cs = (callsign || "").toLowerCase();
  return watchlist.some(term => cs.includes(term.toLowerCase()));
}

// Look up the aircraft model/type using its ICAO hex code (state[0] from OpenSky)
async function getAircraftType(icao) {
  try {
    const r = await fetch(`https://api.adsbdb.com/v0/aircraft/${icao}`);
    if (!r.ok) return "Unknown aircraft";
    const json = await r.json();
    if (json.response && json.response.aircraft) {
      const ac = json.response.aircraft;
      // Combine manufacturer + type if available, e.g. "Boeing 747-400"
      const manufacturer = ac.manufacturer || "";
      const type = ac.type || "";
      const combined = `${manufacturer} ${type}`.trim();
      return combined || "Unknown aircraft";
    }
    return "Unknown aircraft";
  } catch (err) {
    return "Unknown aircraft";
  }
}

const alreadyAlerted = new Set();

async function checkForPlanes() {
  const data = await new Promise(resolve => {
    chrome.storage.local.get(["location", "radius", "watchlist", "monitoring"], resolve);
  });

  if (!data.monitoring || !data.location) return;

  const { lat, lon } = data.location;
  const radius = parseFloat(data.radius || 20);
  const watchlist = data.watchlist || [];

  const deg = radius / 111;
  const lamin = lat - deg;
  const lamax = lat + deg;
  const lomin = lon - deg;
  const lomax = lon + deg;

  try {
    const url = `https://opensky-network.org/api/states/all?lamin=${lamin}&lomin=${lomin}&lamax=${lamax}&lomax=${lomax}`;
    const response = await fetch(url);
    if (!response.ok) return;

    const json = await response.json();
    if (!json.states) return;

    for (const state of json.states) {
      const icao      = (state[0] || "").trim();   // position 0 = ICAO24 hex code, used to look up aircraft type
      const callsign  = (state[1] || "").trim();
      const longitude = state[5];
      const latitude  = state[6];
      const altitude  = state[7];
      const velocity  = state[9];
      const trueTrack = state[10];                  // position 10 = heading in degrees (0 = North)

      if (!latitude || !longitude) continue;
      if (alreadyAlerted.has(callsign)) continue;
      if (!isInteresting(callsign, watchlist)) continue;

      const distance = getDistanceKm(lat, lon, latitude, longitude);

      if (distance <= radius) {
        alreadyAlerted.add(callsign);

        const altFt = altitude ? Math.round(altitude * 3.281) : "unknown";
        const speedMph = velocity ? Math.round(velocity * 2.237) : "unknown";
        const speedKmh = velocity ? velocity * 3.6 : null;

        // Better ETA: only meaningful if the plane is actually heading roughly towards us.
        // We work out the bearing FROM the plane TO our location, then compare it
        // to the plane's heading (trueTrack). If they're close, it's heading our way.
        let etaMinutes = null;
        if (speedKmh && trueTrack !== null && trueTrack !== undefined) {
          const bearingToUs = getBearing(latitude, longitude, lat, lon);
          const headingDiff = Math.abs(((trueTrack - bearingToUs + 180) % 360) - 180);

          // Within 45 degrees = roughly heading towards us
          if (headingDiff <= 45) {
            etaMinutes = Math.round((distance / speedKmh) * 60);
          }
        }

        const etaString = etaMinutes !== null
          ? `~${etaMinutes} min until overhead`
          : "not heading directly your way";

        // Look up the aircraft type (separate API call)
        const aircraftType = icao ? await getAircraftType(icao) : "Unknown aircraft";

        // Send email via EmailJS
        await fetch("https://api.emailjs.com/api/v1.0/email/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            service_id: EMAILJS_SERVICE_ID,
            template_id: EMAILJS_TEMPLATE_ID,
            user_id: EMAILJS_PUBLIC_KEY,
            template_params: {
              callsign: callsign || "Unknown",
              aircraft_type: aircraftType,
              distance: Math.round(distance),
              altitude: altFt,
              speed: speedMph,
              eta: etaString,
              time: new Date().toLocaleTimeString()
            }
          })
        });

        // Fire browser notification
        chrome.notifications.create(`plane-${callsign}-${Date.now()}`, {
          type: "basic",
          iconUrl: "icon.png",
          title: `✈️ ${aircraftType}`,
          message: `${callsign || "Unknown"} — ${Math.round(distance)}km away, ${altFt}ft, ${speedMph}mph (${etaString})`,
          priority: 2
        });
      }
    }
  } catch (err) {
    console.error("Cool Plane Alert error:", err);
  }
}

// Calculate the compass bearing FROM point 1 TO point 2 (in degrees, 0-360)
function getBearing(lat1, lon1, lat2, lon2) {
  const dLon = toRad(lon2 - lon1);
  const y = Math.sin(dLon) * Math.cos(toRad(lat2));
  const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
            Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLon);
  const bearing = Math.atan2(y, x) * (180 / Math.PI);
  return (bearing + 360) % 360;
}

setInterval(() => {
  alreadyAlerted.clear();
}, 10 * 60 * 1000);

chrome.alarms.create("checkPlanes", { periodInMinutes: 1 });

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "checkPlanes") checkForPlanes();
});

chrome.runtime.onMessage.addListener((message) => {
  if (message.action === "start") checkForPlanes();
});
