#!/bin/bash
# Script de testing manual para el Rate Limiter

echo "========================================="
echo "Rate Limiter - Testing Script"
echo "========================================="
echo ""

# Verificar que el servidor esté corriendo
echo "1. Verificando servidor..."
if curl -s http://localhost:3000/api/health > /dev/null 2>&1; then
    echo "✅ Servidor está corriendo en http://localhost:3000"
else
    echo "❌ Error: Servidor no está corriendo"
    echo "   Ejecuta: npm run start:dev"
    exit 1
fi

echo ""
echo "========================================="
echo "2. Test básico con headers"
echo "========================================="
curl -i http://localhost:3000/api/test
echo ""

echo ""
echo "========================================="
echo "3. Test de rate limiting (12 requests)"
echo "========================================="
echo "Límite configurado: 10 req/min"
echo "Esperado: 10 exitosos (200), 2 rechazados (429)"
echo ""

for i in {1..12}; do
  response=$(curl -s -w "\nSTATUS:%{http_code}" http://localhost:3000/api/test)
  status=$(echo "$response" | grep "STATUS:" | cut -d':' -f2)
  
  if [ "$status" == "200" ]; then
    echo "Request $i: ✅ 200 OK"
  elif [ "$status" == "429" ]; then
    echo "Request $i: 🚫 429 Too Many Requests (Rate Limited)"
  else
    echo "Request $i: ⚠️  $status"
  fi
done

echo ""
echo "========================================="
echo "4. Test con diferentes identificadores"
echo "========================================="
echo "Testeando con API Key diferente..."
response1=$(curl -s -H "X-API-Key: test-key-123" -w "\nSTATUS:%{http_code}" http://localhost:3000/api/test | grep "STATUS:")
echo "Con X-API-Key: test-key-123 → ${response1}"

response2=$(curl -s -H "X-User-Id: user-456" -w "\nSTATUS:%{http_code}" http://localhost:3000/api/test | grep "STATUS:")
echo "Con X-User-Id: user-456 → ${response2}"

echo ""
echo "========================================="
echo "5. Test de endpoint de login (5 req/min)"
echo "========================================="
for i in {1..7}; do
  response=$(curl -s -X POST http://localhost:3000/api/auth/login \
    -H "Content-Type: application/json" \
    -d '{"username":"test","password":"pass"}' \
    -w "\nSTATUS:%{http_code}")
  status=$(echo "$response" | grep "STATUS:" | cut -d':' -f2)
  
  if [ "$status" == "200" ]; then
    echo "Login attempt $i: ✅ 200 OK"
  elif [ "$status" == "429" ]; then
    echo "Login attempt $i: 🚫 429 Rate Limited"
  fi
done

echo ""
echo "========================================="
echo "✅ Testing completado"
echo "========================================="
echo ""
echo "Endpoints disponibles:"
echo "  GET  /api/test (10 req/min)"
echo "  GET  /api/health (200 req/min)"
echo "  POST /api/auth/login (5 req/min)"
echo "  POST /api/posts (10 req/min)"
echo "  GET  /api/feed (60 req/min)"
echo ""
echo "Para cambiar el algoritmo, editar src/app.module.ts"
echo "Para modificar límites, editar src/application/services/rate-limiter-config.service.ts"
