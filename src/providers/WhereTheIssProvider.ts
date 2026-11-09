/**
 * Proveedor de validación rápida y prototipado para la ISS: Where the ISS at? (Sección 4.2 y RF-15).
 * - Sin autenticación, límite ~1 request/segundo.
 * - Soporta tanto posición instantánea en tiempo real (lat, lon, alt, velocity) como TLE de la ISS (NORAD 25544).
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

interface WhereTheIssPositionResponse {
  name: string;
  id: number;
  latitude: number;
  longitude: number;
  altitude: number;
  velocity: number;
  timestamp: number;
}

interface WhereTheIssTleResponse {
  name: string;
  id: number;
  header: string;
  line1: string;
  line2: string;
  tle_timestamp: number;
}

export class WhereTheIssProvider implements DataProvider {
  public readonly id = 'wheretheiss' as const;
  public readonly displayName = 'Where the ISS at? (REST API)';

  public async getCatalog(category: ConstellationCategory): Promise<OrbitalElements[]> {
    if (category !== 'stations') {
      throw new Error('Where the ISS at? solo provee datos para la ISS (NORAD 25544)');
    }
    const iss = await this.getOrbitalData(25544);
    return [iss];
  }

  public async getOrbitalData(noradId: number): Promise<OrbitalElements> {
    if (noradId !== 25544) {
      throw new Error('Where the ISS at? solo soporta NORAD 25544 (ISS)');
    }

    return rateLimiter.schedule('wheretheiss', async () => {
      const response = await fetch('https://api.wheretheiss.at/v1/satellites/25544/tles');
      if (!response.ok) {
        throw new Error(`WhereTheISS TLE respondió HTTP ${response.status}`);
      }
      const data = (await response.json()) as WhereTheIssTleResponse;
      const epochIso = data.tle_timestamp
        ? new Date(data.tle_timestamp * 1000).toISOString()
        : new Date().toISOString();

      return {
        noradId: 25544,
        name: 'ISS (ZARYA)',
        category: 'stations',
        epochIso,
        fetchedAtIso: new Date().toISOString(),
        sourceProvider: 'wheretheiss',
        tle: {
          name: data.header || 'ISS (ZARYA)',
          line1: data.line1,
          line2: data.line2,
        },
      };
    });
  }

  public async getValidationPosition(
    noradId: number,
    _timestampMs: number,
    _observer: ObserverLocation
  ): Promise<ValidationPositionSample> {
    if (noradId !== 25544) {
      throw new Error(
        'Where the ISS at? solo permite validar la Estación Espacial Internacional (NORAD 25544). Para otros satélites use N2YO.'
      );
    }

    return rateLimiter.schedule('wheretheiss', async () => {
      const creds = await credentialStore.getCredentials();

      if (creds.proxyBaseUrl) {
        try {
          const proxyUrl = `${creds.proxyBaseUrl.replace(/\/$/, '')}/api/wheretheiss`;
          const proxyRes = await fetch(proxyUrl);
          if (proxyRes.ok) {
            const wrapped = (await proxyRes.json()) as { data?: WhereTheIssPositionResponse };
            if (wrapped.data) {
              const d = wrapped.data;
              return {
                provider: 'wheretheiss',
                noradId: 25544,
                timestamp: d.timestamp * 1000,
                latitude: Number(d.latitude),
                longitude: Number(d.longitude),
                altitudeKm: Number(d.altitude),
                velocityKmS: Number(d.velocity) / 3600,
              };
            }
          }
        } catch {
          // Continuar a consulta directa
        }
      }

      const res = await fetch('https://api.wheretheiss.at/v1/satellites/25544');
      if (!res.ok) {
        throw new Error(`WhereTheISS respondió HTTP ${res.status}`);
      }
      const data = (await res.json()) as WhereTheIssPositionResponse;
      return {
        provider: 'wheretheiss',
        noradId: 25544,
        timestamp: data.timestamp * 1000,
        latitude: Number(data.latitude),
        longitude: Number(data.longitude),
        altitudeKm: Number(data.altitude),
        velocityKmS: Number(data.velocity) / 3600,
      };
    });
  }
}

export const whereTheIssProvider = new WhereTheIssProvider();

