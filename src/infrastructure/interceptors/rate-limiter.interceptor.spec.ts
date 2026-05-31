import { Test, TestingModule } from "@nestjs/testing";
import { ExecutionContext, CallHandler, HttpException } from "@nestjs/common";
import { of } from "rxjs";
import { RateLimiterInterceptor } from "./rate-limiter.interceptor";
import { RateLimiterService } from "../../application/services/rate-limiter.service";
import { RateLimiterConfigService } from "../../application/services/rate-limiter-config.service";
import { RateLimitRule, TimeUnit } from "../../core/interfaces";

describe("RateLimiterInterceptor", () => {
  let interceptor: RateLimiterInterceptor;
  let rateLimiterService: jest.Mocked<RateLimiterService>;
  let configService: jest.Mocked<RateLimiterConfigService>;

  // Mock de ExecutionContext
  const createMockExecutionContext = (
    request: any,
    response: any,
  ): ExecutionContext => {
    return {
      switchToHttp: jest.fn().mockReturnValue({
        getRequest: jest.fn().mockReturnValue(request),
        getResponse: jest.fn().mockReturnValue(response),
      }),
    } as any;
  };

  // Mock de CallHandler
  const createMockCallHandler = (): CallHandler => {
    return {
      handle: jest.fn().mockReturnValue(of({ success: true })),
    } as any;
  };

  // Mock de Request
  const createMockRequest = (
    options: {
      path?: string;
      method?: string;
      ip?: string;
      headers?: Record<string, string>;
    } = {},
  ): any => {
    return {
      path: options.path || "/api/test",
      method: options.method || "GET",
      ip: options.ip || "192.168.1.1",
      headers: options.headers || {},
    };
  };

  // Mock de Response
  const createMockResponse = (): any => {
    const headers: Record<string, string> = {};
    return {
      setHeader: jest.fn((key: string, value: string) => {
        headers[key] = value;
      }),
      getHeader: jest.fn((key: string) => headers[key]),
      _headers: headers,
    };
  };

  beforeEach(async () => {
    const mockRateLimiterService = {
      checkLimit: jest.fn(),
    };

    const mockConfigService = {
      getRuleForEndpoint: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RateLimiterInterceptor,
        {
          provide: RateLimiterService,
          useValue: mockRateLimiterService,
        },
        {
          provide: RateLimiterConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    interceptor = module.get<RateLimiterInterceptor>(RateLimiterInterceptor);
    rateLimiterService = module.get(
      RateLimiterService,
    ) as jest.Mocked<RateLimiterService>;
    configService = module.get(
      RateLimiterConfigService,
    ) as jest.Mocked<RateLimiterConfigService>;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("intercept", () => {
    it("should allow request when under rate limit", async () => {
      const request = createMockRequest();
      const response = createMockResponse();
      const context = createMockExecutionContext(request, response);
      const next = createMockCallHandler();

      const mockRule: RateLimitRule = {
        requestsPerUnit: 100,
        unit: TimeUnit.MINUTE,
      };

      configService.getRuleForEndpoint.mockReturnValue(mockRule);
      rateLimiterService.checkLimit.mockResolvedValue({
        allowed: true,
        limit: 100,
        remaining: 99,
        resetAt: Date.now() + 60000,
      });

      const result = await interceptor.intercept(context, next);

      expect(result).toBeDefined();
      expect(next.handle).toHaveBeenCalled();
      expect(configService.getRuleForEndpoint).toHaveBeenCalledWith(
        "/api/test",
      );
      expect(rateLimiterService.checkLimit).toHaveBeenCalledWith(
        "ip:192.168.1.1",
        mockRule,
      );
    });

    it("should throw 429 when rate limit exceeded", async () => {
      const request = createMockRequest();
      const response = createMockResponse();
      const context = createMockExecutionContext(request, response);
      const next = createMockCallHandler();

      const mockRule: RateLimitRule = {
        requestsPerUnit: 100,
        unit: TimeUnit.MINUTE,
      };

      const resetTimestamp = Math.floor(Date.now() / 1000) + 60;
      configService.getRuleForEndpoint.mockReturnValue(mockRule);
      rateLimiterService.checkLimit.mockResolvedValue({
        allowed: false,
        limit: 100,
        remaining: 0,
        resetAt: resetTimestamp,
        retryAfter: resetTimestamp,
      });

      await expect(interceptor.intercept(context, next)).rejects.toThrow(
        HttpException,
      );
      await expect(interceptor.intercept(context, next)).rejects.toThrow(
        "Too many requests, please try again later",
      );

      expect(next.handle).not.toHaveBeenCalled();
    });

    it("should set rate limit headers on response", async () => {
      const request = createMockRequest();
      const response = createMockResponse();
      const context = createMockExecutionContext(request, response);
      const next = createMockCallHandler();

      const resetTimestamp = Date.now() + 60000;
      const mockRule: RateLimitRule = {
        requestsPerUnit: 100,
        unit: TimeUnit.MINUTE,
      };

      configService.getRuleForEndpoint.mockReturnValue(mockRule);
      rateLimiterService.checkLimit.mockResolvedValue({
        allowed: true,
        limit: 100,
        remaining: 75,
        resetAt: resetTimestamp,
      });

      await interceptor.intercept(context, next);

      expect(response.setHeader).toHaveBeenCalledWith(
        "X-RateLimit-Limit",
        "100",
      );
      expect(response.setHeader).toHaveBeenCalledWith(
        "X-RateLimit-Remaining",
        "75",
      );
      expect(response.setHeader).toHaveBeenCalledWith(
        "X-RateLimit-Reset",
        resetTimestamp.toString(),
      );
    });

    it("should set Retry-After header when rate limit exceeded", async () => {
      const request = createMockRequest();
      const response = createMockResponse();
      const context = createMockExecutionContext(request, response);
      const next = createMockCallHandler();

      const resetTimestamp = Math.floor(Date.now() / 1000) + 60;
      const mockRule: RateLimitRule = {
        requestsPerUnit: 100,
        unit: TimeUnit.MINUTE,
      };

      configService.getRuleForEndpoint.mockReturnValue(mockRule);
      rateLimiterService.checkLimit.mockResolvedValue({
        allowed: false,
        limit: 100,
        remaining: 0,
        resetAt: resetTimestamp,
        retryAfter: resetTimestamp,
      });

      try {
        await interceptor.intercept(context, next);
      } catch (error) {
        // Expected to throw
      }

      expect(response.setHeader).toHaveBeenCalledWith(
        "Retry-After",
        expect.any(String),
      );
    });

    it("should handle different endpoints", async () => {
      const request = createMockRequest({ path: "/api/login" });
      const response = createMockResponse();
      const context = createMockExecutionContext(request, response);
      const next = createMockCallHandler();

      const mockRule: RateLimitRule = {
        requestsPerUnit: 10,
        unit: TimeUnit.MINUTE,
      };

      configService.getRuleForEndpoint.mockReturnValue(mockRule);
      rateLimiterService.checkLimit.mockResolvedValue({
        allowed: true,
        limit: 10,
        remaining: 9,
        resetAt: Date.now() + 60000,
      });

      await interceptor.intercept(context, next);

      expect(configService.getRuleForEndpoint).toHaveBeenCalledWith(
        "/api/login",
      );
      expect(rateLimiterService.checkLimit).toHaveBeenCalledWith(
        "ip:192.168.1.1",
        mockRule,
      );
    });
  });

  describe("getClientKey", () => {
    it("should prioritize X-API-Key header", async () => {
      const request = createMockRequest({
        headers: {
          "x-api-key": "test-api-key-123",
          "x-user-id": "user123",
        },
      });
      const response = createMockResponse();
      const context = createMockExecutionContext(request, response);
      const next = createMockCallHandler();

      const mockRule: RateLimitRule = {
        requestsPerUnit: 100,
        unit: TimeUnit.MINUTE,
      };

      configService.getRuleForEndpoint.mockReturnValue(mockRule);
      rateLimiterService.checkLimit.mockResolvedValue({
        allowed: true,
        limit: 100,
        remaining: 99,
        resetAt: Date.now() + 60000,
      });

      await interceptor.intercept(context, next);

      expect(rateLimiterService.checkLimit).toHaveBeenCalledWith(
        "apikey:test-api-key-123",
        mockRule,
      );
    });

    it("should use X-User-Id when no API key", async () => {
      const request = createMockRequest({
        headers: {
          "x-user-id": "user456",
        },
      });
      const response = createMockResponse();
      const context = createMockExecutionContext(request, response);
      const next = createMockCallHandler();

      const mockRule: RateLimitRule = {
        requestsPerUnit: 100,
        unit: TimeUnit.MINUTE,
      };

      configService.getRuleForEndpoint.mockReturnValue(mockRule);
      rateLimiterService.checkLimit.mockResolvedValue({
        allowed: true,
        limit: 100,
        remaining: 99,
        resetAt: Date.now() + 60000,
      });

      await interceptor.intercept(context, next);

      expect(rateLimiterService.checkLimit).toHaveBeenCalledWith(
        "user:user456",
        mockRule,
      );
    });

    it("should fallback to IP when no headers present", async () => {
      const request = createMockRequest({
        ip: "10.0.0.5",
        headers: {},
      });
      const response = createMockResponse();
      const context = createMockExecutionContext(request, response);
      const next = createMockCallHandler();

      const mockRule: RateLimitRule = {
        requestsPerUnit: 100,
        unit: TimeUnit.MINUTE,
      };

      configService.getRuleForEndpoint.mockReturnValue(mockRule);
      rateLimiterService.checkLimit.mockResolvedValue({
        allowed: true,
        limit: 100,
        remaining: 99,
        resetAt: Date.now() + 60000,
      });

      await interceptor.intercept(context, next);

      expect(rateLimiterService.checkLimit).toHaveBeenCalledWith(
        "ip:10.0.0.5",
        mockRule,
      );
    });
  });

  describe("getClientIp", () => {
    it("should extract IP from X-Forwarded-For header", async () => {
      const request = createMockRequest({
        headers: {
          "x-forwarded-for": "203.0.113.1, 198.51.100.1, 192.0.2.1",
        },
        ip: "127.0.0.1",
      });
      const response = createMockResponse();
      const context = createMockExecutionContext(request, response);
      const next = createMockCallHandler();

      const mockRule: RateLimitRule = {
        requestsPerUnit: 100,
        unit: TimeUnit.MINUTE,
      };

      configService.getRuleForEndpoint.mockReturnValue(mockRule);
      rateLimiterService.checkLimit.mockResolvedValue({
        allowed: true,
        limit: 100,
        remaining: 99,
        resetAt: Date.now() + 60000,
      });

      await interceptor.intercept(context, next);

      expect(rateLimiterService.checkLimit).toHaveBeenCalledWith(
        "ip:203.0.113.1",
        mockRule,
      );
    });

    it("should extract IP from X-Real-IP header when X-Forwarded-For not present", async () => {
      const request = createMockRequest({
        headers: {
          "x-real-ip": "198.51.100.42",
        },
        ip: "127.0.0.1",
      });
      const response = createMockResponse();
      const context = createMockExecutionContext(request, response);
      const next = createMockCallHandler();

      const mockRule: RateLimitRule = {
        requestsPerUnit: 100,
        unit: TimeUnit.MINUTE,
      };

      configService.getRuleForEndpoint.mockReturnValue(mockRule);
      rateLimiterService.checkLimit.mockResolvedValue({
        allowed: true,
        limit: 100,
        remaining: 99,
        resetAt: Date.now() + 60000,
      });

      await interceptor.intercept(context, next);

      expect(rateLimiterService.checkLimit).toHaveBeenCalledWith(
        "ip:198.51.100.42",
        mockRule,
      );
    });

    it("should fallback to request.ip when no proxy headers", async () => {
      const request = createMockRequest({
        headers: {},
        ip: "172.16.0.1",
      });
      const response = createMockResponse();
      const context = createMockExecutionContext(request, response);
      const next = createMockCallHandler();

      const mockRule: RateLimitRule = {
        requestsPerUnit: 100,
        unit: TimeUnit.MINUTE,
      };

      configService.getRuleForEndpoint.mockReturnValue(mockRule);
      rateLimiterService.checkLimit.mockResolvedValue({
        allowed: true,
        limit: 100,
        remaining: 99,
        resetAt: Date.now() + 60000,
      });

      await interceptor.intercept(context, next);

      expect(rateLimiterService.checkLimit).toHaveBeenCalledWith(
        "ip:172.16.0.1",
        mockRule,
      );
    });

    it("should use 'unknown' when no IP available", async () => {
      const request = {
        path: "/api/test",
        method: "GET",
        ip: undefined,
        headers: {},
      };
      const response = createMockResponse();
      const context = createMockExecutionContext(request, response);
      const next = createMockCallHandler();

      const mockRule: RateLimitRule = {
        requestsPerUnit: 100,
        unit: TimeUnit.MINUTE,
      };

      configService.getRuleForEndpoint.mockReturnValue(mockRule);
      rateLimiterService.checkLimit.mockResolvedValue({
        allowed: true,
        limit: 100,
        remaining: 99,
        resetAt: Date.now() + 60000,
      });

      await interceptor.intercept(context, next);

      expect(rateLimiterService.checkLimit).toHaveBeenCalledWith(
        "ip:unknown",
        mockRule,
      );
    });

    it("should handle X-Forwarded-For with single IP", async () => {
      const request = createMockRequest({
        headers: {
          "x-forwarded-for": "203.0.113.5",
        },
      });
      const response = createMockResponse();
      const context = createMockExecutionContext(request, response);
      const next = createMockCallHandler();

      const mockRule: RateLimitRule = {
        requestsPerUnit: 100,
        unit: TimeUnit.MINUTE,
      };

      configService.getRuleForEndpoint.mockReturnValue(mockRule);
      rateLimiterService.checkLimit.mockResolvedValue({
        allowed: true,
        limit: 100,
        remaining: 99,
        resetAt: Date.now() + 60000,
      });

      await interceptor.intercept(context, next);

      expect(rateLimiterService.checkLimit).toHaveBeenCalledWith(
        "ip:203.0.113.5",
        mockRule,
      );
    });

    it("should trim whitespace from X-Forwarded-For IP", async () => {
      const request = createMockRequest({
        headers: {
          "x-forwarded-for": "  203.0.113.10  , 198.51.100.1",
        },
      });
      const response = createMockResponse();
      const context = createMockExecutionContext(request, response);
      const next = createMockCallHandler();

      const mockRule: RateLimitRule = {
        requestsPerUnit: 100,
        unit: TimeUnit.MINUTE,
      };

      configService.getRuleForEndpoint.mockReturnValue(mockRule);
      rateLimiterService.checkLimit.mockResolvedValue({
        allowed: true,
        limit: 100,
        remaining: 99,
        resetAt: Date.now() + 60000,
      });

      await interceptor.intercept(context, next);

      expect(rateLimiterService.checkLimit).toHaveBeenCalledWith(
        "ip:203.0.113.10",
        mockRule,
      );
    });
  });

  describe("error handling", () => {
    it("should throw HttpException with correct status code", async () => {
      const request = createMockRequest();
      const response = createMockResponse();
      const context = createMockExecutionContext(request, response);
      const next = createMockCallHandler();

      const mockRule: RateLimitRule = {
        requestsPerUnit: 100,
        unit: TimeUnit.MINUTE,
      };

      const resetTimestamp = Math.floor(Date.now() / 1000) + 60;
      configService.getRuleForEndpoint.mockReturnValue(mockRule);
      rateLimiterService.checkLimit.mockResolvedValue({
        allowed: false,
        limit: 100,
        remaining: 0,
        resetAt: resetTimestamp,
        retryAfter: resetTimestamp,
      });

      try {
        await interceptor.intercept(context, next);
        fail("Should have thrown HttpException");
      } catch (error: any) {
        expect(error).toBeInstanceOf(HttpException);
        expect(error.getStatus()).toBe(429);
        expect(error.getResponse()).toMatchObject({
          statusCode: 429,
          message: "Too many requests, please try again later",
          error: "Too Many Requests",
          retryAfter: resetTimestamp,
        });
      }
    });

    it("should include retryAfter in error response", async () => {
      const request = createMockRequest();
      const response = createMockResponse();
      const context = createMockExecutionContext(request, response);
      const next = createMockCallHandler();

      const mockRule: RateLimitRule = {
        requestsPerUnit: 100,
        unit: TimeUnit.MINUTE,
      };

      const resetTimestamp = Math.floor(Date.now() / 1000) + 120;
      configService.getRuleForEndpoint.mockReturnValue(mockRule);
      rateLimiterService.checkLimit.mockResolvedValue({
        allowed: false,
        limit: 100,
        remaining: 0,
        resetAt: resetTimestamp,
        retryAfter: resetTimestamp,
      });

      try {
        await interceptor.intercept(context, next);
      } catch (error: any) {
        const response = error.getResponse();
        expect(response.retryAfter).toBe(resetTimestamp);
      }
    });
  });

  describe("integration scenarios", () => {
    it("should handle POST request with API key", async () => {
      const request = createMockRequest({
        method: "POST",
        path: "/api/users",
        headers: {
          "x-api-key": "production-key-abc123",
        },
      });
      const response = createMockResponse();
      const context = createMockExecutionContext(request, response);
      const next = createMockCallHandler();

      const mockRule: RateLimitRule = {
        requestsPerUnit: 50,
        unit: TimeUnit.MINUTE,
      };

      configService.getRuleForEndpoint.mockReturnValue(mockRule);
      rateLimiterService.checkLimit.mockResolvedValue({
        allowed: true,
        limit: 50,
        remaining: 25,
        resetAt: Date.now() + 60000,
      });

      await interceptor.intercept(context, next);

      expect(rateLimiterService.checkLimit).toHaveBeenCalledWith(
        "apikey:production-key-abc123",
        mockRule,
      );
      expect(response.setHeader).toHaveBeenCalledWith(
        "X-RateLimit-Limit",
        "50",
      );
      expect(next.handle).toHaveBeenCalled();
    });

    it("should handle request from authenticated user", async () => {
      const request = createMockRequest({
        method: "GET",
        path: "/api/profile",
        headers: {
          "x-user-id": "user-uuid-12345",
        },
      });
      const response = createMockResponse();
      const context = createMockExecutionContext(request, response);
      const next = createMockCallHandler();

      const mockRule: RateLimitRule = {
        requestsPerUnit: 200,
        unit: TimeUnit.MINUTE,
      };

      configService.getRuleForEndpoint.mockReturnValue(mockRule);
      rateLimiterService.checkLimit.mockResolvedValue({
        allowed: true,
        limit: 200,
        remaining: 150,
        resetAt: Date.now() + 60000,
      });

      await interceptor.intercept(context, next);

      expect(rateLimiterService.checkLimit).toHaveBeenCalledWith(
        "user:user-uuid-12345",
        mockRule,
      );
      expect(next.handle).toHaveBeenCalled();
    });

    it("should handle request behind proxy", async () => {
      const request = createMockRequest({
        headers: {
          "x-forwarded-for": "203.0.113.50, 10.0.0.1",
        },
        ip: "10.0.0.1",
      });
      const response = createMockResponse();
      const context = createMockExecutionContext(request, response);
      const next = createMockCallHandler();

      const mockRule: RateLimitRule = {
        requestsPerUnit: 100,
        unit: TimeUnit.MINUTE,
      };

      configService.getRuleForEndpoint.mockReturnValue(mockRule);
      rateLimiterService.checkLimit.mockResolvedValue({
        allowed: true,
        limit: 100,
        remaining: 99,
        resetAt: Date.now() + 60000,
      });

      await interceptor.intercept(context, next);

      // Should use real client IP, not proxy IP
      expect(rateLimiterService.checkLimit).toHaveBeenCalledWith(
        "ip:203.0.113.50",
        mockRule,
      );
    });
  });
});
