/**
 * Estado almacenado para un bucket de rate limiting.
 * La estructura exacta depende del algoritmo utilizado.
 */
export interface BucketState {
  /**
   * Contador actual (tokens disponibles o requests en la ventana)
   */
  count: number;

  /**
   * Timestamp de la última actualización (en milisegundos)
   */
  lastUpdate: number;

  /**
   * Contador de la ventana anterior (usado en Sliding Window Counter)
   */
  previousCount?: number;

  /**
   * Timestamp de inicio de la ventana anterior (en milisegundos)
   */
  previousWindowStart?: number;
}

/**
 * Interfaz para adaptadores de almacenamiento.
 * Define las operaciones básicas necesarias para almacenar y recuperar
 * el estado de los buckets de rate limiting.
 *
 * Esta abstracción permite intercambiar implementaciones (in-memory, Redis, etc.)
 * sin modificar la lógica de los algoritmos.
 */
export interface StorageAdapter {
  /**
   * Obtiene el estado actual de un bucket
   * @param key - Identificador único del bucket (ej: "ip:192.168.1.1" o "user:123")
   * @returns Estado del bucket o null si no existe
   */
  get(key: string): Promise<BucketState | null>;

  /**
   * Guarda o actualiza el estado de un bucket
   * @param key - Identificador único del bucket
   * @param state - Estado a guardar
   * @param ttlSeconds - Tiempo de vida en segundos (opcional)
   */
  set(key: string, state: BucketState, ttlSeconds?: number): Promise<void>;

  /**
   * Elimina un bucket del almacenamiento
   * @param key - Identificador único del bucket
   */
  delete(key: string): Promise<void>;

  /**
   * Incrementa el contador de un bucket de forma atómica
   * Si el bucket no existe, lo crea con count = increment
   * @param key - Identificador único del bucket
   * @param increment - Valor a incrementar (default: 1)
   * @param ttlSeconds - Tiempo de vida en segundos (opcional)
   * @returns Nuevo valor del contador
   */
  increment(
    key: string,
    increment?: number,
    ttlSeconds?: number,
  ): Promise<number>;

  /**
   * Limpia todos los buckets expirados (útil para mantenimiento)
   */
  cleanup?(): Promise<void>;
}
