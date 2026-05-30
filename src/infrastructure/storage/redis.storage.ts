import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import Redis, { RedisOptions } from "ioredis";
import { StorageAdapter, BucketState } from "../../core/interfaces";

/**
 * Configuración para Redis Storage
 */
export interface RedisStorageConfig {
  host?: string;
  port?: number;
  password?: string;
  db?: number;
  keyPrefix?: string;
  maxRetriesPerRequest?: number;
  enableReadyCheck?: boolean;
  enableOfflineQueue?: boolean;
}

/**
 * Implementación Redis del adaptador de almacenamiento.
 *
 * Características:
 * - Almacenamiento distribuido y persistente
 * - Operaciones atómicas con Lua scripts
 * - TTL nativo de Redis
 * - Soporte para múltiples instancias de la aplicación
 * - Reconexión automática
 *
 * Ventajas sobre InMemory:
 * - Datos persisten entre reinicios
 * - Escala horizontalmente (múltiples instancias pueden compartir Redis)
 * - Redis maneja TTL y expiración automáticamente
 * - Operaciones atómicas garantizadas
 *
 * Consideraciones:
 * - Requiere instancia de Redis corriendo
 * - Latencia de red adicional (~1-5ms típicamente)
 * - Fail-open: Si Redis falla, el rate limiter debe permitir requests
 *
 * Formato de keys en Redis:
 * - {keyPrefix}:bucket:{key} - Estado del bucket
 *   Ejemplo: "ratelimit:bucket:ip:192.168.1.1"
 *
 * Formato de datos:
 * - JSON serializado de BucketState
 * - TTL manejado por Redis automáticamente
 */
@Injectable()
export class RedisStorage implements StorageAdapter, OnModuleDestroy {
  private readonly logger = new Logger(RedisStorage.name);
  private readonly client: Redis;
  private readonly keyPrefix: string;

  constructor(config?: RedisStorageConfig) {
    const redisOptions: RedisOptions = {
      host: config?.host || process.env.REDIS_HOST || "localhost",
      port: config?.port || parseInt(process.env.REDIS_PORT || "6379"),
      password: config?.password || process.env.REDIS_PASSWORD,
      db: config?.db || parseInt(process.env.REDIS_DB || "0"),
      maxRetriesPerRequest:
        config?.maxRetriesPerRequest ||
        parseInt(process.env.REDIS_MAX_RETRIES || "3"),
      enableReadyCheck: config?.enableReadyCheck ?? true,
      enableOfflineQueue: config?.enableOfflineQueue ?? true,
      retryStrategy: (times: number) => {
        // Retry con backoff exponencial hasta 5 segundos
        const delay = Math.min(times * 100, 5000);
        this.logger.warn(
          `Redis connection retry attempt ${times}, waiting ${delay}ms`,
        );
        return delay;
      },
    };

    this.client = new Redis(redisOptions);
    this.keyPrefix =
      config?.keyPrefix || process.env.REDIS_KEY_PREFIX || "ratelimit";

    // Event handlers
    this.client.on("connect", () => {
      this.logger.log("Redis client connected");
    });

    this.client.on("ready", () => {
      this.logger.log("Redis client ready");
    });

    this.client.on("error", (error) => {
      this.logger.error("Redis client error:", error.message);
    });

    this.client.on("close", () => {
      this.logger.warn("Redis client connection closed");
    });

    this.client.on("reconnecting", () => {
      this.logger.log("Redis client reconnecting");
    });
  }

  /**
   * Construye la key completa de Redis con el prefix
   */
  private buildKey(key: string): string {
    return `${this.keyPrefix}:bucket:${key}`;
  }

  /**
   * Obtiene el estado de un bucket desde Redis
   */
  async get(key: string): Promise<BucketState | null> {
    try {
      const redisKey = this.buildKey(key);
      const data = await this.client.get(redisKey);

      if (!data) {
        return null;
      }

      const state = JSON.parse(data) as BucketState;
      return state;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(`Error getting key ${key} from Redis: ${errorMessage}`);
      // Fail-open: retornar null permite que el rate limiter funcione
      return null;
    }
  }

  /**
   * Guarda el estado de un bucket en Redis con TTL opcional
   */
  async set(
    key: string,
    state: BucketState,
    ttlSeconds?: number,
  ): Promise<void> {
    try {
      const redisKey = this.buildKey(key);
      const data = JSON.stringify(state);

      if (ttlSeconds && ttlSeconds > 0) {
        // SET con EX (expiration en segundos)
        await this.client.setex(redisKey, ttlSeconds, data);
      } else {
        await this.client.set(redisKey, data);
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(`Error setting key ${key} in Redis: ${errorMessage}`);
      // Fail-open: no lanzar error, solo loguear
    }
  }

  /**
   * Elimina un bucket de Redis
   */
  async delete(key: string): Promise<void> {
    try {
      const redisKey = this.buildKey(key);
      await this.client.del(redisKey);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Error deleting key ${key} from Redis: ${errorMessage}`,
      );
    }
  }

  /**
   * Incrementa el contador de un bucket de forma atómica usando Lua script
   *
   * El script Lua garantiza atomicidad:
   * 1. Lee el bucket actual
   * 2. Incrementa el contador
   * 3. Guarda el nuevo estado
   * 4. Todo en una transacción atómica
   */
  async increment(
    key: string,
    increment: number = 1,
    ttlSeconds?: number,
  ): Promise<number> {
    try {
      const redisKey = this.buildKey(key);
      const now = Date.now();

      // Lua script para operación atómica de increment
      // KEYS[1] = redis key
      // ARGV[1] = increment value
      // ARGV[2] = current timestamp
      // ARGV[3] = TTL in seconds (optional)
      const luaScript = `
        local key = KEYS[1]
        local increment = tonumber(ARGV[1])
        local now = tonumber(ARGV[2])
        local ttl = tonumber(ARGV[3])
        
        local data = redis.call('GET', key)
        local state
        
        if data then
          state = cjson.decode(data)
          state.count = state.count + increment
          state.lastUpdate = now
        else
          state = {
            count = increment,
            lastUpdate = now
          }
        end
        
        local encoded = cjson.encode(state)
        
        if ttl and ttl > 0 then
          redis.call('SETEX', key, ttl, encoded)
        else
          redis.call('SET', key, encoded)
        end
        
        return state.count
      `;

      const result = await this.client.eval(
        luaScript,
        1, // número de KEYS
        redisKey,
        increment.toString(),
        now.toString(),
        (ttlSeconds || 0).toString(),
      );

      return result as number;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Error incrementing key ${key} in Redis: ${errorMessage}`,
      );
      // Fail-open: retornar el increment como si fuera la primera vez
      return increment;
    }
  }

  /**
   * Limpia todos los buckets con el prefix del rate limiter
   * Útil para testing o mantenimiento
   */
  async cleanup(): Promise<void> {
    try {
      const pattern = `${this.keyPrefix}:bucket:*`;
      const stream = this.client.scanStream({
        match: pattern,
        count: 100,
      });

      let deletedCount = 0;

      stream.on("data", async (keys: string[]) => {
        if (keys.length > 0) {
          await this.client.del(...keys);
          deletedCount += keys.length;
        }
      });

      await new Promise((resolve, reject) => {
        stream.on("end", resolve);
        stream.on("error", reject);
      });

      this.logger.log(`Cleaned up ${deletedCount} expired buckets from Redis`);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(`Error during Redis cleanup: ${errorMessage}`);
    }
  }

  /**
   * Obtiene estadísticas de Redis para monitoreo
   */
  async getStats(): Promise<{
    totalKeys: number;
    memoryUsed: string;
    connectedClients: number;
  }> {
    try {
      const pattern = `${this.keyPrefix}:bucket:*`;
      let totalKeys = 0;

      const stream = this.client.scanStream({
        match: pattern,
        count: 100,
      });

      stream.on("data", (keys: string[]) => {
        totalKeys += keys.length;
      });

      await new Promise((resolve, reject) => {
        stream.on("end", resolve);
        stream.on("error", reject);
      });

      const info = await this.client.info("memory");
      const memoryMatch = info.match(/used_memory_human:([^\r\n]+)/);
      const memoryUsed = memoryMatch ? memoryMatch[1] : "unknown";

      const clientsInfo = await this.client.info("clients");
      const clientsMatch = clientsInfo.match(/connected_clients:(\d+)/);
      const connectedClients = clientsMatch ? parseInt(clientsMatch[1]) : 0;

      return {
        totalKeys,
        memoryUsed,
        connectedClients,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(`Error getting Redis stats: ${errorMessage}`);
      return {
        totalKeys: 0,
        memoryUsed: "error",
        connectedClients: 0,
      };
    }
  }

  /**
   * Limpia la conexión de Redis al destruir el módulo
   */
  async onModuleDestroy() {
    this.logger.log("Closing Redis connection");
    await this.client.quit();
  }

  /**
   * Verifica si Redis está disponible
   */
  async isHealthy(): Promise<boolean> {
    try {
      const result = await this.client.ping();
      return result === "PONG";
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(`Redis health check failed: ${errorMessage}`);
      return false;
    }
  }

  /**
   * Obtiene el cliente Redis para operaciones avanzadas
   * (usar con cuidado, preferir los métodos de la interfaz)
   */
  getClient(): Redis {
    return this.client;
  }
}
