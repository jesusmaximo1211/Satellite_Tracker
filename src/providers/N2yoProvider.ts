/**
 * Proveedor de validación cruzada para cualquier satélite: N2YO REST API (Sección 4.2 y RF-15).
 * - Límite de uso: 1000 transacciones/hora (TLE y posiciones), 100/hora (pases).
 * - Lee la API Key desde el proxy Node.js o desde el almacenamiento seguro (SecureStore).
 */

import {
  ConstellationCategory,
  DataProvider,
  ObserverLocation,
  OrbitalElements,
  ValidationPositionSample,
} from '../types/orbital';
import { credentialStore } from './CredentialStore';
import { rateLimiter } from './RateLimiter';

interface N2yoPositionsPayload {
  info?: {
    satname: string;
    satid: number;
    transactionscount: number;
  };
  positions?: Array<{
    satlatitude: number;
    satlongitude: number;
    sataltitude: number;
    azimuth: number;
    elevation: number;
    ra: number;
    dec: number;
    timestamp: number;
  }>;
  error?: string;
}

interface N2yoTlePayload {
  info?: {
    satname: string;
    satid: number;
  };
  tle?: string;
  error?: string;
}

export class N2yoProvider implements DataProvider {
  public readonly id = 'n2yo' as const;
  public readonly displayName = 'N2YO REST API (Validación Cruzada)';

  public async getCatalog(_category: ConstellationCategory): Promise<OrbitalElements[]> {
    throw new Error('N2YO se utiliza para validación cruzada individual o TLE puntual, no listado masivo.');
  }

  public async getOrbitalData(noradId: number): Promise<OrbitalElements> {
    return rateLimiter.schedule('n2yo', async () => {
      const creds = await credentialStore.getCredentials();
      if (!creds.n2yoApiKey) {
        throw new Error('API Key de N2YO no configurada.');
      }

      const url = `https://api.n2yo.com/rest/v1/satellite/tle/${noradId}&apiKey=${encodeURIComponent(creds.n2yoApiKey)}`;
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`N2YO TLE HTTP ${res.status}`);
      }
      const data = (await res.json()) as N2yoTlePayload;
      if (data.error || !data.tle) {
        throw new Error(data.error || 'N2YO no devolvió TLE válido');
      }

      const lines = data.tle.split(/\r?\n/).filter((l) => l.trim().length > 0);
      if (lines.length < 2) {
        throw new Error('Formato TLE de N2YO incompleto');
      }

      return {
        noradId,
        name: data.info?.satname || `SAT ${noradId}`,
        category: 'stations',
        epochIso: new Date().toISOString(),
        fetchedAtIso: new Date().toISOString(),
        sourceProvider: 'n2yo',
        tle: {
          name: data.info?.satname || `SAT ${noradId}`,
          line1: lines[0],
          line2: lines[1],
        },
      };
    });
  }

  public async getValidationPosition(
    noradId: number,
    _timestampMs: number,
    observer: ObserverLocation
  ): Promise<ValidationPositionSample> {
    return rateLimiter.schedule('n2yo', async () => {
      const creds = await credentialStore.getCredentials();

      let payload: N2yoPositionsPayload | null = null;

      // 1. Intentar primero mediante el Proxy Node.js si está configurado
      if (creds.proxyBaseUrl) {
        try {
          const proxyUrl = `${creds.proxyBaseUrl.replace(/\/$/, '')}/api/n2yo/positions?id=${noradId}&lat=${observer.latitude}&lon=${observer.longitude}&alt=${observer.altitudeMeters}&seconds=1`;
          const res = await fetch(proxyUrl);
          if (res.ok) {
            const wrapped = (await res.json()) as { data?: N2yoPositionsPayload };
            if (wrapped.data) {
              payload = wrapped.data;
            }
          }
        } catch {
          // Si falla el proxy, probamos con la clave en SecureStore
        }
      }

      // 2. Consulta directa con API Key de SecureStore
      if (!payload) {
        if (!creds.n2yoApiKey) {
          throw new Error(
            'API Key de N2YO no configurada. Ingresala en la pestaña Config / Proxy o en server/.env para validar contra N2YO.'
          );
        }
        const url = `https://api.n2yo.com/rest/v1/satellite/positions/${noradId}/${observer.latitude}/${observer.longitude}/${observer.altitudeMeters}/1/&apiKey=${encodeURIComponent(creds.n2yoApiKey)}`;
        const res = await fetch(url);
        if (!res.ok) {
          throw new Error(`N2YO respondió HTTP ${res.status}`);
        }
        payload = (await res.json()) as N2yoPositionsPayload;
      }

      if (payload.error) {
        throw new Error(`Error N2YO: ${payload.error}`);
      }

      const pos = payload.positions?.[0];
      if (!pos) {
        throw new Error('N2YO no devolvió posiciones para este satélite');
      }

      return {
        provider: 'n2yo',
        noradId,
        timestamp: pos.timestamp * 1000,
        latitude: Number(pos.satlatitude),
        longitude: Number(pos.satlongitude),
        altitudeKm: Number(pos.sataltitude),
        azimuthDeg: Number(pos.azimuth),
        elevationDeg: Number(pos.elevation),
      };
    });
  }
}

export const n2yoProvider = new N2yoProvider();

