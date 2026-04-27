/**
 * RouteWise – script.js
 * Firebase Realtime Database (no backend needed)
 */

// Firebase config
const firebaseConfig = {
  apiKey:            "AIzaSyANTwFLwHF0Ej0--OatJ0QeuBn5pv80HYA",
  authDomain:        "routewise-tracking.firebaseapp.com",
  databaseURL:       "https://routewise-tracking-default-rtdb.firebaseio.com",
  projectId:         "routewise-tracking",
  storageBucket:     "routewise-tracking.firebasestorage.app",
  messagingSenderId: "817860760901",
  appId:             "1:817860760901:web:836cda877137cfeaa9da2c"
};

// Initialize Firebase (using CDN compat SDK loaded in HTML)
firebase.initializeApp(firebaseConfig);
const db = firebase.database();

/* ═══════════════════════════════════════════════
   SHARED UTILITIES
═══════════════════════════════════════════════ */

function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span>${message}</span>`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(60px)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

function formatTime(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

/* ═══════════════════════════════════════════════
   DRIVER PAGE
═══════════════════════════════════════════════ */

let watchId      = null;
let sendInterval = null;
let currentCoords = null;
let updateCount  = 0;

function startTracking() {
  const numberPlate = document.getElementById('numberPlate')?.value.trim().toUpperCase();
  const origin      = document.getElementById('origin')?.value.trim();
  const destination = document.getElementById('destination')?.value.trim();

  if (!numberPlate || !origin || !destination) {
    showToast('Please fill in all fields.', 'error');
    return;
  }

  if (!navigator.geolocation) {
    showToast('Geolocation not supported by your browser.', 'error');
    return;
  }

  document.getElementById('summaryPlate').textContent  = numberPlate;
  document.getElementById('summaryOrigin').textContent = origin;
  document.getElementById('summaryDest').textContent   = destination;
  document.getElementById('summaryStatus').textContent = 'In Transit';

  // Watch GPS position
  watchId = navigator.geolocation.watchPosition(
    (pos) => {
      currentCoords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      updateLiveUI(currentCoords);
    },
    (err) => {
      showToast('Location error: ' + err.message, 'error');
      stopTracking();
    },
    { enableHighAccuracy: true, maximumAge: 3000, timeout: 10000 }
  );

  // Push to Firebase every 5 seconds
  sendInterval = setInterval(() => {
    if (currentCoords) {
      const key = numberPlate.replace(/[.#$[\]]/g, '_');
      db.ref('trucks/' + key).set({
        number_plate: numberPlate,
        origin,
        destination,
        latitude:   currentCoords.lat,
        longitude:  currentCoords.lng,
        updated_at: Date.now()
      });
      updateCount++;
      const countEl = document.getElementById('sendCount');
      if (countEl) countEl.textContent = `Updates sent: ${updateCount}`;
    }
  }, 5000);

  // Update UI
  document.getElementById('startBtn').style.display = 'none';
  document.getElementById('liveCard').classList.add('visible');

  const badge = document.getElementById('statusBadge');
  if (badge) {
    badge.className = 'status-badge active';
    badge.innerHTML = '<span class="status-dot"></span> Live';
  }

  showToast('Tracking started. Sending location every 5s.', 'success');
}

function updateLiveUI(coords) {
  const latEl = document.getElementById('liveLat');
  const lngEl = document.getElementById('liveLng');
  if (latEl) latEl.textContent = coords.lat.toFixed(6);
  if (lngEl) lngEl.textContent = coords.lng.toFixed(6);
  document.getElementById('summaryCoords').textContent =
    `${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}`;
  document.getElementById('summaryTime').textContent = new Date().toLocaleTimeString();
}

function stopTracking() {
  if (watchId !== null) { navigator.geolocation.clearWatch(watchId); watchId = null; }
  if (sendInterval !== null) { clearInterval(sendInterval); sendInterval = null; }

  document.getElementById('liveCard').classList.remove('visible');
  document.getElementById('startBtn').style.display = 'flex';

  const badge = document.getElementById('statusBadge');
  if (badge) {
    badge.className = 'status-badge inactive';
    badge.innerHTML = '<span class="status-dot"></span> Offline';
  }

  document.getElementById('summaryStatus').textContent = 'Stopped';
  updateCount = 0;
  showToast('Tracking stopped.', 'info');
}

/* ═══════════════════════════════════════════════
   TRACKER PAGE
═══════════════════════════════════════════════ */

let map           = null;
let truckMarker   = null;
let originMarker  = null;
let destMarker    = null;
let routeLine     = null;
let liveListener  = null;

function truckIcon() {
  return L.divIcon({
    className: '',
    html: `<div style="
      background:#3b82f6;border:3px solid #fff;border-radius:50%;
      width:36px;height:36px;display:flex;align-items:center;
      justify-content:center;font-size:13px;font-weight:700;color:#fff;
      box-shadow:0 2px 8px rgba(59,130,246,0.5);">T</div>`,
    iconSize: [36, 36],
    iconAnchor: [18, 18]
  });
}

function pinIcon(color) {
  return L.divIcon({
    className: '',
    html: `<div style="background:${color};border:3px solid #fff;border-radius:50%;
      width:18px;height:18px;box-shadow:0 2px 6px rgba(0,0,0,0.3);"></div>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9]
  });
}

function initMap(lat, lng) {
  if (!map) {
    map = L.map('map').setView([lat, lng], 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19
    }).addTo(map);
  }
}

async function geocode(place) {
  try {
    const res  = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(place)}&limit=1`,
      { headers: { 'Accept-Language': 'en' } }
    );
    const data = await res.json();
    if (data.length > 0) return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
  } catch (e) { /* ignore */ }
  return null;
}

function trackTruck() {
  const plate = document.getElementById('trackPlate')?.value.trim().toUpperCase();
  if (!plate) { showToast('Please enter a number plate.', 'error'); return; }

  // Detach any previous listener
  if (liveListener) liveListener.off();

  const key = plate.replace(/[.#$[\]]/g, '_');
  const ref = db.ref('trucks/' + key);

  document.getElementById('trackBtnText').textContent = 'Searching...';
  document.getElementById('trackBtn').disabled = true;

  // Listen for real-time updates
  ref.on('value', async (snapshot) => {
    document.getElementById('trackBtnText').textContent = 'Track';
    document.getElementById('trackBtn').disabled = false;

    const data = snapshot.val();
    if (!data) {
      showToast('Truck not found. Start tracking from the driver page first.', 'error');
      return;
    }
    await renderTruckData(data);
  });

  liveListener = ref;
}

async function renderTruckData(data) {
  document.getElementById('truckInfoSection').style.display = 'block';
  document.getElementById('emptyState').style.display       = 'none';

  document.getElementById('tPlate').textContent  = data.number_plate || '—';
  document.getElementById('tOrigin').textContent = data.origin        || '—';
  document.getElementById('tDest').textContent   = data.destination   || '—';
  document.getElementById('tLat').textContent    = parseFloat(data.latitude).toFixed(6);
  document.getElementById('tLng').textContent    = parseFloat(data.longitude).toFixed(6);

  const lat = parseFloat(data.latitude);
  const lng = parseFloat(data.longitude);

  initMap(lat, lng);

  const newLatLng = L.latLng(lat, lng);
  if (truckMarker) {
    smoothMoveTo(truckMarker, newLatLng);
  } else {
    truckMarker = L.marker(newLatLng, { icon: truckIcon(), zIndexOffset: 1000 })
      .addTo(map)
      .bindPopup(`<b>${data.number_plate}</b><br>In Transit`)
      .openPopup();
  }

  map.setView(newLatLng, map.getZoom() < 10 ? 12 : map.getZoom());

  if (data.origin && data.destination) {
    const [oCoords, dCoords] = await Promise.all([
      geocode(data.origin),
      geocode(data.destination)
    ]);

    if (oCoords) {
      if (originMarker) originMarker.setLatLng([oCoords.lat, oCoords.lng]);
      else originMarker = L.marker([oCoords.lat, oCoords.lng], { icon: pinIcon('#22c55e') })
        .addTo(map).bindPopup(`<b>Origin</b><br>${data.origin}`);
    }

    if (dCoords) {
      if (destMarker) destMarker.setLatLng([dCoords.lat, dCoords.lng]);
      else destMarker = L.marker([dCoords.lat, dCoords.lng], { icon: pinIcon('#ef4444') })
        .addTo(map).bindPopup(`<b>Destination</b><br>${data.destination}`);
    }

    if (oCoords && dCoords) {
      const points = [[oCoords.lat, oCoords.lng], [lat, lng], [dCoords.lat, dCoords.lng]];
      if (routeLine) routeLine.setLatLngs(points);
      else routeLine = L.polyline(points, {
        color: '#3b82f6', weight: 4, opacity: 0.75, dashArray: '8, 6'
      }).addTo(map);

      map.fitBounds(L.latLngBounds(points), { padding: [40, 40] });
    }
  }

  const label = document.getElementById('lastRefreshLabel');
  if (label) label.textContent = `Last updated: ${formatTime(data.updated_at)}`;
}

function smoothMoveTo(marker, newLatLng) {
  const start = marker.getLatLng();
  const frames = 20;
  let frame = 0;
  const timer = setInterval(() => {
    frame++;
    const t = frame / frames;
    marker.setLatLng([
      start.lat + (newLatLng.lat - start.lat) * t,
      start.lng + (newLatLng.lng - start.lng) * t
    ]);
    if (frame >= frames) clearInterval(timer);
  }, 30);
}
