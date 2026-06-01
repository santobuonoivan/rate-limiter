import { Injectable, Logger, Inject, Optional } from "@nestjs/common";
import {
  RateLimiterStrategy,
  RateLimitResult,
  RateLimitRule,
  StorageAdapter,
} from "../../core/interfaces";
import {
  RATE_LIMITER_STRATEGY,
  STORAGE_ADAPTER,
} from "../../core/injection-tokens";
import { MetricsService } from "./metrics.service";

/**
 * Servicio principal de Rate Limiting.
 *
 * Responsabilidades:
 * - Orquestar la verificación de límites usando una estrategia (algoritmo)
 * - Coordinar entre storage y algoritmo
 * - Logging de eventos importantes
 * - Abstraer la complejidad de las capas inferiores
 *
 * Este servicio es el punto de entrada principal para verificar rate limits
 * y es usado por el interceptor HTTP.
 *
 * Patrón Strategy:
 * - Recibe una Strategy inyectada (Token Bucket, Sliding Window, etc.)
 * - Puede intercambiarse sin modificar este código
 * - Cada estrategia implementa la misma interfaz
 */
@Injectable()
export class RateLimiterService {
  private readonly logger = new Logger(RateLimiterService.name);
  private readonly storageType: string;

  constructor(
    @Inject(RATE_LIMITER_STRATEGY)
    private readonly strategy: RateLimiterStrategy,
    @Inject(STORAGE_ADAPTER) private readonly storage: StorageAdapter,
    @Optional() private readonly metricsService?: MetricsService,
  ) {
    this.logger.log(
      `RateLimiterService initialized with strategy: ${this.strategy.name}`,
    );
    // Detectar tipo de storage para métricas
    this.storageType = storage.constructor.name.toLowerCase().includes("redis")
      ? "redis"
      : "memory";
  }

  /**
   * Verifica si una solicitud debe ser permitida según la regla especificada.
   *
   * @param key - Identificador único del cliente (IP, userId, API key, etc.)
   * @param rule - Regla de rate limiting a aplicar
   * @returns Resultado con información de si se permite y metadata
   *
   * Ejemplo de uso:
   * ```typescript
   * const result = await rateLimiterService.checkLimit('ip:192.168.1.1', {
   *   requestsPerUnit: 10,
   *   unit: TimeUnit.MINUTE
   * });
   *
   * if (!result.allowed) {
   *   throw new TooManyRequestsException();
   * }
   * ```
   */
  async checkLimit(key: string, rule: RateLimitRule): Promise<RateLimitResult> {
    const startTime = Date.now();

    try {
      // Delegar a la estrategia configurada
      const result = await this.strategy.checkLimit(key, rule, this.storage);

      // Registrar métricas si el servicio está disponible
      if (this.metricsService) {
        const duration = (Date.now() - startTime) / 1000; // en segundos
        this.metricsService.recordCheckDuration(
          this.strategy.name,
          this.storageType,
          duration,
        );
        this.metricsService.recordRequest(
          this.strategy.name,
          result.allowed ? "allowed" : "blocked",
          rule.name || "unknown",
        );
      }

      // Logging condicional: solo registrar rechazos para reducir ruido
      if (!result.allowed) {
        this.logger.warn(
          `Rate limit exceeded for key: ${key} (rule: ${rule.name || "unnamed"})`,
        );
      }

      return result;
    } catch (error) {
      // Registrar error en métricas
      if (this.metricsService) {
        this.metricsService.recordStorageError(this.storageType, "checkLimit");
      }

      // En caso de error en el rate limiter, loggear pero NO bloquear el request
      // Esto implementa "fail open" para alta disponibilidad
      this.logger.error(
        `Error checking rate limit for key ${key}:`,
        error instanceof Error ? error.stack : error,
      );

      // Retornar resultado que permite la solicitud
      // En producción, considerar retornar false en caso de errores sospechosos
      return {
        allowed: true,
        remaining: rule.requestsPerUnit,
        limit: rule.requestsPerUnit,
        resetAt: Math.ceil(Date.now() / 1000 + 60),
      };
    }
  }

  /**
   * Verifica múltiples keys a la vez (útil para rate limiting compuesto)
   * Por ejemplo: limitar por IP Y por userId simultáneamente
   *
   * @param keys - Array de identificadores
   * @param rule - Regla a aplicar
   * @returns Resultado combinado (rechaza si alguno excede el límite)
   */
  async checkMultipleKeys(
    keys: string[],
    rule: RateLimitRule,
  ): Promise<RateLimitResult> {
    const results = await Promise.all(
      keys.map((key) => this.checkLimit(key, rule)),
    );

    // Si alguno está bloqueado, bloquear el request completo
    const blocked = results.find((r) => !r.allowed);
    if (blocked) {
      return blocked;
    }

    // Retornar el resultado más restrictivo
    const mostRestrictive = results.reduce((prev, curr) =>
      curr.remaining < prev.remaining ? curr : prev,
    );

    return mostRestrictive;
  }

  /**
   * Obtiene el nombre de la estrategia actualmente configurada
   */
  getStrategyName(): string {
    return this.strategy.name;
  }

  /**
   * Método para resetear manualmente un bucket (útil para casos especiales)
   * Por ejemplo: un admin que quiere desbloquear un usuario
   */
  async resetLimit(key: string): Promise<void> {
    try {
      await this.storage.delete(key);
      this.logger.log(`Rate limit reset for key: ${key}`);
    } catch (error) {
      this.logger.error(
        `Error resetting rate limit for key ${key}:`,
        error instanceof Error ? error.stack : error,
      );
      throw error;
    }
  }
}
