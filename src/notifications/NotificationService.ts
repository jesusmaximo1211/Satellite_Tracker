/**
 * Capa de Notificaciones y Tareas en Background (Notification Layer - RF-06, RF-09 y Sección 4.6):
 * - Programa alertas locales N minutos antes del inicio (AOS) de un pase visible relevante.
 * - Incluye disparador inmediato ("Notificación Demo") para demostrar la alerta en vivo en el video entregable.
 * - Registra una tarea periódica de Background Fetch para refrescar efemérides con TTL vencido
 *   y recalcular próximas ventanas de visibilidad.
 */

import * as BackgroundFetch from 'expo-background-fetch';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';
import { PRESET_LOCATIONS } from '../observer/ObserverService';
import { passPredictor } from '../prediction/PassPredictor';
import { dataOrchestrator } from '../providers/DataOrchestrator';
import { PassWindow } from '../types/orbital';

export const BACKGROUND_ORBITAL_TASK = 'TP7_ORBITAL_BACKGROUND_REFRESH';

// Configurar comportamiento de notificaciones en foreground para que se vean durante la demo
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

// Definición de la tarea en segundo plano (Sección 4.6)
try {
  if (!TaskManager.isTaskDefined(BACKGROUND_ORBITAL_TASK)) {
    TaskManager.defineTask(BACKGROUND_ORBITAL_TASK, async () => {
      try {
        // 1. Refrescar catálogo principal si superó su TTL (RF-09)
        const { items } = await dataOrchestrator.getCatalog('stations', { forceRefresh: false });
        // 2. Recalcular pases para el primer satélite (ej. ISS)
        if (items.length > 0) {
          await passPredictor.predictPasses(items[0], PRESET_LOCATIONS[0], Date.now(), {
            horizonHours: 12,
            minElevationDeg: 10,
            maxPasses: 3,
          });
        }
        return BackgroundFetch.BackgroundFetchResult.NewData;
      } catch {
        return BackgroundFetch.BackgroundFetchResult.Failed;
      }
    });
  }
} catch {
  // En entorno web o test sin módulo nativo, ignoramos el registro estático
}

export interface ScheduledAlertItem {
  notificationId: string;
  passId: string;
  satelliteName: string;
  aosTime: number;
  leadMinutes: number;
  triggerTimeMs: number;
}

class NotificationService {
  private scheduledAlerts: ScheduledAlertItem[] = [];

  public getScheduledAlerts(): ScheduledAlertItem[] {
    return this.scheduledAlerts;
  }

  public async requestPermissions(): Promise<boolean> {
    if (Platform.OS === 'web') return false;
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;
    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    return finalStatus === 'granted';
  }

  public async registerBackgroundRefreshTask(): Promise<boolean> {
    if (Platform.OS === 'web') return false;
    try {
      const isRegistered = await TaskManager.isTaskRegisteredAsync(BACKGROUND_ORBITAL_TASK);
      if (!isRegistered) {
        await BackgroundFetch.registerTaskAsync(BACKGROUND_ORBITAL_TASK, {
          minimumInterval: 60 * 60, // Cada 1 hora verifica TTL y próximos pases
          stopOnTerminate: false,
          startOnBoot: true,
        });
      }
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Programa una notificación local N minutos antes de un pase configurado (RF-06).
   */
  public async schedulePassReminder(
    pass: PassWindow,
    leadMinutes: number = 5
  ): Promise<ScheduledAlertItem> {
    const granted = await this.requestPermissions();
    const triggerTimeMs = pass.aosTime - leadMinutes * 60_000;
    const delaySeconds = Math.max(3, Math.round((triggerTimeMs - Date.now()) / 1000));

    let notificationId = `sim-${Date.now()}`;
    if (granted && Platform.OS !== 'web') {
      notificationId = await Notifications.scheduleNotificationAsync({
        content: {
          title: `🛰️ Pase próximo: ${pass.satelliteName}`,
          body: `AOS en ${leadMinutes} min | Azimut inicial: ${pass.aosAzimuthDeg.toFixed(0)}° | Elev. Máx: ${pass.maxElevationDeg.toFixed(1)}°`,
          data: { passId: pass.id, noradId: pass.noradId },
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
          seconds: delaySeconds,
        },
      });
    }

    const item: ScheduledAlertItem = {
      notificationId,
      passId: pass.id,
      satelliteName: pass.satelliteName,
      aosTime: pass.aosTime,
      leadMinutes,
      triggerTimeMs: Date.now() + delaySeconds * 1000,
    };

    this.scheduledAlerts.unshift(item);
    return item;
  }

  /**
   * Dispara una notificación inmediata (en 2 segundos) con los datos reales del próximo pase.
   * Ideal para grabar el Video Demo exigido en la Sección 6 de Entregables.
   */
  public async triggerInstantDemoNotification(pass: PassWindow): Promise<string> {
    const granted = await this.requestPermissions();
    if (!granted || Platform.OS === 'web') {
      return 'simulated-banner';
    }

    const id = await Notifications.scheduleNotificationAsync({
      content: {
        title: `🛰️ [ALERTA DE PASE] ${pass.satelliteName} Visible pronto`,
        body: `Inicia (AOS): ${new Date(pass.aosTime).toLocaleTimeString()} (Az ${pass.aosAzimuthDeg.toFixed(0)}°) • Elev. Máx: ${pass.maxElevationDeg.toFixed(1)}° • Duración: ${Math.round(pass.durationSeconds / 60)}m ${pass.durationSeconds % 60}s`,
        data: { passId: pass.id, demo: true },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds: 2,
      },
    });
    return id;
  }
}

export const notificationService = new NotificationService();

