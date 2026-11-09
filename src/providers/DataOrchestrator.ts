/**
 * Orquestador de Proveedores de Datos con Caché Local (TTL 12-24h) y Fallback Automático (RF-01, RF-08, RF-09, RF-14, RF-16).
 * Flujo de consulta:
 * 1. Caché local vigente (AsyncStorage + Memoria)
 * 2. Proveedor primario: CelesTrak (GP y SupGP Starlink)
 * 3. Proveedor secundario (Fallback): Space-Track.org
 * 4. Proveedor específico (WhereTheISS para ISS / N2YO)
 * 5. Caché expirada de emergencia o Catálogo Semilla Offline (seedCatalog)
 */

import {
  ConstellationCategory,
  ObserverLocation,
  OrbitalElements,
  ProviderId,
  ValidationPositionSample,
} from '../types/orbital';
import { celesTrakProvider } from './CelesTrakProvider';
import { n2yoProvider } from './N2yoProvider';
import { DEFAULT_TTL_HOURS, orbitalCache } from './OrbitalCache';
import { getSeedCatalogByCategory } from './seedCatalog';
import { spaceTrackProvider } from './SpaceTrackProvider';
import { whereTheIssProvider } from './WhereTheIssProvider';

export interface ProviderEventLog {
  id: string;
  timestamp: number;
  provider: ProviderId | 'cache';
  action: string;
  status: 'success' | 'fallback' | 'error';
  detail: string;
}

class DataOrchestratorService {
  private logs: ProviderEventLog[] = [];
  private simulatePrimaryFailure: boolean = false;

  public setSimulatePrimaryFailure(enabled: boolean): void {
    this.simulatePrimaryFailure = enabled;
    this.addLog(
      'celestrak',
      'Simulación de Falla',
      enabled ? 'fallback' : 'success',
      enabled
        ? 'Simulación activada: CelesTrak fallará intencionalmente para demostrar el fallback automático (RF-14)'
        : 'Simulación desactivada: CelesTrak opera normalmente'
    );
  }

  public isSimulatingPrimaryFailure(): boolean {
    return this.simulatePrimaryFailure;
  }

  private addLog(
    provider: ProviderId | 'cache',
    action: string,
    status: 'success' | 'fallback' | 'error',
    detail: string
  ): void {
    this.logs.unshift({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      timestamp: Date.now(),
      provider,
      action,
      status,
      detail,
    });
    if (this.logs.length > 40) {
      this.logs = this.logs.slice(0, 40);
    }
  }

  public getLogs(): ProviderEventLog[] {
    return this.logs;
  }

  /**
   * Obtiene el catálogo de una constelación respetando el TTL (12-24h) y aplicando fallback automático.
   */
  public async getCatalog(
    category: ConstellationCategory,
    options: { forceRefresh?: boolean; ttlHours?: number } = {}
  ): Promise<{ items: OrbitalElements[]; source: string; fromCache: boolean }> {
    const ttlHours = options.ttlHours ?? DEFAULT_TTL_HOURS;

    // 1. Verificar caché local vigente si no se forzó refresco
    if (!options.forceRefresh) {
      const cached = await orbitalCache.getCatalog(category, false);
      if (cached && cached.items.length > 0) {
        const ageMin = Math.round((Date.now() - cached.savedAtMs) / 60_000);
        this.addLog(
          'cache',
          `getCatalog(${category})`,
          'success',
          `Hit de caché local (${cached.items.length} satélites, guardado hace ${ageMin} min, TTL ${ttlHours}h)`
        );
        return {
          items: cached.items,
          source: 'Caché Local (TTL Vigente)',
          fromCache: true,
        };
      }
    }

    // 2. Proveedor Primario: CelesTrak
    try {
      if (this.simulatePrimaryFailure) {
        throw new Error('Falla simulada en CelesTrak para prueba de resiliencia (RF-14)');
      }
      const items = await celesTrakProvider.getCatalog(category);
      await orbitalCache.setCatalog(category, items, ttlHours);
      this.addLog(
        'celestrak',
        `getCatalog(${category})`,
        'success',
        `Descargados ${items.length} objetos OMM desde CelesTrak (${category === 'starlink' ? 'SupGP Starlink' : 'GP'})`
      );
      return {
        items,
        source: category === 'starlink' ? 'CelesTrak SupGP (SpaceX Ephemeris)' : 'CelesTrak GP (OMM/JSON)',
        fromCache: false,
      };
    } catch (primaryErr) {
      const msg = primaryErr instanceof Error ? primaryErr.message : 'Error de red';
      this.addLog(
        'celestrak',
        `getCatalog(${category})`,
        'fallback',
        `Fallo en proveedor primario CelesTrak (${msg}). Conmutando a Fallback...`
      );
    }

    // 3. Proveedor Secundario (Fallback 1): Space-Track.org
    try {
      const items = await spaceTrackProvider.getCatalog(category);
      await orbitalCache.setCatalog(category, items, ttlHours);
      this.addLog(
        'spacetrack',
        `getCatalog(${category})`,
        'success',
        `Fallback exitoso desde Space-Track.org (${items.length} objetos)`
      );
      return {
        items,
        source: 'Space-Track.org (Fallback)',
        fromCache: false,
      };
    } catch (stErr) {
      const msg = stErr instanceof Error ? stErr.message : 'No disponible';
      this.addLog('spacetrack', `getCatalog(${category})`, 'fallback', `Space-Track no disponible: ${msg}`);
    }

    // 4. Fallback 2 (Si es categoría stations, obtener ISS en vivo desde Where the ISS at?)
    if (category === 'stations') {
      try {
        const iss = await whereTheIssProvider.getOrbitalData(25544);
        const seedOthers = getSeedCatalogByCategory('stations').filter((s) => s.noradId !== 25544);
        const combined = [iss, ...seedOthers];
        await orbitalCache.setCatalog(category, combined, ttlHours);
        this.addLog(
          'wheretheiss',
          'getCatalog(stations)',
          'success',
          'Fallback exitoso: TLE de la ISS recuperado en vivo desde WhereTheISS API'
        );
        return {
          items: combined,
          source: 'Where the ISS at? API (Fallback en vivo)',
          fromCache: false,
        };
      } catch {
        // Continuar a caché expirada o semilla
      }
    }

    // 5. Fallback 3: Caché local expirada (permite operar sin conectividad durante un pase)
    const expiredCache = await orbitalCache.getCatalog(category, true);
    if (expiredCache && expiredCache.items.length > 0) {
      this.addLog(
        'cache',
        `getCatalog(${category})`,
        'fallback',
        `Operando en modo offline con caché expirada (${expiredCache.items.length} satélites)`
      );
      return {
        items: expiredCache.items,
        source: 'Caché Local Offline (TTL vencido)',
        fromCache: true,
      };
    }

    // 6. Último recurso garantizado: Catálogo Semilla Offline
    const seedItems = getSeedCatalogByCategory(category);
    await orbitalCache.setCatalog(category, seedItems, ttlHours);
    this.addLog(
      'offline-seed',
      `getCatalog(${category})`,
      'fallback',
      `Cargados ${seedItems.length} satélites desde el catálogo semilla embebido (Offline Resiliency)`
    );
    return {
      items: seedItems,
      source: 'Catálogo Semilla Offline (Fallback)',
      fromCache: true,
    };
  }

  /**
   * Busca satélites por nombre o NORAD ID a través del catálogo activo o consultando directo por ID (RF-01).
   */
  public async searchSatellites(
    query: string,
    currentCatalog: OrbitalElements[]
  ): Promise<OrbitalElements[]> {
    const clean = query.trim().toLowerCase();
    if (!clean) return currentCatalog;

    const localMatches = currentCatalog.filter(
      (item) =>
        item.name.toLowerCase().includes(clean) || String(item.noradId).includes(clean)
    );

    if (localMatches.length > 0) {
      return localMatches;
    }

    // Si el usuario ingresó un NORAD ID numérico que no está en la categoría actual, lo buscamos en las APIs
    const parsedId = Number(clean);
    if (Number.isInteger(parsedId) && parsedId > 0) {
      try {
        const sat = await this.getOrbitalData(parsedId);
        return [sat];
      } catch {
        return [];
      }
    }

    return [];
  }

  public async getOrbitalData(noradId: number, forceRefresh: boolean = false): Promise<OrbitalElements> {
    if (!forceRefresh) {
      const cached = await orbitalCache.getSatellite(noradId, false);
      if (cached) {
        return cached.element;
      }
    }

    try {
      if (this.simulatePrimaryFailure) {
        throw new Error('Falla simulada en CelesTrak');
      }
      const el = await celesTrakProvider.getOrbitalData(noradId);
      await orbitalCache.setSatellite(el);
      this.addLog('celestrak', `getOrbitalData(${noradId})`, 'success', `Datos OMM actualizados para ${el.name}`);
      return el;
    } catch {
      this.addLog('celestrak', `getOrbitalData(${noradId})`, 'fallback', 'Fallo CelesTrak, probando fallback...');
    }

    if (noradId === 25544) {
      try {
        const iss = await whereTheIssProvider.getOrbitalData(25544);
        await orbitalCache.setSatellite(iss);
        this.addLog('wheretheiss', 'getOrbitalData(25544)', 'success', 'TLE obtenido desde WhereTheISS');
        return iss;
      } catch {
        // Continuar
      }
    }

    try {
      const st = await spaceTrackProvider.getOrbitalData(noradId);
      await orbitalCache.setSatellite(st);
      this.addLog('spacetrack', `getOrbitalData(${noradId})`, 'success', 'OMM obtenido desde Space-Track');
      return st;
    } catch {
      // Continuar
    }

    try {
      const n2yo = await n2yoProvider.getOrbitalData(noradId);
      await orbitalCache.setSatellite(n2yo);
      this.addLog('n2yo', `getOrbitalData(${noradId})`, 'success', 'TLE obtenido desde N2YO');
      return n2yo;
    } catch {
      // Continuar
    }

    const expired = await orbitalCache.getSatellite(noradId, true);
    if (expired) {
      return expired.element;
    }

    const allSeeds = [
      ...getSeedCatalogByCategory('stations'),
      ...getSeedCatalogByCategory('weather'),
      ...getSeedCatalogByCategory('gnss'),
      ...getSeedCatalogByCategory('geo'),
      ...getSeedCatalogByCategory('starlink'),
    ];
    const seedMatch = allSeeds.find((s) => s.noradId === noradId);
    if (seedMatch) return seedMatch;

    throw new Error(`No se pudieron obtener datos orbitales para NORAD ${noradId}`);
  }

  /**
   * Obtiene posición externa para validación cruzada (RF-15).
   */
  public async getValidationPosition(
    noradId: number,
    timestampMs: number,
    observer: ObserverLocation,
    preferredProvider?: 'wheretheiss' | 'n2yo'
  ): Promise<ValidationPositionSample> {
    if (preferredProvider === 'wheretheiss' || (noradId === 25544 && !preferredProvider)) {
      const sample = await whereTheIssProvider.getValidationPosition(noradId, timestampMs, observer);
      this.addLog(
        'wheretheiss',
        `getValidationPosition(${noradId})`,
        'success',
        `Posición de referencia obtenida de WhereTheISS (${sample.latitude.toFixed(3)}°, ${sample.longitude.toFixed(3)}°)`
      );
      return sample;
    }

    const sample = await n2yoProvider.getValidationPosition(noradId, timestampMs, observer);
    this.addLog(
      'n2yo',
      `getValidationPosition(${noradId})`,
      'success',
      `Posición de referencia obtenida de N2YO (${sample.latitude.toFixed(3)}°, ${sample.longitude.toFixed(3)}°)`
    );
    return sample;
  }
}

export const dataOrchestrator = new DataOrchestratorService();

