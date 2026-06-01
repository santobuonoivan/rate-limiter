import { RedisStorage } from "./redis.storage";
import { BucketState } from "../../core/interfaces";

// Mock de ioredis
const mockRedisClient = {
  get: jest.fn(),
  set: jest.fn(),
  setex: jest.fn(),
  del: jest.fn(),
  eval: jest.fn(),
  scanStream: jest.fn(),
  info: jest.fn(),
  ping: jest.fn(),
  quit: jest.fn(),
  on: jest.fn(),
};

jest.mock("ioredis", () => {
  return jest.fn().mockImplementation(() => mockRedisClient);
});

describe("RedisStorage", () => {
  let storage: RedisStorage;

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();

    // Create instance manually (no DI needed for tests)
    storage = new RedisStorage();
  });

  afterEach(async () => {
    await storage.onModuleDestroy();
  });

  describe("get", () => {
    it("should return null when key does not exist", async () => {
      mockRedisClient.get.mockResolvedValue(null);

      const result = await storage.get("test-key");

      expect(result).toBeNull();
      expect(mockRedisClient.get).toHaveBeenCalledWith(
        "ratelimit:bucket:test-key",
      );
    });

    it("should return bucket state when key exists", async () => {
      const bucketState: BucketState = {
        count: 5,
        lastUpdate: Date.now(),
      };

      mockRedisClient.get.mockResolvedValue(JSON.stringify(bucketState));

      const result = await storage.get("test-key");

      expect(result).toEqual(bucketState);
      expect(mockRedisClient.get).toHaveBeenCalledWith(
        "ratelimit:bucket:test-key",
      );
    });

    it("should return null on Redis error (fail-open)", async () => {
      mockRedisClient.get.mockRejectedValue(new Error("Redis connection lost"));

      const result = await storage.get("test-key");

      expect(result).toBeNull();
    });

    it("should handle JSON parse errors gracefully", async () => {
      mockRedisClient.get.mockResolvedValue("invalid-json");

      const result = await storage.get("test-key");

      expect(result).toBeNull();
    });
  });

  describe("set", () => {
    it("should set value without TTL", async () => {
      const state: BucketState = {
        count: 10,
        lastUpdate: Date.now(),
      };

      mockRedisClient.set.mockResolvedValue("OK");

      await storage.set("test-key", state);

      expect(mockRedisClient.set).toHaveBeenCalledWith(
        "ratelimit:bucket:test-key",
        JSON.stringify(state),
      );
      expect(mockRedisClient.setex).not.toHaveBeenCalled();
    });

    it("should set value with TTL", async () => {
      const state: BucketState = {
        count: 10,
        lastUpdate: Date.now(),
      };
      const ttl = 60;

      mockRedisClient.setex.mockResolvedValue("OK");

      await storage.set("test-key", state, ttl);

      expect(mockRedisClient.setex).toHaveBeenCalledWith(
        "ratelimit:bucket:test-key",
        ttl,
        JSON.stringify(state),
      );
      expect(mockRedisClient.set).not.toHaveBeenCalled();
    });

    it("should handle Redis errors gracefully (fail-open)", async () => {
      const state: BucketState = {
        count: 10,
        lastUpdate: Date.now(),
      };

      mockRedisClient.set.mockRejectedValue(new Error("Redis connection lost"));

      // Should not throw
      await expect(storage.set("test-key", state)).resolves.toBeUndefined();
    });

    it("should ignore zero or negative TTL", async () => {
      const state: BucketState = {
        count: 10,
        lastUpdate: Date.now(),
      };

      mockRedisClient.set.mockResolvedValue("OK");

      await storage.set("test-key", state, 0);

      expect(mockRedisClient.set).toHaveBeenCalled();
      expect(mockRedisClient.setex).not.toHaveBeenCalled();
    });
  });

  describe("delete", () => {
    it("should delete key from Redis", async () => {
      mockRedisClient.del.mockResolvedValue(1);

      await storage.delete("test-key");

      expect(mockRedisClient.del).toHaveBeenCalledWith(
        "ratelimit:bucket:test-key",
      );
    });

    it("should handle Redis errors gracefully", async () => {
      mockRedisClient.del.mockRejectedValue(new Error("Redis error"));

      // Should not throw
      await expect(storage.delete("test-key")).resolves.toBeUndefined();
    });
  });

  describe("increment", () => {
    it("should increment existing bucket", async () => {
      const now = Date.now();
      jest.spyOn(Date, "now").mockReturnValue(now);

      // El script Lua retorna el nuevo count
      mockRedisClient.eval.mockResolvedValue(6);

      const result = await storage.increment("test-key", 1);

      expect(result).toBe(6);
      expect(mockRedisClient.eval).toHaveBeenCalled();

      // Verificar que se llamó con los argumentos correctos
      const evalCall = mockRedisClient.eval.mock.calls[0];
      expect(evalCall[0]).toContain("local increment"); // Lua script
      expect(evalCall[1]).toBe(1); // número de KEYS
      expect(evalCall[2]).toBe("ratelimit:bucket:test-key");
      expect(evalCall[3]).toBe("1"); // increment
      expect(evalCall[4]).toBe(now.toString()); // timestamp

      jest.spyOn(Date, "now").mockRestore();
    });

    it("should create new bucket if not exists", async () => {
      mockRedisClient.eval.mockResolvedValue(1);

      const result = await storage.increment("new-key", 1);

      expect(result).toBe(1);
    });

    it("should support custom increment values", async () => {
      mockRedisClient.eval.mockResolvedValue(5);

      const result = await storage.increment("test-key", 5);

      expect(result).toBe(5);

      const evalCall = mockRedisClient.eval.mock.calls[0];
      expect(evalCall[3]).toBe("5"); // increment value
    });

    it("should handle TTL in increment", async () => {
      mockRedisClient.eval.mockResolvedValue(1);

      await storage.increment("test-key", 1, 60);

      const evalCall = mockRedisClient.eval.mock.calls[0];
      expect(evalCall[5]).toBe("60"); // TTL
    });

    it("should return increment value on Redis error (fail-open)", async () => {
      mockRedisClient.eval.mockRejectedValue(new Error("Redis error"));

      const result = await storage.increment("test-key", 5);

      // Fail-open: retorna el increment como si fuera la primera vez
      expect(result).toBe(5);
    });

    it("should default increment to 1", async () => {
      mockRedisClient.eval.mockResolvedValue(1);

      await storage.increment("test-key");

      const evalCall = mockRedisClient.eval.mock.calls[0];
      expect(evalCall[3]).toBe("1"); // default increment
    });
  });

  describe("cleanup", () => {
    it("should clean up all buckets with prefix", async () => {
      const mockStream: any = {
        on: jest.fn((event: string, handler: any) => {
          if (event === "data") {
            handler([
              "ratelimit:bucket:key1",
              "ratelimit:bucket:key2",
              "ratelimit:bucket:key3",
            ]);
          }
          if (event === "end") {
            setTimeout(() => handler(), 0);
          }
          return mockStream;
        }),
      };

      mockRedisClient.scanStream.mockReturnValue(mockStream);
      mockRedisClient.del.mockResolvedValue(3);

      await storage.cleanup!();

      expect(mockRedisClient.scanStream).toHaveBeenCalledWith({
        match: "ratelimit:bucket:*",
        count: 100,
      });
      expect(mockRedisClient.del).toHaveBeenCalledWith(
        "ratelimit:bucket:key1",
        "ratelimit:bucket:key2",
        "ratelimit:bucket:key3",
      );
    });

    it("should handle empty results", async () => {
      const mockStream: any = {
        on: jest.fn((event: string, handler: any) => {
          if (event === "data") {
            handler([]);
          }
          if (event === "end") {
            setTimeout(() => handler(), 0);
          }
          return mockStream;
        }),
      };

      mockRedisClient.scanStream.mockReturnValue(mockStream);

      await storage.cleanup!();

      expect(mockRedisClient.del).not.toHaveBeenCalled();
    });

    it("should handle Redis errors during cleanup gracefully", async () => {
      const mockStream: any = {
        on: jest.fn((event: string, handler: any) => {
          if (event === "error") {
            setTimeout(() => handler(new Error("Redis error")), 0);
          }
          return mockStream;
        }),
      };

      mockRedisClient.scanStream.mockReturnValue(mockStream);

      // Should not throw due to fail-open strategy
      await expect(storage.cleanup!()).resolves.toBeUndefined();
    });
  });

  describe("getStats", () => {
    it("should return Redis statistics", async () => {
      const mockStream: any = {
        on: jest.fn((event: string, handler: any) => {
          if (event === "data") {
            handler(["key1", "key2", "key3"]);
          }
          if (event === "end") {
            setTimeout(() => handler(), 0);
          }
          return mockStream;
        }),
      };

      mockRedisClient.scanStream.mockReturnValue(mockStream);
      mockRedisClient.info.mockImplementation((section: string) => {
        if (section === "memory") {
          return Promise.resolve("used_memory_human:1.23M\r\n");
        }
        if (section === "clients") {
          return Promise.resolve("connected_clients:5\r\n");
        }
        return Promise.resolve("");
      });

      const stats = await storage.getStats();

      expect(stats).toEqual({
        totalKeys: 3,
        memoryUsed: "1.23M",
        connectedClients: 5,
      });
    });

    it("should handle errors in getStats", async () => {
      mockRedisClient.scanStream.mockImplementation(() => {
        throw new Error("Redis error");
      });

      const stats = await storage.getStats();

      expect(stats).toEqual({
        totalKeys: 0,
        memoryUsed: "error",
        connectedClients: 0,
      });
    });
  });

  describe("isHealthy", () => {
    it("should return true when Redis is healthy", async () => {
      mockRedisClient.ping.mockResolvedValue("PONG");

      const result = await storage.isHealthy();

      expect(result).toBe(true);
      expect(mockRedisClient.ping).toHaveBeenCalled();
    });

    it("should return false when Redis is unhealthy", async () => {
      mockRedisClient.ping.mockRejectedValue(new Error("Connection refused"));

      const result = await storage.isHealthy();

      expect(result).toBe(false);
    });

    it("should return false for unexpected ping response", async () => {
      mockRedisClient.ping.mockResolvedValue("UNEXPECTED");

      const result = await storage.isHealthy();

      expect(result).toBe(false);
    });
  });

  describe("getClient", () => {
    it("should return Redis client", () => {
      const client = storage.getClient();

      expect(client).toBeDefined();
      expect(client).toBe(mockRedisClient);
    });
  });

  describe("key prefix", () => {
    it("should use custom key prefix from config", async () => {
      const customStorage = new RedisStorage({ keyPrefix: "custom" });
      mockRedisClient.get.mockResolvedValue(null);

      await customStorage.get("test");

      expect(mockRedisClient.get).toHaveBeenCalledWith("custom:bucket:test");
    });

    it("should use environment variable for key prefix", async () => {
      process.env.REDIS_KEY_PREFIX = "myapp";
      const envStorage = new RedisStorage();
      mockRedisClient.get.mockResolvedValue(null);

      await envStorage.get("test");

      expect(mockRedisClient.get).toHaveBeenCalledWith("myapp:bucket:test");

      delete process.env.REDIS_KEY_PREFIX;
    });

    it("should use default key prefix", async () => {
      mockRedisClient.get.mockResolvedValue(null);

      await storage.get("test");

      expect(mockRedisClient.get).toHaveBeenCalledWith("ratelimit:bucket:test");
    });
  });

  describe("Configuration", () => {
    it("should use config values when provided", () => {
      const config = {
        host: "redis.example.com",
        port: 6380,
        password: "secret",
        db: 2,
        keyPrefix: "test",
      };

      const customStorage = new RedisStorage(config);

      expect(customStorage).toBeDefined();
    });

    it("should use environment variables when config not provided", () => {
      process.env.REDIS_HOST = "env-redis.com";
      process.env.REDIS_PORT = "6381";
      process.env.REDIS_PASSWORD = "env-password";
      process.env.REDIS_DB = "3";

      const envStorage = new RedisStorage();

      expect(envStorage).toBeDefined();

      // Cleanup
      delete process.env.REDIS_HOST;
      delete process.env.REDIS_PORT;
      delete process.env.REDIS_PASSWORD;
      delete process.env.REDIS_DB;
    });

    it("should use default values when no config or env", () => {
      const defaultStorage = new RedisStorage();

      expect(defaultStorage).toBeDefined();
    });
  });

  describe("Connection lifecycle", () => {
    it("should properly close connection on module destroy", async () => {
      mockRedisClient.quit.mockResolvedValue("OK");

      await storage.onModuleDestroy();

      expect(mockRedisClient.quit).toHaveBeenCalled();
    });

    it("should register event handlers on creation", () => {
      expect(mockRedisClient.on).toHaveBeenCalledWith(
        "connect",
        expect.any(Function),
      );
      expect(mockRedisClient.on).toHaveBeenCalledWith(
        "ready",
        expect.any(Function),
      );
      expect(mockRedisClient.on).toHaveBeenCalledWith(
        "error",
        expect.any(Function),
      );
      expect(mockRedisClient.on).toHaveBeenCalledWith(
        "close",
        expect.any(Function),
      );
      expect(mockRedisClient.on).toHaveBeenCalledWith(
        "reconnecting",
        expect.any(Function),
      );
    });

    it("should trigger connect event handler", () => {
      const connectHandler = mockRedisClient.on.mock.calls.find(
        (call: string[]) => call[0] === "connect",
      )?.[1];
      expect(() => connectHandler?.()).not.toThrow();
    });

    it("should trigger ready event handler", () => {
      const readyHandler = mockRedisClient.on.mock.calls.find(
        (call: string[]) => call[0] === "ready",
      )?.[1];
      expect(() => readyHandler?.()).not.toThrow();
    });

    it("should trigger error event handler", () => {
      const errorHandler = mockRedisClient.on.mock.calls.find(
        (call: string[]) => call[0] === "error",
      )?.[1];
      expect(() => errorHandler?.(new Error("test error"))).not.toThrow();
    });

    it("should trigger close event handler", () => {
      const closeHandler = mockRedisClient.on.mock.calls.find(
        (call: string[]) => call[0] === "close",
      )?.[1];
      expect(() => closeHandler?.()).not.toThrow();
    });

    it("should trigger reconnecting event handler", () => {
      const reconnectHandler = mockRedisClient.on.mock.calls.find(
        (call: string[]) => call[0] === "reconnecting",
      )?.[1];
      expect(() => reconnectHandler?.()).not.toThrow();
    });
  });

  describe("Circuit breaker disabled", () => {
    let noCircuitStorage: RedisStorage;

    beforeEach(() => {
      jest.clearAllMocks();
      noCircuitStorage = new RedisStorage({ circuitBreakerEnabled: false });
    });

    afterEach(async () => {
      await noCircuitStorage.onModuleDestroy();
    });

    it("should still get values when circuit breaker is disabled", async () => {
      const bucketState: BucketState = {
        count: 5,
        lastUpdate: Date.now(),
      };

      mockRedisClient.get.mockResolvedValue(JSON.stringify(bucketState));

      const result = await noCircuitStorage.get("test-key");

      expect(result).toEqual(bucketState);
    });

    it("should return null for missing key when circuit breaker is disabled", async () => {
      mockRedisClient.get.mockResolvedValue(null);

      const result = await noCircuitStorage.get("test-key");

      expect(result).toBeNull();
    });

    it("should set values when circuit breaker is disabled", async () => {
      const state: BucketState = { count: 10, lastUpdate: Date.now() };
      mockRedisClient.set.mockResolvedValue("OK");

      await noCircuitStorage.set("test-key", state);

      expect(mockRedisClient.set).toHaveBeenCalledWith(
        "ratelimit:bucket:test-key",
        JSON.stringify(state),
      );
    });

    it("should set values with TTL when circuit breaker is disabled", async () => {
      const state: BucketState = { count: 10, lastUpdate: Date.now() };
      mockRedisClient.setex.mockResolvedValue("OK");

      await noCircuitStorage.set("test-key", state, 60);

      expect(mockRedisClient.setex).toHaveBeenCalledWith(
        "ratelimit:bucket:test-key",
        60,
        JSON.stringify(state),
      );
    });

    it("should delete keys when circuit breaker is disabled", async () => {
      mockRedisClient.del.mockResolvedValue(1);

      await noCircuitStorage.delete("test-key");

      expect(mockRedisClient.del).toHaveBeenCalledWith(
        "ratelimit:bucket:test-key",
      );
    });

    it("should increment when circuit breaker is disabled", async () => {
      mockRedisClient.eval.mockResolvedValue(3);

      const result = await noCircuitStorage.increment("test-key", 1);

      expect(result).toBe(3);
      expect(mockRedisClient.eval).toHaveBeenCalled();
    });

    it("should handle get error gracefully when circuit breaker disabled", async () => {
      mockRedisClient.get.mockRejectedValue(new Error("Redis down"));

      const result = await noCircuitStorage.get("test-key");

      expect(result).toBeNull();
    });

    it("should handle set error gracefully when circuit breaker disabled", async () => {
      const state: BucketState = { count: 5, lastUpdate: Date.now() };
      mockRedisClient.set.mockRejectedValue(new Error("Redis down"));

      await expect(
        noCircuitStorage.set("test-key", state),
      ).resolves.toBeUndefined();
    });

    it("should handle delete error gracefully when circuit breaker disabled", async () => {
      mockRedisClient.del.mockRejectedValue(new Error("Redis down"));

      await expect(
        noCircuitStorage.delete("test-key"),
      ).resolves.toBeUndefined();
    });

    it("should return increment value on error when circuit breaker disabled", async () => {
      mockRedisClient.eval.mockRejectedValue(new Error("Redis down"));

      const result = await noCircuitStorage.increment("test-key", 7);

      expect(result).toBe(7);
    });
  });
});
