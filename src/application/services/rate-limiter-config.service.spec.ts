import { Test, TestingModule } from "@nestjs/testing";
import { RateLimiterConfigService } from "./rate-limiter-config.service";
import { TimeUnit, RateLimitRule } from "../../core/interfaces";

describe("RateLimiterConfigService", () => {
  let service: RateLimiterConfigService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [RateLimiterConfigService],
    }).compile();

    service = module.get<RateLimiterConfigService>(RateLimiterConfigService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("constructor", () => {
    it("should initialize the service", () => {
      expect(service).toBeDefined();
    });

    it("should have logger available", () => {
      expect(service["logger"]).toBeDefined();
    });

    it("should have default rule configured", () => {
      const defaultRule = service.getDefaultRule();
      expect(defaultRule).toBeDefined();
      expect(defaultRule.name).toBe("default");
      expect(defaultRule.requestsPerUnit).toBeGreaterThan(0);
    });

    it("should have endpoint rules configured", () => {
      const rules = service.getAllRules();
      expect(Object.keys(rules).length).toBeGreaterThan(0);
    });
  });

  describe("getDefaultRule", () => {
    it("should return the default rule", () => {
      const rule = service.getDefaultRule();

      expect(rule).toEqual({
        name: "default",
        requestsPerUnit: 100,
        unit: TimeUnit.MINUTE,
      });
    });

    it("should return the same instance on multiple calls", () => {
      const rule1 = service.getDefaultRule();
      const rule2 = service.getDefaultRule();

      expect(rule1).toBe(rule2);
    });
  });

  describe("getRuleForEndpoint", () => {
    describe("exact matches", () => {
      it("should return rule for /api/auth/login", () => {
        const rule = service.getRuleForEndpoint("/api/auth/login");

        expect(rule).toEqual({
          name: "login",
          requestsPerUnit: 5,
          unit: TimeUnit.MINUTE,
        });
      });

      it("should return rule for /api/auth/register", () => {
        const rule = service.getRuleForEndpoint("/api/auth/register");

        expect(rule).toEqual({
          name: "register",
          requestsPerUnit: 3,
          unit: TimeUnit.HOUR,
        });
      });

      it("should return rule for /api/auth/reset-password", () => {
        const rule = service.getRuleForEndpoint("/api/auth/reset-password");

        expect(rule).toEqual({
          name: "password-reset",
          requestsPerUnit: 3,
          unit: TimeUnit.HOUR,
        });
      });

      it("should return rule for /api/posts", () => {
        const rule = service.getRuleForEndpoint("/api/posts");

        expect(rule).toEqual({
          name: "create-post",
          requestsPerUnit: 10,
          unit: TimeUnit.MINUTE,
        });
      });

      it("should return rule for /api/comments", () => {
        const rule = service.getRuleForEndpoint("/api/comments");

        expect(rule).toEqual({
          name: "create-comment",
          requestsPerUnit: 30,
          unit: TimeUnit.MINUTE,
        });
      });

      it("should return rule for /api/feed", () => {
        const rule = service.getRuleForEndpoint("/api/feed");

        expect(rule).toEqual({
          name: "feed",
          requestsPerUnit: 60,
          unit: TimeUnit.MINUTE,
        });
      });

      it("should return rule for /api/test", () => {
        const rule = service.getRuleForEndpoint("/api/test");

        expect(rule).toEqual({
          name: "test",
          requestsPerUnit: 10,
          unit: TimeUnit.MINUTE,
        });
      });

      it("should return rule for /api/health", () => {
        const rule = service.getRuleForEndpoint("/api/health");

        expect(rule).toEqual({
          name: "health",
          requestsPerUnit: 200,
          unit: TimeUnit.MINUTE,
        });
      });
    });

    describe("prefix matches", () => {
      it("should match /api/auth/login/v2 to /api/auth/login rule", () => {
        const rule = service.getRuleForEndpoint("/api/auth/login/v2");

        expect(rule).toEqual({
          name: "login",
          requestsPerUnit: 5,
          unit: TimeUnit.MINUTE,
        });
      });

      it("should match /api/posts/123 to /api/posts rule", () => {
        const rule = service.getRuleForEndpoint("/api/posts/123");

        expect(rule).toEqual({
          name: "create-post",
          requestsPerUnit: 10,
          unit: TimeUnit.MINUTE,
        });
      });

      it("should match /api/comments/456/replies to /api/comments rule", () => {
        const rule = service.getRuleForEndpoint("/api/comments/456/replies");

        expect(rule).toEqual({
          name: "create-comment",
          requestsPerUnit: 30,
          unit: TimeUnit.MINUTE,
        });
      });

      it("should match /api/health/check to /api/health rule", () => {
        const rule = service.getRuleForEndpoint("/api/health/check");

        expect(rule).toEqual({
          name: "health",
          requestsPerUnit: 200,
          unit: TimeUnit.MINUTE,
        });
      });
    });

    describe("fallback to default", () => {
      it("should return default rule for unknown endpoint", () => {
        const rule = service.getRuleForEndpoint("/api/unknown");

        expect(rule).toEqual({
          name: "default",
          requestsPerUnit: 100,
          unit: TimeUnit.MINUTE,
        });
      });

      it("should return default rule for root path", () => {
        const rule = service.getRuleForEndpoint("/");

        expect(rule).toEqual({
          name: "default",
          requestsPerUnit: 100,
          unit: TimeUnit.MINUTE,
        });
      });

      it("should return default rule for empty string", () => {
        const rule = service.getRuleForEndpoint("");

        expect(rule).toEqual({
          name: "default",
          requestsPerUnit: 100,
          unit: TimeUnit.MINUTE,
        });
      });

      it("should return default rule for /api/users (no specific rule)", () => {
        const rule = service.getRuleForEndpoint("/api/users");

        expect(rule).toEqual({
          name: "default",
          requestsPerUnit: 100,
          unit: TimeUnit.MINUTE,
        });
      });
    });
  });

  describe("getAllRules", () => {
    it("should return all configured endpoint rules", () => {
      const rules = service.getAllRules();

      expect(rules).toBeDefined();
      expect(Object.keys(rules).length).toBeGreaterThan(0);
      expect(rules["/api/auth/login"]).toBeDefined();
      expect(rules["/api/posts"]).toBeDefined();
      expect(rules["/api/health"]).toBeDefined();
    });

    it("should return a copy of the rules (not the original object)", () => {
      const rules1 = service.getAllRules();
      const rules2 = service.getAllRules();

      // Should be equal but not the same reference
      expect(rules1).toEqual(rules2);
      expect(rules1).not.toBe(rules2);
    });

    it("should not affect internal rules when modifying returned object", () => {
      const rules = service.getAllRules();
      const originalLoginRule = service.getRuleForEndpoint("/api/auth/login");

      // Modify the returned object
      rules["/api/auth/login"] = {
        name: "modified",
        requestsPerUnit: 999,
        unit: TimeUnit.SECOND,
      };

      // Original rule should remain unchanged
      const currentRule = service.getRuleForEndpoint("/api/auth/login");
      expect(currentRule).toEqual(originalLoginRule);
      expect(currentRule.requestsPerUnit).toBe(5);
    });
  });

  describe("addRule", () => {
    it("should add a new rule for a custom endpoint", () => {
      const logSpy = jest.spyOn(service["logger"], "log");
      const customRule: RateLimitRule = {
        name: "custom",
        requestsPerUnit: 50,
        unit: TimeUnit.MINUTE,
      };

      service.addRule("/api/custom", customRule);

      const rule = service.getRuleForEndpoint("/api/custom");
      expect(rule).toEqual(customRule);
      expect(logSpy).toHaveBeenCalledWith(
        "Added rule for endpoint /api/custom",
      );
    });

    it("should override existing rule", () => {
      const newRule: RateLimitRule = {
        name: "login-modified",
        requestsPerUnit: 20,
        unit: TimeUnit.MINUTE,
      };

      service.addRule("/api/auth/login", newRule);

      const rule = service.getRuleForEndpoint("/api/auth/login");
      expect(rule).toEqual(newRule);
      expect(rule.requestsPerUnit).toBe(20);
    });

    it("should add rule with different time units", () => {
      const secondRule: RateLimitRule = {
        name: "per-second",
        requestsPerUnit: 10,
        unit: TimeUnit.SECOND,
      };

      service.addRule("/api/fast", secondRule);

      const rule = service.getRuleForEndpoint("/api/fast");
      expect(rule.unit).toBe(TimeUnit.SECOND);
    });

    it("should handle multiple dynamic rules", () => {
      const rule1: RateLimitRule = {
        name: "dynamic1",
        requestsPerUnit: 25,
        unit: TimeUnit.MINUTE,
      };
      const rule2: RateLimitRule = {
        name: "dynamic2",
        requestsPerUnit: 15,
        unit: TimeUnit.HOUR,
      };

      service.addRule("/api/dynamic1", rule1);
      service.addRule("/api/dynamic2", rule2);

      expect(service.getRuleForEndpoint("/api/dynamic1")).toEqual(rule1);
      expect(service.getRuleForEndpoint("/api/dynamic2")).toEqual(rule2);
    });
  });

  describe("removeRule", () => {
    it("should remove an existing rule", () => {
      const logSpy = jest.spyOn(service["logger"], "log");

      // Verify rule exists
      let rule = service.getRuleForEndpoint("/api/test");
      expect(rule.name).toBe("test");

      // Remove it
      service.removeRule("/api/test");

      // Should now fallback to default
      rule = service.getRuleForEndpoint("/api/test");
      expect(rule.name).toBe("default");
      expect(logSpy).toHaveBeenCalledWith(
        "Removed rule for endpoint /api/test",
      );
    });

    it("should handle removing non-existent rule gracefully", () => {
      const logSpy = jest.spyOn(service["logger"], "log");

      // Should not throw
      expect(() => {
        service.removeRule("/api/non-existent");
      }).not.toThrow();

      expect(logSpy).toHaveBeenCalledWith(
        "Removed rule for endpoint /api/non-existent",
      );
    });

    it("should allow re-adding a removed rule", () => {
      // Remove existing rule
      service.removeRule("/api/posts");

      // Verify it's gone (falls back to default)
      let rule = service.getRuleForEndpoint("/api/posts");
      expect(rule.name).toBe("default");

      // Re-add with different config
      const newRule: RateLimitRule = {
        name: "posts-new",
        requestsPerUnit: 25,
        unit: TimeUnit.MINUTE,
      };
      service.addRule("/api/posts", newRule);

      // Verify new rule is active
      rule = service.getRuleForEndpoint("/api/posts");
      expect(rule).toEqual(newRule);
    });
  });

  describe("integration scenarios", () => {
    it("should handle workflow of add, get, remove, get", () => {
      const customRule: RateLimitRule = {
        name: "workflow",
        requestsPerUnit: 123,
        unit: TimeUnit.MINUTE,
      };

      // Add
      service.addRule("/api/workflow", customRule);
      expect(service.getRuleForEndpoint("/api/workflow")).toEqual(customRule);

      // Remove
      service.removeRule("/api/workflow");
      expect(service.getRuleForEndpoint("/api/workflow").name).toBe("default");
    });

    it("should maintain other rules when adding/removing", () => {
      const originalHealthRule = service.getRuleForEndpoint("/api/health");

      // Add new rule
      service.addRule("/api/temp", {
        name: "temp",
        requestsPerUnit: 1,
        unit: TimeUnit.SECOND,
      });

      // Remove it
      service.removeRule("/api/temp");

      // Original rules should be unaffected
      const currentHealthRule = service.getRuleForEndpoint("/api/health");
      expect(currentHealthRule).toEqual(originalHealthRule);
    });

    it("should support different configurations per endpoint category", () => {
      // Auth endpoints should be restrictive
      const loginRule = service.getRuleForEndpoint("/api/auth/login");
      expect(loginRule.requestsPerUnit).toBeLessThan(10);

      // Health endpoints should be permissive
      const healthRule = service.getRuleForEndpoint("/api/health");
      expect(healthRule.requestsPerUnit).toBeGreaterThan(100);

      // Content endpoints should be moderate
      const postsRule = service.getRuleForEndpoint("/api/posts");
      expect(postsRule.requestsPerUnit).toBeGreaterThanOrEqual(10);
      expect(postsRule.requestsPerUnit).toBeLessThan(100);
    });
  });
});
