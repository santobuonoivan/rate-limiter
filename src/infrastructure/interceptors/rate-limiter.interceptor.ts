import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import { Observable } from "rxjs";
import { Request, Response } from "express";
import { RateLimiterService } from "../../application/services/rate-limiter.service";
import { RateLimiterConfigService } from "../../application/services/rate-limiter-config.service";

/**
 * Interceptor global de Rate Limiting para requests HTTP.
 *
 * Funcionamiento:
 * 1. Extrae identificador del cliente (IP por defecto, puede usar headers custom)
 * 2. Obtiene la regla aplicable según el endpoint
 * 3. Verifica con RateLimiterService si se permite la solicitud
 * 4. Agrega headers HTTP con información de rate limiting
 * 5. Si excede el límite, lanza HttpException 429
 *
 * Headers agregados (estándar de facto):
 * - X-RateLimit-Limit: Límite total de requests
 * - X-RateLimit-Remaining: Requests restantes
 * - X-RateLimit-Reset: Timestamp de reset
 * - Retry-After: Segundos para reintentar (solo en 429)
 *
 * Identificación de clientes:
 * - Por defecto: IP address (req.ip)
 * - Puede extenderse: X-API-Key, X-User-Id, Authorization token
 * - Soporta múltiples estrategias (IP + userId, IP + endpoint, etc.)
 */
@Injectable()
export class RateLimiterInterceptor implements NestInterceptor {
  private readonly logger = new Logger(RateLimiterInterceptor.name);

  constructor(
    private readonly rateLimiterService: RateLimiterService,
    private readonly configService: RateLimiterConfigService,
  ) {}

  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<any>> {
    const httpContext = context.switchToHttp();
    const request = httpContext.getRequest<Request>();
    const response = httpContext.getResponse<Response>();

    // Extraer identificador del cliente
    const clientKey = this.getClientKey(request);

    // Obtener regla aplicable para este endpoint
    const rule = this.configService.getRuleForEndpoint(request.path);

    // Verificar rate limit
    const result = await this.rateLimiterService.checkLimit(clientKey, rule);

    // Agregar headers de rate limiting a la respuesta
    this.setRateLimitHeaders(response, result);

    // Si no está permitido, rechazar con 429
    if (!result.allowed) {
      this.logger.warn(
        `Rate limit exceeded: ${clientKey} on ${request.method} ${request.path}`,
      );

      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: "Too many requests, please try again later",
          error: "Too Many Requests",
          retryAfter: result.retryAfter,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // Continuar con el request
    return next.handle();
  }

  /**
   * Extrae el identificador único del cliente.
   *
   * Prioridad:
   * 1. X-API-Key header (si existe)
   * 2. X-User-Id header (si existe)
   * 3. IP address (fallback)
   *
   * En producción, considerar:
   * - Combinar múltiples identificadores (IP + userId)
   * - Usar hash de fingerprint del cliente
   * - Rate limit por endpoint + cliente
   */
  private getClientKey(request: Request): string {
    // Opción 1: API Key (para clientes autenticados con key)
    const apiKey = request.headers["x-api-key"] as string;
    if (apiKey) {
      return `apikey:${apiKey}`;
    }

    // Opción 2: User ID (para usuarios logueados)
    const userId = request.headers["x-user-id"] as string;
    if (userId) {
      return `user:${userId}`;
    }

    // Opción 3: IP address (fallback por defecto)
    // Considerar X-Forwarded-For en producción con proxies/load balancers
    const ip = this.getClientIp(request);
    return `ip:${ip}`;
  }

  /**
   * Obtiene la IP del cliente considerando proxies
   */
  private getClientIp(request: Request): string {
    // Intenta obtener IP real desde headers de proxy
    const forwardedFor = request.headers["x-forwarded-for"] as string;
    if (forwardedFor) {
      // X-Forwarded-For puede tener múltiples IPs: "client, proxy1, proxy2"
      return forwardedFor.split(",")[0].trim();
    }

    // Otros headers comunes de proxies
    const realIp = request.headers["x-real-ip"] as string;
    if (realIp) {
      return realIp;
    }

    // Fallback a request.ip (provisto por Express)
    return request.ip || "unknown";
  }

  /**
   * Agrega headers estándar de rate limiting a la respuesta
   */
  private setRateLimitHeaders(
    response: Response,
    result: {
      limit: number;
      remaining: number;
      resetAt: number;
      retryAfter?: number;
    },
  ): void {
    // Headers estándar (RateLimit Header Fields para HTTP)
    // Ver: https://datatracker.ietf.org/doc/draft-ietf-httpapi-ratelimit-headers/
    response.setHeader("X-RateLimit-Limit", result.limit.toString());
    response.setHeader("X-RateLimit-Remaining", result.remaining.toString());
    response.setHeader("X-RateLimit-Reset", result.resetAt.toString());

    // Retry-After solo en respuestas 429
    if (result.retryAfter) {
      // Puede ser timestamp absoluto o segundos relativos
      // Usamos segundos relativos (más común)
      const retryAfterSeconds = Math.max(
        1,
        result.retryAfter - Math.floor(Date.now() / 1000),
      );
      response.setHeader("Retry-After", retryAfterSeconds.toString());
    }
  }
}
