-- Afterglow: sunset alerts (web push).
--
-- How to use: in Supabase, open SQL Editor → New query, paste this whole file and
-- press Run. Nothing to fill in, unless the site is still behind Vercel's login
-- (see step 4). Running it again later is safe: it only adds what's missing and
-- replaces the scheduled job.

-- 1. Extensions: pg_cron runs a job on a schedule, pg_net lets it make a web request.
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 2. One row per phone or browser that switched alerts on.
create table if not exists public.push_subscriptions (
  id              uuid primary key default gen_random_uuid(),
  -- Where to send: the browser's push service address, plus its encryption keys.
  endpoint        text not null unique check (endpoint like 'https://%' and length(endpoint) <= 2048),
  p256dh          text not null check (length(p256dh) <= 200),
  auth            text not null check (length(auth) <= 100),
  -- Rounded to 0.01° (about 1 km) before it's saved.
  lat             double precision not null check (lat between -90 and 90),
  lon             double precision not null check (lon between -180 and 180),
  walk_minutes    smallint not null default 15 check (walk_minutes between 1 and 60),
  -- Alert settings.
  min_label       text not null default 'Great' check (min_label in ('Good', 'Great', 'Epic')),
  lead_minutes    smallint not null default 120 check (lead_minutes in (60, 120, 180)),
  happening_now   boolean not null default true,
  upgrades        boolean not null default true,
  -- Saved spots: [{ "id": "…", "tile": "…", "name": "…" }].
  favorites       jsonb not null default '[]'::jsonb check (jsonb_typeof(favorites) = 'array'),
  timezone        text not null default 'Europe/London',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  -- The last time a push service accepted a message for this device.
  last_ok_at      timestamptz,
  -- The last "Send a test alert" (at most one a minute).
  last_test_at    timestamptz,
  -- What has been decided and sent, as the sunset's date in the subscriber's time zone.
  decided_on      date,      -- the pre-sunset decision, made once a day whether or not it sent
  decided_score   smallint,  -- the score at that decision
  sent_on         date,      -- a pre-sunset or upgrade alert went out (at most one a day)
  sent_kind       text check (sent_kind in ('pre-sunset', 'upgrade')),
  now_checked_on  date,      -- the "it's happening" check, once a day
  now_sent_on     date       -- an "it's happening" alert went out
);

-- Row-level security on, with no policies on purpose: the public (anon) key can't
-- read or write this table at all. Only the site's server can, with the service
-- role key, which bypasses row-level security.
alter table public.push_subscriptions enable row level security;
revoke all on table public.push_subscriptions from anon, authenticated;
grant select, insert, update, delete on table public.push_subscriptions to service_role;

-- 3. The server's own secrets, private like the table above: the push (VAPID) keys,
--    which the site makes the first time it needs them, and the secret the job in
--    step 4 sends so the site knows the request is real, made here (64 random hex
--    characters from two random UUIDs).
create table if not exists public.app_settings (
  key        text primary key,
  value      text not null,
  created_at timestamptz not null default now()
);
alter table public.app_settings enable row level security;
revoke all on table public.app_settings from anon, authenticated;
grant select, insert, update, delete on table public.app_settings to service_role;
insert into public.app_settings (key, value)
values ('cron_secret', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
on conflict (key) do nothing;

-- 4. The job: every 15 minutes, ask the site to send the alerts that are due.
do $setup$
declare
  -- Only while the site is behind Vercel Authentication: the secret from Vercel →
  -- Settings → Deployment Protection → Protection Bypass for Automation, between
  -- the quotes. Leave it as '' if Vercel Authentication is off.
  bypass_secret text := '';

  site_url text := 'https://afterglow-evglissin-hue.vercel.app';
  cron_secret text;
  request_headers jsonb;
begin
  select value into cron_secret from public.app_settings where key = 'cron_secret';

  request_headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'Authorization', 'Bearer ' || cron_secret
  );
  if bypass_secret <> '' then
    request_headers := request_headers || jsonb_build_object('x-vercel-protection-bypass', bypass_secret);
  end if;

  -- Same name each time, so running this again replaces the job instead of adding another.
  perform cron.schedule(
    'afterglow-alerts',
    '*/15 * * * *',
    format(
      'select net.http_post(url := %L, headers := %L::jsonb, body := %L::jsonb, timeout_milliseconds := 60000)',
      site_url || '/api/cron/alerts',
      request_headers::text,
      '{}'
    )
  );
end
$setup$;

-- To check it's working, run these one at a time whenever you like:
--   select jobname, schedule, active from cron.job;
--   select status, start_time, return_message from cron.job_run_details order by start_time desc limit 5;
--   select created, status_code, content from net._http_response order by created desc limit 5;
-- A healthy run answers status 200 with {"ok":true,…}; 401 means the CRON_SECRET here and in
-- the site doesn't match (a CRON_SECRET set in Vercel overrides the one made here; remove it);
-- an HTML page about logging in means the site is behind Vercel's login: switch that off, or
-- fill in bypass_secret in step 4 and run this again.
--
-- To stop the job:  select cron.unschedule('afterglow-alerts');
