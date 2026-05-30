import { RateLimitResult } from "./rate-limit-result.interface";
import { RateLimitRule } from "./rate-limit-rule.interface";
import { StorageAdapter } from "./storage-adapter.interface";

/**
 * Interfaz para estrategias de rate limiting.
 * Implementa el patrón Strategy permitiendo intercambiar algoritmos
 * (Token Bucket, Sliding Window, etc.) sin modificar el código cliente.
 *
 * Cada estrategia debe ser stateless - todo el estado se almacena
 * en el StorageAdapter inyectado.
 */
export interface RateLimiterStrategy {
  /**
   * Nombre descriptivo del algoritmo
   */
  readonly name: string;

  /**
   * Verifica si una solicitud debe ser permitida según la regla especificada
   *
   * @param key - Identificador único del cliente (ej: IP, userId, API key)
   * @param rule - Regla de rate limiting a aplicar
   * @param storage - Adaptador de almacenamiento para persistir estado
   * @returns Resultado con información de si se permite la solicitud y metadata
   */
  checkLimit(
    key: string,
    rule: RateLimitRule,
    storage: StorageAdapter,
  ): Promise<RateLimitResult>;
}
