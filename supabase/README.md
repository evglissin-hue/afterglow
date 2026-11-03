# Switching on sunset alerts

The alert code is in the app (`lib/alerts`, `app/_server/alerts`, `/alerts`). It needs a free Supabase project to keep track of who wants alerts, and a few secrets in Vercel. Until then, `/alerts` says "Alerts aren't switched on yet" and the API answers 503.

About 15 minutes, in this order:

1. **Supabase project.** On [supabase.com](https://supabase.com), create a new project on the Free plan: name it `afterglow`, pick the London region, and keep the database password somewhere safe.
   - Project Settings → Data API: copy the **Project URL**.
   - Project Settings → API Keys: copy the **secret key** (`sb_secret_…`, or the older `service_role` key). Never share it.
2. **A cron secret.** Make up a long random password, 32 or more letters and digits with no quote marks. A password manager's generator is ideal. It lets Supabase's 15-minute job prove it's allowed to run the alert job.
3. **Vercel environment variables.** Vercel → project `afterglow` → Settings → Environment Variables, for Production, marked Sensitive:
   - `SUPABASE_URL`: the Project URL
   - `SUPABASE_SERVICE_ROLE_KEY`: the secret key
   - `CRON_SECRET`: the password from step 2
   - The push keys (`NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and `VAPID_SUBJECT` = `https://afterglow-evglissin-hue.vercel.app`): Claude can generate and add these from a session where Vercel is logged in, so the private key is never shown. To do it yourself, run `npx web-push generate-vapid-keys` and paste the two keys.
4. **Getting past Vercel's login.** While Vercel Authentication is on, Supabase's job can't reach the site. Either:
   - keep the site private: Settings → Deployment Protection → **Protection Bypass for Automation** → create a secret and copy it; or
   - switch Vercel Authentication off for production. That also makes installing the app on an iPhone simpler.
5. **Deploy** so the new variables take effect. New variables only reach new deployments.
6. **Database.** Supabase → SQL Editor → New query. Paste all of [`schema.sql`](schema.sql), put the cron secret on the `cron_secret` line and the bypass secret on the `bypass_secret` line (leave it `''` if Vercel Authentication is off), and press Run. It should say "Success". If it complains about pg_cron, switch on `pg_cron` and `pg_net` under Database → Extensions and run it again.
7. **Try it.** On Android, open the app, tap the bell, switch alerts on, allow notifications, then "Send a test alert". On iPhone, add the app to the home screen first and open it from there.
8. **Check the job.** In the SQL Editor:

   ```sql
   select created, status_code, content from net._http_response order by created desc limit 5;
   ```

   Every 15 minutes there should be a 200 with `"ok":true`. A 401 means the cron secret differs between the SQL and Vercel. A login page means the bypass secret is missing.

To stop the job: `select cron.unschedule('afterglow-alerts');`

## What's stored

One row per phone with alerts on (`push_subscriptions`): the push service address and keys, the place rounded to about 1 km, walk time, alert settings, favorite spots, the time zone, and what was decided and sent each day. Row-level security is on with no policies, so only the site's server (with the secret key) can read or write it. Switching alerts off deletes the row, and so does a push service reporting the phone gone.
