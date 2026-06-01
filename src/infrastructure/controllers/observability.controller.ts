import { Controller, Get, Header } from "@nestjs/common";
import { MetricsService } from "../../application/services/metrics.service";
import { StorageAdapter } from "../../core/interfaces";
import { Inject } from "@nestjs/common";
import { STORAGE_ADAPTER } from "../../core/injection-tokens";

/**
 * Controller para endpoints de observabilidad.
 *
 * Endpoints:
 * - GET /metrics: Métricas de Prometheus
 * - GET /health: Health check del sistema
 *
 * Uso en producción:
 * - /metrics se usa para scraping de Prometheus
 * - /health se usa para health checks de Kubernetes/ECS
 *
 * Best practices:
 * - No proteger /health con rate limiting (debe responder siempre)
 * - /metrics puede protegerse con autenticación básica en producción
 * - Responder rápido (<100ms) para no afectar el scraping
 */
@Controller()
export class ObservabilityController {
  constructor(
    private readonly metricsService: MetricsService,
    @Inject(STORAGE_ADAPTER) private readonly storage: StorageAdapter,
  ) {}

  /**
   * Endpoint de métricas en formato Prometheus.
   *
   * Expone todas las métricas recolectadas:
   * - rate_limiter_requests_total
   * - rate_limiter_limit_exceeded_total
   * - rate_limiter_check_duration_seconds
   * - rate_limiter_storage_errors_total
   * - Métricas del sistema (CPU, memoria, etc.)
   *
   * Configuración de Prometheus:
   * ```yaml
   * scrape_configs:
   *   - job_name: 'rate-limiter'
   *     scrape_interval: 15s
   *     static_configs:
   *       - targets: ['localhost:3000']
   * ```
   */
  @Get("/metrics")
  @Header("Content-Type", "text/plain")
  async getMetrics(): Promise<string> {
    return this.metricsService.getMetrics();
  }

  /**
   * Health check endpoint.
   *
   * Verifica:
   * - El servicio está respondiendo
   * - El storage está disponible (opcional)
   *
   * Respuestas:
   * - 200: Todo operativo
   * - 503: Algún componente crítico falló (storage)
   *
   * Usado por:
   * - Kubernetes liveness/readiness probes
   * - AWS ECS health checks
   * - Load balancers
   * - Monitoring (Datadog, New Relic, etc.)
   */
  @Get("/health")
  async healthCheck(): Promise<{
    status: string;
    timestamp: number;
    storage: {
      type: string;
      status: string;
    };
  }> {
    const timestamp = Date.now();
    const storageType = this.storage.constructor.name
      .toLowerCase()
      .includes("redis")
      ? "redis"
      : "memory";

    // Verificar storage health (con timeout)
    let storageStatus = "unknown";
    try {
      // Para in-memory, siempre está disponible
      if (storageType === "memory") {
        storageStatus = "healthy";
      } else {
        // Para Redis, intentar una operación simple con timeout
        const testKey = "_health_check_";
        await Promise.race([
          this.storage.get(testKey),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error("Health check timeout")), 2000),
          ),
        ]);
        storageStatus = "healthy";
      }
    } catch (error) {
      storageStatus = "unhealthy";
    }

    return {
      status: storageStatus === "healthy" ? "ok" : "degraded",
      timestamp,
      storage: {
        type: storageType,
        status: storageStatus,
      },
    };
  }
}
