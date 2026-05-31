import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { RateLimiterModule, RateLimitAlgorithm } from "./rate-limiter.module";
import { TestController } from "./infrastructure/controllers/test.controller";

/**
 * Módulo raíz de la aplicación.
 *
 * Configura e importa todos los módulos necesarios.
 * En este caso, principalmente el RateLimiterModule con sus configuraciones.
 */
@Module({
  imports: [
    // Configurar variables de entorno
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ".env",
    }),

    // Configurar Rate Limiter con algoritmo desde env
    RateLimiterModule.forRoot({
      algorithm:
        process.env.RATE_LIMIT_ALGORITHM === "SLIDING_WINDOW_COUNTER"
          ? RateLimitAlgorithm.SLIDING_WINDOW_COUNTER
          : RateLimitAlgorithm.TOKEN_BUCKET,
      enableGlobalInterceptor:
        process.env.ENABLE_GLOBAL_INTERCEPTOR !== "false",
    }),
  ],
  controllers: [TestController],
})
export class AppModule {}
