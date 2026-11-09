/**
 * Catálogo semilla de respaldo (Offline Fallback Seed) en formato OMM/JSON y TLE.
 * Garantiza que la aplicación pueda operar sin conexión desde el primer arranque,
 * incluyendo satélites LEO (ISS, SAOCOM 1A/1B, Hubble, Tiangong), MEO (GPS BIIR-2, Galileo),
 * GEO (ARSAT-1, ARSAT-2, GOES-16) y una constelación Starlink (con objetos de 5 y 6 dígitos NORAD).
 */

import { ConstellationCategory, OMMRecord, OrbitalElements } from '../types/orbital';

function buildSeedOMM(
  noradId: number,
  name: string,
  objectId: string,
  meanMotion: number,
  eccentricity: number,
  inclination: number,
  raan: number,
  argPericenter: number,
  meanAnomaly: number,
  bstar: number = 0.00012
): OMMRecord {
  // Generamos un epoch reciente al día en curso para el modo offline de emergencia
  const recentEpoch = new Date(Date.now() - 2 * 3600_000).toISOString().replace('Z', '');
  return {
    OBJECT_NAME: name,
    OBJECT_ID: objectId,
    EPOCH: recentEpoch,
    MEAN_MOTION: meanMotion,
    ECCENTRICITY: eccentricity,
    INCLINATION: inclination,
    RA_OF_ASC_NODE: raan,
    ARG_OF_PERICENTER: argPericenter,
    MEAN_ANOMALY: meanAnomaly,
    EPHEMERIS_TYPE: 0,
    CLASSIFICATION_TYPE: 'U',
    NORAD_CAT_ID: noradId,
    ELEMENT_SET_NO: 999,
    REV_AT_EPOCH: 45120,
    BSTAR: bstar,
    MEAN_MOTION_DOT: 0.000045,
    MEAN_MOTION_DDOT: 0,
  };
}

export function getSeedCatalogByCategory(category: ConstellationCategory): OrbitalElements[] {
  const fetchedAtIso = new Date().toISOString();

  const stations: OrbitalElements[] = [
    {
      noradId: 25544,
      name: 'ISS (ZARYA)',
      category: 'stations',
      epochIso: new Date(Date.now() - 2 * 3600_000).toISOString(),
      fetchedAtIso,
      sourceProvider: 'offline-seed',
      omm: buildSeedOMM(25544, 'ISS (ZARYA)', '1998-067A', 15.50103472, 0.0004872, 51.6416, 128.452, 84.112, 276.045, 0.000164),
    },
    {
      noradId: 48274,
      name: 'CSS (TIANGONG)',
      category: 'stations',
      epochIso: new Date(Date.now() - 3 * 3600_000).toISOString(),
      fetchedAtIso,
      sourceProvider: 'offline-seed',
      omm: buildSeedOMM(48274, 'CSS (TIANGONG)', '2021-035A', 15.6054211, 0.000612, 41.4742, 210.331, 312.5, 47.62, 0.00018),
    },
    {
      noradId: 20580,
      name: 'HST (HUBBLE)',
      category: 'stations',
      epochIso: new Date(Date.now() - 4 * 3600_000).toISOString(),
      fetchedAtIso,
      sourceProvider: 'offline-seed',
      omm: buildSeedOMM(20580, 'HST (HUBBLE)', '1990-037B', 15.168421, 0.000248, 28.4698, 45.821, 152.34, 207.81, 0.000095),
    },
  ];

  const weather: OrbitalElements[] = [
    {
      noradId: 43641,
      name: 'SAOCOM 1A (CONAE)',
      category: 'weather',
      epochIso: new Date(Date.now() - 3 * 3600_000).toISOString(),
      fetchedAtIso,
      sourceProvider: 'offline-seed',
      omm: buildSeedOMM(43641, 'SAOCOM 1A (CONAE)', '2018-076A', 14.828645, 0.000125, 97.8921, 315.42, 91.25, 268.9, 0.000054),
    },
    {
      noradId: 46265,
      name: 'SAOCOM 1B (CONAE)',
      category: 'weather',
      epochIso: new Date(Date.now() - 3 * 3600_000).toISOString(),
      fetchedAtIso,
      sourceProvider: 'offline-seed',
      omm: buildSeedOMM(46265, 'SAOCOM 1B (CONAE)', '2020-059A', 14.828712, 0.000131, 97.8894, 315.48, 89.41, 90.75, 0.000051),
    },
    {
      noradId: 33591,
      name: 'NOAA 19',
      category: 'weather',
      epochIso: new Date(Date.now() - 5 * 3600_000).toISOString(),
      fetchedAtIso,
      sourceProvider: 'offline-seed',
      omm: buildSeedOMM(33591, 'NOAA 19', '2009-005A', 14.129845, 0.001421, 99.1524, 182.61, 124.8, 235.4, 0.000088),
    },
  ];

  const gnss: OrbitalElements[] = [
    {
      noradId: 24876,
      name: 'GPS BIIR-2 (PRN 13)',
      category: 'gnss',
      epochIso: new Date(Date.now() - 4 * 3600_000).toISOString(),
      fetchedAtIso,
      sourceProvider: 'offline-seed',
      omm: buildSeedOMM(24876, 'GPS BIIR-2 (PRN 13)', '1997-035A', 2.0056812, 0.008412, 55.4218, 114.25, 241.6, 118.4, 0),
    },
    {
      noradId: 41859,
      name: 'GALILEO 15 (GSAT0207)',
      category: 'gnss',
      epochIso: new Date(Date.now() - 4 * 3600_000).toISOString(),
      fetchedAtIso,
      sourceProvider: 'offline-seed',
      omm: buildSeedOMM(41859, 'GALILEO 15 (GSAT0207)', '2016-069A', 1.7047512, 0.000285, 56.0412, 65.12, 180.0, 45.2, 0),
    },
  ];

  const geo: OrbitalElements[] = [
    {
      noradId: 40271,
      name: 'ARSAT-1 (GEO 71.8W)',
      category: 'geo',
      epochIso: new Date(Date.now() - 5 * 3600_000).toISOString(),
      fetchedAtIso,
      sourceProvider: 'offline-seed',
      omm: buildSeedOMM(40271, 'ARSAT-1 (GEO 71.8W)', '2014-062A', 1.0027154, 0.000182, 0.021, 82.4, 195.2, 15.8, 0),
    },
    {
      noradId: 40941,
      name: 'ARSAT-2 (GEO 81W)',
      category: 'geo',
      epochIso: new Date(Date.now() - 5 * 3600_000).toISOString(),
      fetchedAtIso,
      sourceProvider: 'offline-seed',
      omm: buildSeedOMM(40941, 'ARSAT-2 (GEO 81W)', '2015-054B', 1.0027098, 0.000145, 0.018, 75.1, 201.4, 6.4, 0),
    },
    {
      noradId: 41866,
      name: 'GOES 16 (GEO 75.2W)',
      category: 'geo',
      epochIso: new Date(Date.now() - 5 * 3600_000).toISOString(),
      fetchedAtIso,
      sourceProvider: 'offline-seed',
      omm: buildSeedOMM(41866, 'GOES 16 (GEO 75.2W)', '2016-071A', 1.0027112, 0.000112, 0.032, 90.0, 180.0, 12.1, 0),
    },
  ];

  // Generación de un tren y malla orbital realista de Starlink (incluyendo IDs de 6 dígitos para demostrar OMM V3)
  const starlink: OrbitalElements[] = Array.from({ length: 36 }).map((_, idx) => {
    const plane = Math.floor(idx / 6);
    const slot = idx % 6;
    const isSixDigit = idx >= 24;
    const noradId = isSixDigit ? 100101 + idx : 44713 + idx;
    const name = isSixDigit
      ? `STARLINK-${31000 + idx} [6-DIGIT OMM]`
      : `STARLINK-${1007 + idx}`;
    const raan = (plane * 60 + 18) % 360;
    const meanAnomaly = (slot * 60 + plane * 10) % 360;
    return {
      noradId,
      name,
      category: 'starlink',
      epochIso: new Date(Date.now() - 2 * 3600_000).toISOString(),
      fetchedAtIso,
      sourceProvider: 'offline-seed',
      omm: buildSeedOMM(
        noradId,
        name,
        `2023-11${plane}A`,
        15.064128, // ~547 km de altitud LEO
        0.000145,
        53.054,
        raan,
        90.0,
        meanAnomaly,
        0.00021
      ),
    };
  });

  switch (category) {
    case 'stations':
      return stations;
    case 'starlink':
      return starlink;
    case 'gnss':
      return gnss;
    case 'weather':
      return weather;
    case 'geo':
      return geo;
    default:
      return [...stations, ...weather, ...gnss, ...geo];
  }
}

