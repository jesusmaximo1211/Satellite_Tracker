/**
 * Capa de Validación Cruzada (Validation Layer - RF-15 y Sección 5):
 * Compara la posición calculada localmente mediante SGP4 (satellite.js) contra:
 * 1. Where the ISS at? (para la Estación Espacial Internacional, NORAD 25544)
 * 2. N2YO REST API (para cualquier satélite del catálogo)
 * Calcula el error geodésico superficial (Haversine en km), error de altitud (km)
 * y error espacial euclidiano 3D ECEF (km), registrando la antigüedad del Epoch orbital.
 */

import { orbitalEngine } from '../orbital/OrbitalEngine';
import { dataOrchestrator } from '../providers/DataOrchestrator';
import {
  ObserverLocation,
  OrbitalElements,
  ValidationComparisonResult,
} from '../types/orbital';

class ValidationService {
  private history: ValidationComparisonResult[] = [];

  public getHistory(): ValidationComparisonResult[] {
    return this.history;
  }

  public clearHistory(): void {
    this.history = [];
  }

  /**
   * Ejecuta una prueba de validación en tiempo real contra el proveedor seleccionado.
   */
  public async validateSatellitePosition(
    elements: OrbitalElements,
    observer: ObserverLocation,
    provider: 'wheretheiss' | 'n2yo'
  ): Promise<ValidationComparisonResult> {
    // 1. Consultar posición externa de referencia (que incluye su propio timestamp exacto)
    const externalSample = await dataOrchestrator.getValidationPosition(
      elements.noradId,
      Date.now(),
      observer,
      provider
    );

    // 2. Propagar nuestro modelo SGP4 local exactamente para el MISMO instante timestamp devuelto por la API externa
    const evalTimestamp = externalSample.timestamp || Date.now();
    const localState = orbitalEngine.propagateRealtimeState(
      elements,
      observer,
      evalTimestamp
    );

    if (!localState) {
      throw new Error(`Fallo al propagar localmente SGP4 para ${elements.name}`);
    }

    // 3. Calcular errores en kilómetros (Haversine 2D, Altitud y Euclidiano 3D ECEF)
    const errors = orbitalEngine.computePositionErrorsKm(localState, {
      latitude: externalSample.latitude,
      longitude: externalSample.longitude,
      altitudeKm: externalSample.altitudeKm,
    });

    const azimuthDiffDeg =
      externalSample.azimuthDeg !== undefined
        ? Math.abs(
            ((externalSample.azimuthDeg - localState.azimuthDeg + 540) % 360) - 180
          )
        : undefined;

    const elevationDiffDeg =
      externalSample.elevationDeg !== undefined
        ? Math.abs(externalSample.elevationDeg - localState.elevationDeg)
        : undefined;

    const result: ValidationComparisonResult = {
      id: `val-${elements.noradId}-${Date.now()}`,
      noradId: elements.noradId,
      satelliteName: elements.name,
      providerCompared: externalSample.provider,
      timestamp: evalTimestamp,
      epochAgeHours: localState.epochAgeHours,
      local: {
        latitude: localState.latitude,
        longitude: localState.longitude,
        altitudeKm: localState.altitudeKm,
        azimuthDeg: localState.azimuthDeg,
        elevationDeg: localState.elevationDeg,
      },
      external: externalSample,
      surfaceErrorKm: errors.surfaceErrorKm,
      altitudeErrorKm: errors.altitudeErrorKm,
      spatial3dErrorKm: errors.spatial3dErrorKm,
      azimuthDiffDeg,
      elevationDiffDeg,
    };

    this.history.unshift(result);
    return result;
  }
}

export const validationService = new ValidationService();

