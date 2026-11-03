-- Afterglow: sunset alerts (web push).
--
-- How to use: in Supabase, open SQL Editor → New query, paste this whole file,
-- fill in the line marked FILL IN in step 3 (and the optional one under it), then
-- press Run. Running it again later is safe: it only adds what's missing and
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

-- 3. The job: every 15 minutes, ask the site to send the alerts that are due.
do $setup$
declare
  -- FILL IN: the same long random text you saved as CRON_SECRET in Vercel,
  -- between the quotes.
  cron_secret text := 'PASTE-YOUR-CRON-SECRET-HERE';

  -- FILL IN, only while the site is behind Vercel Authentication: the secret
  -- from Vercel → Settings → Deployment Protection → Protection Bypass for
  -- Automation. Leave it as '' if Vercel Authentication is off.
  bypass_secret text := '';

  site_url text := 'https://afterglow-evglissin-hue.vercel.app';
  request_headers jsonb;
begin
  if cron_secret = 'PASTE-YOUR-CRON-SECRET-HERE' or length(cron_secret) < 16 then
    raise exception 'Paste your CRON_SECRET into the cron_secret line in step 3 first (at least 16 characters), then run again.';
  end if;

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
-- Vercel don't match; an HTML page about logging in means the Vercel bypass secret is missing.
--
-- To stop the job:  select cron.unschedule('afterglow-alerts');
