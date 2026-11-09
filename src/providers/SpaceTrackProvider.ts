/**
 * Proveedor secundario / Fallback: Space-Track.org (Sección 4.2 y 4.3).
 * - Respeta estrictamente el límite < 30 req/min y < 300 req/hora mediante RateLimiter.
 * - Protege las credenciales (identity/password) delegando la autenticación al proxy Node.js
 *   o leyéndolas desde el almacenamiento cifrado (SecureStore).
 */

import {
  ConstellationCategory,
  DataProvider,
  OMMRecord,
  ObserverLocation,
  OrbitalElements,
  ValidationPositionSample,
} from '../types/orbital';
import { credentialStore } from './CredentialStore';
import { rateLimiter } from './RateLimiter';

function parseSpaceTrackOmm(raw: Record<string, unknown>, category: ConstellationCategory): OrbitalElements {
  const noradId = Number(raw.NORAD_CAT_ID);
  const name = String(raw.OBJECT_NAME || `SAT-${noradId}`).trim();
  const epochIso = String(raw.EPOCH || new Date().toISOString());

  const omm: OMMRecord = {
    OBJECT_NAME: name,
    OBJECT_ID: String(raw.OBJECT_ID || 'UNKNOWN'),
    EPOCH: epochIso,
    MEAN_MOTION: Number(raw.MEAN_MOTION),
    ECCENTRICITY: Number(raw.ECCENTRICITY),
    INCLINATION: Number(raw.INCLINATION),
    RA_OF_ASC_NODE: Number(raw.RA_OF_ASC_NODE),
    ARG_OF_PERICENTER: Number(raw.ARG_OF_PERICENTER),
    MEAN_ANOMALY: Number(raw.MEAN_ANOMALY),
    EPHEMERIS_TYPE: 0,
    CLASSIFICATION_TYPE: 'U',
    NORAD_CAT_ID: noradId,
    ELEMENT_SET_NO: Number(raw.ELEMENT_SET_NO ?? 999),
    REV_AT_EPOCH: Number(raw.REV_AT_EPOCH ?? 0),
    BSTAR: Number(raw.BSTAR ?? 0),
    MEAN_MOTION_DOT: Number(raw.MEAN_MOTION_DOT ?? 0),
    MEAN_MOTION_DDOT: Number(raw.MEAN_MOTION_DDOT ?? 0),
  };

  return {
    noradId,
    name,
    category,
    epochIso,
    fetchedAtIso: new Date().toISOString(),
    sourceProvider: 'spacetrack',
    omm,
  };
}

export class SpaceTrackProvider implements DataProvider {
  public readonly id = 'spacetrack' as const;
  public readonly displayName = 'Space-Track.org (Catálogo Oficial GP)';

  public async getCatalog(category: ConstellationCategory): Promise<OrbitalElements[]> {
    // Obtenemos los NORAD IDs representativos de la categoría solicitada vía Space-Track
    const representativeIds: Record<ConstellationCategory, number[]> = {
      stations: [25544, 48274, 20580],
      starlink: [44713, 44714, 44715],
      gnss: [24876, 41859],
      weather: [43641, 46265, 33591],
      geo: [40271, 40941, 41866],
    };

    const ids = representativeIds[category] || [25544];
    const results: OrbitalElements[] = [];
    for (const id of ids) {
      const el = await this.getOrbitalData(id);
      results.push({ ...el, category });
    }
    return results;
  }

  public async getOrbitalData(noradId: number): Promise<OrbitalElements> {
    return rateLimiter.schedule('spacetrack', async () => {
      const creds = await credentialStore.getCredentials();

      if (creds.proxyBaseUrl) {
        const url = `${creds.proxyBaseUrl.replace(/\/$/, '')}/api/spacetrack/gp?catnr=${noradId}`;
        const res = await fetch(url);
        if (!res.ok) {
          throw new Error(`Space-Track proxy HTTP ${res.status}`);
        }
        const payload = (await res.json()) as { data?: unknown[] };
        if (payload.data && Array.isArray(payload.data) && payload.data.length > 0) {
          return parseSpaceTrackOmm(payload.data[0] as Record<string, unknown>, 'stations');
        }
      }

      if (!creds.spaceTrackIdentity || !creds.spaceTrackPassword) {
        throw new Error(
          'Space-Track requiere credenciales en Configuración (SecureStore) o en server/.env'
        );
      }

      throw new Error(
        'Para evitar problemas de cookies/CORS en móvil, Space-Track debe consultarse mediante el Proxy Node.js configurado.'
      );
    });
  }

  public async getValidationPosition(
    _noradId: number,
    _timestampMs: number,
    _observer: ObserverLocation
  ): Promise<ValidationPositionSample> {
    throw new Error('Space-Track provee elementos GP/TLE, no posiciones instantáneas para validación.');
  }
}

export const spaceTrackProvider = new SpaceTrackProvider();

