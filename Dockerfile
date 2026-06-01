# Multi-stage Dockerfile optimizado para producción

# ==========================================
# Stage 1: Dependencies
# ==========================================
FROM node:20-alpine AS dependencies

WORKDIR /app

# Copiar archivos de dependencias
COPY package*.json ./

# Instalar todas las dependencias (incluye devDependencies para build)
RUN npm ci --quiet

# ==========================================
# Stage 2: Builder
# ==========================================
FROM node:20-alpine AS builder

WORKDIR /app

# Copiar dependencias desde stage anterior
COPY --from=dependencies /app/node_modules ./node_modules

# Copiar código fuente
COPY . .

# Build de la aplicación
RUN npm run build

# Limpiar devDependencies
RUN npm prune --production

# ==========================================
# Stage 3: Production
# ==========================================
FROM node:20-alpine AS production

# Metadata
LABEL maintainer="Rate Limiter Team"
LABEL description="Rate Limiter Service with NestJS"
LABEL version="1.0.0"

# Variables de entorno por defecto
ENV NODE_ENV=production \
    PORT=3000

# Crear usuario no-root para seguridad
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nestjs -u 1001

WORKDIR /app

# Copiar solo archivos necesarios desde builder
COPY --from=builder --chown=nestjs:nodejs /app/dist ./dist
COPY --from=builder --chown=nestjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nestjs:nodejs /app/package*.json ./

# Cambiar a usuario no-root
USER nestjs

# Exponer puerto
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/api/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Comando de inicio
CMD ["node", "dist/main"]
