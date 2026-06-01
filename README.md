# Rate Limiter - Sistema de Control de Tasa Distribuido

![CI Pipeline](https://github.com/santobuonoivan/rate-limiter/workflows/CI%20Pipeline/badge.svg)
![Deploy to AWS](https://github.com/santobuonoivan/rate-limiter/workflows/Deploy%20to%20AWS/badge.svg)
[![codecov](https://codecov.io/gh/santobuonoivan/rate-limiter/branch/main/graph/badge.svg)](https://codecov.io/gh/santobuonoivan/rate-limiter)

Sistema de control de tasa (rate limiting) implementado con NestJS que proporciona protección contra abuso de API mediante algoritmos de Token Bucket y Sliding Window Counter.

## 🚀 Características

- ✅ **Múltiples Algoritmos**: Token Bucket y Sliding Window Counter
- ✅ **Almacenamiento Flexible**: In-Memory o Redis
- ✅ **Docker Ready**: Dockerfile multi-stage y docker-compose
- ✅ **CI/CD Automático**: GitHub Actions con deploy a AWS
- ✅ **Alta Cobertura de Tests**: Unit, Integration, E2E y Concurrency tests
- ✅ **Configuración por Entorno**: Variables de entorno para todos los parámetros
- ✅ **Identificación de Cliente**: Por IP, X-API-Key, X-User-Id o Authorization header
- ✅ **Límites por Endpoint**: Configuración granular por ruta
- ✅ **Headers Estándar**: `X-RateLimit-*` y `Retry-After`
- ✅ **Fail-Open Strategy**: Disponibilidad sobre exactitud en caso de error
- ✅ **Production Ready**: Desplegable en AWS ECS con un solo comando

## 📋 Requisitos

- Node.js 20+ o Docker
- Redis 7+ (opcional, solo si STORAGE_TYPE=redis)

## 🛠️ Instalación y Ejecución

### Opción 1: Ejecución Local

```bash
# Instalar dependencias
npm install

# Copiar archivo de configuración
cp .env.example .env

# Modo desarrollo
npm run start:dev

# Modo producción
npm run build
npm run start:prod
```

### Opción 2: Docker Compose (Recomendado)

```bash
# Construir y levantar todos los servicios
docker-compose up -d

# Ver logs
docker-compose logs -f rate-limiter

# Ver estado de servicios
docker-compose ps

# Detener servicios
docker-compose down

# Con Redis Commander (UI para inspeccionar Redis)
docker-compose --profile tools up -d
```

### Opción 3: Docker Manual

```bash
# Construir imagen
docker build -t rate-limiter:latest .

# Ejecutar contenedor (sin Redis)
docker run -p 3000:3000 \
  -e STORAGE_TYPE=memory \
  -e RATE_LIMIT_ALGORITHM=TOKEN_BUCKET \
  rate-limiter:latest

# Ejecutar con Redis externo
docker run -p 3000:3000 \
  -e STORAGE_TYPE=redis \
  -e REDIS_HOST=redis-server \
  -e REDIS_PORT=6379 \
  -e REDIS_PASSWORD=secret \
  rate-limiter:latest
```

## ⚙️ Configuración

Todas las opciones se configuran mediante variables de entorno (ver `.env.example`):

### Variables Principales

| Variable               | Valores                             | Default        | Descripción                |
| ---------------------- | ----------------------------------- | -------------- | -------------------------- |
| `NODE_ENV`             | development/production              | development    | Ambiente de ejecución      |
| `PORT`                 | number                              | 3000           | Puerto del servidor        |
| `STORAGE_TYPE`         | memory/redis                        | memory         | Tipo de almacenamiento     |
| `RATE_LIMIT_ALGORITHM` | TOKEN_BUCKET/SLIDING_WINDOW_COUNTER | TOKEN_BUCKET   | Algoritmo de rate limiting |
| `LOG_LEVEL`            | log,error,warn,debug,verbose        | log,error,warn | Niveles de logging         |

### Variables de Redis

| Variable           | Default    | Descripción                |
| ------------------ | ---------- | -------------------------- |
| `REDIS_HOST`       | localhost  | Host de Redis              |
| `REDIS_PORT`       | 6379       | Puerto de Redis            |
| `REDIS_PASSWORD`   | -          | Contraseña de Redis        |
| `REDIS_DB`         | 0          | Base de datos de Redis     |
| `REDIS_KEY_PREFIX` | ratelimit: | Prefijo para keys de Redis |

### Variables de Rate Limiting

| Variable                      | Default | Descripción                    |
| ----------------------------- | ------- | ------------------------------ |
| `DEFAULT_REQUESTS_PER_MINUTE` | 60      | Límite por defecto             |
| `DEFAULT_BURST_SIZE`          | -       | Tamaño de burst (Token Bucket) |

## 🧪 Testing

### Ejecutar Tests

```bash
# Todos los tests con coverage
npm run test:cov

# Solo tests unitarios
npm test

# Tests E2E
npm run test:e2e

# Tests de concurrencia
npm run test:e2e -- --testPathPattern="concurrency"

# Watch mode
npm run test:watch
```

### Coverage Actual

```
Statements   : 47.89%
Branches     : 44.11%
Functions    : 48.00%
Lines        : 48.63%

Cobertura por módulo:
- Algorithms: 87.93%
- Storage:    96.07%
- Service:    100.00%
```

### Suite de Tests

1. **Unit Tests** (77 tests)
   - Token Bucket algorithm: 20 tests
   - Sliding Window Counter: tests completos
   - InMemory Storage: 28 tests
   - RateLimiter Service: 22 tests

2. **E2E Tests** (14 tests) ✅ 100% passing
   - Rate limiting por endpoint
   - Headers estándar
   - Identificación de clientes
   - CORS
   - Respuestas de error

3. **Concurrency Tests** (8 tests activos)
   - 1000 requests concurrentes
   - Burst traffic patterns
   - Múltiples keys independientes
   - Performance benchmarks

## 📡 API Endpoints

### Endpoints de Prueba

#### GET /api/test

- **Rate Limit**: 10 requests/min
- **Identificación**: Por IP o headers

```bash
curl -X GET http://localhost:3000/api/test \
  -H "X-API-Key: mi-api-key"
```

**Respuesta exitosa (200):**

```json
{
  "message": "Rate limiter is working!",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "requestsRemaining": 9
}
```

**Headers de respuesta:**

```
X-RateLimit-Limit: 10
X-RateLimit-Remaining: 9
X-RateLimit-Reset: 1705316400
```

**Respuesta limitada (429):**

```json
{
  "statusCode": 429,
  "error": "Too Many Requests",
  "message": "Rate limit exceeded",
  "retryAfter": 1705316460
}
```

#### POST /api/auth/login

- **Rate Limit**: 5 requests/min
- **Propósito**: Protección contra brute force

```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username": "user", "password": "pass"}'
```

#### GET /api/health

- **Rate Limit**: 200 requests/min
- **Propósito**: Health check con límite permisivo

```bash
curl -X GET http://localhost:3000/api/health
```

#### GET /api/feed

- **Rate Limit**: 30 requests/min
- **Propósito**: Endpoint con límite moderado

```bash
curl -X GET http://localhost:3000/api/feed
```

### Identificación de Cliente

El rate limiter identifica clientes en este orden de prioridad:

1. **X-API-Key header**: API key del cliente
2. **X-User-Id header**: ID de usuario autenticado
3. **Authorization header**: Token de autenticación
4. **IP Address**: Dirección IP del cliente (fallback)

```bash
# Por API Key
curl -H "X-API-Key: cliente-123" http://localhost:3000/api/test

# Por User ID
curl -H "X-User-Id: user-456" http://localhost:3000/api/test

# Por IP (automático)
curl http://localhost:3000/api/test
```

## 🏗️ Arquitectura

### Estructura del Proyecto

```
rate-limiter/
├── src/
│   ├── core/                       # Lógica de dominio
│   │   ├── algorithms/             # Algoritmos de rate limiting
│   │   │   ├── token-bucket.algorithm.ts
│   │   │   └── sliding-window-counter.algorithm.ts
│   │   ├── interfaces/             # Interfaces y contratos
│   │   └── injection-tokens.ts
│   ├── application/                # Capa de aplicación
│   │   └── services/
│   │       └── rate-limiter.service.ts
│   ├── infrastructure/             # Adaptadores
│   │   ├── interceptors/           # Interceptor HTTP
│   │   └── storage/                # Adaptadores de storage
│   │       ├── in-memory.storage.ts
│   │       └── redis.storage.ts
│   ├── presentation/               # Controllers
│   │   └── controllers/
│   ├── config/                     # Configuración
│   └── app.module.ts
├── test/                           # Tests E2E y concurrencia
├── docker-compose.yml              # Orquestación de contenedores
├── Dockerfile                      # Multi-stage build
└── .env.example                    # Template de configuración
```

### Algoritmos Implementados

#### 1. Token Bucket

- Permite burst traffic
- Regeneración constante de tokens
- Ideal para APIs con tráfico irregular
- Configurable: capacity, refill rate, burst size

```typescript
// Configuración ejemplo
{
  requestsPerUnit: 10,
  unit: TimeUnit.MINUTE,
  burstSize: 15  // Permite hasta 15 requests de golpe
}
```

#### 2. Sliding Window Counter

- Límite más preciso
- Considera ventana deslizante
- Mejor para distribución uniforme
- Configurable: requests per window, window size

```typescript
// Configuración ejemplo
{
  requestsPerUnit: 10,
  unit: TimeUnit.MINUTE
  // Usa ventana de 60 segundos deslizándose continuamente
}
```

### Storage Adapters

#### In-Memory Storage

- Sin dependencias externas
- Ideal para desarrollo
- Limpieza automática de expirados
- TTL por key
- Thread-safe con concurrencia

#### Redis Storage

- Producción-ready
- Persistencia
- Escalable horizontalmente
- Soporte para cluster
- Atomic operations

## 🔧 Desarrollo

### Scripts Disponibles

```bash
# Desarrollo
npm run start          # Modo normal
npm run start:dev      # Con watch y hot reload
npm run start:debug    # Con debugger

# Builds
npm run build          # Compilar TypeScript
npm run format         # Formatear con Prettier
npm run lint           # Linter con ESLint

# Tests
npm test               # Tests unitarios
npm run test:watch     # Tests en watch mode
npm run test:cov       # Tests con coverage
npm run test:e2e       # Tests E2E
npm run test:debug     # Tests con debugger
```

### Agregar Nuevo Endpoint con Rate Limiting

```typescript
// En tu controller
@Controller("api/mi-endpoint")
export class MiController {
  @Get()
  @RateLimit({
    requestsPerUnit: 20,
    unit: TimeUnit.MINUTE,
  })
  async getMiRecurso() {
    return { data: "mi respuesta" };
  }
}
```

## 🐳 Docker

### Dockerfile

Multi-stage build optimizado:

1. **Stage 1**: Instalación de dependencias
2. **Stage 2**: Build de TypeScript
3. **Stage 3**: Imagen de producción (solo dist y deps prod)

Características:

- Usuario no-root (nestjs:1001)
- Health check integrado
- Optimizado para tamaño (~150MB final)

### Docker Compose

Servicios incluidos:

- **rate-limiter**: API principal (port 3000)
- **redis**: Redis 7 con persistencia
- **redis-commander** (opcional): UI para inspeccionar Redis

```bash
# Solo API y Redis
docker-compose up -d

# Con Redis Commander en http://localhost:8081
docker-compose --profile tools up -d
```

## 📊 Monitoreo

### Health Check

```bash
curl http://localhost:3000/api/health
```

### Logs

```bash
# Docker Compose
docker-compose logs -f rate-limiter

# Docker standalone
docker logs -f <container-id>

# Local
# Los logs se escriben a stdout
```

### Métricas

El sistema incluye logging de:

- Requests permitidos/rechazados
- Latencia del rate limiter
- Errores de storage
- Estado de rate limits

## 🚀 Deployment Automático (AWS)

El proyecto incluye GitHub Actions para CI/CD automático con deployment a AWS.

> **⚠️ Nota Importante:** Todos los workflows (CI y deployment) están configurados para ejecutarse **únicamente en la rama `main`**. Los releases deben crearse desde `main` para activar el deployment automático.

### Quick Start

**1. Crear Release (Deployment Automático):**

```bash
# Asegurarse de estar en main
git checkout main
git pull origin main

# Crear y pushear tag
git tag v1.0.0
git push origin v1.0.0

# En GitHub UI: Releases → Create release → Publish
# El workflow se ejecuta automáticamente
```

### Workflows Configurados

#### CI Pipeline (`.github/workflows/ci.yml`)

- ✅ Ejecuta en cada push/PR a `main`
- ✅ Lint, tests unitarios, E2E, y security scan
- ✅ Build de Docker image
- ✅ Tests en Node 18 y 20

#### Deploy to AWS (`.github/workflows/deploy-aws.yml`)

- ✅ Trigger: Release publicado o manual
- ✅ Tests completos antes de deploy
- ✅ Build y push a AWS ECR
- ✅ Deploy a AWS ECS Fargate
- ✅ Wait for service stability
- ✅ Notificaciones de resultado

### Configuración Requerida

**GitHub Secrets (obligatorios):**

```
AWS_ACCESS_KEY_ID
AWS_SECRET_ACCESS_KEY
AWS_REGION
ECR_REPOSITORY
ECS_CLUSTER
ECS_SERVICE
REDIS_HOST
REDIS_PASSWORD
```

**Infraestructura AWS necesaria:**

- ECR Repository
- ECS Cluster (Fargate)
- ECS Service
- ElastiCache Redis
- Application Load Balancer (opcional)
- IAM Roles (ecsTaskExecutionRole, ecsTaskRole)

## 🤝 Contribución

1. Fork del repositorio
2. Crear feature branch: `git checkout -b feature/nueva-funcionalidad`
3. Commit cambios: `git commit -am 'Agregar nueva funcionalidad'`
4. Push a branch: `git push origin feature/nueva-funcionalidad`
5. Crear Pull Request

## 📝 Licencia

ISC

## 📚 Referencias

- [NestJS Documentation](https://docs.nestjs.com/)
- [Token Bucket Algorithm](https://en.wikipedia.org/wiki/Token_bucket)
- [Sliding Window Counter](https://engineering.classdojo.com/blog/2015/02/06/rolling-rate-limiter/)
- [Docker Best Practices](https://docs.docker.com/develop/dev-best-practices/)
