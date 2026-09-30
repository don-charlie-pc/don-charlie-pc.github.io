# Operación diaria de reservas

## Abrir y publicar horarios

Entra directamente a `/admin/` y accede con tu Google autorizado. El panel no está enlazado desde la navegación pública; la protección real está en el servidor.

En **Disponibilidad**, captura inicio y fin en hora de Guadalajara. Selecciona servicios admitidos, locación, etiqueta pública y notas. Una nota interna nunca aparece en la página pública. Guarda como borrador para revisarlo o como activo para publicarlo. Un horario activo solo aparece si está dentro de la ventana, admite el servicio y no tiene reserva activa. Publicar, editar, pausar y archivar nunca llama a Google Calendar.

Para crear en bloque, indica cantidad (máximo 60) y repetición diaria, semanal o consecutiva. Todos se guardan en una transacción: si uno se solapa con un horario publicado, ninguno del bloque se guarda. Los rangos son `[inicio, fin)`: dos horarios pueden tocarse, pero no superponerse. Considera tus traslados al definirlos; no se añade un margen de viaje automáticamente.

Editar o pausar solo se permite sin una reserva activa. Eliminar archiva el horario y mantiene su historial. El panel lista hasta 1,000 horarios no archivados; archiva los antiguos según tu operación.

## Revisar solicitudes y cotizaciones

Usa filtros por fecha de sesión, servicio, estado y Calendar. Los datos privados se obtienen solo después de validar tu autorización. Cada página muestra hasta 100 reservas; usa Anterior/Siguiente. Las consultas de cotización se muestran aparte (últimas 100), no apartan fechas y pueden marcarse como contactadas/cerradas. Para más consultas utiliza SQL Editor privado o amplía su paginación antes de crecer.

Un cliente recibe un UUID como folio. No hay buscador público ni enlace que permita consultar datos privados por folio. No se envían correos, WhatsApps automáticos ni invitaciones de Google.

Los pendientes caducan por defecto al menor valor entre 24 horas desde la solicitud y 24 horas antes del horario. Al vencer vuelven a estar disponibles si aún cumplen la ventana. Cron procesa cada minuto; las lecturas públicas y operaciones administrativas también limpian vencidos. El sistema no promete recordatorios.

## Confirmar

1. Revisa el servicio, locación, duración, disponibilidad personal y acuerdos comerciales.
2. Si tu operación requiere anticipo, compruébalo manualmente por tu medio habitual. El sistema no cobra ni verifica pagos y no inventa una política de anticipos.
3. Comprueba la cuenta conectada y calendario de destino. Pulsa **Confirmar y añadir a Google Calendar** y acepta el diálogo.
4. Espera el estado **Confirmada / Sincronizado**. Solo entonces comunica la confirmación al cliente por WhatsApp o correo.

La aplicación registra el evento privado en Calendar antes de marcar la reserva como confirmada. El primer intento pasa por `confirming / creating`; si falla, se queda en `confirming / error`, todavía apartado y sin comunicar confirmación. El mismo botón explícito reintenta. No existe una tarea automática que confirme pendientes.

Un doble clic no crea dos eventos: hay un bloqueo temporal de sincronización y un ID determinista. Si aparece “sincronización en curso”, espera hasta tres minutos y recarga. Si Google guardó el evento pero hubo un timeout, el reintento recupera ese mismo ID. Si se cambió/eliminó manualmente el evento, la app detecta inconsistencias y exige revisión.

## Rechazar, cancelar y recuperar

- **Rechazar**: solo pendientes sin evento. Libera el horario de inmediato.
- **Cancelar pendiente**: no toca Calendar; libera el horario.
- **Cancelar confirmada o confirmación con error**: busca el evento determinista y lo elimina sin notificar asistentes. Mientras no se verifique la eliminación, mantiene `cancellation_requested / cancellation_pending` y el horario bloqueado. Usa **Reintentar cancelación de Calendar** si falla. Repetir una cancelación exitosa es inocuo.
- **Recuperación: liberar manualmente**: recurso explícito cuando no se puede sincronizar. Espera que no haya operación en curso, revisa/elimina el evento manualmente en Google y escribe el motivo. Libera el horario y deja auditoría; no elimina el evento por sí mismo. Comprueba el calendario después ante respuestas de red ambiguas.
- **Realizada / No asistió**: disponible para reservas confirmadas cuando la sesión ya terminó. Conserva el evento como historial.

Las notas de cancelación de pendientes y el motivo de recuperación se conservan sin incluirse en logs. La auditoría guarda actor, acción y estados; no copia teléfonos, correo, notas ni tokens.

## Reprogramar

Esta versión no mueve silenciosamente eventos ya confirmados. Acuerda el cambio con el cliente, cancela la reserva original, comprueba la sincronización, publica/elige el nuevo horario y pide una nueva solicitud. Confirma la nueva únicamente después de revisar los acuerdos. La referencia nueva facilita conservar ambos historiales.

## Cambiar ventanas y catálogo

Estas opciones se gestionan desde SQL Editor privado, no desde archivos públicos:

```sql
update public.booking_settings
set minimum_notice_hours=24, maximum_window_days=90,
    hold_hours=24, hold_cutoff_hours=24
where id=true;
```

`hold_cutoff_hours` indica cuántas horas antes de la sesión vence el apartado. Si reduces la anticipación por debajo de 24, reduce también ese corte; de otro modo el horario seguiría sin poder apartarse. Ambos se aplican en servidor. Los valores nuevos afectan solicitudes nuevas; los vencimientos ya emitidos se conservan.

Actualiza nombres, descripciones, visibilidad, duración sugerida, `price_label` y `sort_order` en `service_types`. Usa `booking_mode='quote'` para servicios de cotización y bodas largas. Los horarios definen su duración exacta; la duración del catálogo es una referencia, no se ajusta automáticamente. Antes de cambiar un servicio de `slot` a `quote`, retíralo de los horarios publicados. Nunca ofrezcas video en el servicio de boda. No publiques precios sin definirlos tú.

Para cerrar nuevas solicitudes, establece `accepting_requests=false`. Las reservas existentes siguen administrándose. Al modificar el aviso y términos, publica la nueva versión y actualiza `legal_version`; cada solicitud conserva la versión aceptada y timestamps del servidor.

## Operación y límites

Mantén copias de seguridad, revisa cron, errores y permisos de Google periódicamente. No se revisa automáticamente el calendario personal completo, no se importan eventos y no se detectan sus conflictos: revísalos manualmente antes de confirmar. No hay pagos, facturación, cancelación autoservicio, correos ni WhatsApps automáticos. Los datos de clientes permanecen en la base de datos; define y ejecuta una política de conservación en el aviso antes de recibir solicitudes reales.
