import { TokenBucketAlgorithm } from "./token-bucket.algorithm";
import { RateLimitRule, TimeUnit, StorageAdapter } from "../interfaces";

describe("TokenBucketAlgorithm", () => {
  let algorithm: TokenBucketAlgorithm;
  let mockStorage: jest.Mocked<StorageAdapter>;

  beforeEach(() => {
    algorithm = new TokenBucketAlgorithm();
    mockStorage = {
      get: jest.fn(),
      set: jest.fn(),
      delete: jest.fn(),
      increment: jest.fn(),
    };
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("Basic Functionality", () => {
    it("should have correct algorithm name", () => {
      expect(algorithm.name).toBe("TokenBucket");
    });

    it("should allow first request when bucket is empty", async () => {
      const rule: RateLimitRule = {
        name: "test",
        requestsPerUnit: 10,
        unit: TimeUnit.MINUTE,
      };

      mockStorage.get.mockResolvedValue(null);

      const result = await algorithm.checkLimit("test-key", rule, mockStorage);

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(9); // capacity - 1
      expect(result.limit).toBe(10);
      expect(mockStorage.set).toHaveBeenCalledWith(
        "test-key",
        expect.objectContaining({
          count: 9,
          lastUpdate: expect.any(Number),
        }),
        120, // windowSeconds * 2 = 60 * 2
      );
    });

    it("should consume tokens correctly", async () => {
      const rule: RateLimitRule = {
        name: "test",
        requestsPerUnit: 5,
        unit: TimeUnit.MINUTE,
      };

      const now = Date.now();

      // Bucket con 3 tokens disponibles
      mockStorage.get.mockResolvedValue({
        count: 3,
        lastUpdate: now - 1000, // 1 segundo atrás
      });

      const result = await algorithm.checkLimit("test-key", rule, mockStorage);

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBeLessThanOrEqual(3);
      expect(result.limit).toBe(5);
    });

    it("should reject when no tokens available", async () => {
      const rule: RateLimitRule = {
        name: "test",
        requestsPerUnit: 5,
        unit: TimeUnit.MINUTE,
      };

      const now = Date.now();

      // Bucket con 0 tokens (consumidos todos)
      mockStorage.get.mockResolvedValue({
        count: 0,
        lastUpdate: now - 1000,
      });

      const result = await algorithm.checkLimit("test-key", rule, mockStorage);

      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
      expect(result.retryAfter).toBeDefined();
    });
  });

  describe("Token Regeneration", () => {
    it("should regenerate tokens over time", async () => {
      const rule: RateLimitRule = {
        name: "test",
        requestsPerUnit: 10,
        unit: TimeUnit.MINUTE, // 60 seconds
      };

      const now = Date.now();

      // Bucket con 0 tokens hace 30 segundos (la mitad de la ventana)
      // Debería regenerar ~5 tokens (50% de 10)
      mockStorage.get.mockResolvedValue({
        count: 0,
        lastUpdate: now - 30000, // 30 segundos atrás
      });

      const result = await algorithm.checkLimit("test-key", rule, mockStorage);

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBeGreaterThanOrEqual(4);
      expect(result.remaining).toBeLessThanOrEqual(5);
    });

    it("should not exceed bucket capacity", async () => {
      const rule: RateLimitRule = {
        name: "test",
        requestsPerUnit: 10,
        unit: TimeUnit.MINUTE,
      };

      const now = Date.now();

      // Bucket con 5 tokens hace 2 minutos (tiempo suficiente para regenerar completamente)
      mockStorage.get.mockResolvedValue({
        count: 5,
        lastUpdate: now - 120000, // 2 minutos atrás
      });

      const result = await algorithm.checkLimit("test-key", rule, mockStorage);

      expect(result.allowed).toBe(true);
      // Capacidad máxima es 10, consumimos 1, quedan 9
      expect(result.remaining).toBe(9);
    });

    it("should handle partial token regeneration", async () => {
      const rule: RateLimitRule = {
        name: "test",
        requestsPerUnit: 60,
        unit: TimeUnit.MINUTE, // 1 token por segundo
      };

      const now = Date.now();

      // 0 tokens hace 10 segundos = deberían regenerarse ~10 tokens
      mockStorage.get.mockResolvedValue({
        count: 0,
        lastUpdate: now - 10000,
      });

      const result = await algorithm.checkLimit("test-key", rule, mockStorage);

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBeGreaterThanOrEqual(9);
      expect(result.remaining).toBeLessThanOrEqual(10);
    });
  });

  describe("Different Time Units", () => {
    it("should handle SECOND unit correctly", async () => {
      const rule: RateLimitRule = {
        name: "test",
        requestsPerUnit: 5,
        unit: TimeUnit.SECOND,
      };

      mockStorage.get.mockResolvedValue(null);

      const result = await algorithm.checkLimit("test-key", rule, mockStorage);

      expect(result.allowed).toBe(true);
      expect(result.limit).toBe(5);
      expect(mockStorage.set).toHaveBeenCalledWith(
        "test-key",
        expect.anything(),
        2, // 1 second * 2
      );
    });

    it("should handle HOUR unit correctly", async () => {
      const rule: RateLimitRule = {
        name: "test",
        requestsPerUnit: 1000,
        unit: TimeUnit.HOUR,
      };

      mockStorage.get.mockResolvedValue(null);

      const result = await algorithm.checkLimit("test-key", rule, mockStorage);

      expect(result.allowed).toBe(true);
      expect(result.limit).toBe(1000);
      expect(mockStorage.set).toHaveBeenCalledWith(
        "test-key",
        expect.anything(),
        7200, // 3600 * 2
      );
    });

    it("should handle DAY unit correctly", async () => {
      const rule: RateLimitRule = {
        name: "test",
        requestsPerUnit: 10000,
        unit: TimeUnit.DAY,
      };

      mockStorage.get.mockResolvedValue(null);

      const result = await algorithm.checkLimit("test-key", rule, mockStorage);

      expect(result.allowed).toBe(true);
      expect(result.limit).toBe(10000);
      expect(mockStorage.set).toHaveBeenCalledWith(
        "test-key",
        expect.anything(),
        172800, // 86400 * 2
      );
    });
  });

  describe("Burst Traffic", () => {
    it("should allow burst of requests up to capacity", async () => {
      const rule: RateLimitRule = {
        name: "test",
        requestsPerUnit: 5,
        unit: TimeUnit.MINUTE,
      };

      // Simular 5 requests consecutivas (burst)
      const results: boolean[] = [];

      for (let i = 0; i < 5; i++) {
        const now = Date.now();
        const currentTokens = 5 - i; // 5, 4, 3, 2, 1

        mockStorage.get.mockResolvedValue({
          count: currentTokens,
          lastUpdate: now - 100, // Casi inmediato
        });

        const result = await algorithm.checkLimit(
          "test-key",
          rule,
          mockStorage,
        );
        results.push(result.allowed);
      }

      // Todas las 5 primeras deberían estar permitidas
      expect(results.filter((r) => r).length).toBe(5);
    });

    it("should reject after burst exhausts tokens", async () => {
      const rule: RateLimitRule = {
        name: "test",
        requestsPerUnit: 3,
        unit: TimeUnit.MINUTE,
      };

      const now = Date.now();

      // Todos los tokens consumidos, sin tiempo para regeneración
      mockStorage.get.mockResolvedValue({
        count: 0,
        lastUpdate: now - 100, // Casi inmediato
      });

      const result = await algorithm.checkLimit("test-key", rule, mockStorage);

      expect(result.allowed).toBe(false);
      expect(result.retryAfter).toBeDefined();
    });
  });

  describe("Reset and Retry Logic", () => {
    it("should provide resetAt timestamp", async () => {
      const rule: RateLimitRule = {
        name: "test",
        requestsPerUnit: 10,
        unit: TimeUnit.MINUTE,
      };

      mockStorage.get.mockResolvedValue(null);

      const result = await algorithm.checkLimit("test-key", rule, mockStorage);

      expect(result.resetAt).toBeDefined();
      expect(result.resetAt).toBeGreaterThan(Date.now() / 1000);
    });

    it("should provide retryAfter only when rejected", async () => {
      const rule: RateLimitRule = {
        name: "test",
        requestsPerUnit: 5,
        unit: TimeUnit.MINUTE,
      };

      // Request permitido
      mockStorage.get.mockResolvedValue({
        count: 3,
        lastUpdate: Date.now(),
      });

      const allowedResult = await algorithm.checkLimit(
        "test-key",
        rule,
        mockStorage,
      );
      expect(allowedResult.retryAfter).toBeUndefined();

      // Request rechazado
      mockStorage.get.mockResolvedValue({
        count: 0,
        lastUpdate: Date.now(),
      });

      const rejectedResult = await algorithm.checkLimit(
        "test-key",
        rule,
        mockStorage,
      );
      expect(rejectedResult.retryAfter).toBeDefined();
      expect(rejectedResult.retryAfter).toBeGreaterThan(Date.now() / 1000);
    });
  });

  describe("Edge Cases", () => {
    it("should handle fractional tokens correctly", async () => {
      const rule: RateLimitRule = {
        name: "test",
        requestsPerUnit: 7,
        unit: TimeUnit.MINUTE,
      };

      const now = Date.now();

      // 0.5 tokens hace 17 segundos (17/60 * 7 ≈ 1.98 tokens regenerados)
      mockStorage.get.mockResolvedValue({
        count: 0.5,
        lastUpdate: now - 17000,
      });

      const result = await algorithm.checkLimit("test-key", rule, mockStorage);

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBeGreaterThanOrEqual(1);
    });

    it("should handle very high request rates", async () => {
      const rule: RateLimitRule = {
        name: "test",
        requestsPerUnit: 1000,
        unit: TimeUnit.SECOND,
      };

      mockStorage.get.mockResolvedValue(null);

      const result = await algorithm.checkLimit("test-key", rule, mockStorage);

      expect(result.allowed).toBe(true);
      expect(result.limit).toBe(1000);
      expect(result.remaining).toBe(999);
    });

    it("should handle very low request rates", async () => {
      const rule: RateLimitRule = {
        name: "test",
        requestsPerUnit: 1,
        unit: TimeUnit.HOUR,
      };

      mockStorage.get.mockResolvedValue(null);

      const result = await algorithm.checkLimit("test-key", rule, mockStorage);

      expect(result.allowed).toBe(true);
      expect(result.limit).toBe(1);
      expect(result.remaining).toBe(0);
    });

    it("should handle immediate consecutive requests", async () => {
      const rule: RateLimitRule = {
        name: "test",
        requestsPerUnit: 10,
        unit: TimeUnit.MINUTE,
      };

      const now = Date.now();

      // Request hace 1ms (prácticamente inmediato)
      mockStorage.get.mockResolvedValue({
        count: 5,
        lastUpdate: now - 1,
      });

      const result = await algorithm.checkLimit("test-key", rule, mockStorage);

      expect(result.allowed).toBe(true);
      // No debería regenerar tokens significativos en 1ms
      expect(result.remaining).toBeGreaterThanOrEqual(4);
    });
  });

  describe("Storage Integration", () => {
    it("should call storage.get with correct key", async () => {
      const rule: RateLimitRule = {
        name: "test",
        requestsPerUnit: 10,
        unit: TimeUnit.MINUTE,
      };

      mockStorage.get.mockResolvedValue(null);

      await algorithm.checkLimit("user:123", rule, mockStorage);

      expect(mockStorage.get).toHaveBeenCalledWith("user:123");
      expect(mockStorage.get).toHaveBeenCalledTimes(1);
    });

    it("should call storage.set with correct parameters", async () => {
      const rule: RateLimitRule = {
        name: "test",
        requestsPerUnit: 10,
        unit: TimeUnit.MINUTE,
      };

      mockStorage.get.mockResolvedValue(null);

      await algorithm.checkLimit("user:123", rule, mockStorage);

      expect(mockStorage.set).toHaveBeenCalledWith(
        "user:123",
        expect.objectContaining({
          count: expect.any(Number),
          lastUpdate: expect.any(Number),
        }),
        120, // TTL
      );
      expect(mockStorage.set).toHaveBeenCalledTimes(1);
    });
  });
});
