# Guía de Docker - Rate Limiter

Esta guía detalla cómo usar Docker y Docker Compose para ejecutar el Rate Limiter en diferentes escenarios.

## 📦 Contenido

- [Quick Start](#quick-start)
- [Dockerfile Explicado](#dockerfile-explicado)
- [Docker Compose Explicado](#docker-compose-explicado)
- [Escenarios de Uso](#escenarios-de-uso)
- [Troubleshooting](#troubleshooting)

## Quick Start

```bash
# 1. Clonar o navegar al proyecto
cd rate-limiter/

# 2. Levantar con docker-compose
docker-compose up -d

# 3. Verificar que está corriendo
curl http://localhost:3000/api/health

# 4. Ver logs
docker-compose logs -f rate-limiter
```

## Dockerfile Explicado

### Multi-Stage Build

El Dockerfile usa 3 stages para optimizar tamaño y seguridad:

#### Stage 1: Dependencies

```dockerfile
FROM node:20-alpine AS dependencies
# Instala TODAS las dependencias (dev + prod)
# Usa npm ci para builds reproducibles
COPY package*.json ./
RUN npm ci
```

#### Stage 2: Builder

```dockerfile
FROM node:20-alpine AS builder
# Compila TypeScript a JavaScript
# Usa deps del stage anterior
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
RUN npm run build
RUN npm prune --production  # Elimina dev dependencies
```

#### Stage 3: Production

```dockerfile
FROM node:20-alpine AS production
# Solo copia lo necesario para producción
# Crea usuario no-root para seguridad
# Incluye health check
```

### Características de Seguridad

1. **Usuario no-root**: Corre como `nestjs:1001`
2. **Imagen Alpine**: Minimal footprint (~50MB base)
3. **Solo archivos necesarios**: No incluye src/, tests/, etc.
4. **Health check integrado**: Verifica `/api/health` cada 30s

### Comandos Docker

```bash
# Construir imagen
docker build -t rate-limiter:latest .

# Construir con nombre específico
docker build -t rate-limiter:v1.0.0 .

# Construir sin caché
docker build --no-cache -t rate-limiter:latest .

# Ver imágenes
docker images | grep rate-limiter

# Inspeccionar imagen
docker inspect rate-limiter:latest

# Ver tamaño de capas
docker history rate-limiter:latest
```

## Docker Compose Explicado

### Servicios

#### 1. rate-limiter (API)

```yaml
rate-limiter:
  build: .
  ports:
    - "3000:3000"
  environment:
    - STORAGE_TYPE=redis
    - REDIS_HOST=redis
  depends_on:
    redis:
      condition: service_healthy
  healthcheck:
    test:
      [
        "CMD",
        "wget",
        "--no-verbose",
        "--tries=1",
        "--spider",
        "http://localhost:3000/api/health",
      ]
    interval: 30s
    timeout: 10s
    retries: 3
```

**Características:**

- Espera a que Redis esté healthy antes de iniciar
- Tiene su propio health check
- Variables de entorno desde `.env`
- Auto-restart en caso de fallo

#### 2. redis (Storage)

```yaml
redis:
  image: redis:7-alpine
  command: redis-server --requirepass ${REDIS_PASSWORD} --maxmemory 256mb --maxmemory-policy allkeys-lru
  volumes:
    - redis-data:/data
  healthcheck:
    test: ["CMD", "redis-cli", "--raw", "incr", "ping"]
```

**Características:**

- Persistencia con volumen nombrado
- Password protegido
- Limit de memoria 256MB
- Política LRU para evicción
- Health check automático

#### 3. redis-commander (Opcional)

```yaml
redis-commander:
  image: ghcr.io/joeferner/redis-commander:latest
  profiles: ["tools"]
  ports:
    - "8081:8081"
  environment:
    - REDIS_HOSTS=local:redis:6379
    - REDIS_PASSWORD=${REDIS_PASSWORD}
```

**Características:**

- Solo se levanta con `--profile tools`
- UI web para inspeccionar Redis
- Accesible en http://localhost:8081

### Volúmenes

```yaml
volumes:
  redis-data:
    driver: local
```

**Beneficios:**

- Datos persisten entre reinicios
- Backups más fáciles
- Pueden moverse entre contenedores

### Networks

```yaml
networks:
  rate-limiter-network:
    driver: bridge
```

**Beneficios:**

- Aislamiento de red
- DNS interno (servicios se ven por nombre)
- Control de comunicación entre servicios

## Escenarios de Uso

### Escenario 1: Desarrollo Local

```bash
# 1. Usar storage in-memory (sin Redis)
cat > .env << EOF
NODE_ENV=development
STORAGE_TYPE=memory
RATE_LIMIT_ALGORITHM=TOKEN_BUCKET
LOG_LEVEL=log,error,warn,debug
EOF

# 2. Solo levantar el API
docker-compose up rate-limiter

# 3. Ver logs en tiempo real
docker-compose logs -f
```

### Escenario 2: Desarrollo con Redis

```bash
# 1. Usar storage Redis
cat > .env << EOF
NODE_ENV=development
STORAGE_TYPE=redis
REDIS_HOST=redis
REDIS_PORT=6379
REDIS_PASSWORD=dev_password
LOG_LEVEL=log,error,warn,debug,verbose
EOF

# 2. Levantar todos los servicios
docker-compose up -d

# 3. Ver Redis con Commander
docker-compose --profile tools up -d

# 4. Acceder a Redis Commander
open http://localhost:8081
```

### Escenario 3: Producción

```bash
# 1. Configurar variables de producción
cat > .env << EOF
NODE_ENV=production
PORT=3000
STORAGE_TYPE=redis
REDIS_HOST=redis
REDIS_PORT=6379
REDIS_PASSWORD=$(openssl rand -base64 32)
RATE_LIMIT_ALGORITHM=SLIDING_WINDOW_COUNTER
DEFAULT_REQUESTS_PER_MINUTE=60
LOG_LEVEL=log,error,warn
EOF

# 2. Build y deploy
docker-compose build
docker-compose up -d

# 3. Verificar health
watch -n 1 'docker-compose ps && echo "---" && curl -s http://localhost:3000/api/health | jq'

# 4. Monitoreo de logs
docker-compose logs -f --tail=100
```

### Escenario 4: Testing

```bash
# 1. Levantar servicios en background
docker-compose up -d

# 2. Esperar a que estén healthy
docker-compose ps

# 3. Ejecutar tests E2E contra contenedor
npm run test:e2e

# 4. O ejecutar dentro del contenedor
docker-compose exec rate-limiter npm run test:e2e

# 5. Cleanup
docker-compose down -v
```

### Escenario 5: Multiple Instances (Scaling)

```bash
# 1. Levantar múltiples instancias del API
docker-compose up -d --scale rate-limiter=3

# 2. Usar nginx o traefik como load balancer
# (requiere configuración adicional)

# 3. Verificar que todas usan el mismo Redis
docker-compose exec redis redis-cli --raw keys "ratelimit:*"
```

## Comandos Útiles

### Gestión de Contenedores

```bash
# Ver estado
docker-compose ps

# Ver logs de todos los servicios
docker-compose logs

# Ver logs de un servicio específico
docker-compose logs rate-limiter
docker-compose logs redis

# Logs en tiempo real
docker-compose logs -f

# Seguir logs de un servicio
docker-compose logs -f rate-limiter

# Ver últimas 100 líneas
docker-compose logs --tail=100 rate-limiter

# Reiniciar servicio
docker-compose restart rate-limiter

# Detener servicios
docker-compose stop

# Detener y eliminar contenedores
docker-compose down

# Detener, eliminar contenedores Y volúmenes
docker-compose down -v

# Reconstruir imagen
docker-compose build

# Reconstruir sin cache
docker-compose build --no-cache

# Forzar recreación de contenedores
docker-compose up -d --force-recreate
```

### Inspección

```bash
# Entrar al contenedor del API
docker-compose exec rate-limiter sh

# Ejecutar comando en el contenedor
docker-compose exec rate-limiter npm run test

# Entrar a Redis CLI
docker-compose exec redis redis-cli

# Con password
docker-compose exec redis redis-cli -a dev_password

# Ver contenido de Redis
docker-compose exec redis redis-cli -a dev_password KEYS "ratelimit:*"
docker-compose exec redis redis-cli -a dev_password GET "ratelimit:user:123"

# Inspeccionar configuración
docker-compose config

# Ver variables de entorno de un servicio
docker-compose exec rate-limiter env | grep REDIS
```

### Troubleshooting

```bash
# Ver uso de recursos
docker stats

# Ver procesos en contenedor
docker-compose top

# Inspeccionar health checks
docker inspect rate-limiter-rate-limiter-1 | jq '.[0].State.Health'

# Ver eventos de Docker
docker events --filter 'container=rate-limiter-rate-limiter-1'

# Limpiar todo
docker system prune -a --volumes
```

## Troubleshooting

### Problema: "Port already in use"

```bash
# Ver qué está usando el puerto 3000
lsof -i :3000
netstat -tunlp | grep 3000

# Cambiar puerto en docker-compose.yml
ports:
  - "3001:3000"  # Host:Container

# O matar el proceso que usa el puerto
kill -9 <PID>
```

### Problema: "Cannot connect to Redis"

```bash
# 1. Verificar que Redis está corriendo
docker-compose ps redis

# 2. Verificar logs de Redis
docker-compose logs redis

# 3. Verificar health de Redis
docker-compose exec redis redis-cli ping
# Debería responder: PONG

# 4. Verificar conectividad desde el API
docker-compose exec rate-limiter wget -O- http://redis:6379
```

### Problema: "Build fails"

```bash
# 1. Limpiar caché de Docker
docker builder prune

# 2. Rebuild sin cache
docker-compose build --no-cache

# 3. Verificar .dockerignore
cat .dockerignore

# 4. Verificar que package.json existe
ls -la package*.json
```

### Problema: "Container keeps restarting"

```bash
# 1. Ver logs del contenedor
docker-compose logs --tail=50 rate-limiter

# 2. Ver estado del health check
docker inspect rate-limiter-rate-limiter-1 | jq '.[0].State.Health'

# 3. Deshabilitar restart temporalmente en docker-compose.yml
restart_policy:
  condition: "no"

# 4. Ejecutar contenedor en modo interactivo
docker-compose run --rm rate-limiter sh
```

### Problema: "Out of memory"

```bash
# 1. Ver uso de recursos
docker stats

# 2. Aumentar límite de memoria en docker-compose.yml
deploy:
  resources:
    limits:
      memory: 512M

# 3. Para Redis, ajustar maxmemory
command: redis-server --maxmemory 512mb
```

### Problema: "Volume data lost"

```bash
# 1. Verificar volúmenes
docker volume ls

# 2. Inspeccionar volumen
docker volume inspect rate-limiter_redis-data

# 3. Backup de volumen
docker run --rm -v rate-limiter_redis-data:/data -v $(pwd):/backup alpine tar czf /backup/redis-backup.tar.gz /data

# 4. Restore de volumen
docker run --rm -v rate-limiter_redis-data:/data -v $(pwd):/backup alpine tar xzf /backup/redis-backup.tar.gz -C /
```

## Best Practices

### 1. Variables de Entorno

✅ **DO:**

- Usar archivo `.env` para configuración
- NO committear `.env` al repo
- Usar `.env.example` como template
- Validar env vars al inicio

❌ **DON'T:**

- Hardcodear valores en docker-compose.yml
- Compartir passwords en plain text
- Usar defaults de producción en desarrollo

### 2. Logs

✅ **DO:**

- Usar `docker-compose logs -f` para debug
- Configurar log rotation en producción
- Usar niveles de log apropiados
- Agregar timestamps a logs

❌ **DON'T:**

- Loguear información sensible
- Usar `console.log` en producción
- Acumular logs sin límite

### 3. Health Checks

✅ **DO:**

- Implementar health checks en todos los servicios
- Usar `depends_on` con `condition: service_healthy`
- Hacer health checks idempotentes
- Incluir checks de dependencias

❌ **DON'T:**

- Confiar solo en que el puerto esté abierto
- Hacer health checks muy pesados
- Ignorar health check failures

### 4. Seguridad

✅ **DO:**

- Usar usuario no-root
- Actualizar imagen base regularmente
- Escanear vulnerabilidades (`docker scan`)
- Limitar recursos (CPU, memoria)

❌ **DON'T:**

- Correr como root
- Exponer puertos innecesarios
- Usar `latest` tag en producción
- Ignorar security advisories

## Referencias

- [Docker Best Practices](https://docs.docker.com/develop/dev-best-practices/)
- [Docker Compose Documentation](https://docs.docker.com/compose/)
- [Redis Docker Image](https://hub.docker.com/_/redis)
- [Node.js Docker Best Practices](https://github.com/nodejs/docker-node/blob/main/docs/BestPractices.md)
