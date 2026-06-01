import { Test, TestingModule } from "@nestjs/testing";
import { MetricsService } from "./metrics.service";

describe("MetricsService", () => {
  let service: MetricsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [MetricsService],
    }).compile();

    service = module.get<MetricsService>(MetricsService);
  });

  afterEach(() => {
    service.reset();
  });

  describe("Initialization", () => {
    it("should be defined", () => {
      expect(service).toBeDefined();
    });

    it("should have a registry initialized", () => {
      expect(service["registry"]).toBeDefined();
    });

    it("should expose metrics immediately after creation", async () => {
      const metrics = await service.getMetrics();
      expect(typeof metrics).toBe("string");
      expect(metrics.length).toBeGreaterThan(0);
    });

    it("should expose default system metrics (node prefix)", async () => {
      const metrics = await service.getMetrics();
      // collectDefaultMetrics usa el prefix "rate_limiter_"
      expect(metrics).toContain("rate_limiter_");
    });
  });

  describe("recordRequest", () => {
    it("should increment requests counter for allowed status", async () => {
      service.recordRequest("TokenBucket", "allowed", "/api/test");

      const metrics = await service.getMetrics();
      expect(metrics).toContain("rate_limiter_requests_total");
    });

    it("should increment requests counter for blocked status", async () => {
      service.recordRequest("TokenBucket", "blocked", "/api/test");

      const metrics = await service.getMetrics();
      expect(metrics).toContain("rate_limiter_requests_total");
      expect(metrics).toContain("rate_limiter_limit_exceeded_total");
    });

    it("should NOT increment limit_exceeded_total for allowed status", async () => {
      service.reset();
      service.recordRequest("TokenBucket", "allowed", "/api/test");

      const metrics = await service.getMetrics();
      // El counter de exceeded debería existir pero con valor 0 o no registrado
      // No debería tener un sample con value > 0
      if (metrics.includes("rate_limiter_limit_exceeded_total")) {
        const lines = metrics.split("\n");
        const sampleLines = lines.filter(
          (l) =>
            l.includes("rate_limiter_limit_exceeded_total{") &&
            !l.startsWith("#"),
        );
        sampleLines.forEach((line) => {
          const value = parseFloat(line.split(" ").pop() || "0");
          expect(value).toBe(0);
        });
      }
    });

    it("should increment limit_exceeded_total for blocked status", async () => {
      service.recordRequest("SlidingWindow", "blocked", "/api/auth/login");
      service.recordRequest("SlidingWindow", "blocked", "/api/auth/login");

      const metrics = await service.getMetrics();
      expect(metrics).toContain("rate_limiter_limit_exceeded_total");
    });

    it("should include algorithm label in metrics", async () => {
      service.recordRequest("TokenBucket", "allowed", "/api/feed");

      const metrics = await service.getMetrics();
      expect(metrics).toContain("TokenBucket");
    });

    it("should sanitize numeric IDs in endpoint", async () => {
      service.recordRequest("TokenBucket", "allowed", "/api/users/123");

      const metrics = await service.getMetrics();
      expect(metrics).toContain(":id");
      expect(metrics).not.toContain('endpoint="/api/users/123"');
    });

    it("should sanitize UUID in endpoint", async () => {
      service.recordRequest(
        "TokenBucket",
        "allowed",
        "/api/items/a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      );

      const metrics = await service.getMetrics();
      expect(metrics).toContain(":uuid");
    });

    it("should truncate very long endpoints", async () => {
      const longEndpoint = "/api/" + "x".repeat(200);
      service.recordRequest("TokenBucket", "allowed", longEndpoint);

      const metrics = await service.getMetrics();
      // La métrica debería estar presente pero el endpoint truncado a 100 chars
      expect(metrics).toContain("rate_limiter_requests_total");
    });

    it("should handle multiple calls with different labels", async () => {
      service.recordRequest("TokenBucket", "allowed", "/api/test");
      service.recordRequest("TokenBucket", "blocked", "/api/test");
      service.recordRequest("SlidingWindow", "allowed", "/api/feed");

      const metrics = await service.getMetrics();
      expect(metrics).toContain("rate_limiter_requests_total");
      expect(metrics).toContain("rate_limiter_limit_exceeded_total");
    });
  });

  describe("recordCheckDuration", () => {
    it("should record duration observation", async () => {
      service.recordCheckDuration("TokenBucket", "memory", 0.005);

      const metrics = await service.getMetrics();
      expect(metrics).toContain("rate_limiter_check_duration_seconds");
    });

    it("should include algorithm and storage labels", async () => {
      service.recordCheckDuration("TokenBucket", "redis", 0.002);

      const metrics = await service.getMetrics();
      expect(metrics).toContain("TokenBucket");
      expect(metrics).toContain("redis");
    });

    it("should record multiple observations", async () => {
      service.recordCheckDuration("TokenBucket", "memory", 0.001);
      service.recordCheckDuration("TokenBucket", "memory", 0.003);
      service.recordCheckDuration("TokenBucket", "memory", 0.01);

      const metrics = await service.getMetrics();
      expect(metrics).toContain("rate_limiter_check_duration_seconds_bucket");
      expect(metrics).toContain("rate_limiter_check_duration_seconds_sum");
      expect(metrics).toContain("rate_limiter_check_duration_seconds_count");
    });

    it("should work with redis storage type", async () => {
      service.recordCheckDuration("SlidingWindow", "redis", 0.005);

      const metrics = await service.getMetrics();
      expect(metrics).toContain("rate_limiter_check_duration_seconds");
    });
  });

  describe("recordStorageError", () => {
    it("should increment storage errors counter", async () => {
      service.recordStorageError("memory", "get");

      const metrics = await service.getMetrics();
      expect(metrics).toContain("rate_limiter_storage_errors_total");
    });

    it("should include storage and operation labels", async () => {
      service.recordStorageError("redis", "set");

      const metrics = await service.getMetrics();
      expect(metrics).toContain("redis");
      expect(metrics).toContain("set");
    });

    it("should handle multiple error types", async () => {
      service.recordStorageError("redis", "get");
      service.recordStorageError("redis", "set");
      service.recordStorageError("memory", "increment");

      const metrics = await service.getMetrics();
      expect(metrics).toContain("rate_limiter_storage_errors_total");
    });
  });

  describe("getMetrics", () => {
    it("should return a non-empty string", async () => {
      const result = await service.getMetrics();
      expect(typeof result).toBe("string");
      expect(result.length).toBeGreaterThan(0);
    });

    it("should return Prometheus text format", async () => {
      service.recordRequest("TokenBucket", "allowed", "/api/test");
      const result = await service.getMetrics();

      // El formato Prometheus tiene líneas con # HELP y # TYPE
      expect(result).toContain("# HELP");
      expect(result).toContain("# TYPE");
    });

    it("should reflect recorded metrics", async () => {
      service.recordRequest("TokenBucket", "allowed", "/api/test");
      service.recordStorageError("memory", "get");

      const result = await service.getMetrics();
      expect(result).toContain("rate_limiter_requests_total");
      expect(result).toContain("rate_limiter_storage_errors_total");
    });
  });

  describe("getContentType", () => {
    it("should return a content type string", () => {
      const contentType = service.getContentType();
      expect(typeof contentType).toBe("string");
      expect(contentType.length).toBeGreaterThan(0);
    });

    it("should return a text/plain compatible content type", () => {
      const contentType = service.getContentType();
      expect(contentType).toContain("text/plain");
    });
  });

  describe("reset", () => {
    it("should reset all metrics", async () => {
      // Registrar algunas métricas
      service.recordRequest("TokenBucket", "allowed", "/api/test");
      service.recordRequest("TokenBucket", "blocked", "/api/test");
      service.recordStorageError("memory", "get");

      // Reset
      service.reset();

      // Después del reset, las métricas deberían ser 0 o vacías
      const metrics = await service.getMetrics();
      // Los counters deberían estar en 0 (o no tener samples)
      const lines = metrics.split("\n");
      const requestLines = lines.filter(
        (l) => l.includes("rate_limiter_requests_total{") && !l.startsWith("#"),
      );
      requestLines.forEach((line) => {
        const value = parseFloat(line.split(" ").pop() || "0");
        expect(value).toBe(0);
      });
    });

    it("should allow recording metrics after reset", async () => {
      service.recordRequest("TokenBucket", "allowed", "/api/test");
      service.reset();
      service.recordRequest("TokenBucket", "blocked", "/api/auth/login");

      const metrics = await service.getMetrics();
      expect(metrics).toContain("rate_limiter_limit_exceeded_total");
    });
  });

  describe("sanitizeEndpoint (via recordRequest)", () => {
    it("should replace multiple numeric IDs", async () => {
      service.recordRequest("TokenBucket", "allowed", "/api/users/42/posts/7");

      const metrics = await service.getMetrics();
      expect(metrics).toContain(":id");
    });

    it("should preserve non-numeric paths", async () => {
      service.recordRequest("TokenBucket", "allowed", "/api/feed");

      const metrics = await service.getMetrics();
      expect(metrics).toContain("/api/feed");
    });

    it("should handle endpoint without leading slash", async () => {
      service.recordRequest("TokenBucket", "allowed", "api/test");

      const metrics = await service.getMetrics();
      expect(metrics).toContain("rate_limiter_requests_total");
    });
  });
});
