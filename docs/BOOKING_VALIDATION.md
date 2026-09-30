# Verificación de implementación

Fecha: 30 de septiembre de 2026. Entorno local: macOS, Node 25.3.0 y Chrome instalado. No se usaron credenciales reales, no se desplegó y no se escribieron eventos en un calendario real.

## Resultados ejecutados

| Comando | Resultado |
| --- | --- |
| `npm test` | 22 pruebas aprobadas: confirmación/cancelación, timeout, doble clic, OAuth, cifrado, controles de acceso, antispam, zona horaria y artefacto estático. |
| `node scripts/check.mjs` | Sintaxis JS y comprobaciones de código público aprobadas. |
| `npm run build` | Aprobado. Artefacto estático en `public/`, sin backend, tests, docs ni `.env`. |
| `node tests/browser.mjs` | Aprobado con Chrome en perfil aislado: escritorio/móvil, formulario, cotización, datos no confiables, confirmación y rechazo de cuenta no autorizada. Browser configurado en Asia/Tokyo. |
| `git diff --check` | Sin errores de whitespace. |
| `npm run lint` | No pudo completar TypeScript: `tsc` no instalado. El chequeo JS se ejecutó por separado. |
| `npm run test:db` | No pudo iniciar: falta `@electric-sql/pglite`. No se afirma validación SQL ejecutada. |
| `npm run test:concurrency` | No ejecutado: faltan Postgres/Supabase local y `psql`. |

Se intentó `npm install` con la red del entorno y fuera del sandbox. El proxy corporativo presentó un certificado expirado (`CERT_HAS_EXPIRED`) y una respuesta de bloqueo del registry. No se desactivó la verificación TLS para instalar dependencias. Las dependencias de desarrollo están fijadas en `package.json`; no se generó lockfile porque no pudo completarse la instalación. Una consulta de diagnóstico de cabeceras confirmó el origen del fallo, sin descargar paquetes.

Las pruebas de navegador utilizan DevTools Protocol con el Chrome ya instalado, un servidor local y respuestas simuladas. Las capturas en `test-results/` se revisaron visualmente. En este entorno el proceso Chrome requiere ejecución fuera del sandbox; el comando directo autorizado funcionó. No se trata de una auditoría completa de WCAG ni de un test con lector de pantalla humano.

## Criterios del brief y evidencia

| Criterio | Implementación y verificación |
| --- | --- |
| Horarios futuros, activos y compatibles | Filtro SQL de catálogo; pruebas SQL incluidas pendientes de ejecutar. UI verificada con mocks. |
| Mínimo 24 h / ventana 90 días | Validación SQL transaccional y catálogo; tests SQL incluidos, pendientes. |
| Una reserva activa por slot / concurrencia | `FOR UPDATE` e índice único parcial; test PGlite y test de dos procesos `psql` incluidos, pendientes. |
| Publicar/editar/pausar no crea evento | RPC SQL sin llamadas externas; única llamada Events.insert en el flujo de confirmación. |
| Pendientes no crean evento | Test del endpoint real con transporte simulado aprobado; solo ejecuta antispam y RPC de reserva. |
| Confirmar crea un evento y confirma después | Tests del flujo real con mock de Google aprobados. |
| Doble clic, timeout, reintento | Tests de lease simulado e ID determinista aprobados, incluidos evento creado antes de perder respuesta y fallo de persistencia. Lease SQL pendiente de ejecución. |
| Error de Calendar recuperable | Tests aprobados: conserva `confirming/error`; reintento recupera evento sin duplicar. |
| Usuario Google no permitido → 403 | Todas las funciones administrativas probadas con Auth simulado, sin lecturas de PII. Navegador borra sesión/datos al rechazo. |
| Sin PII/tokens/notas internas en público | DTO SQL explícito, RLS/revocaciones y respuesta mínima; test de respuesta pública y exclusión del artefacto aprobados. RLS SQL pendiente de ejecución. |
| Cancelación idempotente | Tests aprobados: fallo mantiene bloqueo, reintento elimina, repetición no duplica operación. |
| Hora de Guadalajara desde otra zona | Pruebas Node en Tokyo/New York/Honolulu y Chrome en Tokyo aprobadas. |
| Móvil/escritorio y accesibilidad básica | 390 y 1440 px sin overflow, etiquetas, enlaces de salto, foco visible, roles de estado, árbol de accesibilidad y diálogo de confirmación; capturas revisadas. |

## Pendientes antes de producción

1. Con red de paquetes permitida: `npm install`, `npm run lint`, `npm run test:db`; revisar y conservar el lockfile generado.
2. Aplicar migraciones en un proyecto de prueba, comprobar RLS con claves anon/authenticated, correr concurrencia con conexiones independientes y verificar pg_cron.
3. Configurar Supabase, Google Sign-In, allowlist de administrador, OAuth de Calendar, secretos, Turnstile y orígenes/redirects.
4. Completar/revisar aviso legal y términos; establecer versión y habilitar solicitudes explícitamente.
5. Probar OAuth real, refresh, reconexión, `invalid_grant`, Calendar existente/modificado, fallo de red, confirmación y cancelación con un calendario de prueba antes de depender de tu calendario personal.
6. Elegir y autorizar hosting comercial, revisar políticas de proveedor y completar pruebas reales. No se realizó migración ni despliegue.

Los mocks prueban el comportamiento del código, pero no demuestran que un proyecto real tenga permisos, tokens, políticas, extensiones o configuración de Google correctos. La integración está implementada; su configuración y validación real están pendientes.
