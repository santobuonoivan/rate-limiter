import { Injectable, Logger } from "@nestjs/common";
import { StorageAdapter, BucketState } from "../../core/interfaces";

/**
 * Estructura interna para almacenar buckets con TTL
 */
interface BucketEntry {
  state: BucketState;
  expiresAt: number; // timestamp en ms
}

/**
 * Implementación in-memory del adaptador de almacenamiento.
 *
 * Características:
 * - Usa Map<string, BucketEntry> para almacenamiento eficiente
 * - TTL automático con limpieza periódica
 * - Operaciones atómicas para prevenir race conditions
 * - Singleton por defecto en NestJS
 *
 * Consideraciones de concurrencia:
 * - Node.js es single-threaded pero operaciones async pueden intercalarse
 * - Las operaciones críticas (get + set) deben ejecutarse sin await intermedio
 * - Map operations en JavaScript son síncronas y thread-safe en el event loop
 *
 * Limitaciones:
 * - Datos se pierden al reiniciar el servidor (aceptable para MVP)
 * - No escala horizontalmente (requiere sticky sessions o Redis)
 * - Memoria puede crecer sin límite (mitigado con TTL y cleanup)
 */
@Injectable()
export class InMemoryStorage implements StorageAdapter {
  private readonly logger = new Logger(InMemoryStorage.name);
  private readonly buckets = new Map<string, BucketEntry>();
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor() {
    // Iniciar limpieza periódica cada 60 segundos
    this.startCleanupTask();
    this.logger.log("InMemoryStorage initialized");
  }

  async get(key: string): Promise<BucketState | null> {
    const entry = this.buckets.get(key);

    if (!entry) {
      return null;
    }

    // Verificar si ha expirado
    if (Date.now() > entry.expiresAt) {
      this.buckets.delete(key);
      return null;
    }

    return entry.state;
  }

  async set(
    key: string,
    state: BucketState,
    ttlSeconds: number = 3600,
  ): Promise<void> {
    const expiresAt = Date.now() + ttlSeconds * 1000;

    this.buckets.set(key, {
      state: { ...state }, // Crear copia para evitar mutaciones externas
      expiresAt,
    });
  }

  async delete(key: string): Promise<void> {
    this.buckets.delete(key);
  }

  /**
   * Incrementa el contador de forma atómica.
   * Esta operación es crítica para prevenir race conditions.
   */
  async increment(
    key: string,
    increment: number = 1,
    ttlSeconds?: number,
  ): Promise<number> {
    const entry = this.buckets.get(key);
    const now = Date.now();

    if (!entry || now > entry.expiresAt) {
      // Crear nuevo bucket con valor inicial
      const newState: BucketState = {
        count: increment,
        lastUpdate: now,
      };

      const ttlMs = ttlSeconds ? ttlSeconds * 1000 : 3600 * 1000; // Default 1 hora

      this.buckets.set(key, {
        state: newState,
        expiresAt: now + ttlMs,
      });

      return increment;
    }

    // Incrementar contador existente de forma atómica
    entry.state.count += increment;
    entry.state.lastUpdate = now;

    // Actualizar TTL si se especifica
    if (ttlSeconds) {
      entry.expiresAt = now + ttlSeconds * 1000;
    }

    return entry.state.count;
  }

  /**
   * Limpia todos los buckets expirados.
   * Se ejecuta periódicamente para liberar memoria.
   */
  async cleanup(): Promise<void> {
    const now = Date.now();
    let cleaned = 0;

    for (const [key, entry] of this.buckets.entries()) {
      if (now > entry.expiresAt) {
        this.buckets.delete(key);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      this.logger.debug(`Cleaned ${cleaned} expired buckets`);
    }
  }

  /**
   * Inicia tarea de limpieza periódica
   */
  private startCleanupTask(): void {
    // Ejecutar cleanup cada 60 segundos
    this.cleanupInterval = setInterval(() => {
      this.cleanup().catch((err) => {
        this.logger.error("Error during cleanup", err);
      });
    }, 60000);
  }

  /**
   * Detiene la tarea de limpieza (útil para testing y shutdown)
   */
  stopCleanupTask(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
      this.logger.log("Cleanup task stopped");
    }
  }

  /**
   * Obtiene estadísticas del storage (útil para debugging)
   */
  getStats(): { totalBuckets: number; expiredBuckets: number } {
    const now = Date.now();
    let expired = 0;

    for (const entry of this.buckets.values()) {
      if (now > entry.expiresAt) {
        expired++;
      }
    }

    return {
      totalBuckets: this.buckets.size,
      expiredBuckets: expired,
    };
  }

  /**
   * Limpia todos los buckets (útil para testing)
   */
  clear(): void {
    this.buckets.clear();
    this.logger.debug("All buckets cleared");
  }
}
