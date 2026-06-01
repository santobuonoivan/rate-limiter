# GitHub Actions Workflows

Este directorio contiene los workflows de CI/CD para el Rate Limiter.

## Workflows Disponibles

### 1. CI Pipeline (`ci.yml`)

**Trigger:** Push o Pull Request a `main`

**Jobs:**

- **lint**: Verifica código con ESLint y Prettier
- **test**: Ejecuta tests unitarios y E2E en Node 18 y 20
- **build**: Compila la aplicación TypeScript
- **docker-build**: Construye imagen Docker y verifica que funcione
- **security-scan**: Escanea vulnerabilidades con Trivy y npm audit

**Uso:**
Automático en cada push. También puedes ejecutar localmente:

```bash
# Simular workflow completo localmente
npm run lint
npm test
npm run test:e2e
npm run build
docker build -t rate-limiter:test .
```

### 2. Deploy to AWS (`deploy-aws.yml`)

**Trigger:**

- Release publicado (automático)
- Manual via workflow_dispatch

**Jobs:**

1. **test**: Ejecuta suite completa de tests
2. **build-and-push**: Construye y sube imagen a AWS ECR
3. **deploy-ecs**: Despliega nueva versión a AWS ECS
4. **notify**: Envía notificación de resultado

**Uso:**

**Automático (Release):**

```bash
# Crear y publicar release
git tag v1.0.0
git push origin v1.0.0

# En GitHub UI:
# Releases → Create release → Tag v1.0.0 → Publish
```

**Manual:**

1. Ir a Actions tab en GitHub
2. Seleccionar "Deploy to AWS"
3. Click "Run workflow"
4. Elegir environment (production/staging)
5. Run workflow

## Configuración Requerida

### GitHub Secrets

Ver `AWS_DEPLOYMENT.md` para la lista completa de secrets necesarios.

**Mínimos obligatorios:**

- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `AWS_REGION`
- `ECR_REPOSITORY`
- `ECS_CLUSTER`
- `ECS_SERVICE`
- `REDIS_HOST`
- `REDIS_PASSWORD`

### Infraestructura AWS

Antes de ejecutar deploy, asegúrate de tener:

- ECR repository creado
- ECS Cluster y Service configurados
- Redis ElastiCache (opcional pero recomendado)
- IAM roles con permisos correctos

Ver `AWS_DEPLOYMENT.md` para guía completa de setup.

## Badges

Agrega estos badges a tu README.md:

```markdown
![CI](https://github.com/YOUR_USERNAME/rate-limiter/workflows/CI%20Pipeline/badge.svg)
![Deploy](https://github.com/YOUR_USERNAME/rate-limiter/workflows/Deploy%20to%20AWS/badge.svg)
[![codecov](https://codecov.io/gh/YOUR_USERNAME/rate-limiter/branch/main/graph/badge.svg)](https://codecov.io/gh/YOUR_USERNAME/rate-limiter)
```

## Troubleshooting

### Workflow falla en test job

**Solución:**

```bash
# Ejecutar tests localmente primero
npm test
npm run test:e2e

# Ver logs detallados en GitHub Actions → Job → Ver pasos fallidos
```

### Workflow falla en build-and-push

**Posibles causas:**

- AWS credentials incorrectos o expirados
- ECR repository no existe
- Permisos IAM insuficientes

**Verificar:**

```bash
# Test AWS credentials localmente
aws sts get-caller-identity

# Verificar ECR repository existe
aws ecr describe-repositories --repository-names rate-limiter
```

### Workflow falla en deploy-ecs

**Posibles causas:**

- ECS cluster o service no existe
- Task definition inválida
- Security groups bloqueando tráfico
- Redis no accesible

**Verificar:**

```bash
# Ver eventos del servicio
aws ecs describe-services \
  --cluster rate-limiter-cluster \
  --services rate-limiter-service
```

Ver `AWS_DEPLOYMENT.md` sección Troubleshooting para más detalles.

## Personalización

### Agregar notificaciones Slack

Descomentar en `deploy-aws.yml`:

```yaml
- name: Slack Notification
  uses: 8398a7/action-slack@v3
  with:
    status: ${{ job.status }}
    webhook_url: ${{ secrets.SLACK_WEBHOOK }}
```

Configurar `SLACK_WEBHOOK` secret en GitHub.

### Cambiar región AWS

Editar en `deploy-aws.yml`:

```yaml
env:
  AWS_REGION: "us-west-2" # Cambiar aquí
```

O configurar `AWS_REGION` secret en GitHub.

### Modificar estrategia de tags

Editar en `deploy-aws.yml` → job `build-and-push` → step `Extract metadata`:

```yaml
tags: |
  type=semver,pattern={{version}}
  type=semver,pattern={{major}}.{{minor}}
  type=raw,value=latest
  # Agregar más patrones según necesidad
```

## Monitoreo

### Ver ejecuciones

1. GitHub → Actions tab
2. Seleccionar workflow
3. Ver historial de runs

### Logs

Cada job tiene logs detallados:

- Expandir cada step para ver output
- Buscar errores con Ctrl+F "ERROR"
- Download logs para análisis offline

### Artifacts

Los workflows guardan artifacts:

- Coverage reports (7 días)
- Build artifacts (7 días)

Descargar desde GitHub Actions → Run → Artifacts.

## Contribuir

Al agregar nuevos workflows:

1. Crear archivo en `.github/workflows/nombre.yml`
2. Definir triggers claramente
3. Documentar secrets necesarios
4. Agregar a este README
5. Testear localmente si es posible
6. Commit y push

## Referencias

- [GitHub Actions Syntax](https://docs.github.com/actions/reference/workflow-syntax-for-github-actions)
- [AWS Actions](https://github.com/aws-actions)
- [Docker Build Push Action](https://github.com/docker/build-push-action)
