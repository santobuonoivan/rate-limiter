/**
 * Unidades de tiempo soportadas para las reglas de rate limiting
 */
export enum TimeUnit {
  SECOND = "second",
  MINUTE = "minute",
  HOUR = "hour",
  DAY = "day",
}

/**
 * Definición de una regla de rate limiting.
 * Especifica cuántas solicitudes están permitidas en un período de tiempo dado.
 */
export interface RateLimitRule {
  /**
   * Número de solicitudes permitidas por unidad de tiempo
   */
  requestsPerUnit: number;

  /**
   * Unidad de tiempo para la ventana (second, minute, hour, day)
   */
  unit: TimeUnit;

  /**
   * Identificador único para esta regla (opcional)
   * Útil para aplicar diferentes reglas a diferentes endpoints
   */
  name?: string;
}

/**
 * Convierte una unidad de tiempo a segundos
 */
export function timeUnitToSeconds(unit: TimeUnit): number {
  switch (unit) {
    case TimeUnit.SECOND:
      return 1;
    case TimeUnit.MINUTE:
      return 60;
    case TimeUnit.HOUR:
      return 3600;
    case TimeUnit.DAY:
      return 86400;
    default:
      throw new Error(`Unknown time unit: ${unit}`);
  }
}
