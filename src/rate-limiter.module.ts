import { Module } from "@nestjs/common";
import { APP_INTERCEPTOR } from "@nestjs/core";

// Core
import { RateLimiterStrategy } from "./core/interfaces";
import { TokenBucketAlgorithm } from "./core/algorithms/token-bucket.algorithm";
import { SlidingWindowCounterAlgorithm } from "./core/algorithms/sliding-window-counter.algorithm";
import {
  RATE_LIMITER_STRATEGY,
  STORAGE_ADAPTER,
} from "./core/injection-tokens";

// Infrastructure
import { InMemoryStorage } from "./infrastructure/storage/in-memory.storage";
import { RedisStorage } from "./infrastructure/storage/redis.storage";
import { RateLimiterInterceptor } from "./infrastructure/interceptors/rate-limiter.interceptor";

// Application
import { RateLimiterService } from "./application/services/rate-limiter.service";
import { RateLimiterConfigService } from "./application/services/rate-limiter-config.service";
import { MetricsService } from "./application/services/metrics.service";

// Controllers
import { ObservabilityController } from "./infrastructure/controllers/observability.controller";

/**
 * Enum para seleccionar el algoritmo de rate limiting
 */
export enum RateLimitAlgorithm {
  TOKEN_BUCKET = "token_bucket",
  SLIDING_WINDOW_COUNTER = "sliding_window_counter",
}

/**
 * Enum para seleccionar el tipo de almacenamiento
 */
export enum StorageType {
  MEMORY = "memory",
  REDIS = "redis",
}

/**
 * Configuración del módulo de Rate Limiting
 */
export interface RateLimiterModuleOptions {
  /**
   * Algoritmo a utilizar (default: TOKEN_BUCKET)
   */
  algorithm?: RateLimitAlgorithm;

  /**
   * Tipo de almacenamiento (default: MEMORY)
   * Se puede sobrescribir con STORAGE_TYPE env var
   */
  storageType?: StorageType;

  /**
   * Habilitar interceptor global (default: true)
   */
  enableGlobalInterceptor?: boolean;
}

/**
 * Módulo de Rate Limiting.
 *
 * Encapsula toda la funcionalidad de rate limiting y la expone
 * de forma modular para ser utilizada en la aplicación.
 *
 * Características:
 * - Patrón Strategy: Permite intercambiar algoritmos fácilmente
 * - Dependency Injection: Todos los componentes se inyectan vía DI
 * - Configuración flexible: Puede configurarse con diferentes opciones
 * - Interceptor global: Se aplica automáticamente a todos los endpoints
 *
 * Uso:
 * ```typescript
 * @Module({
 *   imports: [RateLimiterModule],
 * })
 * export class AppModule {}
 * ```
 */
@Module({})
export class RateLimiterModule {
  /**
   * Configuración estática del módulo.
   * Por ahora usa Token Bucket por defecto.
   *
   * Para usar Sliding Window Counter:
   * ```typescript
   * RateLimiterModule.forRoot({
   *   algorithm: RateLimitAlgorithm.SLIDING_WINDOW_COUNTER
   * })
   * ```
   */
  static forRoot(options?: RateLimiterModuleOptions) {
    const algorithm =
      options?.algorithm ||
      (process.env.RATE_LIMIT_ALGORITHM as RateLimitAlgorithm) ||
      RateLimitAlgorithm.TOKEN_BUCKET;

    const enableInterceptor = options?.enableGlobalInterceptor ?? true;

    // Determinar storage type desde opciones o variable de entorno
    const storageTypeEnv = (process.env.STORAGE_TYPE || "memory").toLowerCase();
    const storageType =
      options?.storageType ||
      (storageTypeEnv === "redis" ? StorageType.REDIS : StorageType.MEMORY);

    // Factory para crear la estrategia según configuración
    const strategyProvider = {
      provide: RATE_LIMITER_STRATEGY,
      useFactory: (): RateLimiterStrategy => {
        switch (algorithm) {
          case RateLimitAlgorithm.TOKEN_BUCKET:
            return new TokenBucketAlgorithm();
          case RateLimitAlgorithm.SLIDING_WINDOW_COUNTER:
            return new SlidingWindowCounterAlgorithm();
          default:
            return new TokenBucketAlgorithm();
        }
      },
    };

    // Provider para el storage adapter (dinámico según configuración)
    const storageProvider = {
      provide: STORAGE_ADAPTER,
      useFactory: () => {
        switch (storageType) {
          case StorageType.REDIS:
            return new RedisStorage();
          case StorageType.MEMORY:
          default:
            return new InMemoryStorage();
        }
      },
    };

    // Provider para el interceptor global (opcional)
    const interceptorProvider = enableInterceptor
      ? {
          provide: APP_INTERCEPTOR,
          useClass: RateLimiterInterceptor,
        }
      : null;

    const providers: any[] = [
      strategyProvider,
      storageProvider,
      RateLimiterService,
      RateLimiterConfigService,
      RateLimiterInterceptor,
      MetricsService,
    ];

    if (interceptorProvider) {
      providers.push(interceptorProvider);
    }

    return {
      module: RateLimiterModule,
      providers,
      controllers: [ObservabilityController],
      exports: [RateLimiterService, RateLimiterConfigService, MetricsService],
    };
  }
}
