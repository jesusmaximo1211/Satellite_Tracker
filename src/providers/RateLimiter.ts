/**
 * Limitador de tasa (Rate Limiter) por proveedor y cola de reintentos con Backoff Exponencial.
 * Cumple con los requisitos de la Sección 4.2 y 4.3 del TP7.
 */

import { ProviderId } from '../types/orbital';

export interface ProviderRateLimitConfig {
  maxPerMinute: number;
  maxPerHour: number;
  minIntervalMs: number;
  maxRetries: number;
  baseBackoffMs: number;
}

export const PROVIDER_RATE_LIMITS: Record<ProviderId, ProviderRateLimitConfig> = {
  // CelesTrak: actualiza 1 vez al día, TTL 12-24h. Limitamos consultas de red.
  celestrak: {
    maxPerMinute: 10,
    maxPerHour: 100,
    minIntervalMs: 1000,
    maxRetries: 3,
    baseBackoffMs: 1000,
  },
  // Space-Track.org: Guía oficial < 30 requests/min y < 300/hora.
  spacetrack: {
    maxPerMinute: 25,
    maxPerHour: 250,
    minIntervalMs: 2100,
    maxRetries: 3,
    baseBackoffMs: 1500,
  },
  // N2YO: 1000 transacciones/hora (posiciones/TLE), 100/hora (pases).
  n2yo: {
    maxPerMinute: 20,
    maxPerHour: 90,
    minIntervalMs: 1000,
    maxRetries: 2,
    baseBackoffMs: 1200,
  },
  // Where the ISS at?: ~1 request/segundo.
  wheretheiss: {
    maxPerMinute: 50,
    maxPerHour: 1000,
    minIntervalMs: 1100,
    maxRetries: 3,
    baseBackoffMs: 1000,
  },
  'offline-seed': {
    maxPerMinute: 9999,
    maxPerHour: 99999,
    minIntervalMs: 0,
    maxRetries: 0,
    baseBackoffMs: 0,
  },
};

export interface ProviderQuotaStatus {
  provider: ProviderId;
  requestsLastMinute: number;
  maxPerMinute: number;
  requestsLastHour: number;
  maxPerHour: number;
}

class RateLimiterService {
  private history: Record<ProviderId, number[]> = {
    celestrak: [],
    spacetrack: [],
    n2yo: [],
    wheretheiss: [],
    'offline-seed': [],
  };

  private pruneOldTimestamps(provider: ProviderId, now: number): void {
    const oneHourAgo = now - 3600_000;
    this.history[provider] = this.history[provider].filter((t) => t > oneHourAgo);
  }

  public getQuotaStatus(provider: ProviderId): ProviderQuotaStatus {
    const now = Date.now();
    this.pruneOldTimestamps(provider, now);
    const config = PROVIDER_RATE_LIMITS[provider];
    const oneMinAgo = now - 60_000;
    const timestamps = this.history[provider];
    const requestsLastMinute = timestamps.filter((t) => t > oneMinAgo).length;

    return {
      provider,
      requestsLastMinute,
      maxPerMinute: config.maxPerMinute,
      requestsLastHour: timestamps.length,
      maxPerHour: config.maxPerHour,
    };
  }

  public getAllQuotas(): ProviderQuotaStatus[] {
    return (['celestrak', 'spacetrack', 'n2yo', 'wheretheiss'] as ProviderId[]).map((p) =>
      this.getQuotaStatus(p)
    );
  }

  private async waitForSlot(provider: ProviderId): Promise<void> {
    const config = PROVIDER_RATE_LIMITS[provider];
    const now = Date.now();
    this.pruneOldTimestamps(provider, now);
    const timestamps = this.history[provider];

    if (timestamps.length >= config.maxPerHour) {
      throw new Error(
        `Límite horario alcanzado para ${provider} (${config.maxPerHour} req/h). Usando caché/fallback.`
      );
    }

    const oneMinAgo = now - 60_000;
    const lastMinuteTimestamps = timestamps.filter((t) => t > oneMinAgo);
    if (lastMinuteTimestamps.length >= config.maxPerMinute) {
      const oldestInMinute = lastMinuteTimestamps[0];
      const waitMs = Math.max(500, oldestInMinute + 60_000 - now + 100);
      if (waitMs > 8000) {
        throw new Error(`Rate limit por minuto excedido en ${provider}. Activando fallback.`);
      }
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }

    const lastRequest = timestamps[timestamps.length - 1];
    if (lastRequest && now - lastRequest < config.minIntervalMs) {
      const waitMs = config.minIntervalMs - (now - lastRequest);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }

    this.history[provider].push(Date.now());
  }

  /**
   * Ejecuta una petición respetando el Rate Limit del proveedor y aplicando
   * reintentos con Backoff Exponencial + Jitter ante errores transitorios.
   */
  public async schedule<T>(provider: ProviderId, task: () => Promise<T>): Promise<T> {
    const config = PROVIDER_RATE_LIMITS[provider];
    let attempt = 0;
    let lastError: unknown;

    while (attempt <= config.maxRetries) {
      try {
        await this.waitForSlot(provider);
        return await task();
      } catch (err) {
        lastError = err;
        attempt += 1;
        if (attempt > config.maxRetries) {
          break;
        }
        // Backoff exponencial: base * 2^(attempt-1) + jitter aleatorio (0-250ms)
        const backoffMs =
          config.baseBackoffMs * Math.pow(2, attempt - 1) + Math.floor(Math.random() * 250);
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error(`Fallo en proveedor ${provider} tras ${config.maxRetries} reintentos`);
  }
}

export const rateLimiter = new RateLimiterService();

