/**
 * TP7 Satellite Tracker - Micro-Backend Proxy & Cache Server (Node.js)
 *
 * Cumple con el requisito 4.3 de la cátedra:
 * - Resguarda las credenciales de Space-Track.org y la API Key de N2YO fuera del código
 *   fuente y del bundle de la aplicación móvil.
 * - Implementa caché en memoria con TTL para reducir el número de requests hacia las APIs
 *   externas y respetar estrictamente sus Rate Limits.
 * - No requiere dependencias externas pesadas (usa fetch y http nativos de Node 18+).
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

// Carga liviana de variables desde .env si existe
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, 'utf-8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx > 0) {
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim();
      if (!process.env[key]) {
        process.env[key] = val;
      }
    }
  }
}

const PORT = Number(process.env.PORT || 3001);
const SPACETRACK_IDENTITY = process.env.SPACETRACK_IDENTITY || '';
const SPACETRACK_PASSWORD = process.env.SPACETRACK_PASSWORD || '';
const N2YO_API_KEY = process.env.N2YO_API_KEY || '';

// Caché en memoria: Map<cacheKey, { data, expiresAt, fetchedAt }>
const memoryCache = new Map();
const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;

function getFromCache(key) {
  const entry = memoryCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    memoryCache.delete(key);
    return null;
  }
  return entry;
}

function setInCache(key, data, ttlMs) {
  const entry = {
    data,
    fetchedAt: new Date().toISOString(),
    expiresAt: Date.now() + ttlMs,
  };
  memoryCache.set(key, entry);
  return entry;
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  });
  res.end(JSON.stringify(payload));
}

let spaceTrackCookie = null;
let spaceTrackCookieExpiresAt = 0;

async function authenticateSpaceTrack() {
  if (spaceTrackCookie && Date.now() < spaceTrackCookieExpiresAt) {
    return spaceTrackCookie;
  }
  if (!SPACETRACK_IDENTITY || !SPACETRACK_PASSWORD) {
    throw new Error('Credenciales SPACETRACK_IDENTITY / SPACETRACK_PASSWORD no configuradas en el proxy');
  }

  const res = await fetch('https://www.space-track.org/ajaxauth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      identity: SPACETRACK_IDENTITY,
      password: SPACETRACK_PASSWORD,
    }).toString(),
  });

  if (!res.ok) {
    throw new Error(`Error autenticando en Space-Track: HTTP ${res.status}`);
  }

  const setCookie = res.headers.get('set-cookie');
  if (!setCookie) {
    throw new Error('Space-Track no devolvió cookie de sesión');
  }
  spaceTrackCookie = setCookie.split(';')[0];
  spaceTrackCookieExpiresAt = Date.now() + 90 * 60 * 1000; // 90 min
  return spaceTrackCookie;
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    return sendJson(res, 200, { ok: true });
  }

  const reqUrl = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = reqUrl.pathname;

  try {
    // 1. Healthcheck y estado de credenciales configuradas
    if (pathname === '/api/health') {
      return sendJson(res, 200, {
        status: 'ok',
        timestamp: new Date().toISOString(),
        providersConfigured: {
          celestrak: true,
          wheretheiss: true,
          spacetrack: Boolean(SPACETRACK_IDENTITY && SPACETRACK_PASSWORD),
          n2yo: Boolean(N2YO_API_KEY),
        },
        cacheEntries: memoryCache.size,
      });
    }

    // 2. Proxy con caché para CelesTrak (GP y SupGP Starlink)
    if (pathname === '/api/celestrak/gp') {
      const group = reqUrl.searchParams.get('group') || 'stations';
      const catnr = reqUrl.searchParams.get('catnr');
      const isSup = reqUrl.searchParams.get('sup') === 'true';

      const cacheKey = `celestrak:${isSup ? 'sup' : 'gp'}:${catnr || group}`;
      const cached = getFromCache(cacheKey);
      if (cached) {
        return sendJson(res, 200, { source: 'proxy-cache', fetchedAt: cached.fetchedAt, data: cached.data });
      }

      let targetUrl;
      if (catnr) {
        targetUrl = `https://celestrak.org/NORAD/elements/gp.php?CATNR=${encodeURIComponent(catnr)}&FORMAT=json`;
      } else if (isSup || group === 'starlink-sup') {
        targetUrl = `https://celestrak.org/NORAD/elements/supplemental/sup-gp.php?FILE=starlink&FORMAT=json`;
      } else {
        targetUrl = `https://celestrak.org/NORAD/elements/gp.php?GROUP=${encodeURIComponent(group)}&FORMAT=json`;
      }

      const upstream = await fetch(targetUrl);
      if (!upstream.ok) {
        throw new Error(`CelesTrak respondió HTTP ${upstream.status}`);
      }
      const data = await upstream.json();
      const entry = setInCache(cacheKey, data, TWELVE_HOURS_MS);
      return sendJson(res, 200, { source: 'celestrak-upstream', fetchedAt: entry.fetchedAt, data });
    }

    // 3. Proxy para Space-Track (protege usuario/contraseña en el servidor)
    if (pathname === '/api/spacetrack/gp') {
      const catnr = reqUrl.searchParams.get('catnr') || '25544';
      const cacheKey = `spacetrack:gp:${catnr}`;
      const cached = getFromCache(cacheKey);
      if (cached) {
        return sendJson(res, 200, { source: 'proxy-cache', fetchedAt: cached.fetchedAt, data: cached.data });
      }

      const cookie = await authenticateSpaceTrack();
      const targetUrl = `https://www.space-track.org/basicspacedata/query/class/gp/NORAD_CAT_ID/${encodeURIComponent(catnr)}/orderby/EPOCH%20desc/limit/1/format/json`;
      const upstream = await fetch(targetUrl, {
        headers: { Cookie: cookie },
      });
      if (!upstream.ok) {
        throw new Error(`Space-Track respondió HTTP ${upstream.status}`);
      }
      const data = await upstream.json();
      const entry = setInCache(cacheKey, data, TWELVE_HOURS_MS);
      return sendJson(res, 200, { source: 'spacetrack-upstream', fetchedAt: entry.fetchedAt, data });
    }

    // 4. Proxy para N2YO (protege N2YO_API_KEY en el servidor)
    if (pathname === '/api/n2yo/positions') {
      if (!N2YO_API_KEY) {
        return sendJson(res, 503, {
          error: 'N2YO_API_KEY no configurada en server/.env',
          configured: false,
        });
      }
      const id = reqUrl.searchParams.get('id') || '25544';
      const lat = reqUrl.searchParams.get('lat') || '-32.4845';
      const lon = reqUrl.searchParams.get('lon') || '-58.2322';
      const alt = reqUrl.searchParams.get('alt') || '20';
      const seconds = reqUrl.searchParams.get('seconds') || '1';

      const targetUrl = `https://api.n2yo.com/rest/v1/satellite/positions/${encodeURIComponent(id)}/${encodeURIComponent(lat)}/${encodeURIComponent(lon)}/${encodeURIComponent(alt)}/${encodeURIComponent(seconds)}/&apiKey=${encodeURIComponent(N2YO_API_KEY)}`;
      const upstream = await fetch(targetUrl);
      if (!upstream.ok) {
        throw new Error(`N2YO respondió HTTP ${upstream.status}`);
      }
      const data = await upstream.json();
      return sendJson(res, 200, { source: 'n2yo-upstream', fetchedAt: new Date().toISOString(), data });
    }

    // 5. Proxy para Where the ISS at?
    if (pathname === '/api/wheretheiss') {
      const upstream = await fetch('https://api.wheretheiss.at/v1/satellites/25544');
      if (!upstream.ok) {
        throw new Error(`WhereTheISS respondió HTTP ${upstream.status}`);
      }
      const data = await upstream.json();
      return sendJson(res, 200, { source: 'wheretheiss-upstream', fetchedAt: new Date().toISOString(), data });
    }

    return sendJson(res, 404, { error: 'Ruta no encontrada en el proxy' });
  } catch (err) {
    return sendJson(res, 500, {
      error: err instanceof Error ? err.message : 'Error interno del proxy',
    });
  }
});

server.listen(PORT, () => {
  console.log(`[TP7 Proxy] Servidor proxy y caché escuchando en http://localhost:${PORT}`);
  console.log(`[TP7 Proxy] Healthcheck: http://localhost:${PORT}/api/health`);
});

