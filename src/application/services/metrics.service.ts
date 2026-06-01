import { Injectable } from "@nestjs/common";
import {
  Counter,
  Histogram,
  Registry,
  collectDefaultMetrics,
} from "prom-client";

/**
 * Servicio de Métricas con Prometheus.
 *
 * Métricas disponibles:
 * - rate_limiter_requests_total: Total de requests procesadas
 * - rate_limiter_limit_exceeded_total: Total de requests bloqueadas
 * - rate_limiter_check_duration_seconds: Latencia de verificación de límites
 * - rate_limiter_storage_errors_total: Errores de almacenamiento
 *
 * Uso:
 * - Las métricas se recolectan automáticamente durante operaciones
 * - Se exponen vía endpoint /metrics en formato Prometheus
 * - Compatible con Grafana para visualización
 *
 * Best practices:
 * - Labels para segmentación (algorithm, endpoint, status)
 * - Histograms con buckets apropiados para latencia
 * - Counters para eventos acumulativos
 */
@Injectable()
export class MetricsService {
  private readonly registry: Registry;

  // Counter: Total de requests procesadas
  private readonly requestsTotal: Counter<string>;

  // Counter: Total de requests que excedieron el límite
  private readonly limitExceededTotal: Counter<string>;

  // Histogram: Latencia de verificación de rate limits
  private readonly checkDuration: Histogram<string>;

  // Counter: Errores en storage
  private readonly storageErrors: Counter<string>;

  constructor() {
    // Crear registry propio (no usar el global para mejor control)
    this.registry = new Registry();

    // Recolectar métricas por defecto del sistema (CPU, memoria, etc.)
    collectDefaultMetrics({
      register: this.registry,
      prefix: "rate_limiter_",
    });

    // Métrica: Total de requests procesadas
    this.requestsTotal = new Counter({
      name: "rate_limiter_requests_total",
      help: "Total number of rate limit checks performed",
      labelNames: ["algorithm", "status", "endpoint"],
      registers: [this.registry],
    });

    // Métrica: Total de límites excedidos
    this.limitExceededTotal = new Counter({
      name: "rate_limiter_limit_exceeded_total",
      help: "Total number of requests that exceeded rate limit",
      labelNames: ["algorithm", "endpoint"],
      registers: [this.registry],
    });

    // Métrica: Latencia de verificación
    this.checkDuration = new Histogram({
      name: "rate_limiter_check_duration_seconds",
      help: "Duration of rate limit check operations in seconds",
      labelNames: ["algorithm", "storage"],
      // Buckets optimizados para latencias típicas de rate limiting
      // 1ms, 2.5ms, 5ms, 10ms, 25ms, 50ms, 100ms, 250ms, 500ms, 1s
      buckets: [0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1],
      registers: [this.registry],
    });

    // Métrica: Errores de storage
    this.storageErrors = new Counter({
      name: "rate_limiter_storage_errors_total",
      help: "Total number of storage errors encountered",
      labelNames: ["storage", "operation"],
      registers: [this.registry],
    });
  }

  /**
   * Registra una verificación de rate limit.
   *
   * @param algorithm - Algoritmo usado (TokenBucket, SlidingWindow)
   * @param status - Resultado (allowed, blocked)
   * @param endpoint - Endpoint solicitado
   */
  recordRequest(
    algorithm: string,
    status: "allowed" | "blocked",
    endpoint: string,
  ): void {
    this.requestsTotal.inc({
      algorithm,
      status,
      endpoint: this.sanitizeEndpoint(endpoint),
    });

    if (status === "blocked") {
      this.limitExceededTotal.inc({
        algorithm,
        endpoint: this.sanitizeEndpoint(endpoint),
      });
    }
  }

  /**
   * Registra la latencia de una operación de verificación.
   *
   * @param algorithm - Algoritmo usado
   * @param storage - Tipo de storage (redis, memory)
   * @param durationSeconds - Duración en segundos
   */
  recordCheckDuration(
    algorithm: string,
    storage: string,
    durationSeconds: number,
  ): void {
    this.checkDuration.observe(
      {
        algorithm,
        storage,
      },
      durationSeconds,
    );
  }

  /**
   * Registra un error de storage.
   *
   * @param storage - Tipo de storage
   * @param operation - Operación que falló (get, set, delete, etc.)
   */
  recordStorageError(storage: string, operation: string): void {
    this.storageErrors.inc({
      storage,
      operation,
    });
  }

  /**
   * Obtiene las métricas en formato Prometheus.
   *
   * @returns String con todas las métricas en formato Prometheus
   */
  async getMetrics(): Promise<string> {
    return this.registry.metrics();
  }

  /**
   * Obtiene el tipo de contenido para las métricas.
   */
  getContentType(): string {
    return this.registry.contentType;
  }

  /**
   * Limpia el endpoint para usar como label (evita cardinalidad alta).
   * Reemplaza IDs numéricos y UUIDs con placeholders.
   *
   * @param endpoint - Endpoint original
   * @returns Endpoint sanitizado
   */
  private sanitizeEndpoint(endpoint: string): string {
    return (
      endpoint
        // Reemplazar IDs numéricos: /api/users/123 -> /api/users/:id
        .replace(/\/\d+/g, "/:id")
        // Reemplazar UUIDs: /api/items/abc-123-def -> /api/items/:uuid
        .replace(
          /\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/gi,
          "/:uuid",
        )
        // Limitar longitud para evitar labels demasiado largos
        .substring(0, 100)
    );
  }

  /**
   * Reinicia todas las métricas (útil para tests).
   */
  reset(): void {
    this.registry.resetMetrics();
  }
}
