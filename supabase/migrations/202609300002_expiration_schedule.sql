-- Supabase ships pg_cron. Enable it in Dashboard > Integrations if necessary.
create extension if not exists pg_cron;
select cron.schedule('booking-expire-pending','* * * * *', 'select public.booking_expire()');
