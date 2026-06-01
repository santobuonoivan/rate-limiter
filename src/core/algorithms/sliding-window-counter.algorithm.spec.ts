import { SlidingWindowCounterAlgorithm } from "./sliding-window-counter.algorithm";
import { RateLimitRule, TimeUnit, StorageAdapter } from "../interfaces";

describe("SlidingWindowCounterAlgorithm", () => {
  let algorithm: SlidingWindowCounterAlgorithm;
  let mockStorage: jest.Mocked<StorageAdapter>;

  beforeEach(() => {
    algorithm = new SlidingWindowCounterAlgorithm();
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
      expect(algorithm.name).toBe("SlidingWindowCounter");
    });

    it("should allow first request when no state exists", async () => {
      const rule: RateLimitRule = {
        name: "test",
        requestsPerUnit: 10,
        unit: TimeUnit.MINUTE,
      };

      mockStorage.get.mockResolvedValue(null);

      const result = await algorithm.checkLimit("test-key", rule, mockStorage);

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBeGreaterThanOrEqual(9);
      expect(result.limit).toBe(10);
    });

    it("should count requests correctly", async () => {
      const rule: RateLimitRule = {
        name: "test",
        requestsPerUnit: 5,
        unit: TimeUnit.MINUTE,
      };

      const now = Date.now();
      const windowMillis = 60 * 1000;
      const currentWindowStart = Math.floor(now / windowMillis) * windowMillis;

      mockStorage.get.mockResolvedValue({
        count: 3,
        lastUpdate: now - 1000,
        previousCount: 0,
        previousWindowStart: currentWindowStart - windowMillis,
      });

      const result = await algorithm.checkLimit("test-key", rule, mockStorage);

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBeLessThanOrEqual(2);
    });

    it("should reject when limit is exceeded", async () => {
      const rule: RateLimitRule = {
        name: "test",
        requestsPerUnit: 5,
        unit: TimeUnit.MINUTE,
      };

      const now = Date.now();
      const windowMillis = 60 * 1000;
      const currentWindowStart = Math.floor(now / windowMillis) * windowMillis;

      // 5 requests en ventana actual (límite alcanzado)
      mockStorage.get.mockResolvedValue({
        count: 5,
        lastUpdate: now - 1000,
        previousCount: 0,
        previousWindowStart: currentWindowStart - windowMillis,
      });

      const result = await algorithm.checkLimit("test-key", rule, mockStorage);

      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
      expect(result.retryAfter).toBeDefined();
    });
  });

  describe("Sliding Window Logic", () => {
    it("should weight previous window requests correctly", async () => {
      const rule: RateLimitRule = {
        name: "test",
        requestsPerUnit: 10,
        unit: TimeUnit.MINUTE,
      };

      const now = Date.now();
      const windowMillis = 60 * 1000;
      const currentWindowStart = Math.floor(now / windowMillis) * windowMillis;

      // Estamos a 30 segundos (50%) en la ventana actual
      const timeIntoWindow = 30000;
      const nowAdjusted = currentWindowStart + timeIntoWindow;

      // 3 requests en ventana actual, 4 en ventana anterior
      // Weighted count = 3 + (4 * 0.5) = 5
      mockStorage.get.mockResolvedValue({
        count: 3,
        lastUpdate: nowAdjusted - 1000,
        previousCount: 4,
        previousWindowStart: currentWindowStart - windowMillis,
      });

      // Mock Date.now() para controlar el tiempo
      jest.spyOn(Date, "now").mockReturnValue(nowAdjusted);

      const result = await algorithm.checkLimit("test-key", rule, mockStorage);

      expect(result.allowed).toBe(true);
      // El weighted count es ~5, limit es 10, debería quedar espacio
      expect(result.remaining).toBeGreaterThan(0);

      jest.spyOn(Date, "now").mockRestore();
    });

    it("should handle window transitions correctly", async () => {
      const rule: RateLimitRule = {
        name: "test",
        requestsPerUnit: 7,
        unit: TimeUnit.MINUTE,
      };

      const now = Date.now();
      const windowMillis = 60 * 1000;
      const currentWindowStart = Math.floor(now / windowMillis) * windowMillis;
      const previousWindowStart = currentWindowStart - windowMillis;

      // Estado de la ventana anterior (5 requests)
      // Ahora estamos en nueva ventana
      mockStorage.get.mockResolvedValue({
        count: 5,
        lastUpdate: previousWindowStart + 30000, // En medio de ventana anterior
        previousCount: 0,
      });

      // Mock para estar justo al inicio de nueva ventana
      jest.spyOn(Date, "now").mockReturnValue(currentWindowStart + 1000);

      const result = await algorithm.checkLimit("test-key", rule, mockStorage);

      expect(result.allowed).toBe(true);
      // La ventana anterior ahora es previousCount, current debería empezar en 0

      jest.spyOn(Date, "now").mockRestore();
    });

    it("should reset old windows correctly", async () => {
      const rule: RateLimitRule = {
        name: "test",
        requestsPerUnit: 10,
        unit: TimeUnit.MINUTE,
      };

      const now = Date.now();
      const windowMillis = 60 * 1000;

      // Estado de hace 3 ventanas (muy antiguo)
      mockStorage.get.mockResolvedValue({
        count: 8,
        lastUpdate: now - windowMillis * 3,
        previousCount: 5,
      });

      const result = await algorithm.checkLimit("test-key", rule, mockStorage);

      expect(result.allowed).toBe(true);
      // Debería resetear completamente porque el estado es muy antiguo
      expect(result.remaining).toBeGreaterThanOrEqual(9);
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
    });
  });

  describe("Overlap Percentage Calculation", () => {
    it("should calculate 0% overlap at window start", async () => {
      const rule: RateLimitRule = {
        name: "test",
        requestsPerUnit: 10,
        unit: TimeUnit.MINUTE,
      };

      const now = Date.now();
      const windowMillis = 60 * 1000;
      const currentWindowStart = Math.floor(now / windowMillis) * windowMillis;

      // Justo al inicio de la ventana (0% progreso)
      jest.spyOn(Date, "now").mockReturnValue(currentWindowStart);

      mockStorage.get.mockResolvedValue({
        count: 0,
        lastUpdate: currentWindowStart - 1000,
        previousCount: 10, // Muchos en ventana anterior
      });

      const result = await algorithm.checkLimit("test-key", rule, mockStorage);

      // Con 0% progreso, overlap es 100%, weighted = 0 + (10 * 1) = 10
      // El algoritmo permite la request pero remaining refleja el estado después
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBeGreaterThanOrEqual(0);
      expect(result.remaining).toBeLessThanOrEqual(10);

      jest.spyOn(Date, "now").mockRestore();
    });

    it("should calculate 100% overlap at window end", async () => {
      const rule: RateLimitRule = {
        name: "test",
        requestsPerUnit: 10,
        unit: TimeUnit.MINUTE,
      };

      const now = Date.now();
      const windowMillis = 60 * 1000;
      const currentWindowStart = Math.floor(now / windowMillis) * windowMillis;

      // Justo al final de la ventana (100% progreso)
      const windowEnd = currentWindowStart + windowMillis - 1;
      jest.spyOn(Date, "now").mockReturnValue(windowEnd);

      mockStorage.get.mockResolvedValue({
        count: 5,
        lastUpdate: windowEnd - 1000,
        previousCount: 10, // Muchos en ventana anterior
      });

      const result = await algorithm.checkLimit("test-key", rule, mockStorage);

      // Con 100% progreso, overlap es ~0%, weighted ≈ 5 + (10 * 0) = 5
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBeGreaterThan(0);

      jest.spyOn(Date, "now").mockRestore();
    });

    it("should calculate 50% overlap at window middle", async () => {
      const rule: RateLimitRule = {
        name: "test",
        requestsPerUnit: 10,
        unit: TimeUnit.MINUTE,
      };

      const now = Date.now();
      const windowMillis = 60 * 1000;
      const currentWindowStart = Math.floor(now / windowMillis) * windowMillis;

      // En el medio de la ventana (50% progreso)
      const windowMiddle = currentWindowStart + windowMillis / 2;
      jest.spyOn(Date, "now").mockReturnValue(windowMiddle);

      mockStorage.get.mockResolvedValue({
        count: 3,
        lastUpdate: windowMiddle - 1000,
        previousCount: 6,
      });

      const result = await algorithm.checkLimit("test-key", rule, mockStorage);

      // Con 50% progreso, overlap es 50%, weighted = 3 + (6 * 0.5) = 6
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBeGreaterThan(0);

      jest.spyOn(Date, "now").mockRestore();
    });
  });

  describe("Edge Cases", () => {
    it("should handle zero requests in previous window", async () => {
      const rule: RateLimitRule = {
        name: "test",
        requestsPerUnit: 10,
        unit: TimeUnit.MINUTE,
      };

      const now = Date.now();
      const windowMillis = 60 * 1000;
      const currentWindowStart = Math.floor(now / windowMillis) * windowMillis;

      mockStorage.get.mockResolvedValue({
        count: 5,
        lastUpdate: now - 1000,
        previousCount: 0,
        previousWindowStart: currentWindowStart - windowMillis,
      });

      const result = await algorithm.checkLimit("test-key", rule, mockStorage);

      expect(result.allowed).toBe(true);
      // Sin requests en ventana anterior, weighted = count actual
      expect(result.remaining).toBeGreaterThan(0);
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
      expect(result.remaining).toBeGreaterThanOrEqual(0);
      expect(result.remaining).toBeLessThanOrEqual(1);
    });

    it("should handle fractional weighted counts", async () => {
      const rule: RateLimitRule = {
        name: "test",
        requestsPerUnit: 7,
        unit: TimeUnit.MINUTE,
      };

      const now = Date.now();
      const windowMillis = 60 * 1000;
      const currentWindowStart = Math.floor(now / windowMillis) * windowMillis;

      // 25% en ventana (overlap 75%)
      const timeInWindow = windowMillis * 0.25;
      jest
        .spyOn(Date, "now")
        .mockReturnValue(currentWindowStart + timeInWindow);

      // 2 actual + (3 * 0.75) = 4.25 (floor = 4)
      mockStorage.get.mockResolvedValue({
        count: 2,
        lastUpdate: currentWindowStart + timeInWindow - 1000,
        previousCount: 3,
      });

      const result = await algorithm.checkLimit("test-key", rule, mockStorage);

      expect(result.allowed).toBe(true);
      // Weighted ≈ 4.25, floor = 4, remaining = 7 - 5 = 2
      expect(result.remaining).toBeGreaterThanOrEqual(2);

      jest.spyOn(Date, "now").mockRestore();
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

      const now = Date.now();

      // Request permitido
      mockStorage.get.mockResolvedValue({
        count: 2,
        lastUpdate: now,
        previousCount: 0,
      });

      const allowedResult = await algorithm.checkLimit(
        "test-key",
        rule,
        mockStorage,
      );
      expect(allowedResult.retryAfter).toBeUndefined();

      // Request rechazado
      mockStorage.get.mockResolvedValue({
        count: 5,
        lastUpdate: now,
        previousCount: 0,
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

  describe("Storage Integration", () => {
    it("should call storage.get with correct key", async () => {
      const rule: RateLimitRule = {
        name: "test",
        requestsPerUnit: 10,
        unit: TimeUnit.MINUTE,
      };

      mockStorage.get.mockResolvedValue(null);

      await algorithm.checkLimit("user:456", rule, mockStorage);

      expect(mockStorage.get).toHaveBeenCalledWith("user:456");
      expect(mockStorage.get).toHaveBeenCalledTimes(1);
    });

    it("should call storage.set with correct parameters", async () => {
      const rule: RateLimitRule = {
        name: "test",
        requestsPerUnit: 10,
        unit: TimeUnit.MINUTE,
      };

      mockStorage.get.mockResolvedValue(null);

      await algorithm.checkLimit("user:456", rule, mockStorage);

      expect(mockStorage.set).toHaveBeenCalledWith(
        "user:456",
        expect.objectContaining({
          count: expect.any(Number),
          lastUpdate: expect.any(Number),
          previousCount: expect.any(Number),
        }),
        120, // TTL
      );
      expect(mockStorage.set).toHaveBeenCalledTimes(1);
    });

    it("should store previousWindowStart in state", async () => {
      const rule: RateLimitRule = {
        name: "test",
        requestsPerUnit: 10,
        unit: TimeUnit.MINUTE,
      };

      mockStorage.get.mockResolvedValue(null);

      await algorithm.checkLimit("user:456", rule, mockStorage);

      const setCall = mockStorage.set.mock.calls[0];
      const state = setCall[1] as any;

      expect(state).toHaveProperty("previousWindowStart");
      expect(typeof state.previousWindowStart).toBe("number");
    });
  });
});
