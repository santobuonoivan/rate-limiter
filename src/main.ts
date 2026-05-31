import { NestFactory } from "@nestjs/core";
import { ValidationPipe, Logger } from "@nestjs/common";
import { AppModule } from "./app.module";

/**
 * Bootstrap de la aplicación NestJS.
 *
 * Configuraciones aplicadas:
 * - ValidationPipe global para validación de DTOs
 * - CORS habilitado para desarrollo
 * - Logger de NestJS habilitado
 * - Graceful shutdown para limpieza de recursos
 */
async function bootstrap() {
  const logger = new Logger("Bootstrap");

  // Configurar logger level desde env
  const logLevels = process.env.LOG_LEVEL
    ? [process.env.LOG_LEVEL as any]
    : ["log", "error", "warn", "debug"];

  // Crear aplicación NestJS
  const app = await NestFactory.create(AppModule, {
    logger: logLevels,
  });

  // Configurar validation pipe global
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );

  // Habilitar CORS (útil para desarrollo y APIs públicas)
  app.enableCors({
    origin: true, // En producción: configurar orígenes específicos
    credentials: true,
  });

  // Configurar graceful shutdown
  app.enableShutdownHooks();

  // Puerto de escucha
  const port = process.env.PORT || 3000;

  await app.listen(port);

  logger.log(`🚀 Application is running on: http://localhost:${port}`);
  logger.log(`📊 Health check: http://localhost:${port}/api/health`);
  logger.log(`🧪 Test endpoint: http://localhost:${port}/api/test`);
  logger.log("");
  logger.log("Rate Limiter is active on all endpoints!");
  logger.log(
    "Check headers: X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset",
  );
  logger.log("");
  logger.log("Example endpoints to test:");
  logger.log("  GET  /api/test (10 req/min)");
  logger.log("  GET  /api/health (200 req/min)");
  logger.log("  POST /api/auth/login (5 req/min)");
  logger.log("  POST /api/posts (10 req/min)");
  logger.log("  GET  /api/feed (60 req/min)");
}

bootstrap().catch((err) => {
  const logger = new Logger("Bootstrap");
  logger.error("Failed to start application", err);
  process.exit(1);
});
