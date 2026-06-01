import {
  RateLimiterStrategy,
  RateLimitResult,
  RateLimitRule,
  StorageAdapter,
  timeUnitToSeconds,
} from "../interfaces";

/**
 * Implementación del algoritmo Sliding Window Counter para rate limiting.
 *
 * Funcionamiento:
 * - Divide el tiempo en ventanas fijas pero evalúa en ventanas deslizantes
 * - Usa una aproximación híbrida entre Fixed Window y Sliding Window Log
 * - Fórmula: requests_en_ventana_actual + (requests_en_ventana_anterior × porcentaje_solapamiento)
 *
 * Ventajas:
 * - Más preciso que Fixed Window (evita picos en bordes de ventana)
 * - Más eficiente en memoria que Sliding Window Log (no guarda timestamps individuales)
 * - Suaviza picos de tráfico usando promedio ponderado
 * - Usado por Cloudflare (0.003% de error en 400M requests)
 *
 * Trade-offs:
 * - Es una aproximación (asume distribución uniforme en ventana anterior)
 * - No es 100% preciso pero suficientemente bueno para casos reales
 *
 * Ejemplo:
 * - Límite: 7 requests/minuto
 * - Ventana anterior (0:00-1:00): 5 requests
 * - Ventana actual (1:00-2:00): 3 requests
 * - Request llega a 1:30 (50% en ventana actual)
 * - Cálculo: 3 + (5 × 0.5) = 5.5 ≈ 5 requests
 * - Permitido: 5 < 7 ✓
 */
export class SlidingWindowCounterAlgorithm implements RateLimiterStrategy {
  readonly name = "SlidingWindowCounter";

  async checkLimit(
    key: string,
    rule: RateLimitRule,
    storage: StorageAdapter,
  ): Promise<RateLimitResult> {
    const now = Date.now();
    const windowMillis = timeUnitToSeconds(rule.unit) * 1000;
    const limit = rule.requestsPerUnit;

    // Calcular inicio de ventana actual
    const currentWindowStart = Math.floor(now / windowMillis) * windowMillis;
    const previousWindowStart = currentWindowStart - windowMillis;

    // Obtener estado actual
    const state = await storage.get(key);

    let currentCount = 0;
    let previousCount = 0;

    if (state) {
      // Si el estado es de la ventana actual, usar ese contador
      if (state.lastUpdate >= currentWindowStart) {
        currentCount = state.count;
        previousCount = state.previousCount || 0;
      }
      // Si el estado es de la ventana anterior, moverlo a previousCount
      else if (state.lastUpdate >= previousWindowStart) {
        currentCount = 0;
        previousCount = state.count;
      }
      // Si es más antiguo, resetear todo
      else {
        currentCount = 0;
        previousCount = 0;
      }
    }

    // Calcular el porcentaje de solapamiento con ventana anterior
    const timeIntoCurrentWindow = now - currentWindowStart;
    const overlapPercentage = 1 - timeIntoCurrentWindow / windowMillis;

    // Aplicar fórmula de sliding window counter
    // Weighted count = current + (previous × overlap)
    const weightedCount = currentCount + previousCount * overlapPercentage;

    // Verificar si está permitido (usar floor para ser más permisivo)
    const allowed = Math.floor(weightedCount) < limit;

    if (allowed) {
      // Incrementar contador de ventana actual
      currentCount += 1;
    }

    // Actualizar estado
    const newState = {
      count: currentCount,
      lastUpdate: now,
      previousCount: previousCount,
      previousWindowStart: previousWindowStart,
    };

    // TTL: mantener por 2 ventanas completas
    const ttlSeconds = timeUnitToSeconds(rule.unit) * 2;
    await storage.set(key, newState, ttlSeconds);

    // Calcular metadata para respuesta
    const remaining = Math.max(0, limit - Math.ceil(weightedCount));
    const resetAt = Math.ceil((currentWindowStart + windowMillis) / 1000);

    let retryAfter: number | undefined;
    if (!allowed) {
      // Próximo reset de ventana
      retryAfter = resetAt;
    }

    return {
      allowed,
      remaining,
      limit,
      resetAt,
      retryAfter,
    };
  }
}
