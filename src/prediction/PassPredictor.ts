/**
 * Servicio Predictor de Ventanas de Visibilidad (AOS / Punto Máximo / LOS) (RF-04, RF-05 y Sección 5).
 *
 * Implementa el algoritmo de búsqueda por refinamiento (Paso Grueso -> Paso Fino)
 * recomendado en la Sección 5 de la especificación para no bloquear el hilo de JS:
 * 1. Muestreo Grueso (cada 60 s): identifica intervalos donde el satélite supera la elevación mínima
 *    o alcanza un máximo local cercano al umbral.
 * 2. Refinamiento por Bisección Binaria (precisión ~1 s): determina con exactitud el instante de
 *    AOS (Acquisition of Signal) y LOS (Loss of Signal).
 * 3. Búsqueda Ternaria: halla el instante exacto y ángulo de Máxima Elevación (MAX) durante el pase.
 * 4. Muestreo Polar: genera la curva (azimut(t), elevación(t)) para el Sky Chart en SVG (RF-05).
 */

import * as satellite from 'satellite.js';
import { orbitalEngine } from '../orbital/OrbitalEngine';
import {
  ObserverLocation,
  OrbitalElements,
  PassTrajectoryPoint,
  PassWindow,
} from '../types/orbital';

export interface PredictionOptions {
  horizonHours?: number;
  minElevationDeg?: number;
  maxPasses?: number;
}

class PassPredictorService {
  /**
   * Refina por bisección binaria el instante exacto (precisión ~1 s) en que la elevación
   * cruza el umbral targetElevationDeg entre t1Ms y t2Ms.
   */
  private bisectHorizonCrossing(
    satrec: satellite.SatRec,
    observerGd: { latitude: number; longitude: number; height: number },
    t1Ms: number,
    t2Ms: number,
    targetElevationDeg: number,
    rising: boolean
  ): { timeMs: number; azimuthDeg: number; elevationDeg: number; rangeKm: number } {
    let low = t1Ms;
    let high = t2Ms;
    let bestLook = orbitalEngine.computeLookAnglesFast(
      satrec,
      observerGd,
      rising ? high : low,
      targetElevationDeg
    );

    // 7 iteraciones reducen un intervalo de 60s a < 0.5s
    for (let iter = 0; iter < 7; iter++) {
      const mid = Math.round((low + high) / 2);
      const look = orbitalEngine.computeLookAnglesFast(
        satrec,
        observerGd,
        mid,
        targetElevationDeg
      );
      if (!look) break;
      bestLook = look;

      const isAbove = look.elevationDeg >= targetElevationDeg;
      if (rising) {
        if (isAbove) {
          high = mid;
        } else {
          low = mid;
        }
      } else {
        if (isAbove) {
          low = mid;
        } else {
          high = mid;
        }
      }
    }

    const finalTime = Math.round((low + high) / 2);
    const finalLook =
      orbitalEngine.computeLookAnglesFast(satrec, observerGd, finalTime, targetElevationDeg) ||
      bestLook || { azimuthDeg: 0, elevationDeg: targetElevationDeg, rangeKm: 0 };

    return {
      timeMs: finalTime,
      azimuthDeg: finalLook.azimuthDeg,
      elevationDeg: finalLook.elevationDeg,
      rangeKm: finalLook.rangeKm,
    };
  }

  /**
   * Búsqueda ternaria para encontrar el instante exacto de máxima elevación dentro de [aosMs, losMs].
   */
  private findPeakElevation(
    satrec: satellite.SatRec,
    observerGd: { latitude: number; longitude: number; height: number },
    aosMs: number,
    losMs: number,
    minElevationDeg: number
  ): { timeMs: number; maxElevationDeg: number; maxAzimuthDeg: number; minRangeKm: number } {
    let left = aosMs;
    let right = losMs;

    for (let iter = 0; iter < 12; iter++) {
      if (right - left < 1500) break;
      const m1 = Math.round(left + (right - left) / 3);
      const m2 = Math.round(right - (right - left) / 3);

      const look1 = orbitalEngine.computeLookAnglesFast(satrec, observerGd, m1, minElevationDeg);
      const look2 = orbitalEngine.computeLookAnglesFast(satrec, observerGd, m2, minElevationDeg);

      if (!look1 || !look2) break;
      if (look1.elevationDeg < look2.elevationDeg) {
        left = m1;
      } else {
        right = m2;
      }
    }

    const peakTime = Math.round((left + right) / 2);
    const peakLook = orbitalEngine.computeLookAnglesFast(
      satrec,
      observerGd,
      peakTime,
      minElevationDeg
    ) || { azimuthDeg: 0, elevationDeg: minElevationDeg, rangeKm: 1000 };

    return {
      timeMs: peakTime,
      maxElevationDeg: peakLook.elevationDeg,
      maxAzimuthDeg: peakLook.azimuthDeg,
      minRangeKm: peakLook.rangeKm,
    };
  }

  /**
   * Construye la lista de puntos (az, el) desde el horizonte (0°) pasando por AOS -> MAX -> LOS -> 0°
   * para graficar la curva completa en el Sky Chart polar (RF-05).
   */
  private samplePassTrajectory(
    satrec: satellite.SatRec,
    observerGd: { latitude: number; longitude: number; height: number },
    aosMs: number,
    losMs: number,
    minElevationDeg: number,
    numSamples: number = 32
  ): PassTrajectoryPoint[] {
    // Extendemos ligeramente hacia elevación >= 0° para que la curva toque el anillo exterior del Sky Chart
    const horizonAos = this.bisectHorizonCrossing(
      satrec,
      observerGd,
      aosMs - 180_000,
      aosMs,
      0,
      true
    );
    const horizonLos = this.bisectHorizonCrossing(
      satrec,
      observerGd,
      losMs,
      losMs + 180_000,
      0,
      false
    );

    const startMs = horizonAos.elevationDeg >= -2 ? horizonAos.timeMs : aosMs;
    const endMs = horizonLos.elevationDeg >= -2 ? horizonLos.timeMs : losMs;
    const spanMs = Math.max(10_000, endMs - startMs);

    const points: PassTrajectoryPoint[] = [];
    for (let i = 0; i <= numSamples; i++) {
      const t = Math.round(startMs + (i / numSamples) * spanMs);
      const look = orbitalEngine.computeLookAnglesFast(satrec, observerGd, t, minElevationDeg);
      if (look) {
        points.push({
          timestamp: t,
          azimuthDeg: look.azimuthDeg,
          elevationDeg: Math.max(0, look.elevationDeg),
          rangeKm: look.rangeKm,
        });
      }
    }
    return points;
  }

  /**
   * Calcula las próximas ventanas de visibilidad para un satélite de forma asíncrona,
   * cediendo el control al event loop periódicamente para mantener 60 FPS en la UI.
   */
  public async predictPasses(
    elements: OrbitalElements,
    observer: ObserverLocation,
    startTimeMs: number = Date.now(),
    options: PredictionOptions = {}
  ): Promise<PassWindow[]> {
    const horizonHours = options.horizonHours ?? 24;
    const minElevationDeg = options.minElevationDeg ?? 10;
    const maxPasses = options.maxPasses ?? 8;

    const satrec = orbitalEngine.getSatRec(elements);
    const observerGd = {
      latitude: satellite.degreesToRadians(observer.latitude),
      longitude: satellite.degreesToRadians(observer.longitude),
      height: observer.altitudeMeters / 1000.0,
    };

    const periodMin = orbitalEngine.getOrbitalPeriodMinutes(elements);
    // Caso especial: Satélite Geoestacionario (GEO) visible permanentemente sobre el observador
    if (periodMin >= 1400 && periodMin <= 1480) {
      const nowLook = orbitalEngine.computeLookAnglesFast(
        satrec,
        observerGd,
        startTimeMs,
        minElevationDeg
      );
      if (nowLook && nowLook.elevationDeg >= minElevationDeg) {
        const trajectory: PassTrajectoryPoint[] = Array.from({ length: 12 }).map((_, idx) => {
          const t = startTimeMs + idx * 3600_000;
          const l =
            orbitalEngine.computeLookAnglesFast(satrec, observerGd, t, minElevationDeg) || nowLook;
          return {
            timestamp: t,
            azimuthDeg: l.azimuthDeg,
            elevationDeg: Math.max(0, l.elevationDeg),
            rangeKm: l.rangeKm,
          };
        });
        return [
          {
            id: `geo-${elements.noradId}-${startTimeMs}`,
            noradId: elements.noradId,
            satelliteName: elements.name,
            aosTime: startTimeMs,
            aosAzimuthDeg: nowLook.azimuthDeg,
            maxTime: startTimeMs + 12 * 3600_000,
            maxElevationDeg: nowLook.elevationDeg,
            maxAzimuthDeg: nowLook.azimuthDeg,
            minRangeKm: nowLook.rangeKm,
            losTime: startTimeMs + 24 * 3600_000,
            losAzimuthDeg: nowLook.azimuthDeg,
            durationSeconds: 86400,
            minElevationThresholdDeg: minElevationDeg,
            trajectory,
          },
        ];
      }
    }

    // Paso grueso: 60 segundos
    const coarseStepMs = 60_000;
    const endTimeMs = startTimeMs + horizonHours * 3600_000;
    const passes: PassWindow[] = [];

    let prevTime = startTimeMs;
    let prevLook = orbitalEngine.computeLookAnglesFast(
      satrec,
      observerGd,
      prevTime,
      minElevationDeg
    );
    if (!prevLook) return [];

    let inPass = prevLook.elevationDeg >= minElevationDeg;
    let currentAos = inPass
      ? {
          timeMs: startTimeMs,
          azimuthDeg: prevLook.azimuthDeg,
          elevationDeg: prevLook.elevationDeg,
          rangeKm: prevLook.rangeKm,
        }
      : null;

    let stepCount = 0;
    for (let t = startTimeMs + coarseStepMs; t <= endTimeMs; t += coarseStepMs) {
      stepCount++;
      // Cedemos el hilo de JS cada 250 evaluaciones para no bloquear animaciones de UI
      if (stepCount % 250 === 0) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }

      const currLook = orbitalEngine.computeLookAnglesFast(
        satrec,
        observerGd,
        t,
        minElevationDeg
      );
      if (!currLook) continue;

      const isAbove = currLook.elevationDeg >= minElevationDeg;

      if (!inPass && isAbove) {
        // Transición ascendente detectada: refinar AOS por bisección
        inPass = true;
        currentAos = this.bisectHorizonCrossing(
          satrec,
          observerGd,
          prevTime,
          t,
          minElevationDeg,
          true
        );
      } else if (inPass && !isAbove && currentAos) {
        // Transición descendente detectada: refinar LOS por bisección
        inPass = false;
        const refinedLos = this.bisectHorizonCrossing(
          satrec,
          observerGd,
          prevTime,
          t,
          minElevationDeg,
          false
        );

        const peak = this.findPeakElevation(
          satrec,
          observerGd,
          currentAos.timeMs,
          refinedLos.timeMs,
          minElevationDeg
        );

        if (peak.maxElevationDeg >= minElevationDeg) {
          const durationSeconds = Math.max(
            1,
            Math.round((refinedLos.timeMs - currentAos.timeMs) / 1000)
          );
          const trajectory = this.samplePassTrajectory(
            satrec,
            observerGd,
            currentAos.timeMs,
            refinedLos.timeMs,
            minElevationDeg
          );

          passes.push({
            id: `pass-${elements.noradId}-${currentAos.timeMs}`,
            noradId: elements.noradId,
            satelliteName: elements.name,
            aosTime: currentAos.timeMs,
            aosAzimuthDeg: currentAos.azimuthDeg,
            maxTime: peak.timeMs,
            maxElevationDeg: peak.maxElevationDeg,
            maxAzimuthDeg: peak.maxAzimuthDeg,
            minRangeKm: peak.minRangeKm,
            losTime: refinedLos.timeMs,
            losAzimuthDeg: refinedLos.azimuthDeg,
            durationSeconds,
            minElevationThresholdDeg: minElevationDeg,
            trajectory,
          });

          if (passes.length >= maxPasses) {
            break;
          }
        }
        currentAos = null;
      }

      prevTime = t;
      prevLook = currLook;
    }

    return passes;
  }
}

export const passPredictor = new PassPredictorService();

