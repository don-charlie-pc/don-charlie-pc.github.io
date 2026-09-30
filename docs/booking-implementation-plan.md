# Plan de implementación — Castellanos Fotografía

## Inspección (30 de septiembre de 2026)

Repositorio HTML/CSS/JavaScript sin framework, package.json ni build obligatorio. Git limpio al iniciar. Portafolio en `index.html`, contenido en `js/content.js`, estilos en `css/styles.css`. GitHub Actions publica al actualizar `main`; existe también GitLab Pages. Se conservan las fotografías, contenido y comportamiento del portafolio y se añade un CTA.

## Arquitectura y archivos previstos

- `reservar/index.html`, `reservar/privacidad.html`, `admin/index.html`: rutas estáticas reales, español de México y diseño editorial con los estilos existentes.
- `assets/js/booking-*.js`, `assets/js/admin-*.js`, `css/booking.css`: módulos pequeños, DOM seguro, validación, Auth Google con PKCE y API de Edge Functions.
- `supabase/migrations/`: tablas privadas con RLS, restricciones, índice único de reservas activas, exclusión de horarios solapados, operaciones transaccionales y auditoría sin PII.
- `supabase/functions/`: TypeScript, validación JWT + allowlist Google, CORS exacto, antispam, OAuth Calendar de servidor con PKCE y AES-GCM, confirmación/cancelación idempotentes.
- `scripts/`, `tests/`, `package.json`: build por lista permitida de archivos públicos y pruebas sin credenciales, incluidas simulaciones de Calendar y pruebas SQL locales.
- `.env.example`, `docs/BOOKING_SETUP.md`, `docs/OPERACION_RESERVAS.md`, `docs/DEPLOYMENT_BOOKING.md`: configuración y operación.

No se introduce un framework ni se requiere build para previsualizar. Node se usa solo para verificación y empaquetado seguro del sitio. Supabase es el backend; Auth identifica al administrador, y un OAuth independiente conecta Calendar. Ningún token de Calendar llega al navegador. Se usan UTC en Postgres y America/Mexico_City en todas las vistas y conversiones. Las consultas para bodas se almacenan separadas de las reservas y no apartan horarios.

## Garantías y riesgos

Las reservas se crean bajo bloqueo de fila y tienen un índice único parcial. La publicación usa exclusión de rangos para un fotógrafo. Un lease de sincronización y un ID determinista impiden duplicados de Calendar; las cancelaciones mantienen el bloqueo hasta comprobar borrado. Los reintentos de creación entran por la misma operación explícita de confirmación. Un error de red tras crear el evento se recupera consultando el mismo ID. Los pendientes caducan por operación SQL y cron; no se expiran sincronizaciones ambiguas para evitar liberar eventos posiblemente creados.

El despliegue actual del repositorio completo debe cambiar a un artefacto estático por lista permitida, conservando GitHub Pages y su trigger. No se despliega ni se cambia DNS. El aviso legal es un borrador marcado; recepción pública permanecerá deshabilitada en servidor hasta revisar el aviso y configurar el backend. No se inventan precios, WhatsApp, domicilio ni políticas.

## Dependencias y validación

Se usa fetch nativo en Edge Functions y navegador. Herramientas de desarrollo: TypeScript, pruebas Node, PGlite/PostgreSQL local y Chrome para móvil/escritorio. Ante el bloqueo de instalación de paquetes, la verificación visual utiliza DevTools Protocol nativo con el Chrome instalado, sin añadir una dependencia de navegador. Mocks comprueban fallas y recuperación de Calendar. Los límites de validación SQL y TypeScript se registran en `BOOKING_VALIDATION.md`.

## Pasos que requieren al propietario

Crear Supabase, aplicar migraciones y funciones; configurar Google Auth, allowlist por email + subject, dos clientes OAuth y Calendar API; registrar orígenes/redirects exactos; configurar secretos privados, Turnstile y valores públicos; completar/revisar aviso y términos; conectar Calendar y hacer prueba real. Ninguno de estos pasos autoriza despliegues en esta sesión. No se requieren credenciales para implementar o ejecutar mocks.
