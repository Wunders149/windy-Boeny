// --- Localisation / Traductions (fr par défaut, support de base pour mg) ---
const LANG = 'fr'; // change to 'mg' to test Malagasy
const TEXT = {
    fr: {
    tryingCdn: "Tentative de chargement du CDN alternatif pour leaflet-velocity…",
    allCdnFailed: "Tous les CDN ont échoué — utilisation de la visualisation personnalisée des vents",
    detailedError: "Erreur détaillée:",
    cacheReadFailed: "Lecture du cache échouée",
    cacheWriteFailed: "Échec de l'écriture du cache",
    pointFetchError: "Erreur lors de la récupération d'un point",
    windData: "Données vent:",
    maxVelocity: "Vitesse max:",
    velocityAdded: "Couche vent ajoutée à la carte",
    velocityFailed: "La couche velocity a échoué:",
    usingCustom: "Utilisation de la visualisation de secours (personnalisée)",
    tryingAltCdn: "Essai d'un CDN alternatif pour leaflet-velocity…"
    },
    mg: {
    tryingCdn: "Miezaka mampakatra CDN hafa ho an'ny leaflet-velocity…",
    allCdnFailed: "Tsy nahomby ny CDN rehetra — mampiasa sary rivotra mahazatra",
    detailedError: "Lesona fahadisoana:",
    cacheReadFailed: "Tsy afaka namaky ny cache",
    cacheWriteFailed: "Tsy afaka nanoratra ny cache",
    pointFetchError: "Diso tamin'ny fakana teboka",
    windData: "Angon'ny rivotra:",
    maxVelocity: "Hafainganam-pandeha ambony indrindra:",
    velocityAdded: "Nampiana sarimihetsika rivotra tamin'ny sarintany",
    velocityFailed: "Tsy nety ny sosona velocity:",
    usingCustom: "Mampiasa fomba fijery hafa (compatibilité)"
    }
};
function t(key) { return (TEXT[LANG] && TEXT[LANG][key]) || key; }
// --- end localisation ---

// Fallback function to load velocity library from alternative sources
function loadVelocityFallback() {
    console.log(t('tryingCdn'));
    const script = document.createElement('script');
    script.src = 'https://unpkg.com/leaflet-velocity@1.4.1/dist/leaflet-velocity.min.js';
    script.onerror = function() {
    console.log(t('allCdnFailed'));
    window.velocityLibraryFailed = true;
    };
    document.head.appendChild(script);
}

// Custom wind visualization when velocity library is not available
function createCustomWindLayer(windData, maxVelocity, options = {}) {
    if (!windData || windData.length < 2) return null;
    const uData = windData[0].data || [];
    const vData = windData[1].data || [];
    const header = windData[0].header || {};

    const particleMultiplier = options.particleMultiplier ?? 1 / 200; // controls particle count relative to canvas area
    const maxParticles = options.maxParticles ?? 2000;
    const sampleStep = Math.max(1, options.sampleStep ?? 1); // use all points by default; set >1 to skip for perf
    const fadeAlpha = options.fadeAlpha ?? 0.03;
    const speedScale = options.speedScale ?? 1.0;

    // bilinear sample of (u,v) given lat,lon
    function sampleUV(lat, lon) {
    const la1 = Number(header.la1);
    const lo1 = Number(header.lo1);
    const dx = Number(header.dx) || 0.01;
    const dy = Number(header.dy) || -0.01; // may be negative
    const nx = Number(header.nx) || Math.sqrt(uData.length) || 1;
    const ny = Number(header.ny) || Math.sqrt(uData.length) || 1;

    const rowF = (la1 - lat) / Math.abs(dy);
    const colF = (lon - lo1) / dx;
    const r0 = Math.floor(rowF), c0 = Math.floor(colF);
    const r1 = Math.min(ny - 1, r0 + 1), c1 = Math.min(nx - 1, c0 + 1);
    const fr = rowF - r0, fc = colF - c0;
    function get(arr, r, c) {
        const idx = (r * nx + c);
        return arr[idx] ?? 0;
    }
    const u00 = get(uData, r0, c0), u10 = get(uData, r0, c1), u01 = get(uData, r1, c0), u11 = get(uData, r1, c1);
    const v00 = get(vData, r0, c0), v10 = get(vData, r0, c1), v01 = get(vData, r1, c0), v11 = get(vData, r1, c1);
    const u0 = u00 * (1 - fc) + u10 * fc;
    const u1 = u01 * (1 - fc) + u11 * fc;
    const v0 = v00 * (1 - fc) + v10 * fc;
    const v1 = v01 * (1 - fc) + v11 * fc;
    const u = u0 * (1 - fr) + u1 * fr;
    const v = v0 * (1 - fr) + v1 * fr;
    return { u, v };
    }

    const CanvasOverlay = L.Layer.extend({
    initialize: function (opts) {
        L.setOptions(this, opts);
        this._canvas = document.createElement('canvas');
        this._ctx = this._canvas.getContext('2d');
        this._particles = [];
        this._frame = null;
    },

    onAdd: function (map) {
        this._map = map;
        map.getPanes().overlayPane.appendChild(this._canvas);
        this._reset();
        map.on('viewreset zoomend move moveend resize', this._reset, this);
        this._initParticles();
        this._start();
    },

    onRemove: function (map) {
        map.getPanes().overlayPane.removeChild(this._canvas);
        map.off('viewreset zoomend move moveend resize', this._reset, this);
        this._stop();
    },

    _reset: function () {
        const bounds = this._map.getBounds();
        const size = this._map.getSize();
        const topLeft = this._map.latLngToLayerPoint(bounds.getNorthWest());
        this._canvas.width = size.x;
        this._canvas.height = size.y;
        this._canvas.style.width = size.x + 'px';
        this._canvas.style.height = size.y + 'px';
        this._canvas.style.position = 'absolute';
        this._canvas.style.left = topLeft.x + 'px';
        this._canvas.style.top = topLeft.y + 'px';
        this._canvas.style.pointerEvents = 'none';
        // re-init particles on resize to keep density
        this._initParticles();
    },

    _initParticles: function () {
        const area = Math.max(1000, this._canvas.width * this._canvas.height);
        const target = Math.min(maxParticles, Math.round(area * particleMultiplier));
        const particles = this._particles;
        particles.length = 0;
        for (let i = 0; i < target; i++) {
        particles.push(this._createParticle());
        }
    },

    _createParticle: function () {
        // random screen position
        const x = Math.random() * this._canvas.width;
        const y = Math.random() * this._canvas.height;
        return { x, y, age: Math.random() * 100, maxAge: 100 + Math.random() * 100 };
    },

    _start: function () {
        if (this._frame) return;
        const step = (time) => {
        this._frame = requestAnimationFrame(step);
        this._animate();
        };
        this._frame = requestAnimationFrame(step);
    },

    _stop: function () {
        if (this._frame) cancelAnimationFrame(this._frame);
        this._frame = null;
    },

    _animate: function () {
        const ctx = this._ctx;
        const w = this._canvas.width, h = this._canvas.height;
        // draw translucent fade to create trails
        ctx.fillStyle = `rgba(0,0,0,${fadeAlpha})`;
        ctx.globalCompositeOperation = 'destination-out';
        ctx.fillRect(0, 0, w, h);
        ctx.globalCompositeOperation = 'lighter';

        for (let p of this._particles) {
        // convert particle screen pos to lat/lon
        const ll = this._map.layerPointToLatLng([p.x, p.y]);
        const { u, v } = sampleUV(ll.lat, ll.lng);
        // map wind vector to screen movement (simple projection)
        const angle = Math.atan2(u, v);
        const speed = Math.sqrt(u * u + v * v) * speedScale;
        const dx = (Math.sin(angle) * speed) * 0.5;
        const dy = (Math.cos(angle) * speed) * 0.5;
        p.x += dx;
        p.y += dy;
        p.age += 1;
        // wrap / reset if out of bounds or too old
        if (p.x < 0 || p.x >= w || p.y < 0 || p.y >= h || p.age > p.maxAge) {
            Object.assign(p, this._createParticle());
            continue;
        }
        // draw particle
        const intensity = Math.min(1, speed / (maxVelocity || 10));
        const hue = 240 - intensity * 180;
        ctx.strokeStyle = `hsl(${hue},70%,60%)`;
        ctx.lineWidth = Math.max(1, 1.5 * intensity);
        ctx.beginPath();
        ctx.moveTo(p.x - dx, p.y - dy);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
        }
    }
    });

    return new CanvasOverlay();
}
// Enhanced map initialization focused on Mahajanga city
const map = L.map('map', { 
    zoomControl: true,
    attributionControl: true,
    preferCanvas: true // Better performance for animations
}).setView([-15.7167, 46.3167], 12); // Centered precisely on Mahajanga city, closer zoom

// Add multiple tile layer options
const tileLayers = {
    'OpenStreetMap': L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    }),
    'Satellite': L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    attribution: '&copy; <a href="https://www.arcgis.com/">ArcGIS</a>'
    })
};

tileLayers['OpenStreetMap'].addTo(map);
L.control.layers(tileLayers).addTo(map);

// Mahajanga city bounds - properly centered on the actual city location
let minLat = -15.18, maxLat = -15.65, minLon = 46.2, maxLon = 46.45;

// Global state
let gridSize = 10; // default 10×10 for better city coverage
let velocityLayer = null;
let autoTimer = null;
let animationPaused = false;

const $info = document.getElementById('weather-info');
const $time = document.getElementById('timestamp');
const $toast = document.getElementById('toast');
const $panel = document.getElementById('control-panel');
const $togglePanel = document.getElementById('toggle-panel');

// Enhanced toast with better styling
function toast(msg, ms = 3000, type = 'info') {
    $toast.textContent = msg; 
    $toast.style.display = 'block';
    $toast.style.background = type === 'error' ? 'rgba(239, 68, 68, 0.95)' : 'rgba(17, 24, 39, 0.95)';
    setTimeout(() => $toast.style.display = 'none', ms);
}

// Map low-level errors to user-friendly French messages
function mapErrorToUserMessage(err) {
    // log full details for debugging (localisé)
    console.error(t('detailedError'), err);

    if (!err) return 'Erreur inconnue. Voir la console pour les détails.';

    // AbortError (timeout)
    if (err.name === 'AbortError') return 'La requête a expiré. Veuillez réessayer.';

    const msg = String(err.message || err);

    if (msg.includes('HTTP')) {
    const codeMatch = msg.match(/HTTP\s*(\d{3})/);
    const code = codeMatch ? Number(codeMatch[1]) : null;
    switch (code) {
        case 429:
        return 'Trop de requêtes — veuillez réessayer plus tard.';
        case 400:
        return 'Requête invalide vers le serveur.';
        case 401:
        case 403:
        return "Accès refusé par l'API.";
        case 404:
        return "Ressource introuvable (404).";
        case 500:
        case 502:
        case 503:
        case 504:
        return "Erreur serveur — veuillez réessayer ultérieurement.";
        default:
        return `Erreur serveur (${code || 'inconnu'}). Voir la console pour plus de détails.`;
    }
    }

    // network-level failures
    if (msg.toLowerCase().includes('failed to fetch') || msg.toLowerCase().includes('networkerror')) {
    return "Impossible de contacter le serveur météo. Vérifiez votre connexion réseau.";
    }

    // fallback
    return 'Erreur lors du chargement des données — voir la console pour les détails.';
}

function buildGrid(n) {
    const latStep = (maxLat - minLat) / (n - 1);
    const lonStep = (maxLon - minLon) / (n - 1);
    const lats = Array.from({ length: n }, (_, i) => maxLat - i * latStep);
    const lons = Array.from({ length: n }, (_, j) => minLon + j * lonStep);
    return { lats, lons, latStep, lonStep, nx: n, ny: n };
}

function uvFromSpeedDir(speed, deg) {
    const rad = (deg * Math.PI) / 180;
    const u = -speed * Math.sin(rad);
    const v = -speed * Math.cos(rad);
    return { u, v };
}

async function fetchPoint(lat, lon, controller) {
    const url = new URL('https://api.open-meteo.com/v1/forecast');
    url.search = new URLSearchParams({
    latitude: lat.toFixed(3),
    longitude: lon.toFixed(3),
    hourly: 'wind_speed_10m,wind_direction_10m',
    cell_selection: 'sea', // Focus on marine data for coastal Boeny region
    timezone: 'Indian/Antananarivo'
    }).toString();

    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

// --- LocalStorage cache helpers (simple recent-grid cache) ---
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

function cacheKeyForGrid(n) {
    return `windy_cache:${minLat},${maxLat},${minLon},${maxLon}:n=${n}`;
}

function loadCachedGrid(n) {
    try {
    const key = cacheKeyForGrid(n);
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const entry = JSON.parse(raw);
    if (!entry || !entry.ts) return null;
    if ((Date.now() - entry.ts) > CACHE_TTL_MS) {
        localStorage.removeItem(key);
        return null;
    }
    return entry.payload;
    } catch (e) {
    console.warn(t('cacheReadFailed'), e);
    return null;
    }
}

function saveCachedGrid(n, payload) {
    try {
    const key = cacheKeyForGrid(n);
    const entry = { ts: Date.now(), payload };
    localStorage.setItem(key, JSON.stringify(entry));
    } catch (e) {
    console.warn(t('cacheWriteFailed'), e);
    }
}
// --- end cache helpers ---

async function fetchGridData(n) {
    // try cache first
    const cached = loadCachedGrid(n);
    if (cached) {
    // show quick info that cached data is used
    $info.innerHTML = `Données récentes en cache — affichage instantané`;
    return cached;
    }

    const { lats, lons, latStep, lonStep, nx, ny } = buildGrid(n);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000); // Increased timeout

    try {
    // Batch requests to avoid overwhelming the API
    const batchSize = 6;                    // concurrent requests per batch
    const interBatchDelay = 1000 + Math.round(Math.random() * 1000); // 1–2s
    const totalPoints = nx * ny;
    const totalBatches = Math.ceil(totalPoints / batchSize);
    const results = new Array(totalPoints).fill(null);

    let fetchedPoints = 0;

    for (let batch = 0; batch < totalBatches; batch++) {
        const start = batch * batchSize;
        const end = Math.min(start + batchSize, totalPoints);
        const batchPromises = [];

        for (let idx = start; idx < end; idx++) {
        const i = Math.floor(idx / nx);
        const j = idx % nx;

        batchPromises.push(
            fetchPoint(lats[i], lons[j], controller)
            .then(data => {
                const idxRes = i * nx + j;
                // take the nearest hour (safe guard)
                const hourIdx = 0;
                const speedVal = Number(data?.hourly?.wind_speed_10m?.[hourIdx]);
                const dirVal = Number(data?.hourly?.wind_direction_10m?.[hourIdx]);
                if (Number.isFinite(speedVal) && Number.isFinite(dirVal)) {
                const { u, v } = uvFromSpeedDir(speedVal, dirVal);
                results[idxRes] = { u, v, s: speedVal };
                fetchedPoints++;
                } else {
                results[idxRes] = null;
                }
                // update small progress indicator
                $info.innerHTML = `Chargement des données… Traitement du batch ${batch + 1} / ${totalBatches} (<strong>${fetchedPoints}/${totalPoints}</strong> points) <span class="spinner"></span>`;
                return null;
            })
            .catch(err => {
                console.warn(t('pointFetchError'), lats[i], lons[j], err);
                const idxRes = i * nx + j;
                results[idxRes] = null;
                return null;
            })
        );
        }

        // wait for the current batch to finish
        await Promise.all(batchPromises);

        // brief pause between batches to respect rate limits
        if (batch < totalBatches - 1) {
        await new Promise(resolve => setTimeout(resolve, interBatchDelay));
        }
    }

    clearTimeout(timeout);

    // Build arrays expected by velocity/custom layer
    const uData = results.map(r => r ? r.u : 0);
    const vData = results.map(r => r ? r.v : 0);

    // compute simple stats
    const speeds = results.filter(r => r && Number.isFinite(r.s)).map(r => r.s);
    const count = speeds.length;
    const sumSpeed = speeds.reduce((a, b) => a + b, 0);
    const avgSpeed = count ? (sumSpeed / count) : 0;
    const maxSpeed = speeds.length ? Math.max(...speeds) : 0;
    const refTimeIso = new Date().toISOString();

    const headerBase = {
        parameterCategory: 2,
        parameterCategoryName: 'Momentum',
        parameterUnit: 'm.s-1',
        dx: lonStep,
        dy: -latStep,
        la1: lats[0],
        la2: lats[lats.length - 1],
        lo1: lons[0],
        lo2: lons[lons.length - 1],
        nx, ny,
        refTime: refTimeIso
    };

    const windData = [
        { header: { ...headerBase, parameterNumber: 2, parameterNumberName: 'eastward_wind' }, data: uData },
        { header: { ...headerBase, parameterNumber: 3, parameterNumberName: 'northward_wind' }, data: vData }
    ];

    const payload = { windData, avgSpeed, count, total: nx * ny, maxSpeed, refTimeIso };

    // persist to localStorage for faster subsequent loads
    try { saveCachedGrid(n, payload); } catch (e) { /* ignore */ }

    // final UI update
    $info.innerHTML = `Données mises à jour ✅ (${count}/${totalPoints} valides)`;
    $time.textContent = new Date(refTimeIso).toLocaleString('fr-FR', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' });

    return payload;
    } catch (err) {
    clearTimeout(timeout);
    toast(mapErrorToUserMessage(err), 5000, 'error');
    throw err;
    }
}

function updateInfo({ avgSpeed, count, total, refTimeIso, maxSpeed }) {
    const coverage = ((count / total) * 100).toFixed(1);
    $info.innerHTML = `
    <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
        <span><strong>Vitesse moyenne:</strong></span>
        <span><strong>${avgSpeed.toFixed(1)} m/s</strong></span>
    </div>
    <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
        <span><strong>Vitesse max:</strong></span>
        <span><strong>${maxSpeed.toFixed(1)} m/s</strong></span>
    </div>
    <div style="display: flex; justify-content: space-between;">
        <span>Couverture données:</span>
        <span>${coverage}% (${count}/${total})</span>
    </div>
    `;
    $time.textContent = new Date(refTimeIso).toLocaleString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: '2-digit'
    });
}

function renderVelocity(windData, maxVelocity) {
    if (velocityLayer) {
    map.removeLayer(velocityLayer);
    velocityLayer = null;
    }
    
    console.log(t('windData'), windData);
    console.log(t('maxVelocity'), maxVelocity);
    
    // Try to use leaflet-velocity if available
    if (L.velocityLayer && !window.velocityLibraryFailed) {
    try {
        velocityLayer = L.velocityLayer({
        data: windData,
        displayValues: true,
        displayOptions: {
            velocityType: 'Vent',
            position: 'bottomleft',
            emptyString: 'Pas de données vent',
            angleConvention: 'meteo',
            speedUnit: 'm/s',
            showCardinal: true
        },
        minVelocity: 0,
        maxVelocity: Math.max(10, Math.ceil(maxVelocity * 1.5)),
        velocityScale: 0.005,
        colorScale: [
            '#3288bd', '#66c2a5', '#abdda4', '#e6f598', 
            '#fee08b', '#fdae61', '#f46d43', '#d53e4f'
        ],
        particleAge: 64,
        particleMultiplier: 1/250,
        frameRate: 20,
        opacity: 0.97
        });
        
        velocityLayer.addTo(map);
        console.log(t('velocityAdded'));
        toast('Animation des vents activée');
        return;
    } catch (err) {
        console.error(t('velocityFailed'), err);
    }
    }
    
    // Fallback to custom wind visualization
    console.log(t('usingCustom'));
    velocityLayer = createCustomWindLayer(windData, maxVelocity);
    if (velocityLayer) {
    velocityLayer.addTo(map);
    toast('Visualisation des vents (mode compatibilité)');
    }
}

async function loadAndRender(n = gridSize) {
    try {
    document.getElementById('refresh-btn').disabled = true;
    $info.innerHTML = 'Chargement des données… <span class="spinner"></span>';
    
    const payload = await fetchGridData(n);
    updateInfo(payload);
    renderVelocity(payload.windData, payload.maxSpeed);
    toast(`Données vent mises à jour (${payload.count} points)`);
    } catch (err) {
    // show friendly message to user, but keep full error in console for debugging
    const friendly = mapErrorToUserMessage(err);
    $info.innerHTML = `<div style="color: #dc2626;">${friendly}</div>`;
    toast(friendly, 4500, 'error');
    } finally {
    document.getElementById('refresh-btn').disabled = false;
    }
}

function startAuto() {
    if (autoTimer) clearInterval(autoTimer);
    autoTimer = setInterval(() => loadAndRender(gridSize), 30 * 60 * 1000);
}

// Enhanced controls with better UX
document.getElementById('refresh-btn').addEventListener('click', () => {
    loadAndRender(gridSize);
});

document.getElementById('apply-grid').addEventListener('click', () => {
    const n = Number(document.getElementById('density').value);
    if (n !== gridSize) {
    gridSize = n;
    toast(`Résolution changée: ${n}×${n}`);
    loadAndRender(n);
    }
});

document.getElementById('toggle-animation').addEventListener('click', (e) => {
    animationPaused = !animationPaused;
    if (velocityLayer) {
    if (animationPaused) {
        map.removeLayer(velocityLayer);
        e.target.innerHTML = '▶️ Reprendre';
        toast('Animation en pause');
    } else {
        map.addLayer(velocityLayer);
        e.target.innerHTML = '⏸️ Pause';
        toast('Animation reprise');
    }
    }
});

document.getElementById('fullscreen-btn').addEventListener('click', () => {
    if (document.fullscreenElement) {
    document.exitFullscreen();
    } else {
    document.documentElement.requestFullscreen();
    }
});

// Panel toggle for mobile
$togglePanel.addEventListener('click', () => {
    $panel.classList.toggle('collapsed');
});

// Auto-hide panel on small screens after interaction
if (window.innerWidth <= 768) {
    setTimeout(() => {
    $panel.classList.add('collapsed');
    }, 5000);
}

// Initialize
loadAndRender(gridSize);
startAuto();

// Handle fullscreen changes
document.addEventListener('fullscreenchange', () => {
    const btn = document.getElementById('fullscreen-btn');
    btn.innerHTML = document.fullscreenElement ? '⛶ Quitter' : '⛶ Plein écran';
});

// Handle orientation changes on mobile
window.addEventListener('orientationchange', () => {
    setTimeout(() => {
    map.invalidateSize();
    }, 500);
});