# Despliegue estático y límites de producción

No se desplegó ni se cambió DNS durante la implementación. GitHub sigue siendo el origen del código. El frontend no necesita un framework, bundler, servidor Node ni secretos en el hosting.

## GitHub Pages: se conserva el flujo

`.github/workflows/pages.yml` continúa ejecutándose en `main` y manualmente. Antes de subir el artefacto ejecuta `node scripts/build.mjs`, que copia únicamente páginas, scripts, CSS e imágenes a `public/`. No instala dependencias. El artefacto excluye `supabase/`, `.env*`, documentación, tests y archivos de Git. El cambio desde publicar `.` es necesario para no servir código/configuración de backend junto al sitio.

El build no lee `.env`, no inyecta secretos y conserva `assets/js/booking-config.js` como configuración pública explícita. Solo borra una carpeta `public/` marcada previamente como salida propia; no elimina carpetas ajenas. GitLab Pages usa el mismo empaquetado con Node 24. Si utilizabas un `CNAME` externo, no lo agregues automáticamente: configura/verifica el dominio con el proveedor cuando autorices ese cambio.

`/reservar/`, `/reservar/privacidad.html` y `/admin/` son rutas con archivos reales, compatibles con acceso directo y recarga. Todos los enlaces de assets son relativos, por lo que también funcionan bajo un subdirectorio. No hay reglas SPA ni redirects que oculten 404.

```bash
node scripts/build.mjs
python3 -m http.server 8000 --directory public
```

Para previsualizar sirve **public/**. No sirvas la raíz del repositorio después de añadir archivos privados `.env`; un servidor estático genérico podría publicarlos. Los orígenes CORS/redirects tienen que coincidir con el hostname y puerto exactos: `localhost` y `127.0.0.1` son distintos.

## Hosting comercial alternativo

GitHub Pages impone restricciones de uso para negocios/transacciones comerciales. Conservamos la compatibilidad para el portafolio y la revisión, pero antes de lanzar el flujo comercial comprueba los [límites oficiales de GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits). Esta implementación no autoriza una migración.

Alternativas estáticas cuando apruebes el proveedor:

| Proveedor | Comando de build | Directorio publicado | Backend |
| --- | --- | --- | --- |
| Cloudflare Pages | `node scripts/build.mjs` | `public` | El mismo proyecto Supabase |
| Netlify | `node scripts/build.mjs` | `public` | El mismo proyecto Supabase |

Conecta el repositorio, configura Node 24 y evita una instalación de dependencias si el proveedor permite omitirla: el build es nativo. No agregues secretos de Supabase/Calendar al proveedor estático. No son necesarios para empaquetar y podrían acabar en archivos públicos si alguien cambiara el build.

Antes de activar un nuevo origen:

1. Actualiza únicamente los cuatro valores públicos del frontend.
2. Actualiza `ALLOWED_ORIGINS`, `ADMIN_APP_ORIGIN`, `ADMIN_APP_URL` en Supabase, redirects de Auth y hostname de Turnstile.
3. El callback de Calendar seguirá en Supabase: no cambia salvo que cambie el proyecto backend.
4. Verifica rutas directas, OAuth, cuenta/calendario, privacidad, una solicitud, confirmación, reintento y cancelación con datos de prueba.
5. Completa cualquier cambio de dominio/DNS únicamente con aprobación del propietario.

Cuando el proveedor permita cabeceras, configura `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, protección contra framing y una CSP acorde a tu origen Supabase y Turnstile. No agregues analítica o scripts externos al panel sin evaluar que manejan una sesión administrativa. Los endpoints privados y OAuth responden `Cache-Control: no-store`.

## Lo que el hosting estático no resuelve

GitHub Pages, Cloudflare Pages o Netlify estático no ejecutan las Edge Functions, no aplican migraciones ni alojan refresh tokens. Supabase y Google Cloud requieren los pasos separados de [BOOKING_SETUP.md](BOOKING_SETUP.md). No anuncies la agenda como operativa hasta completar esos pasos y las pruebas reales.
