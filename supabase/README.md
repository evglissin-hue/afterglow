# Switching on sunset alerts

The alert code is in the app (`lib/alerts`, `app/_server/alerts`, `/alerts`). It needs a free Supabase database to keep track of who wants alerts. Until it has one, `/alerts` says "Alerts aren't switched on yet" and the API answers 503.

There's nothing to copy or make up: the app makes its own push keys the first time it needs them, and `schema.sql` makes the secret its 15-minute job uses. Both are kept in a private table.

## The easy way: about 10 minutes, all in the browser

1. **Open the site to everyone.** Vercel → project `afterglow` → Settings → Deployment Protection → switch **Vercel Authentication** off → Save. The alert job can then reach the site, and the app opens on an iPhone home screen without asking you to log in. The site has no private data.
2. **Add a database.** Vercel → project `afterglow` → **Storage** → Create Database → **Supabase** → Free plan, region London (or the nearest) → create it and connect it to `afterglow`. Vercel adds the keys the app needs (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` or `SUPABASE_SECRET_KEY`) by itself.
3. **Set it up.** Open the new database in Supabase (there's a link on the Storage page) → **SQL Editor** → New query → paste all of [`schema.sql`](schema.sql) → **Run**. It should say "Success". If it complains about pg_cron, switch on `pg_cron` and `pg_net` under Database → Extensions and run it again.
4. **Redeploy**, so the app sees the new keys: Vercel → Deployments → the latest one → ⋯ → Redeploy. A new push does it too.
5. **Switch alerts on.** On your phone, open the app, tap the bell, switch alerts on, allow notifications, then tap "Send a test alert". On iPhone, add the app to the home screen first and open it from there.

## Checking the job

In the Supabase SQL Editor:

```sql
select created, status_code, content from net._http_response order by created desc limit 5;
```

Every 15 minutes there should be a 200 with `"ok":true`. If you see an HTML page about logging in, the site is still behind Vercel's login (step 1). A 401 means a `CRON_SECRET` set by hand in Vercel doesn't match the one in the database; remove it from Vercel.

To stop the job: `select cron.unschedule('afterglow-alerts');`

## Other ways

- **Keep the site private.** Skip step 1. Instead go to Vercel → Settings → Deployment Protection → **Protection Bypass for Automation**, create a secret, and paste it into the `bypass_secret` line of `schema.sql` (step 4 in the file) before running it. The iPhone home-screen app may then ask you to log in to Vercel.
- **Supabase without Vercel's Storage tab.** Create the project on [supabase.com](https://supabase.com), then add `SUPABASE_URL` (Project Settings → Data API) and `SUPABASE_SERVICE_ROLE_KEY` (Project Settings → API Keys, the secret key) to Vercel's environment variables yourself.
- **Your own keys.** `NEXT_PUBLIC_VAPID_PUBLIC_KEY` with `VAPID_PRIVATE_KEY`, and `CRON_SECRET`, set in Vercel, take the place of the ones in the database.

## What's stored

- `push_subscriptions`: one row per phone with alerts on: the push service address and keys, the place rounded to about 1 km, walk time, alert settings, favorite spots, the time zone, and what was decided and sent each day. Switching alerts off deletes the row, and so does a push service reporting that the phone is gone.
- `app_settings`: the server's push keys and the job's secret.

Both have row-level security on with no policies, so only the site's server, using the secret key, can read or write them.
