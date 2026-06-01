import { Test, TestingModule } from "@nestjs/testing";
import { InMemoryStorage } from "./in-memory.storage";
import { BucketState } from "../../core/interfaces";

describe("InMemoryStorage", () => {
  let storage: InMemoryStorage;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [InMemoryStorage],
    }).compile();

    storage = module.get<InMemoryStorage>(InMemoryStorage);
    storage.clear(); // Limpiar antes de cada test
  });

  afterEach(() => {
    storage.stopCleanupTask();
    storage.clear();
  });

  describe("Basic Operations", () => {
    it("should be defined", () => {
      expect(storage).toBeDefined();
    });

    it("should return null for non-existent key", async () => {
      const result = await storage.get("non-existent");
      expect(result).toBeNull();
    });

    it("should store and retrieve state correctly", async () => {
      const state: BucketState = {
        count: 5,
        lastUpdate: Date.now(),
      };

      await storage.set("test-key", state, 60);
      const retrieved = await storage.get("test-key");

      expect(retrieved).not.toBeNull();
      expect(retrieved?.count).toBe(5);
      expect(retrieved?.lastUpdate).toBe(state.lastUpdate);
    });

    it("should overwrite existing key", async () => {
      const state1: BucketState = { count: 5, lastUpdate: Date.now() };
      const state2: BucketState = { count: 10, lastUpdate: Date.now() };

      await storage.set("test-key", state1, 60);
      await storage.set("test-key", state2, 60);

      const retrieved = await storage.get("test-key");
      expect(retrieved?.count).toBe(10);
    });

    it("should delete key correctly", async () => {
      const state: BucketState = { count: 5, lastUpdate: Date.now() };

      await storage.set("test-key", state, 60);
      await storage.delete("test-key");

      const retrieved = await storage.get("test-key");
      expect(retrieved).toBeNull();
    });

    it("should handle multiple keys independently", async () => {
      const state1: BucketState = { count: 5, lastUpdate: Date.now() };
      const state2: BucketState = { count: 10, lastUpdate: Date.now() };

      await storage.set("key1", state1, 60);
      await storage.set("key2", state2, 60);

      const retrieved1 = await storage.get("key1");
      const retrieved2 = await storage.get("key2");

      expect(retrieved1?.count).toBe(5);
      expect(retrieved2?.count).toBe(10);
    });
  });

  describe("TTL and Expiration", () => {
    it("should expire entries after TTL", async () => {
      const state: BucketState = { count: 5, lastUpdate: Date.now() };

      // TTL de 0.1 segundos
      await storage.set("test-key", state, 0.1);

      // Verificar que existe inmediatamente
      let retrieved = await storage.get("test-key");
      expect(retrieved).not.toBeNull();

      // Esperar a que expire
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Debería retornar null después de expirar
      retrieved = await storage.get("test-key");
      expect(retrieved).toBeNull();
    });

    it("should handle very short TTL", async () => {
      const state: BucketState = { count: 5, lastUpdate: Date.now() };

      await storage.set("test-key", state, 0.05); // 50ms

      await new Promise((resolve) => setTimeout(resolve, 100));

      const retrieved = await storage.get("test-key");
      expect(retrieved).toBeNull();
    });

    it("should handle long TTL", async () => {
      const state: BucketState = { count: 5, lastUpdate: Date.now() };

      await storage.set("test-key", state, 3600); // 1 hora

      const retrieved = await storage.get("test-key");
      expect(retrieved).not.toBeNull();
      expect(retrieved?.count).toBe(5);
    });

    it("should not return expired entries on get", async () => {
      const state: BucketState = { count: 5, lastUpdate: Date.now() };

      await storage.set("test-key", state, 0.05);
      await new Promise((resolve) => setTimeout(resolve, 100));

      // get debería eliminar la entrada expirada
      const retrieved = await storage.get("test-key");
      expect(retrieved).toBeNull();

      // Verificar que realmente se eliminó
      const stats = storage.getStats();
      expect(stats.totalBuckets).toBe(0);
    });
  });

  describe("Increment Operation", () => {
    it("should create new bucket with initial value on first increment", async () => {
      const result = await storage.increment("test-key", 1);

      expect(result).toBe(1);

      const state = await storage.get("test-key");
      expect(state?.count).toBe(1);
    });

    it("should increment existing counter", async () => {
      await storage.increment("test-key", 1);
      await storage.increment("test-key", 1);
      const result = await storage.increment("test-key", 1);

      expect(result).toBe(3);
    });

    it("should handle custom increment values", async () => {
      await storage.increment("test-key", 5);
      const result = await storage.increment("test-key", 3);

      expect(result).toBe(8);
    });

    it("should update lastUpdate timestamp on increment", async () => {
      const before = Date.now();
      await storage.increment("test-key", 1);
      const after = Date.now();

      const state = await storage.get("test-key");
      expect(state?.lastUpdate).toBeGreaterThanOrEqual(before);
      expect(state?.lastUpdate).toBeLessThanOrEqual(after);
    });

    it("should recreate bucket if expired", async () => {
      await storage.increment("test-key", 5);

      // Esperar a que expire (asumiendo TTL corto en test)
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Modificar el TTL interno para forzar expiración
      const state: BucketState = { count: 10, lastUpdate: Date.now() - 10000 };
      await storage.set("test-key", state, 0.01);
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Incrementar debería crear nuevo bucket
      const result = await storage.increment("test-key", 1);
      expect(result).toBe(1); // Nuevo bucket, no 11
    });

    it("should update TTL when incrementing existing entry with ttlSeconds", async () => {
      // Crear entrada primero (sin TTL explícito)
      await storage.increment("test-key", 1);

      // Obtener entry antes de actualizar
      const stateBefore = await storage.get("test-key");
      expect(stateBefore?.count).toBe(1);

      // Incrementar la entrada EXISTENTE con un ttlSeconds explícito
      const result = await storage.increment("test-key", 1, 120);

      expect(result).toBe(2);

      // La entrada debe seguir existiendo con el nuevo TTL
      const stateAfter = await storage.get("test-key");
      expect(stateAfter?.count).toBe(2);
    });
  });

  describe("Cleanup", () => {
    it("should remove expired entries on cleanup", async () => {
      const state1: BucketState = { count: 5, lastUpdate: Date.now() };
      const state2: BucketState = { count: 10, lastUpdate: Date.now() };

      await storage.set("key1", state1, 0.05);
      await storage.set("key2", state2, 3600);

      await new Promise((resolve) => setTimeout(resolve, 100));
      await storage.cleanup();

      const retrieved1 = await storage.get("key1");
      const retrieved2 = await storage.get("key2");

      expect(retrieved1).toBeNull();
      expect(retrieved2).not.toBeNull();
    });

    it("should not affect non-expired entries", async () => {
      const state: BucketState = { count: 5, lastUpdate: Date.now() };

      await storage.set("test-key", state, 3600);
      await storage.cleanup();

      const retrieved = await storage.get("test-key");
      expect(retrieved).not.toBeNull();
      expect(retrieved?.count).toBe(5);
    });

    it("should handle cleanup with no expired entries", async () => {
      const state: BucketState = { count: 5, lastUpdate: Date.now() };
      await storage.set("test-key", state, 3600);

      await expect(storage.cleanup()).resolves.not.toThrow();

      const stats = storage.getStats();
      expect(stats.totalBuckets).toBe(1);
    });

    it("should handle cleanup with empty storage", async () => {
      await expect(storage.cleanup()).resolves.not.toThrow();

      const stats = storage.getStats();
      expect(stats.totalBuckets).toBe(0);
    });
  });

  describe("Stats", () => {
    it("should return correct stats for empty storage", () => {
      const stats = storage.getStats();

      expect(stats.totalBuckets).toBe(0);
      expect(stats.expiredBuckets).toBe(0);
    });

    it("should count total buckets correctly", async () => {
      await storage.set("key1", { count: 1, lastUpdate: Date.now() }, 60);
      await storage.set("key2", { count: 2, lastUpdate: Date.now() }, 60);
      await storage.set("key3", { count: 3, lastUpdate: Date.now() }, 60);

      const stats = storage.getStats();
      expect(stats.totalBuckets).toBe(3);
      expect(stats.expiredBuckets).toBe(0);
    });

    it("should count expired buckets correctly", async () => {
      await storage.set("key1", { count: 1, lastUpdate: Date.now() }, 0.05);
      await storage.set("key2", { count: 2, lastUpdate: Date.now() }, 3600);

      await new Promise((resolve) => setTimeout(resolve, 100));

      const stats = storage.getStats();
      expect(stats.totalBuckets).toBe(2);
      expect(stats.expiredBuckets).toBe(1);
    });
  });

  describe("Clear", () => {
    it("should remove all buckets", async () => {
      await storage.set("key1", { count: 1, lastUpdate: Date.now() }, 60);
      await storage.set("key2", { count: 2, lastUpdate: Date.now() }, 60);

      storage.clear();

      const stats = storage.getStats();
      expect(stats.totalBuckets).toBe(0);

      const retrieved1 = await storage.get("key1");
      const retrieved2 = await storage.get("key2");

      expect(retrieved1).toBeNull();
      expect(retrieved2).toBeNull();
    });

    it("should work on empty storage", () => {
      expect(() => storage.clear()).not.toThrow();
    });
  });

  describe("Concurrency Safety", () => {
    it("should handle concurrent increments correctly", async () => {
      const promises = Array.from({ length: 100 }, () =>
        storage.increment("counter", 1),
      );

      await Promise.all(promises);

      const state = await storage.get("counter");
      expect(state?.count).toBe(100);
    });

    it("should handle concurrent sets correctly", async () => {
      const promises = Array.from({ length: 10 }, (_, i) =>
        storage.set(`key${i}`, { count: i, lastUpdate: Date.now() }, 60),
      );

      await Promise.all(promises);

      const stats = storage.getStats();
      expect(stats.totalBuckets).toBe(10);
    });

    it("should handle mixed concurrent operations", async () => {
      const operations = [
        storage.set("key1", { count: 1, lastUpdate: Date.now() }, 60),
        storage.increment("key2", 1),
        storage.get("key1"),
        storage.delete("key3"),
        storage.increment("key2", 1),
      ];

      await expect(Promise.all(operations)).resolves.not.toThrow();
    });
  });

  describe("Data Isolation", () => {
    it("should not allow external mutations to affect stored state", async () => {
      const state: BucketState = { count: 5, lastUpdate: Date.now() };

      await storage.set("test-key", state, 60);

      // Mutar objeto original
      state.count = 999;

      const retrieved = await storage.get("test-key");
      expect(retrieved?.count).toBe(5); // No debería cambiar
    });

    it("should store independent copies for different keys", async () => {
      const state: BucketState = { count: 5, lastUpdate: Date.now() };

      await storage.set("key1", state, 60);
      await storage.set("key2", state, 60);

      // Modificar una
      const state1 = await storage.get("key1");
      if (state1) state1.count = 100;
      await storage.set("key1", state1!, 60);

      // La otra no debería cambiar
      const state2 = await storage.get("key2");
      expect(state2?.count).toBe(5);
    });
  });

  describe("Edge Cases", () => {
    it("should handle empty string key", async () => {
      const state: BucketState = { count: 5, lastUpdate: Date.now() };

      await storage.set("", state, 60);
      const retrieved = await storage.get("");

      expect(retrieved).not.toBeNull();
      expect(retrieved?.count).toBe(5);
    });

    it("should handle very long key names", async () => {
      const longKey = "x".repeat(1000);
      const state: BucketState = { count: 5, lastUpdate: Date.now() };

      await storage.set(longKey, state, 60);
      const retrieved = await storage.get(longKey);

      expect(retrieved).not.toBeNull();
      expect(retrieved?.count).toBe(5);
    });

    it("should handle zero count", async () => {
      const state: BucketState = { count: 0, lastUpdate: Date.now() };

      await storage.set("test-key", state, 60);
      const retrieved = await storage.get("test-key");

      expect(retrieved).not.toBeNull();
      expect(retrieved?.count).toBe(0);
    });

    it("should handle negative count", async () => {
      const state: BucketState = { count: -5, lastUpdate: Date.now() };

      await storage.set("test-key", state, 60);
      const retrieved = await storage.get("test-key");

      expect(retrieved).not.toBeNull();
      expect(retrieved?.count).toBe(-5);
    });

    it("should handle fractional count", async () => {
      const state: BucketState = { count: 5.7, lastUpdate: Date.now() };

      await storage.set("test-key", state, 60);
      const retrieved = await storage.get("test-key");

      expect(retrieved).not.toBeNull();
      expect(retrieved?.count).toBeCloseTo(5.7);
    });
  });

  describe("Cleanup Task", () => {
    it("should stop cleanup task when requested", () => {
      expect(() => storage.stopCleanupTask()).not.toThrow();
    });

    it("should handle stopping already stopped task", () => {
      storage.stopCleanupTask();
      expect(() => storage.stopCleanupTask()).not.toThrow();
    });

    it("should handle cleanup errors inside the periodic interval", async () => {
      jest.useFakeTimers();

      // Crear instancia DESPUÉS de activar fake timers para que el
      // setInterval quede registrado en el sistema de fake timers
      const fakeTimerStorage = new InMemoryStorage();
      const loggerErrorSpy = jest.spyOn(fakeTimerStorage["logger"], "error");

      jest
        .spyOn(fakeTimerStorage, "cleanup")
        .mockRejectedValueOnce(new Error("Cleanup error"));

      // advanceTimersByTimeAsync dispara el setInterval y drena microtasks
      await jest.advanceTimersByTimeAsync(61000);

      expect(loggerErrorSpy).toHaveBeenCalledWith(
        "Error during cleanup",
        expect.any(Error),
      );

      fakeTimerStorage.stopCleanupTask();
      jest.useRealTimers();
    });
  });
});
