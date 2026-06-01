# Guía de Testing - Rate Limiter

Documentación completa de la suite de tests del Rate Limiter.

## 📊 Resumen de Coverage

```
Test Suites: 4 passed, 4 total
Tests:       99 passed, 99 total (3 skipped)

Coverage:
- Statements   : 47.89%
- Branches     : 44.11%
- Functions    : 48.00%
- Lines        : 48.63%

Por Módulo:
- core/algorithms/            : 87.93%
- infrastructure/storage/     : 96.07%
- application/services/       : 100.00%
- infrastructure/interceptors/: 0.00% (no testeado)
- presentation/controllers/   : 0.00% (no testeado)
```

## 🧪 Tipos de Tests

### 1. Unit Tests (77 tests)

Tests de lógica de negocio aislada sin dependencias externas.

#### Token Bucket Algorithm (20 tests)

**Ubicación**: `src/core/algorithms/token-bucket.algorithm.spec.ts`

**Cobertura**: 87%+

**Tests incluidos**:

- ✅ Funcionalidad básica (4 tests)
  - Permite primera request
  - Consume tokens correctamente
  - Rechaza cuando no hay tokens
  - Retorna información correcta de reset

- ✅ Regeneración de tokens (3 tests)
  - Regenera tokens con el tiempo
  - Regeneración parcial correcta
  - No excede capacidad máxima

- ✅ Unidades de tiempo (3 tests)
  - SECOND, MINUTE, HOUR, DAY
  - Cálculo correcto de refill rate

- ✅ Burst traffic (2 tests)
  - Permite burst hasta burstSize
  - Limita burst apropiadamente

- ✅ Lógica de reset (2 tests)
  - resetAt correcto
  - retryAfter calculado bien

- ✅ Edge cases (5 tests)
  - Límite de 0 requests
  - Regeneración instantánea
  - Múltiples consumos rápidos
  - Tiempo futuro
  - Tokens negativos

- ✅ Integración con storage (2 tests)
  - Persiste estado correctamente
  - Recupera estado del storage

**Ejemplo de test**:

```typescript
it("should regenerate tokens over time", async () => {
  // Consumir todos los tokens
  for (let i = 0; i < 10; i++) {
    await algorithm.checkLimit(clientKey, rule);
  }

  // Siguiente request rechazada
  let result = await algorithm.checkLimit(clientKey, rule);
  expect(result.allowed).toBe(false);

  // Avanzar tiempo 30 segundos (debería regenerar 5 tokens)
  jest.advanceTimersByTime(30000);

  // Ahora debería permitir 5 requests
  for (let i = 0; i < 5; i++) {
    result = await algorithm.checkLimit(clientKey, rule);
    expect(result.allowed).toBe(true);
  }
});
```

#### Sliding Window Counter Algorithm (tests completos)

**Ubicación**: `src/core/algorithms/sliding-window-counter.algorithm.spec.ts`

**Tests incluidos**:

- ✅ Funcionalidad básica
- ✅ Lógica de ventana deslizante
- ✅ Cálculo de weighted count
- ✅ Overlap percentage
- ✅ Transición de ventanas
- ✅ Edge cases

**Ejemplo de test**:

```typescript
it("should calculate weighted count correctly", async () => {
  // Hacer 10 requests en ventana anterior
  for (let i = 0; i < 10; i++) {
    await algorithm.checkLimit(clientKey, rule);
  }

  // Avanzar 30 segundos (50% de la ventana)
  jest.advanceTimersByTime(30000);

  // Weighted count = previousCount * (1 - overlap) + currentCount
  // = 10 * 0.5 + 0 = 5
  const result = await algorithm.checkLimit(clientKey, rule);
  expect(result.remaining).toBe(5); // 10 - 5
});
```

#### InMemory Storage (28 tests)

**Ubicación**: `src/infrastructure/storage/in-memory.storage.spec.ts`

**Cobertura**: 96%+

**Tests incluidos**:

- ✅ Operaciones básicas (get, set, delete)
- ✅ TTL y expiración
- ✅ Operación increment atómica
- ✅ Cleanup automático
- ✅ Estadísticas
- ✅ Clear
- ✅ Concurrency safety
- ✅ Data isolation
- ✅ Edge cases

**Ejemplo de test**:

```typescript
it("should handle concurrent increments correctly", async () => {
  const key = "counter";
  const promises = [];

  // 100 increments concurrentes
  for (let i = 0; i < 100; i++) {
    promises.push(storage.increment(key, 1, 60));
  }

  await Promise.all(promises);

  const value = await storage.get(key);
  expect(value).toBe(100); // Todos los increments aplicados
});
```

#### RateLimiter Service (22 tests)

**Ubicación**: `src/application/services/rate-limiter.service.spec.ts`

**Cobertura**: 100%

**Tests incluidos**:

- ✅ Token Bucket algorithm tests (7 tests)
- ✅ Sliding Window Counter tests (4 tests)
- ✅ checkMultipleKeys (3 tests)
- ✅ Error handling fail-open (3 tests)
- ✅ Concurrency (2 tests)
- ✅ Different rules (3 tests)

**Ejemplo de test**:

```typescript
it("should fail open on storage errors", async () => {
  jest
    .spyOn(storage, "get")
    .mockRejectedValue(new Error("Storage unavailable"));

  const result = await service.checkLimit("user:123", rule);

  // Fail-open: permite request aunque storage falló
  expect(result.allowed).toBe(true);
  expect(result.remaining).toBe(rule.requestsPerUnit);
});
```

### 2. E2E Tests (14 tests) ✅ 100% passing

Tests de integración completa contra servidor HTTP real.

**Ubicación**: `test/rate-limiter.e2e-spec.ts`

**Scope**:

- Rate limiting funcional
- Headers HTTP estándar
- Identificación de clientes
- Múltiples endpoints
- CORS

**Tests incluidos**:

#### GET /api/test (10 req/min)

- ✅ Retorna 200 para primera request
- ✅ Incluye rate limit headers
- ✅ Permite hasta 10 requests
- ✅ Retorna 429 después de exceder límite

#### POST /api/auth/login (5 req/min)

- ✅ Aplica límite más estricto
- ✅ Bloquea después de 5 intentos

#### GET /api/health (200 req/min)

- ✅ Aplica límite permisivo

#### Client Identification

- ✅ Identifica por X-API-Key header
- ✅ Identifica por X-User-Id header

#### Response Headers

- ✅ Incluye todos los headers estándar
- ✅ Incluye Retry-After en rechazo

#### Different Endpoints

- ✅ Aplica límites diferentes por endpoint
- ✅ Rastrea límites independientemente

#### CORS

- ✅ Incluye headers CORS

**Ejemplo de test E2E**:

```typescript
it("should return 429 after exceeding limit", async () => {
  // Agotar límite
  for (let i = 0; i < 10; i++) {
    await request(app.getHttpServer()).get("/api/test");
  }

  // Request 11 rechazada
  return request(app.getHttpServer())
    .get("/api/test")
    .expect(429)
    .expect((res) => {
      expect(res.body).toHaveProperty("statusCode", 429);
      expect(res.body).toHaveProperty("error", "Too Many Requests");
      expect(res.headers).toHaveProperty("retry-after");
    });
});
```

### 3. Concurrency Tests (8 tests activos)

Tests de estrés con alta carga concurrente.

**Ubicación**: `test/concurrency.e2e-spec.ts`

**Tests incluidos**:

- ✅ 1000 requests concurrentes
- ✅ Burst traffic patterns
- ✅ Múltiples keys independientes
- ✅ Operaciones mixtas
- ✅ Carga sostenida (3 waves)
- ✅ Recuperación de errores de storage
- ✅ Performance: 1000 requests < 2s
- ✅ Latencia promedio < 10ms

**Tests skipped** (3):

- ⏭️ Enforcement estricto bajo 1000 requests (Token Bucket permite burst)
- ⏭️ Consistencia de datos bajo writes concurrentes
- ⏭️ Race conditions

**Ejemplo de test**:

```typescript
it("should handle 1000 concurrent requests correctly", async () => {
  const requests = Array.from({ length: 1000 }, (_, i) =>
    service.checkLimit(`user:${i}`, rule),
  );

  const results = await Promise.all(requests);

  // Todas deberían tener éxito (keys diferentes)
  const allAllowed = results.every((r) => r.allowed);
  expect(allAllowed).toBe(true);
});
```

## 🚀 Ejecutar Tests

### Comandos Básicos

```bash
# Todos los tests unitarios
npm test

# Con coverage
npm run test:cov

# Watch mode (re-run al cambiar código)
npm run test:watch

# Tests E2E
npm run test:e2e

# Solo concurrency tests
npm run test:e2e -- --testPathPattern="concurrency"

# Test específico
npm test -- token-bucket.algorithm.spec.ts

# Con verbose output
npm test -- --verbose

# Con debug
npm run test:debug
```

### Coverage Report

```bash
# Generar coverage HTML
npm run test:cov

# Ver report en browser
open coverage/lcov-report/index.html

# Ver coverage por archivo
cat coverage/coverage-summary.json | jq
```

### CI/CD Integration

```bash
# En CI, usar:
npm run test:cov -- --ci --coverage --maxWorkers=2

# Sin watch, con coverage mínimo
npm run test:cov -- --coverage --coverageThreshold='{"global":{"lines":40}}'
```

## 🔧 Escribir Tests

### Estructura de Test Unitario

```typescript
import { Test, TestingModule } from "@nestjs/testing";

describe("MiService", () => {
  let service: MiService;
  let mockDependency: jest.Mocked<Dependency>;

  beforeEach(async () => {
    mockDependency = {
      metodo: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MiService,
        {
          provide: "DEPENDENCY",
          useValue: mockDependency,
        },
      ],
    }).compile();

    service = module.get<MiService>(MiService);
  });

  it("should do something", () => {
    // Arrange
    mockDependency.metodo.mockResolvedValue("resultado");

    // Act
    const result = await service.hacerAlgo();

    // Assert
    expect(result).toBe("resultado");
    expect(mockDependency.metodo).toHaveBeenCalledWith("parametro");
  });
});
```

### Estructura de Test E2E

```typescript
import { Test, TestingModule } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { AppModule } from "../src/app.module";

describe("MiEndpoint E2E", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("/api/endpoint (GET)", () => {
    return request(app.getHttpServer())
      .get("/api/endpoint")
      .expect(200)
      .expect((res) => {
        expect(res.body).toHaveProperty("data");
      });
  });
});
```

### Mocking Time

```typescript
beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date("2024-01-01T00:00:00Z"));
});

afterEach(() => {
  jest.useRealTimers();
});

it("should work with time", async () => {
  const result1 = await service.checkLimit("key", rule);
  expect(result1.allowed).toBe(true);

  // Avanzar 30 segundos
  jest.advanceTimersByTime(30000);

  const result2 = await service.checkLimit("key", rule);
  expect(result2.allowed).toBe(true);
});
```

### Testing Async Code

```typescript
// Con async/await
it("should handle async operations", async () => {
  const result = await service.asyncMethod();
  expect(result).toBe("expected");
});

// Con done callback
it("should handle callbacks", (done) => {
  service.methodWithCallback((err, result) => {
    expect(err).toBeNull();
    expect(result).toBe("expected");
    done();
  });
});

// Con Promise.all
it("should handle concurrent operations", async () => {
  const promises = [service.method1(), service.method2(), service.method3()];

  const results = await Promise.all(promises);
  expect(results).toHaveLength(3);
});
```

## 🐛 Debugging Tests

### VSCode Launch Config

Crear `.vscode/launch.json`:

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "node",
      "request": "launch",
      "name": "Jest Debug",
      "program": "${workspaceFolder}/node_modules/.bin/jest",
      "args": ["--runInBand", "--no-cache", "${relativeFile}"],
      "console": "integratedTerminal",
      "internalConsoleOptions": "neverOpen"
    }
  ]
}
```

### Debug con CLI

```bash
# Debug test específico
node --inspect-brk node_modules/.bin/jest --runInBand path/to/test.spec.ts

# Abrir en Chrome
# chrome://inspect
```

### Tips de Debugging

1. **Usar `console.log`** (temporal)

```typescript
it("test", () => {
  console.log("Debug:", variable);
  expect(variable).toBe(expected);
});
```

2. **Solo ejecutar un test**

```typescript
// Con .only
it.only("test to debug", () => {
  // ...
});

// O con fdescribe
fdescribe("Suite to debug", () => {
  // ...
});
```

3. **Skip tests**

```typescript
// Skip un test
it.skip("test not ready", () => {
  // ...
});

// Skip suite completa
xdescribe("Suite to skip", () => {
  // ...
});
```

## 📈 Mejorar Coverage

### Áreas con Baja Cobertura

1. **RateLimiterInterceptor** (0%)
   - Crear `rate-limiter.interceptor.spec.ts`
   - Mockear ExecutionContext
   - Test de HTTP headers

2. **Controllers** (0%)
   - Ya cubiertos por E2E tests
   - Opcionalmente crear unit tests

3. **Config Service** (0%)
   - Test de carga de configuración
   - Test de validación

### Ejemplo: Test de Interceptor

```typescript
describe("RateLimiterInterceptor", () => {
  let interceptor: RateLimiterInterceptor;
  let service: RateLimiterService;

  beforeEach(() => {
    service = {
      checkLimit: jest.fn(),
    } as any;

    interceptor = new RateLimiterInterceptor(service);
  });

  it("should allow request when under limit", async () => {
    jest.spyOn(service, "checkLimit").mockResolvedValue({
      allowed: true,
      remaining: 9,
      resetAt: Date.now() + 60000,
    });

    const context = createMockExecutionContext();
    const next = { handle: () => of("result") };

    const result = await interceptor.intercept(context, next).toPromise();
    expect(result).toBe("result");
  });

  it("should throw RateLimitExceededException when over limit", async () => {
    jest.spyOn(service, "checkLimit").mockResolvedValue({
      allowed: false,
      remaining: 0,
      resetAt: Date.now() + 60000,
    });

    const context = createMockExecutionContext();
    const next = { handle: () => of("result") };

    await expect(
      interceptor.intercept(context, next).toPromise(),
    ).rejects.toThrow(RateLimitExceededException);
  });
});
```

## 🎯 Best Practices

### ✅ DO

- **Arrange-Act-Assert**: Estructura clara
- **Un concepto por test**: Tests enfocados
- **Nombres descriptivos**: `should do X when Y`
- **Mock dependencias**: Aislar unidad bajo test
- **Cleanup**: beforeEach/afterEach para estado limpio
- **Test edge cases**: null, undefined, empty, max values
- **Use fake timers**: Para control de tiempo

### ❌ DON'T

- **No tests flaky**: Deben pasar 100% del tiempo
- **No hardcode dates**: Usar fake timers
- **No test implementation**: Testear comportamiento
- **No ignorar tests fallidos**: Arreglar o documentar
- **No copy-paste tests**: DRY con helpers
- **No test privates**: Solo API pública

## 📚 Referencias

- [Jest Documentation](https://jestjs.io/)
- [NestJS Testing](https://docs.nestjs.com/fundamentals/testing)
- [Testing Best Practices](https://github.com/goldbergyoni/javascript-testing-best-practices)
- [Supertest Documentation](https://github.com/ladjs/supertest)
