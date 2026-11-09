/**
 * Capa del Observador (Observer Layer - Sección 4.5 y 5):
 * - Obtiene la posición GPS real del usuario (latitud, longitud, altitud) mediante expo-location.
 * - Provee estaciones terrenas predefinidas en Argentina (FCyT Concepción del Uruguay, CONAE Córdoba,
 *   Buenos Aires, Ushuaia) para pruebas rápidas o cuando se ejecuta en emulador sin GPS.
 * - Lee Magnetómetro y Acelerómetro (expo-sensors) con filtro pasa-bajos para el Modo Brújula (RF-07).
 */

import * as Location from 'expo-location';
import { Accelerometer, Magnetometer } from 'expo-sensors';
import { Platform } from 'react-native';
import { ObserverLocation } from '../types/orbital';

export const PRESET_LOCATIONS: ObserverLocation[] = [
  {
    label: 'FCyT UADER - Concepción del Uruguay',
    latitude: -32.4845,
    longitude: -58.2322,
    altitudeMeters: 22,
    isGps: false,
  },
  {
    label: 'Estación Terrena CONAE - Córdoba',
    latitude: -31.5236,
    longitude: -64.4635,
    altitudeMeters: 540,
    isGps: false,
  },
  {
    label: 'Buenos Aires (CABA)',
    latitude: -34.6037,
    longitude: -58.3816,
    altitudeMeters: 25,
    isGps: false,
  },
  {
    label: 'Estación Terrena Austral - Tolhuin / Ushuaia',
    latitude: -54.8019,
    longitude: -68.303,
    altitudeMeters: 18,
    isGps: false,
  },
];

export interface DeviceOrientationState {
  headingDeg: number; // 0° = Norte, 90° = Este, 180° = Sur, 270° = Oeste
  pitchDeg: number;   // Ángulo de elevación al que apunta el dispositivo (0° horizonte, 90° cenit)
  hasSensorHardware: boolean;
}

class ObserverService {
  /**
   * Solicita permisos y obtiene la ubicación GPS actual del dispositivo.
   */
  public async getCurrentGpsLocation(): Promise<ObserverLocation> {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      throw new Error('Permiso de ubicación GPS denegado por el usuario.');
    }

    const pos = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });

    return {
      latitude: pos.coords.latitude,
      longitude: pos.coords.longitude,
      altitudeMeters: pos.coords.altitude ?? 25,
      label: 'Mi Ubicación GPS Actual',
      isGps: true,
    };
  }

  /**
   * Suscribe a los sensores físicos (Magnetómetro + Acelerómetro) para orientar el Modo Brújula (RF-07).
   * Aplica suavizado exponencial (Low-Pass Filter) para evitar vibraciones en la aguja.
   */
  public subscribeOrientation(
    onUpdate: (state: DeviceOrientationState) => void
  ): () => void {
    if (Platform.OS === 'web') {
      onUpdate({ headingDeg: 0, pitchDeg: 25, hasSensorHardware: false });
      return () => {};
    }

    let smoothedHeading = 0;
    let smoothedPitch = 20;
    let magSub: { remove: () => void } | null = null;
    let accSub: { remove: () => void } | null = null;

    Magnetometer.setUpdateInterval(120);
    Accelerometer.setUpdateInterval(120);

    try {
      magSub = Magnetometer.addListener((data) => {
        const { x, y } = data;
        let angle = Math.atan2(y, x) * (180 / Math.PI);
        angle = (angle + 360) % 360;
        // Filtro pasa-bajos circular
        const diff = ((angle - smoothedHeading + 540) % 360) - 180;
        smoothedHeading = (smoothedHeading + 0.25 * diff + 360) % 360;
        onUpdate({
          headingDeg: smoothedHeading,
          pitchDeg: smoothedPitch,
          hasSensorHardware: true,
        });
      });

      accSub = Accelerometer.addListener((data) => {
        const { y, z } = data;
        // Cuando el teléfono está vertical apuntando al horizonte, pitch ≈ 0°; inclinado hacia el cielo -> 90°
        const rawPitch = Math.atan2(-z, Math.max(0.01, Math.abs(y))) * (180 / Math.PI);
        const clamped = Math.max(-20, Math.min(90, rawPitch + 45));
        smoothedPitch = smoothedPitch * 0.8 + clamped * 0.2;
      });
    } catch {
      onUpdate({ headingDeg: 0, pitchDeg: 25, hasSensorHardware: false });
    }

    return () => {
      magSub?.remove();
      accSub?.remove();
    };
  }
}

export const observerService = new ObserverService();

