/**
 * Tipos e interfaces centrales del dominio orbital y proveedores de datos (TP7 Satellite Tracker)
 */

export type ProviderId = 'celestrak' | 'spacetrack' | 'n2yo' | 'wheretheiss' | 'offline-seed';

export type ConstellationCategory =
  | 'stations' // Estaciones espaciales (ISS, Tiangong)
  | 'starlink' // Constelación Starlink (SupGP)
  | 'gnss'     // Navegación (GPS, Galileo, GLONASS)
  | 'weather'  // Meteorológicos (NOAA, GOES, METEOR)
  | 'geo';     // Geoestacionarios de comunicaciones

/**
 * Formato estándar CCSDS OMM (Orbit Mean-Elements Message) en JSON.
 * Requerido en Sección 4.1 para soportar números de catálogo NORAD de 6 dígitos
 * sin la limitación de 5 columnas del formato TLE tradicional.
 */
export interface OMMRecord {
  OBJECT_NAME: string;
  OBJECT_ID: string;
  EPOCH: string;
  MEAN_MOTION: number;
  ECCENTRICITY: number;
  INCLINATION: number;
  RA_OF_ASC_NODE: number;
  ARG_OF_PERICENTER: number;
  MEAN_ANOMALY: number;
  EPHEMERIS_TYPE?: 0;
  CLASSIFICATION_TYPE?: 'U' | 'C';
  NORAD_CAT_ID: number;
  ELEMENT_SET_NO: number;
  REV_AT_EPOCH?: number;
  BSTAR: number;
  MEAN_MOTION_DOT: number;
  MEAN_MOTION_DDOT: number;
  [key: string]: unknown;
}

/**
 * Formato clásico Two-Line Element Set (TLE).
 */
export interface TLERecord {
  name: string;
  line1: string;
  line2: string;
}

/**
 * Registro orbital unificado almacenado en caché y consumido por el motor SGP4.
 */
export interface OrbitalElements {
  noradId: number;
  name: string;
  category: ConstellationCategory;
  epochIso: string;
  fetchedAtIso: string;
  sourceProvider: ProviderId;
  omm?: OMMRecord;
  tle?: TLERecord;
}

export interface ObserverLocation {
  latitude: number;       // Grados decimales (-90 a 90)
  longitude: number;      // Grados decimales (-180 a 180)
  altitudeMeters: number; // Altitud sobre el nivel del mar (m)
  label: string;
  isGps: boolean;
}

export interface SubsatellitePoint {
  latitude: number;       // Grados decimales
  longitude: number;      // Grados decimales
  altitudeKm: number;     // Altitud geodésica sobre el elipsoide WGS84 (km)
  velocityKmS: number;    // Magnitud del vector velocidad orbital (km/s)
  timestamp: number;      // Epoch Unix en ms
}

export interface TopocentricLookAngles {
  azimuthDeg: number;     // 0° = Norte, 90° = Este, 180° = Sur, 270° = Oeste
  elevationDeg: number;   // -90° a +90° (positivo sobre el horizonte local)
  rangeKm: number;        // Distancia directa (slant range) observador -> satélite (km)
  isVisible: boolean;     // true si elevationDeg >= minElevationDeg
}

export interface SatelliteRealtimeState extends SubsatellitePoint, TopocentricLookAngles {
  noradId: number;
  name: string;
  category: ConstellationCategory;
  orbitRegime: 'LEO' | 'MEO' | 'GEO' | 'HEO';
  periodMinutes: number;
  epochIso: string;
  epochAgeHours: number;
  isEpochStale: boolean;  // true si supera el TTL recomendado (24 h)
  sourceProvider: ProviderId;
  dopplerFactor: number;  // Factor Doppler de satellite.js (1 - rangeRate/c)
  shadowFraction: number; // 0 = iluminado por el Sol, (0..1) = penumbra, 1 = eclipse/umbra terrestre
  illumination: 'Iluminado (Sol)' | 'Penumbra' | 'Eclipse (Umbra)';
}

export interface LatLonPoint {
  latitude: number;
  longitude: number;
}

export interface GroundTrackSegment {
  id: string;
  points: LatLonPoint[];
  isPast: boolean;
}

export interface FootprintGeometry {
  centerLat: number;
  centerLon: number;
  altitudeKm: number;
  minElevationDeg: number;
  centralAngleDeg: number;
  surfaceRadiusKm: number;
  slantRangeHorizonKm: number;
  polygonSegments: LatLonPoint[][];
}

export interface PassTrajectoryPoint {
  timestamp: number;
  azimuthDeg: number;
  elevationDeg: number;
  rangeKm: number;
}

export interface PassWindow {
  id: string;
  noradId: number;
  satelliteName: string;
  aosTime: number;
  aosAzimuthDeg: number;
  maxTime: number;
  maxElevationDeg: number;
  maxAzimuthDeg: number;
  minRangeKm: number;
  losTime: number;
  losAzimuthDeg: number;
  durationSeconds: number;
  minElevationThresholdDeg: number;
  trajectory: PassTrajectoryPoint[];
}

export interface ValidationPositionSample {
  provider: ProviderId;
  noradId: number;
  timestamp: number;
  latitude: number;
  longitude: number;
  altitudeKm: number;
  velocityKmS?: number;
  azimuthDeg?: number;
  elevationDeg?: number;
}

export interface ValidationComparisonResult {
  id: string;
  noradId: number;
  satelliteName: string;
  providerCompared: ProviderId;
  timestamp: number;
  epochAgeHours: number;
  local: {
    latitude: number;
    longitude: number;
    altitudeKm: number;
    azimuthDeg: number;
    elevationDeg: number;
  };
  external: ValidationPositionSample;
  surfaceErrorKm: number;   // Distancia geodésica Haversine sobre la esfera terrestre (km)
  altitudeErrorKm: number;  // |alt_local - alt_ext| (km)
  spatial3dErrorKm: number; // Distancia euclidiana 3D ECEF (km)
  azimuthDiffDeg?: number;
  elevationDiffDeg?: number;
}

/**
 * Interfaz común DataProvider exigida en Sección 4.3 (RF-14)
 */
export interface DataProvider {
  readonly id: ProviderId;
  readonly displayName: string;

  /**
   * Obtiene el catálogo de elementos orbitales para una categoría o constelación.
   */
  getCatalog(category: ConstellationCategory): Promise<OrbitalElements[]>;

  /**
   * Obtiene los datos orbitales (OMM o TLE) para un satélite específico por su NORAD ID.
   */
  getOrbitalData(noradId: number): Promise<OrbitalElements>;

  /**
   * Obtiene una posición independiente para validación cruzada (RF-15).
   */
  getValidationPosition(
    noradId: number,
    timestampMs: number,
    observer: ObserverLocation
  ): Promise<ValidationPositionSample>;
}
