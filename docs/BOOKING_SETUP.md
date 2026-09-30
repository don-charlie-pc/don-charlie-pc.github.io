# Configuración de reservas — Castellanos Fotografía

## Qué está implementado y qué falta conectar

El repositorio contiene el frontend, las migraciones y las Edge Functions reales. No se creó ningún proyecto, no se registró ningún cliente OAuth y no se hizo un despliegue. La configuración pública viene vacía y `booking_settings.accepting_requests` inicia en `false`. Hasta completar esta guía, la página muestra “agenda en preparación”. No hay datos ni horarios de demostración en producción.

Se conserva el portafolio existente y su contenido. Solo se añade un enlace de reserva. Las páginas nuevas usan la marca Castellanos Fotografía, Guadalajara y español de México. Las fotografías heredadas del portafolio son las imágenes de muestra ya existentes; sustitúyelas por material autorizado antes de lanzar.

## 1. Supabase y base de datos

1. Crea un proyecto Supabase dedicado. Conserva sus credenciales fuera del repositorio y activa las protecciones y copias de seguridad adecuadas.
2. Instala Supabase CLI siguiendo su documentación. En la raíz del repositorio, cuando decidas desplegar:

   ```bash
   supabase login
   supabase link --project-ref TU_PROJECT_REF
   supabase db push
   ```

3. La primera migración crea tablas, restricciones, RLS y RPC exclusivas de servidor. La segunda habilita `pg_cron` y programa la caducidad cada minuto. Si tu proyecto no permite crear la extensión, habilita **Cron** desde las integraciones de Supabase y repite la migración. Comprueba el job `booking-expire-pending` en `cron.job` y sus ejecuciones en `cron.job_run_details`.
4. Mantén los esquemas `booking_private` y `cron` fuera de los esquemas expuestos por Data API. Las tablas de `public` están protegidas por RLS sin políticas de navegador y permisos revocados a `anon` y `authenticated`. Las RPC también revocan EXECUTE público; únicamente las Edge Functions usan la service role.
5. No actives políticas “allow all” para solucionar un 403. Iniciar sesión no autoriza acceso directo a ninguna reserva.

## 2. Login administrativo con Google (identidad solamente)

1. En Google Cloud crea un cliente OAuth de tipo **Web application**, dedicado al login de Supabase. Configura únicamente scopes de identidad (`openid`, email y perfil). No solicites Calendar en este cliente.
2. Su redirect autorizado es el que muestra Supabase, normalmente:

   ```text
   https://TU_PROJECT_REF.supabase.co/auth/v1/callback
   ```

3. En Supabase → Authentication → Providers → Google, habilita Google e introduce el Client ID y Client Secret. En URL Configuration registra la URL del sitio y redirects exactos, por ejemplo:

   ```text
   https://don-charlie-pc.github.io/admin/
   http://localhost:8000/admin/
   ```

   Si usas un subdirectorio, incluye su ruta exacta. Evita comodines en producción. Deshabilita proveedores que no vayas a usar.

4. Completa la configuración pública del paso 5 y accede a `/admin/` con tu cuenta Google una vez. El primer acceso debe devolver **403** porque todavía no existe una autorización administrativa.
5. En SQL Editor, identifica tu UUID de Auth y el `sub` de la identidad **Google**; no uses valores enviados por el navegador ni el ID interno de una identidad como sustituto de su `sub`:

   ```sql
   select u.id, i.identity_data->>'sub' as google_subject,
          i.identity_data->>'email' as google_email
   from auth.users u join auth.identities i on i.user_id = u.id
   where i.provider = 'google';
   ```

6. Agrega exclusivamente la cuenta prevista, verificando correo y subject. Ejecuta esto en SQL Editor privado, reemplazando los marcadores; no guardes el resultado en Git:

   ```sql
   insert into public.admin_users(id,google_subject,email,is_allowed,display_name)
   select u.id, i.identity_data->>'sub', lower(i.identity_data->>'email'), true,
          'Administrador'
   from auth.users u join auth.identities i on i.user_id=u.id
   where i.provider='google'
     and lower(i.identity_data->>'email')=lower('REEMPLAZAR_CORREO')
     and i.identity_data->>'sub'='REEMPLAZAR_SUBJECT';
   ```

7. Configura también ese correo en el secreto `ADMIN_EMAILS`. Cada función administrativa valida el token con `/auth/v1/user`, cruza UUID, Google subject, correo y `is_allowed`, y exige esa segunda lista. Para revocar al administrador establece `is_allowed=false` y revoca sus sesiones en Auth. No necesitas cambiar la ruta oculta para revocar acceso.

El navegador usa PKCE y guarda solamente la sesión de **Supabase** en `sessionStorage`, limitada a la pestaña. Descarta los provider tokens de la respuesta. Cerrar sesión revoca la sesión local y borra los datos privados de la página.

## 3. OAuth de Google Calendar, separado del login

1. Habilita **Google Calendar API** en Google Cloud.
2. Configura el consentimiento en Google Auth Platform: nombre real, contacto y dominios verificados según corresponda. Añade al administrador como usuario de prueba mientras la app esté en Testing.
3. Crea un segundo cliente OAuth de tipo **Web application** para Calendar. Registra exactamente este redirect (sin `/` extra):

   ```text
   https://TU_PROJECT_REF.supabase.co/functions/v1/google-calendar-oauth-callback
   ```

4. Guarda ID y secreto como secretos de Edge Functions. No los pongas en la configuración pública ni en GitHub Actions.
5. El botón de Calendar solicita `https://www.googleapis.com/auth/calendar.events` y `openid email` para identificar la cuenta conectada. No solicita lectura del calendario completo ni importa eventos ajenos. Usa authorization code, acceso offline, consentimiento explícito y PKCE S256.
6. `state` dura 10 minutos, se guarda hasheado y se consume atómicamente una vez. El verificador PKCE está hasheado y además cifrado para poder canjear el código exclusivamente en el servidor. El callback revalida la autorización administrativa.

Los refresh tokens se cifran con AES-256-GCM, IV aleatorio de 12 bytes y contexto autenticado vinculado al propietario. Se descifran solamente en Edge Functions. Los access tokens se usan en memoria y no se persisten. No registres URLs de callback completas ni cabeceras de autorización en sistemas de observabilidad; revisa también la retención de logs de plataforma.

## 4. Secretos de Edge Functions

Usa `.env.example` como lista. Crea un archivo privado fuera del directorio servido, sin subirlo a Git. El ejemplo mezcla nombres públicos y privados como referencia; **no lo copies al frontend**. Supabase suministra `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` en su runtime.

| Secreto | Valor / propósito |
| --- | --- |
| `ADMIN_EMAILS` | Lista separada por comas; solo administradores autorizados, además de la tabla. |
| `GOOGLE_CALENDAR_CLIENT_ID`, `GOOGLE_CALENDAR_CLIENT_SECRET` | Cliente OAuth de Calendar. |
| `GOOGLE_OAUTH_REDIRECT_URI` | URL exacta del callback anterior. |
| `GOOGLE_CALENDAR_DEFAULT_ID` | `primary` por defecto. |
| `GOOGLE_TOKEN_ENCRYPTION_KEY_BASE64` | 32 bytes aleatorios codificados en base64. |
| `GOOGLE_TOKEN_KEY_VERSION` | `1` inicialmente. |
| `TURNSTILE_SECRET_KEY` | Secreto de Cloudflare Turnstile. |
| `TURNSTILE_HOSTNAMES` | Nombres de host exactos, sin esquema, separados por comas. |
| `REQUIRE_TURNSTILE` | `true` en producción; `false` permite pruebas locales sin CAPTCHA. |
| `ADMIN_APP_ORIGIN` | Origen exacto del panel, sin ruta. |
| `ADMIN_APP_URL` | URL completa del panel, con `/admin/`. |
| `ALLOWED_ORIGINS` | Orígenes exactos autorizados, sin ruta ni barra final. Incluye localhost durante desarrollo. |
| `BUSINESS_TIMEZONE` | `America/Mexico_City`; no se acepta otra zona en esta versión. |
| `RATE_LIMIT_SALT` | Secreto aleatorio independiente para seudonimizar IP/correo. |
| `CLIENT_IP_HEADER` | Cabecera de IP reescrita por el gateway confiable; default `x-forwarded-for`, último elemento. |

Genera cada clave aleatoria con un generador criptográfico (por ejemplo `openssl rand -base64 32`) en tu terminal y cópiala al gestor de secretos, no a documentos ni logs compartidos. Para rotar, incrementa `GOOGLE_TOKEN_KEY_VERSION`, configura la nueva clave y conserva temporalmente `GOOGLE_TOKEN_ENCRYPTION_KEY_V1_BASE64` para descifrar registros anteriores hasta reconectar todas las cuentas. No borres la clave anterior antes de migrar/reconectar.

Cuando estés listo:

```bash
supabase secrets set --env-file /RUTA_PRIVADA/booking-edge.env
supabase functions deploy
```

`supabase/config.toml` desactiva la comprobación JWT del gateway por función para admitir endpoints públicos, callback y las claves actuales de Auth. Esto **no** desactiva `requireAdmin`: todas las rutas privilegiadas validan el usuario en Auth y la allowlist dentro del servidor. No quites ese control.

Rate limit inicial: 5 intentos por IP/hora y 3 por correo/hora, persistidos como hashes en Postgres. Honeypot y Turnstile se validan en servidor. Verifica en tu ingress qué cabecera de IP es confiable; no confíes en una cabecera que el cliente pueda elegir. Cuando falta IP todos los clientes comparten un límite restrictivo. Turnstile verifica también hostname y action `booking`. No son una protección completa contra ataques distribuidos; los límites/WAF de plataforma se configuran según el tráfico real.

## 5. Configuración pública y aviso legal

Edita solamente estos cuatro valores en `assets/js/booking-config.js`:

```js
PUBLIC_SUPABASE_URL: 'https://TU_PROJECT_REF.supabase.co',
PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'TU_CLAVE_PUBLICABLE',
PUBLIC_TURNSTILE_SITE_KEY: 'TU_SITE_KEY',
PUBLIC_APP_ORIGIN: 'https://don-charlie-pc.github.io',
```

Para localhost cambia el origen a `http://localhost:8000`. La publishable key no da permiso para leer reservas. Nunca uses service role en este archivo. No se hace sustitución automática de `.env` en el build.

Completa y revisa `reservar/privacidad.html`: responsable, domicilio, contacto de privacidad, conservación, derechos y políticas comerciales. Es un borrador, no asesoría legal ni un aviso terminado. Publica una versión identificable y registra la misma versión en `booking_settings.legal_version`. Solo después de revisar el texto y probar el backend habilita:

```sql
update public.booking_settings
set accepting_requests=true, legal_version='REEMPLAZAR_VERSION_PUBLICADA'
where id=true;
```

## 6. Conectar y comprobar Calendar

1. Inicia sesión en `/admin/` con la cuenta permitida.
2. Pulsa **Conectar Google Calendar**. Autoriza el cliente de Calendar y comprueba, al volver, el correo conectado y el calendario de destino.
3. `primary` selecciona el calendario principal de esa cuenta. Para otro calendario, copia su ID desde la configuración privada de Google Calendar y guárdalo en el panel. No lo publiques en la configuración pública. Esta versión no enumera todos tus calendarios.
4. Publica un horario y envía una solicitud de prueba. Comprueba que **no aparece ningún evento** todavía. Confirma con el botón administrativo y comprueba el evento privado y el estado `confirmed`.
5. Cancela la reserva: comprueba que desaparece el evento y se libera el horario. No se envían invitaciones de Google; la comunicación al cliente es manual.
6. Desconectar elimina el token cifrado local y marca la conexión como desconectada; no borra eventos. Revoca también el acceso desde las conexiones de tu cuenta Google si deseas invalidarlo en Google. Reconecta la misma cuenta para gestionar sus reservas anteriores. No se permite reemplazarla por otra mientras tenga reservas activas ligadas.
7. Si Google devuelve `invalid_grant`, el panel pide reconectar. El horario sigue bloqueado durante errores de confirmación/cancelación.

Los eventos usan un ID determinista (`cf` + UUID de reserva sin guiones), `visibility=private`, `sendUpdates=none` y ninguna lista de asistentes. Un reintento primero busca ese ID. Se detectan modificaciones del horario o del identificador de reserva; requieren revisión manual. La API no comprueba todos los compromisos personales: verifica conflictos en Calendar antes de confirmar. La conexión de cada reserva y su calendario destino se guardan como referencia, así que cambiar el destino del panel no desvía cancelaciones anteriores.

## 7. Testing de OAuth y paso a producción

En apps externas con estado **Testing**, los refresh tokens con permisos como Calendar generalmente caducan a los siete días; no dependas de esta configuración para operación continua. Antes del lanzamiento, configura audiencia de producción, dominios y aviso público, y completa la verificación de scopes/consentimiento que Google exija. Cambiar a Production no garantiza por sí solo que Google apruebe la verificación. Los tokens también pueden caducar o revocarse por otros motivos. Valida reconexión y manejo de `invalid_grant` en tu proyecto.

## 8. Desarrollo y pruebas sin credenciales

Node 24 o posterior. El build no instala dependencias y no requiere claves:

```bash
node scripts/build.mjs
npm run preview
npm test
npm run test:browser
```

`test:browser` usa Chrome instalado, un perfil temporal y respuestas de API simuladas; nunca necesita tu sesión real. En Linux/Windows configura `CHROME_PATH` con la ruta del ejecutable. Las capturas se guardan en `test-results/` (ignorado por Git). No hay librerías de frontend ni CDN de Auth; solo Turnstile carga su script externo cuando se configura.

Para el chequeo de tipos y las pruebas SQL embebidas:

```bash
npm install
npm run lint
npm run test:db
```

`test:db` ejecuta la primera migración con PGlite (Postgres WASM) y `btree_gist`. No ejecuta pg_cron. Su concurrencia comparte un único motor; para verificar bloqueos MVCC en conexiones independientes, usa un Supabase/Postgres **local desechable**, aplica las migraciones y ejecuta:

```bash
TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npm run test:concurrency
```

Esta prueba requiere `psql`, crea/borra su propio fixture y modifica `booking_settings`; no la ejecutes contra datos reales. Rechaza hosts remotos. Para funciones locales usa `supabase start` (requiere Docker) y `supabase functions serve --env-file /RUTA_PRIVADA/booking-edge.env`. Ajusta URL pública, callback local de Calendar, orígenes y Google Auth al entorno local antes de una prueba OAuth real.

## Referencias oficiales

- [Google Sign-In con Supabase](https://supabase.com/docs/guides/auth/social-login/auth-google)
- [Seguridad de Edge Functions](https://supabase.com/docs/guides/functions/auth)
- [Secretos de Edge Functions](https://supabase.com/docs/guides/functions/secrets)
- [OAuth web server de Google](https://developers.google.com/identity/protocols/oauth2/web-server)
- [Caducidad de tokens OAuth](https://developers.google.com/identity/protocols/oauth2#expiration)
- [Events.insert: IDs, scopes y sendUpdates](https://developers.google.com/workspace/calendar/api/v3/reference/events/insert)
