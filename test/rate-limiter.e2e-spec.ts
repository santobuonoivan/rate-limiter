import { Test, TestingModule } from "@nestjs/testing";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { InMemoryStorage } from "../src/infrastructure/storage/in-memory.storage";
import { STORAGE_ADAPTER } from "../src/core/injection-tokens";

describe("Rate Limiter E2E Tests", () => {
  let app: INestApplication;
  let storage: InMemoryStorage;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();

    // Aplicar misma configuración que en main.ts
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );

    app.enableCors();

    storage = moduleFixture.get<InMemoryStorage>(STORAGE_ADAPTER);

    await app.init();
  });

  afterAll(async () => {
    if (storage) {
      storage.stopCleanupTask();
    }
    await app.close();
  });

  beforeEach(() => {
    if (storage) {
      storage.clear();
    }
  });

  describe("GET /api/test (10 req/min)", () => {
    it("should return 200 for first request", () => {
      return request(app.getHttpServer())
        .get("/api/test")
        .expect(200)
        .expect((res) => {
          expect(res.body).toHaveProperty("message");
          expect(res.body.message).toContain("Rate limiter is working");
        });
    });

    it("should include rate limit headers", () => {
      return request(app.getHttpServer())
        .get("/api/test")
        .expect(200)
        .expect((res) => {
          expect(res.headers).toHaveProperty("x-ratelimit-limit");
          expect(res.headers).toHaveProperty("x-ratelimit-remaining");
          expect(res.headers).toHaveProperty("x-ratelimit-reset");

          expect(res.headers["x-ratelimit-limit"]).toBe("10");
        });
    });

    it("should allow up to 10 requests", async () => {
      for (let i = 0; i < 10; i++) {
        await request(app.getHttpServer()).get("/api/test").expect(200);
      }
    });

    it("should return 429 after exceeding limit", async () => {
      for (let i = 0; i < 10; i++) {
        await request(app.getHttpServer()).get("/api/test");
      }

      return request(app.getHttpServer())
        .get("/api/test")
        .expect(429)
        .expect((res) => {
          expect(res.body).toHaveProperty("statusCode", 429);
          expect(res.body).toHaveProperty("error", "Too Many Requests");
        });
    });
  });

  describe("POST /api/auth/login (5 req/min)", () => {
    it("should apply stricter limit for login endpoint", () => {
      return request(app.getHttpServer())
        .post("/api/auth/login")
        .send({ username: "test", password: "test" })
        .expect(200)
        .expect((res) => {
          expect(res.headers["x-ratelimit-limit"]).toBe("5");
        });
    });

    it("should block after 5 login attempts", async () => {
      const credentials = { username: "test", password: "test" };

      for (let i = 0; i < 5; i++) {
        await request(app.getHttpServer())
          .post("/api/auth/login")
          .send(credentials)
          .expect(200);
      }

      return request(app.getHttpServer())
        .post("/api/auth/login")
        .send(credentials)
        .expect(429);
    });
  });

  describe("GET /api/health (200 req/min)", () => {
    it("should apply permissive limit for health check", () => {
      return request(app.getHttpServer())
        .get("/api/health")
        .expect(200)
        .expect((res) => {
          expect(res.headers["x-ratelimit-limit"]).toBe("200");
        });
    });
  });

  describe("Client Identification", () => {
    it("should identify by X-API-Key header", async () => {
      const res1 = await request(app.getHttpServer())
        .get("/api/test")
        .set("X-API-Key", "key-123")
        .expect(200);

      expect(res1.headers["x-ratelimit-remaining"]).toBe("9");

      const res2 = await request(app.getHttpServer())
        .get("/api/test")
        .set("X-API-Key", "key-456")
        .expect(200);

      expect(res2.headers["x-ratelimit-remaining"]).toBe("9");
    });

    it("should identify by X-User-Id header", async () => {
      const res1 = await request(app.getHttpServer())
        .get("/api/test")
        .set("X-User-Id", "user-999")
        .expect(200);

      expect(res1.headers["x-ratelimit-remaining"]).toBe("9");

      const res2 = await request(app.getHttpServer())
        .get("/api/test")
        .set("X-User-Id", "user-999")
        .expect(200);

      expect(res2.headers["x-ratelimit-remaining"]).toBe("8");
    });
  });

  describe("Response Headers", () => {
    it("should include all standard rate limit headers", async () => {
      const res = await request(app.getHttpServer())
        .get("/api/test")
        .expect(200);

      expect(res.headers).toHaveProperty("x-ratelimit-limit");
      expect(res.headers).toHaveProperty("x-ratelimit-remaining");
      expect(res.headers).toHaveProperty("x-ratelimit-reset");
    });

    it("should include Retry-After header on rejection", async () => {
      for (let i = 0; i < 10; i++) {
        await request(app.getHttpServer()).get("/api/test");
      }

      const res = await request(app.getHttpServer())
        .get("/api/test")
        .expect(429);

      expect(res.headers).toHaveProperty("retry-after");
    });
  });

  describe("Different Endpoints", () => {
    it("should apply different limits to different endpoints", async () => {
      const testRes = await request(app.getHttpServer())
        .get("/api/test")
        .expect(200);
      expect(testRes.headers["x-ratelimit-limit"]).toBe("10");

      const healthRes = await request(app.getHttpServer())
        .get("/api/health")
        .expect(200);
      expect(healthRes.headers["x-ratelimit-limit"]).toBe("200");
    });

    it("should track limits independently per endpoint", async () => {
      const apiKey = "test-unique-independent-key";

      // Agotar límite específicamente en /api/test
      for (let i = 0; i < 10; i++) {
        await request(app.getHttpServer())
          .get("/api/test")
          .set("X-API-Key", apiKey);
      }

      // /api/test debería estar bloqueado
      await request(app.getHttpServer())
        .get("/api/test")
        .set("X-API-Key", apiKey)
        .expect(429);

      // /api/health con un API key diferente debería funcionar
      await request(app.getHttpServer())
        .get("/api/health")
        .set("X-API-Key", "different-key-for-health")
        .expect(200);
    });
  });

  describe("CORS", () => {
    it("should include CORS headers", () => {
      return request(app.getHttpServer())
        .get("/api/test")
        .set("Origin", "http://example.com")
        .expect(200)
        .expect((res) => {
          expect(res.headers).toHaveProperty("access-control-allow-origin");
        });
    });
  });
});
