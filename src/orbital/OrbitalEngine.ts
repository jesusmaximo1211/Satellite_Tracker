/**
 * Motor Orbital SGP4 / SDP4 (Sección 4.1, 4.4 y 5).
 * Responsabilidades:
 * - Inicialización de registros satelitales (SatRec) desde OMM/JSON (incluyendo NORAD IDs de 6 dígitos) y TLE.
 * - Propagación SGP4/SDP4 en el sistema inercial ECI (TEME) y transformación a coordenadas geodésicas WGS84 (lat, lon, alt).
 * - Transformación ECI -> ECF -> Topocéntrica (Azimut, Elevación, Slant Range) respecto del observador (RF-02, RF-03).
 * - Generación del Ground Track pasado y futuro con resolución matemática del cruce del antimeridiano (±180°) (RF-11).
 * - Cálculo geométrico del Footprint (área de cobertura sobre la superficie terrestre) según altitud y elevación mínima (RF-12).
 * - Propagación en lote optimizada para capas de constelación (Starlink) sin bloquear el hilo de UI (RF-13).
 */

import * as satellite from 'satellite.js';
import type { OMMJsonObject, SatRec } from 'satellite.js';
import { orbitalCache } from '../providers/OrbitalCache';
import {
  FootprintGeometry,
  GroundTrackSegment,
  LatLonPoint,
  ObserverLocation,
  OrbitalElements,
  SatelliteRealtimeState,
  SubsatellitePoint,
  TopocentricLookAngles,
} from '../types/orbital';

export const EARTH_RADIUS_KM = 6371.0088;
const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

function normalizeLongitude(lonDeg: number): number {
  let lon = ((lonDeg + 180) % 360 + 360) % 360 - 180;
  if (lon === -180 && lonDeg > 0) lon = 180;
  return lon;
}

class OrbitalEngineService {
  private satrecCache = new Map<string, SatRec>();

  /**
   * Compila y cachea la estructura SatRec de satellite.js priorizando OMM/JSON sobre TLE (Sección 4.1).
   */
  public getSatRec(elements: OrbitalElements): SatRec {
    const cacheKey = `${elements.noradId}:${elements.epochIso}`;
    const existing = this.satrecCache.get(cacheKey);
    if (existing) {
      return existing;
    }

    let satrec: SatRec;
    if (elements.omm) {
      const ommInput: OMMJsonObject = {
        OBJECT_NAME: elements.omm.OBJECT_NAME,
        OBJECT_ID: elements.omm.OBJECT_ID,
        EPOCH: elements.omm.EPOCH.replace(/Z$/, ''),
        MEAN_MOTION: elements.omm.MEAN_MOTION,
        ECCENTRICITY: elements.omm.ECCENTRICITY,
        INCLINATION: elements.omm.INCLINATION,
        RA_OF_ASC_NODE: elements.omm.RA_OF_ASC_NODE,
        ARG_OF_PERICENTER: elements.omm.ARG_OF_PERICENTER,
        MEAN_ANOMALY: elements.omm.MEAN_ANOMALY,
        EPHEMERIS_TYPE: 0,
        CLASSIFICATION_TYPE: elements.omm.CLASSIFICATION_TYPE || 'U',
        NORAD_CAT_ID: elements.omm.NORAD_CAT_ID,
        ELEMENT_SET_NO: elements.omm.ELEMENT_SET_NO ?? 999,
        REV_AT_EPOCH: elements.omm.REV_AT_EPOCH ?? 1,
        BSTAR: elements.omm.BSTAR,
        MEAN_MOTION_DOT: elements.omm.MEAN_MOTION_DOT,
        MEAN_MOTION_DDOT: elements.omm.MEAN_MOTION_DDOT,
      };
      satrec = satellite.json2satrec(ommInput);
    } else if (elements.tle) {
      satrec = satellite.twoline2satrec(elements.tle.line1, elements.tle.line2);
    } else {
      throw new Error(`El satélite ${elements.noradId} no posee datos OMM ni TLE`);
    }

    if (this.satrecCache.size > 500) {
      this.satrecCache.clear();
    }
    this.satrecCache.set(cacheKey, satrec);
    return satrec;
  }

  /**
   * Obtiene el período orbital en minutos a partir del movimiento medio (mean motion).
   */
  public getOrbitalPeriodMinutes(elements: OrbitalElements): number {
    if (elements.omm && elements.omm.MEAN_MOTION > 0) {
      return 1440.0 / Number(elements.omm.MEAN_MOTION);
    }
    const satrec = this.getSatRec(elements);
    // satrec.no está en radianes por minuto
    if (satrec.no > 0) {
      return (2 * Math.PI) / satrec.no;
    }
    return 95;
  }

  public classifyOrbitRegime(altitudeKm: number, periodMinutes: number): 'LEO' | 'MEO' | 'GEO' | 'HEO' {
    if (periodMinutes >= 1400 && periodMinutes <= 1480) return 'GEO';
    if (altitudeKm < 2000) return 'LEO';
    if (altitudeKm >= 2000 && altitudeKm < 35000) return 'MEO';
    return 'HEO';
  }

  /**
   * Propaga el estado completo del satélite para el instante timestampMs respecto al observador (RF-02 y RF-03).
   */
  public propagateRealtimeState(
    elements: OrbitalElements,
    observer: ObserverLocation,
    timestampMs: number = Date.now(),
    minElevationDeg: number = 10
  ): SatelliteRealtimeState | null {
    const satrec = this.getSatRec(elements);
    const date = new Date(timestampMs);
    const pv = satellite.propagate(satrec, date);

    if (!pv || !pv.position || !pv.velocity) {
      // Manejo explícito de errores según el enum SatRecError de satellite.js v7.1.0
      if (satrec.error === satellite.SatRecError.Decayed) {
        return null;
      }
      return null;
    }

    const positionEci = pv.position;
    const velocityEci = pv.velocity;
    const gmst = satellite.gstime(date);

    // 1. Coordenadas geodésicas del punto subsatelital (RF-02)
    const geodetic = satellite.eciToGeodetic(positionEci, gmst);
    const latitude = satellite.degreesLat(geodetic.latitude);
    const longitude = satellite.degreesLong(geodetic.longitude);
    const altitudeKm = geodetic.height;
    const velocityKmS = Math.sqrt(
      velocityEci.x * velocityEci.x +
        velocityEci.y * velocityEci.y +
        velocityEci.z * velocityEci.z
    );

    // 2. Coordenadas topocéntricas, Factor Doppler y Fracción de Sombra Solar (satellite.js v7.1.0)
    const observerGd = {
      latitude: satellite.degreesToRadians(observer.latitude),
      longitude: satellite.degreesToRadians(observer.longitude),
      height: observer.altitudeMeters / 1000.0,
    };
    const observerEcf = satellite.geodeticToEcf(observerGd);
    const positionEcf = satellite.eciToEcf(positionEci, gmst);
    const velocityEcf = satellite.eciToEcf(velocityEci, gmst);
    const lookAngles = satellite.ecfToLookAngles(observerGd, positionEcf);
    const doppler = satellite.dopplerFactor(observerEcf, positionEcf, velocityEcf);

    // Cálculo de iluminación solar / eclipse mediante sunPos y shadowFraction de satellite.js
    const jd = satellite.jday(date);
    const sun = satellite.sunPos(jd);
    const shadowFrac = satellite.shadowFraction(sun.rsun, positionEci);
    const illumination: 'Iluminado (Sol)' | 'Penumbra' | 'Eclipse (Umbra)' =
      shadowFrac <= 0.01
        ? 'Iluminado (Sol)'
        : shadowFrac >= 0.99
        ? 'Eclipse (Umbra)'
        : 'Penumbra';

    const azimuthDeg = (satellite.radiansToDegrees(lookAngles.azimuth) + 360) % 360;
    const elevationDeg = satellite.radiansToDegrees(lookAngles.elevation);
    const rangeKm = lookAngles.rangeSat;

    const periodMinutes = this.getOrbitalPeriodMinutes(elements);
    const epochAgeHours = orbitalCache.getEpochAgeHours(elements.epochIso, timestampMs);

    return {
      noradId: elements.noradId,
      name: elements.name,
      category: elements.category,
      orbitRegime: this.classifyOrbitRegime(altitudeKm, periodMinutes),
      periodMinutes,
      epochIso: elements.epochIso,
      epochAgeHours,
      isEpochStale: orbitalCache.isEpochStale(elements.epochIso),
      sourceProvider: elements.sourceProvider,
      latitude,
      longitude,
      altitudeKm,
      velocityKmS,
      timestamp: timestampMs,
      azimuthDeg,
      elevationDeg,
      rangeKm,
      isVisible: elevationDeg >= minElevationDeg,
      dopplerFactor: doppler,
      shadowFraction: shadowFrac,
      illumination,
    };
  }

  /**
   * Evaluación ultrarrápida únicamente de ángulos topocéntricos (usada por el predictor AOS/LOS).
   */
  public computeLookAnglesFast(
    satrec: SatRec,
    observerGd: { latitude: number; longitude: number; height: number },
    timestampMs: number,
    minElevationDeg: number
  ): TopocentricLookAngles | null {
    const date = new Date(timestampMs);
    const pv = satellite.propagate(satrec, date);
    if (!pv || !pv.position) return null;

    const gmst = satellite.gstime(date);
    const positionEcf = satellite.eciToEcf(pv.position, gmst);
    const look = satellite.ecfToLookAngles(observerGd, positionEcf);

    const azimuthDeg = (satellite.radiansToDegrees(look.azimuth) + 360) % 360;
    const elevationDeg = satellite.radiansToDegrees(look.elevation);

    return {
      azimuthDeg,
      elevationDeg,
      rangeKm: look.rangeSat,
      isVisible: elevationDeg >= minElevationDeg,
    };
  }

  /**
   * Divide una secuencia de puntos (lat, lon) en segmentos independientes cada vez
   * que la trayectoria cruza el antimeridiano (±180°), interpolando la latitud exacta en el borde.
   * Cumple estrictamente con RF-11 y Sección 4.4.
   */
  public splitAntimeridianSegments(
    rawPoints: LatLonPoint[],
    isPast: boolean,
    prefix: string
  ): GroundTrackSegment[] {
    if (rawPoints.length === 0) return [];

    const segments: GroundTrackSegment[] = [];
    let currentPoints: LatLonPoint[] = [rawPoints[0]];
    let segIdx = 0;

    for (let i = 1; i < rawPoints.length; i++) {
      const prev = rawPoints[i - 1];
      const curr = rawPoints[i];
      const deltaLon = curr.longitude - prev.longitude;

      if (Math.abs(deltaLon) > 180) {
        // Cruce del antimeridiano detectado (salto > 180°)
        const lon1 = prev.longitude;
        const lon2 = curr.longitude;
        // Calculamos cuánto falta desde lon1 hasta el borde ±180°
        const boundary1 = lon1 >= 0 ? 180 : -180;
        const boundary2 = -boundary1;
        const unwrappedLon2 = lon2 > 0 ? lon2 - 360 : lon2 + 360;
        const totalSpan = unwrappedLon2 - lon1;
        const fraction =
          Math.abs(totalSpan) > 1e-6 ? Math.abs((boundary1 - lon1) / totalSpan) : 0.5;
        const crossLat = prev.latitude + fraction * (curr.latitude - prev.latitude);

        // Cerramos el segmento actual exactamente en el meridiano ±180°
        currentPoints.push({ latitude: crossLat, longitude: boundary1 });
        segments.push({
          id: `${prefix}-seg-${segIdx++}`,
          points: currentPoints,
          isPast,
        });

        // Iniciamos el nuevo segmento desde el meridiano opuesto ∓180°
        currentPoints = [{ latitude: crossLat, longitude: boundary2 }, curr];
      } else {
        currentPoints.push(curr);
      }
    }

    if (currentPoints.length >= 2) {
      segments.push({
        id: `${prefix}-seg-${segIdx}`,
        points: currentPoints,
        isPast,
      });
    }

    return segments;
  }

  /**
   * Genera el Ground Track pasado (0.5 órbitas) y futuro (1.0 órbita completa)
   * con muestreo adaptativo (30-60s en LEO) y corte en el antimeridiano (RF-11).
   */
  public computeGroundTrack(
    elements: OrbitalElements,
    centerTimeMs: number = Date.now()
  ): GroundTrackSegment[] {
    const satrec = this.getSatRec(elements);
    const periodMin = Math.min(Math.max(this.getOrbitalPeriodMinutes(elements), 85), 1440);
    const periodMs = periodMin * 60_000;

    // Paso de 45 segundos para LEO (~95 min), escalado proporcionalmente para MEO/GEO (Sección 4.4)
    const stepMs = periodMin <= 180 ? 45_000 : Math.round((periodMs / 140));
    const pastDurationMs = Math.round(periodMs * 0.5);
    const futureDurationMs = Math.round(periodMs * 1.05); // Al menos una órbita completa hacia adelante

    const pastRaw: LatLonPoint[] = [];
    for (let t = centerTimeMs - pastDurationMs; t <= centerTimeMs; t += stepMs) {
      const date = new Date(t);
      const pv = satellite.propagate(satrec, date);
      if (pv && pv.position) {
        const gmst = satellite.gstime(date);
        const geo = satellite.eciToGeodetic(pv.position, gmst);
        pastRaw.push({
          latitude: satellite.degreesLat(geo.latitude),
          longitude: satellite.degreesLong(geo.longitude),
        });
      }
    }

    const futureRaw: LatLonPoint[] = [];
    for (let t = centerTimeMs; t <= centerTimeMs + futureDurationMs; t += stepMs) {
      const date = new Date(t);
      const pv = satellite.propagate(satrec, date);
      if (pv && pv.position) {
        const gmst = satellite.gstime(date);
        const geo = satellite.eciToGeodetic(pv.position, gmst);
        futureRaw.push({
          latitude: satellite.degreesLat(geo.latitude),
          longitude: satellite.degreesLong(geo.longitude),
        });
      }
    }

    return [
      ...this.splitAntimeridianSegments(pastRaw, true, `gt-past-${elements.noradId}`),
      ...this.splitAntimeridianSegments(futureRaw, false, `gt-fut-${elements.noradId}`),
    ];
  }

  /**
   * Calcula la geometría del Footprint (área de cobertura del satélite sobre la Tierra)
   * según su altitud instantánea h y un ángulo de elevación mínima configurable ε_min (RF-12).
   *
   * Ecuación de ángulo central terrestre ρ:
   *   ρ = arccos( (R_E / (R_E + h)) * cos(ε_min) ) - ε_min
   */
  public computeFootprint(
    centerLatDeg: number,
    centerLonDeg: number,
    altitudeKm: number,
    minElevationDeg: number = 10,
    numVertices: number = 72
  ): FootprintGeometry {
    const safeAltKm = Math.max(100, altitudeKm);
    const elRad = Math.max(0, Math.min(85, minElevationDeg)) * DEG_TO_RAD;

    const ratio = (EARTH_RADIUS_KM / (EARTH_RADIUS_KM + safeAltKm)) * Math.cos(elRad);
    const clampedRatio = Math.max(-1, Math.min(1, ratio));
    const centralAngleRad = Math.max(0.005, Math.acos(clampedRatio) - elRad);

    const centralAngleDeg = centralAngleRad * RAD_TO_DEG;
    const surfaceRadiusKm = EARTH_RADIUS_KM * centralAngleRad;

    // Slant range al borde del footprint por ley de senos/cosenos
    const slantRangeHorizonKm = Math.sqrt(
      EARTH_RADIUS_KM * EARTH_RADIUS_KM +
        (EARTH_RADIUS_KM + safeAltKm) * (EARTH_RADIUS_KM + safeAltKm) -
        2 * EARTH_RADIUS_KM * (EARTH_RADIUS_KM + safeAltKm) * Math.cos(centralAngleRad)
    );

    const lat1 = centerLatDeg * DEG_TO_RAD;
    const lon1 = centerLonDeg * DEG_TO_RAD;
    const sinLat1 = Math.sin(lat1);
    const cosLat1 = Math.cos(lat1);
    const sinRho = Math.sin(centralAngleRad);
    const cosRho = Math.cos(centralAngleRad);

    const ringPoints: LatLonPoint[] = [];
    for (let i = 0; i <= numVertices; i++) {
      const bearing = (i / numVertices) * 2 * Math.PI;
      const sinLat2 = sinLat1 * cosRho + cosLat1 * sinRho * Math.cos(bearing);
      const lat2 = Math.asin(Math.max(-1, Math.min(1, sinLat2)));
      const y = Math.sin(bearing) * sinRho * cosLat1;
      const x = cosRho - sinLat1 * Math.sin(lat2);
      const lon2 = lon1 + Math.atan2(y, x);

      ringPoints.push({
        latitude: lat2 * RAD_TO_DEG,
        longitude: normalizeLongitude(lon2 * RAD_TO_DEG),
      });
    }

    // Dividimos el borde del footprint si cruza el antimeridiano para evitar artefactos en el mapa
    const segments = this.splitAntimeridianSegments(ringPoints, false, 'fp').map((s) => s.points);

    return {
      centerLat: centerLatDeg,
      centerLon: centerLonDeg,
      altitudeKm: safeAltKm,
      minElevationDeg,
      centralAngleDeg,
      surfaceRadiusKm,
      slantRangeHorizonKm,
      polygonSegments: segments,
    };
  }

  /**
   * Propaga en lote un conjunto de satélites para la capa de constelación (p. ej. Starlink),
   * respetando un límite máximo de objetos simultáneos (RF-13).
   */
  public propagateConstellationBatch(
    catalog: OrbitalElements[],
    observer: ObserverLocation,
    timestampMs: number = Date.now(),
    maxObjects: number = 60,
    minElevationDeg: number = 10
  ): SatelliteRealtimeState[] {
    const subset = catalog.slice(0, maxObjects);
    const states: SatelliteRealtimeState[] = [];

    for (const item of subset) {
      const st = this.propagateRealtimeState(item, observer, timestampMs, minElevationDeg);
      if (st) {
        states.push(st);
      }
    }

    return states;
  }

  /**
   * Calcula el error geodésico superficial (Haversine) y el error espacial 3D ECEF en km
   * entre la posición calculada localmente y una fuente externa (N2YO / Where the ISS at?) (RF-15).
   */
  public computePositionErrorsKm(
    local: SubsatellitePoint,
    external: { latitude: number; longitude: number; altitudeKm: number }
  ): { surfaceErrorKm: number; altitudeErrorKm: number; spatial3dErrorKm: number } {
    const dLat = (external.latitude - local.latitude) * DEG_TO_RAD;
    const dLon = (external.longitude - local.longitude) * DEG_TO_RAD;
    const lat1 = local.latitude * DEG_TO_RAD;
    const lat2 = external.latitude * DEG_TO_RAD;

    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
    const surfaceErrorKm = EARTH_RADIUS_KM * c;

    const altitudeErrorKm = Math.abs(external.altitudeKm - local.altitudeKm);

    const ecfLocal = satellite.geodeticToEcf({
      latitude: lat1,
      longitude: local.longitude * DEG_TO_RAD,
      height: local.altitudeKm,
    });
    const ecfExt = satellite.geodeticToEcf({
      latitude: lat2,
      longitude: external.longitude * DEG_TO_RAD,
      height: external.altitudeKm,
    });

    const dx = ecfExt.x - ecfLocal.x;
    const dy = ecfExt.y - ecfLocal.y;
    const dz = ecfExt.z - ecfLocal.z;
    const spatial3dErrorKm = Math.sqrt(dx * dx + dy * dy + dz * dz);

    return {
      surfaceErrorKm,
      altitudeErrorKm,
      spatial3dErrorKm,
    };
  }
}

export const orbitalEngine = new OrbitalEngineService();
