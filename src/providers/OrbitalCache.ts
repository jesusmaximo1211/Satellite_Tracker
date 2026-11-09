/**
 * Caché local persistente de datos orbitales con TTL (12-24 h) y control de antigüedad (RF-09, RF-14, RF-16).
 * Permite operar completamente offline en el momento de un pase satelital.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { ConstellationCategory, OrbitalElements } from '../types/orbital';

const CACHE_PREFIX_CATALOG = '@tp7_orbital_catalog_v1:';
const CACHE_PREFIX_SAT = '@tp7_orbital_sat_v1:';

// TTL por defecto: 12 horas (dentro de la ventana 12-24h solicitada en RF-09)
export const DEFAULT_TTL_HOURS = 12;
// Umbral de alerta de datos orbitales desactualizados (RF-16): 24 horas
export const STALE_EPOCH_THRESHOLD_HOURS = 24;

interface CachedCatalogPayload {
  category: ConstellationCategory;
  savedAtMs: number;
  ttlHours: number;
  items: OrbitalElements[];
}

interface CachedSatellitePayload {
  noradId: number;
  savedAtMs: number;
  ttlHours: number;
  element: OrbitalElements;
}

class OrbitalCacheService {
  private memoryCatalog = new Map<ConstellationCategory, CachedCatalogPayload>();
  private memorySatellites = new Map<number, CachedSatellitePayload>();

  /**
   * Calcula la antigüedad en horas del Epoch orbital (TLE/OMM) respecto de un instante dado.
   */
  public getEpochAgeHours(epochIso: string, referenceTimeMs: number = Date.now()): number {
    const normalizedIso = epochIso.endsWith('Z') ? epochIso : `${epochIso}Z`;
    const epochMs = Date.parse(normalizedIso);
    if (Number.isNaN(epochMs)) {
      return 0;
    }
    return Math.max(0, (referenceTimeMs - epochMs) / 3600_000);
  }

  public isEpochStale(epochIso: string, thresholdHours: number = STALE_EPOCH_THRESHOLD_HOURS): boolean {
    return this.getEpochAgeHours(epochIso) > thresholdHours;
  }

  public async getCatalog(
    category: ConstellationCategory,
    allowExpired: boolean = false
  ): Promise<{ items: OrbitalElements[]; isExpired: boolean; savedAtMs: number } | null> {
    const now = Date.now();
    let payload = this.memoryCatalog.get(category) || null;

    if (!payload) {
      try {
        const raw = await AsyncStorage.getItem(`${CACHE_PREFIX_CATALOG}${category}`);
        if (raw) {
          payload = JSON.parse(raw) as CachedCatalogPayload;
          this.memoryCatalog.set(category, payload);
        }
      } catch {
        // Ignorar errores de lectura de disco y continuar
      }
    }

    if (!payload) return null;

    const ageHours = (now - payload.savedAtMs) / 3600_000;
    const isExpired = ageHours >= payload.ttlHours;

    if (isExpired && !allowExpired) {
      return null;
    }

    return {
      items: payload.items,
      isExpired,
      savedAtMs: payload.savedAtMs,
    };
  }

  public async setCatalog(
    category: ConstellationCategory,
    items: OrbitalElements[],
    ttlHours: number = DEFAULT_TTL_HOURS
  ): Promise<void> {
    const now = Date.now();
    const payload: CachedCatalogPayload = {
      category,
      savedAtMs: now,
      ttlHours,
      items,
    };

    this.memoryCatalog.set(category, payload);
    for (const item of items) {
      this.memorySatellites.set(item.noradId, {
        noradId: item.noradId,
        savedAtMs: now,
        ttlHours,
        element: item,
      });
    }

    try {
      await AsyncStorage.setItem(`${CACHE_PREFIX_CATALOG}${category}`, JSON.stringify(payload));
    } catch {
      // Si el almacenamiento lleno falla, la caché en memoria sigue activa
    }
  }

  public async getSatellite(
    noradId: number,
    allowExpired: boolean = false
  ): Promise<{ element: OrbitalElements; isExpired: boolean } | null> {
    const now = Date.now();
    let payload = this.memorySatellites.get(noradId) || null;

    if (!payload) {
      try {
        const raw = await AsyncStorage.getItem(`${CACHE_PREFIX_SAT}${noradId}`);
        if (raw) {
          payload = JSON.parse(raw) as CachedSatellitePayload;
          this.memorySatellites.set(noradId, payload);
        }
      } catch {
        // Ignorar fallo de disco
      }
    }

    if (!payload) return null;

    const ageHours = (now - payload.savedAtMs) / 3600_000;
    const isExpired = ageHours >= payload.ttlHours;

    if (isExpired && !allowExpired) {
      return null;
    }

    return {
      element: payload.element,
      isExpired,
    };
  }

  public async setSatellite(
    element: OrbitalElements,
    ttlHours: number = DEFAULT_TTL_HOURS
  ): Promise<void> {
    const payload: CachedSatellitePayload = {
      noradId: element.noradId,
      savedAtMs: Date.now(),
      ttlHours,
      element,
    };
    this.memorySatellites.set(element.noradId, payload);
    try {
      await AsyncStorage.setItem(`${CACHE_PREFIX_SAT}${element.noradId}`, JSON.stringify(payload));
    } catch {
      // Continuar con caché en memoria
    }
  }

  public async clearAll(): Promise<void> {
    this.memoryCatalog.clear();
    this.memorySatellites.clear();
    try {
      const keys = await AsyncStorage.getAllKeys();
      const targetKeys = keys.filter(
        (k) => k.startsWith(CACHE_PREFIX_CATALOG) || k.startsWith(CACHE_PREFIX_SAT)
      );
      if (targetKeys.length > 0) {
        await AsyncStorage.multiRemove(targetKeys);
      }
    } catch {
      // Ignorar
    }
  }
}

export const orbitalCache = new OrbitalCacheService();

