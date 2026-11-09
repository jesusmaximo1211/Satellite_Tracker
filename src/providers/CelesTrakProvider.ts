/**
 * Proveedor primario de datos orbitales: CelesTrak (Sección 4.2 y 4.3).
 * - Soporta el catálogo general GP en formato OMM/JSON.
 * - Soporta el dataset suplementario (SupGP) de Starlink derivado de las efemérides de SpaceX:
 *   https://celestrak.org/NORAD/elements/supplemental/sup-gp.php?FILE=starlink&FORMAT=json
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

const CATEGORY_TO_CELESTRAK_GROUP: Record<ConstellationCategory, string> = {
  stations: 'stations',
  starlink: 'starlink',
  gnss: 'gnss',
  weather: 'weather',
  geo: 'geo',
};

function normalizeOmmRecord(raw: Record<string, unknown>, category: ConstellationCategory): OrbitalElements {
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
    CLASSIFICATION_TYPE: raw.CLASSIFICATION_TYPE === 'C' ? 'C' : 'U',
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
    sourceProvider: 'celestrak',
    omm,
  };
}

export class CelesTrakProvider implements DataProvider {
  public readonly id = 'celestrak' as const;
  public readonly displayName = 'CelesTrak (GP + SupGP OMM)';

  private async fetchJsonWithTimeout(url: string, timeoutMs: number = 9000): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) {
        throw new Error(`CelesTrak HTTP ${response.status}`);
      }
      return await response.json();
    } finally {
      clearTimeout(timer);
    }
  }

  public async getCatalog(category: ConstellationCategory): Promise<OrbitalElements[]> {
    return rateLimiter.schedule('celestrak', async () => {
      const creds = await credentialStore.getCredentials();
      const group = CATEGORY_TO_CELESTRAK_GROUP[category] || 'stations';

      let rawArray: unknown;

      // 1. Si hay un backend proxy configurado, intentamos primero a través del proxy
      if (creds.proxyBaseUrl) {
        try {
          const isSup = category === 'starlink';
          const proxyUrl = `${creds.proxyBaseUrl.replace(/\/$/, '')}/api/celestrak/gp?group=${encodeURIComponent(group)}&sup=${isSup}`;
          const proxyRes = (await this.fetchJsonWithTimeout(proxyUrl, 6000)) as { data?: unknown };
          if (proxyRes && Array.isArray(proxyRes.data)) {
            rawArray = proxyRes.data;
          }
        } catch {
          // Si el proxy local no está corriendo, consultamos directo a CelesTrak
        }
      }

      // 2. Consulta directa a CelesTrak
      if (!rawArray) {
        if (category === 'starlink') {
          // Según Sección 4.2 del TP7: sets suplementarios (SupGP) de Starlink vía sup-gp.php?FILE=starlink
          try {
            rawArray = await this.fetchJsonWithTimeout(
              'https://celestrak.org/NORAD/elements/supplemental/sup-gp.php?FILE=starlink&FORMAT=json',
              10000
            );
          } catch {
            // Fallback al endpoint GP de Starlink de CelesTrak si sup-gp demora por tamaño
            rawArray = await this.fetchJsonWithTimeout(
              'https://celestrak.org/NORAD/elements/gp.php?GROUP=starlink&FORMAT=json',
              10000
            );
          }
        } else {
          const url = `https://celestrak.org/NORAD/elements/gp.php?GROUP=${encodeURIComponent(group)}&FORMAT=json`;
          rawArray = await this.fetchJsonWithTimeout(url, 9000);
        }
      }

      if (!Array.isArray(rawArray) || rawArray.length === 0) {
        throw new Error(`CelesTrak devolvió un catálogo vacío para ${category}`);
      }

      // Para Starlink limitamos el lote almacenado a 150 satélites para mantener fluidez de memoria y disco
      const sliced = category === 'starlink' ? rawArray.slice(0, 150) : rawArray.slice(0, 120);
      return sliced
        .map((item) => normalizeOmmRecord(item as Record<string, unknown>, category))
        .filter((el) => !Number.isNaN(el.noradId) && el.noradId > 0);
    });
  }

  public async getOrbitalData(noradId: number): Promise<OrbitalElements> {
    return rateLimiter.schedule('celestrak', async () => {
      const creds = await credentialStore.getCredentials();

      if (creds.proxyBaseUrl) {
        try {
          const proxyUrl = `${creds.proxyBaseUrl.replace(/\/$/, '')}/api/celestrak/gp?catnr=${noradId}`;
          const proxyRes = (await this.fetchJsonWithTimeout(proxyUrl, 6000)) as { data?: unknown };
          if (proxyRes && Array.isArray(proxyRes.data) && proxyRes.data.length > 0) {
            return normalizeOmmRecord(proxyRes.data[0] as Record<string, unknown>, 'stations');
          }
        } catch {
          // Fallback a consulta directa
        }
      }

      const url = `https://celestrak.org/NORAD/elements/gp.php?CATNR=${noradId}&FORMAT=json`;
      const rawArray = await this.fetchJsonWithTimeout(url, 8000);
      if (!Array.isArray(rawArray) || rawArray.length === 0) {
        throw new Error(`Satélite NORAD ${noradId} no encontrado en CelesTrak`);
      }

      return normalizeOmmRecord(rawArray[0] as Record<string, unknown>, 'stations');
    });
  }

  public async getValidationPosition(
    _noradId: number,
    _timestampMs: number,
    _observer: ObserverLocation
  ): Promise<ValidationPositionSample> {
    throw new Error(
      'CelesTrak provee efemérides OMM/TLE, no posiciones calculadas. Use WhereTheISS o N2YO para validación.'
    );
  }
}

export const celesTrakProvider = new CelesTrakProvider();

