import { Injectable, Logger } from "@nestjs/common";
import { RateLimitRule, TimeUnit } from "../../core/interfaces";

/**
 * Configuración de reglas por endpoint o tipo de acción.
 * Define diferentes límites según el contexto de la solicitud.
 */
export interface EndpointRuleConfig {
  [endpoint: string]: RateLimitRule;
}

/**
 * Servicio de configuración para reglas de rate limiting.
 */
@Injectable()
export class RateLimiterConfigService {
  private readonly logger = new Logger(RateLimiterConfigService.name);

  /**
   * Regla por defecto aplicada cuando no hay regla específica
   * 100 requests por minuto (suficientemente generoso para uso normal)
   */
  private readonly defaultRule: RateLimitRule = {
    name: "default",
    requestsPerUnit: 100,
    unit: TimeUnit.MINUTE,
  };

  /**
   * Reglas específicas por endpoint
   * Simulan políticas comunes en APIs reales
   */
  private readonly endpointRules: EndpointRuleConfig = {
    // Endpoints de autenticación: más restrictivos para prevenir brute force
    "/api/auth/login": {
      name: "login",
      requestsPerUnit: 5,
      unit: TimeUnit.MINUTE,
    },
    "/api/auth/register": {
      name: "register",
      requestsPerUnit: 3,
      unit: TimeUnit.HOUR,
    },
    "/api/auth/reset-password": {
      name: "password-reset",
      requestsPerUnit: 3,
      unit: TimeUnit.HOUR,
    },

    // Endpoints de contenido: límites medios
    "/api/posts": {
      name: "create-post",
      requestsPerUnit: 10,
      unit: TimeUnit.MINUTE,
    },
    "/api/comments": {
      name: "create-comment",
      requestsPerUnit: 30,
      unit: TimeUnit.MINUTE,
    },

    // Endpoints de lectura: más permisivos
    "/api/feed": {
      name: "feed",
      requestsPerUnit: 60,
      unit: TimeUnit.MINUTE,
    },

    // Endpoints de prueba: muy permisivos
    "/api/test": {
      name: "test",
      requestsPerUnit: 10,
      unit: TimeUnit.MINUTE,
    },
    "/api/health": {
      name: "health",
      requestsPerUnit: 200,
      unit: TimeUnit.MINUTE,
    },
  };

  constructor() {
    this.logger.log("RateLimiterConfigService initialized");
    this.logConfiguration();
  }

  /**
   * Obtiene la regla aplicable para un endpoint específico
   * @param path - Path del endpoint (ej: /api/auth/login)
   * @returns Regla configurada o regla por defecto
   */
  getRuleForEndpoint(path: string): RateLimitRule {
    // Buscar regla exacta
    const rule = this.endpointRules[path];
    if (rule) {
      return rule;
    }

    // Buscar regla por prefijo (más flexible)
    // Ejemplo: /api/auth/login/v2 matchea /api/auth/login
    for (const [pattern, ruleConfig] of Object.entries(this.endpointRules)) {
      if (path.startsWith(pattern)) {
        return ruleConfig;
      }
    }

    // Retornar regla por defecto
    return this.defaultRule;
  }

  /**
   * Obtiene la regla por defecto
   */
  getDefaultRule(): RateLimitRule {
    return this.defaultRule;
  }

  /**
   * Obtiene todas las reglas configuradas (debugging)
   */
  getAllRules(): EndpointRuleConfig {
    return { ...this.endpointRules };
  }

  /**
   * Registra la configuración actual en los logs
   */
  private logConfiguration(): void {
    const ruleCount = Object.keys(this.endpointRules).length;
    this.logger.log(`Loaded ${ruleCount} endpoint-specific rules`);
    this.logger.log(
      `Default rule: ${this.defaultRule.requestsPerUnit} requests per ${this.defaultRule.unit}`,
    );
  }

  /**
   * Permite agregar una regla dinámicamente (útil para testing o configuración runtime)
   */
  addRule(endpoint: string, rule: RateLimitRule): void {
    this.endpointRules[endpoint] = rule;
    this.logger.log(`Added rule for endpoint ${endpoint}`);
  }

  /**
   * Permite remover una regla (útil para testing)
   */
  removeRule(endpoint: string): void {
    delete this.endpointRules[endpoint];
    this.logger.log(`Removed rule for endpoint ${endpoint}`);
  }
}
