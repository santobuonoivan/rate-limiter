/**
 * Tokens de inyección de dependencias para NestJS.
 *
 * Las interfaces de TypeScript no existen en runtime, por lo que no se pueden
 * usar directamente como tokens de inyección en NestJS.
 *
 * Estos símbolos únicos actúan como tokens de inyección que NestJS puede resolver.
 */

/**
 * Token de inyección para la estrategia de rate limiting
 */
export const RATE_LIMITER_STRATEGY = Symbol("RATE_LIMITER_STRATEGY");

/**
 * Token de inyección para el adaptador de almacenamiento
 */
export const STORAGE_ADAPTER = Symbol("STORAGE_ADAPTER");
