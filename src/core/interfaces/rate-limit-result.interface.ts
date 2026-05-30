/**
 * Resultado de la verificación de rate limiting.
 * Contiene información sobre si la solicitud fue permitida y datos
 * para los headers HTTP de respuesta.
 */
export interface RateLimitResult {
  /**
   * Indica si la solicitud está permitida (true) o debe ser rechazada (false)
   */
  allowed: boolean;

  /**
   * Número de solicitudes restantes dentro de la ventana de tiempo actual
   */
  remaining: number;

  /**
   * Límite total de solicitudes permitidas por ventana de tiempo
   */
  limit: number;

  /**
   * Timestamp (en segundos) de cuando se puede volver a intentar
   * Solo presente cuando allowed = false
   */
  retryAfter?: number;

  /**
   * Tiempo de reset de la ventana actual (timestamp en segundos)
   */
  resetAt: number;
}
