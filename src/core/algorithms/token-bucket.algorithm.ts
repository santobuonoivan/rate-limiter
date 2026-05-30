import {
  RateLimiterStrategy,
  RateLimitResult,
  RateLimitRule,
  StorageAdapter,
  timeUnitToSeconds,
} from "../interfaces";

/**
 * Implementación del algoritmo Token Bucket para rate limiting.
 *
 * Funcionamiento:
 * - Un bucket (contenedor) tiene una capacidad máxima de tokens
 * - Los tokens se recargan a una tasa constante (refill rate)
 * - Cada solicitud consume un token
 * - Si no hay tokens disponibles, la solicitud se rechaza
 *
 * Ventajas:
 * - Permite ráfagas de tráfico (burst traffic) mientras haya tokens
 * - Memoria eficiente (solo almacena contador y timestamp)
 * - Simple de entender e implementar
 * - Usado por Amazon y Stripe en producción
 *
 * Parámetros (derivados de RateLimitRule):
 * - Bucket size (capacidad): requestsPerUnit
 * - Refill rate: requestsPerUnit tokens por unit de tiempo
 *
 * Ejemplo:
 * Si requestsPerUnit=10 y unit=MINUTE, entonces:
 * - Capacidad del bucket: 10 tokens
 * - Refill rate: 10 tokens/minuto = 1 token cada 6 segundos
 */
export class TokenBucketAlgorithm implements RateLimiterStrategy {
  readonly name = "TokenBucket";

  async checkLimit(
    key: string,
    rule: RateLimitRule,
    storage: StorageAdapter,
  ): Promise<RateLimitResult> {
    const now = Date.now();
    const windowSeconds = timeUnitToSeconds(rule.unit);
    const capacity = rule.requestsPerUnit;

    // Obtener estado actual del bucket
    let state = await storage.get(key);

    if (!state) {
      // Primer acceso: crear bucket con capacidad completa
      state = {
        count: capacity,
        lastUpdate: now,
      };
    }

    // Calcular cuántos tokens se han regenerado desde la última actualización
    const timeSinceLastUpdate = (now - state.lastUpdate) / 1000; // en segundos
    const tokensToAdd = (timeSinceLastUpdate / windowSeconds) * capacity;

    // Actualizar contador de tokens (sin exceder la capacidad)
    let currentTokens = Math.min(capacity, state.count + tokensToAdd);

    // Verificar si hay tokens disponibles
    const allowed = currentTokens >= 1;

    if (allowed) {
      // Consumir un token
      currentTokens -= 1;
    }

    // Actualizar estado en storage
    const newState = {
      count: currentTokens,
      lastUpdate: now,
    };

    // TTL: mantener el bucket por el doble de la ventana de tiempo
    await storage.set(key, newState, windowSeconds * 2);

    // Calcular cuándo se resetea completamente el bucket
    const resetAt = Math.ceil(now / 1000 + windowSeconds);

    // Calcular retry-after si fue rechazado
    let retryAfter: number | undefined;
    if (!allowed) {
      // Tiempo hasta que se regenere 1 token
      const secondsPerToken = windowSeconds / capacity;
      retryAfter = Math.ceil(now / 1000 + secondsPerToken);
    }

    return {
      allowed,
      remaining: Math.floor(currentTokens),
      limit: capacity,
      resetAt,
      retryAfter,
    };
  }
}
