# Deploying RielVest to Vercel (Hobby / free plan)

Two repositories, two Vercel projects:

| Repository | Vercel project | What it is |
|---|---|---|
| [`rielvest-api`](https://github.com/vathanaborissal-dev/rielvest-api) | `rielvest-api` | Express app as one serverless function, plus the daily refresh cron |
| [`rielvest-ui`](https://github.com/vathanaborissal-dev/rielvest-ui) | `rielvest-ui` | Next.js frontend |

The UI renders on the server and calls the API over HTTPS. Deploy the API first — the UI needs its URL, and the API needs the UI's origin, so there is one loop to close at the end.

This file lives in the API repo but covers both.

---

## Before you start

**Everything below fits inside the free Hobby plan.** The three limits that actually shape this deployment:

| Limit | Hobby | What it means here |
|---|---|---|
| Cron frequency | once per day | `30 8 * * 1-5` is valid. Anything more frequent **fails at deploy time**. |
| Cron precision | ±59 minutes | The 15:30 ICT refresh really fires between 15:30 and 16:29. Harmless — the market closed at 15:00. |
| Function regions | one | Already pinned to `sin1` in both `vercel.json` files. |
| `maxDuration` | 300s max | The cron is set to exactly 300. No headroom — see *If the refresh times out*. |

One honest caveat: **Vercel's Hobby plan is for non-commercial use.** Personal use of RielVest is fine. If you ever put ads on it, charge for access, or use it for a business, their terms require Pro.

---

## Step 1 — Push both repos

Both are initialised with their remote already set. Confirm no secrets are staged — each must print nothing:

```bash
git -C rielvest_api ls-files | grep -E '(^|/)\.env$|(^|/)\.env\.' | grep -v '.env.example'
```

```bash
git -C rielvest_ui ls-files | grep -E '(^|/)\.env$|(^|/)\.env\.' | grep -v '.env.example'
```

Then commit and push each:

```bash
git -C rielvest_api commit -qm "RielVest API: market data, analysis engine, briefing" && git -C rielvest_api push -u origin main
```

```bash
git -C rielvest_ui commit -qm "RielVest UI: market dashboard, briefing, stock pages" && git -C rielvest_ui push -u origin main
```

---

## Step 2 — Deploy the API

1. Vercel → **Add New → Project** → import **`rielvest-api`**.
2. Framework Preset: **Other**. Leave Root Directory as `./`.
3. Leave Build and Install commands alone — `vercel.json` sets them.
4. Add the environment variables below, then **Deploy**.

### API environment variables

Set each for **Production, Preview and Development**.

| Variable | Value |
|---|---|
| `DATABASE_URL` | Supabase **pooled** string — port `6543`, ending `?pgbouncer=true` |
| `DIRECT_URL` | Supabase **direct** string — port `5432` |
| `JWT_SECRET` | Generate one (below). **The API will not boot without it.** |
| `CRON_SECRET` | Generate one (below). The refresh endpoint refuses to run without it. |
| `CORS_ORIGINS` | Fill in after Step 3 — leave as `http://localhost:3000` for now |
| `NODE_ENV` | `production` |
| `GEMINI_API_KEY` | Optional. Blank = engine sentences, which is fully supported. |

Generate the two secrets:

```bash
node -e "console.log('JWT_SECRET   =', require('crypto').randomBytes(48).toString('base64url')); console.log('CRON_SECRET  =', require('crypto').randomBytes(32).toString('base64url'))"
```

> The `JWT_SECRET` currently in your local `.env` is the placeholder I wrote during development. Do not reuse it.

You do **not** need to set `PORT`, `INGESTION_ENABLED`, or `INGESTION_INTERVAL_MINUTES`. The in-process scheduler detects serverless and stands down; Vercel Cron drives refreshes instead.

### Check it

```bash
curl -s https://<your-api>.vercel.app/api/health
```

Expect `"status":"ok"` and `"runtime":"serverless"`.

---

## Step 3 — Deploy the UI

1. Vercel → **Add New → Project** → import **`rielvest-ui`**.
2. Framework Preset: **Next.js** (auto-detected). Root Directory stays `./`.

### UI environment variables

| Variable | Value |
|---|---|
| `RIELVEST_API_URL` | `https://<your-api>.vercel.app/api` |
| `NEXT_PUBLIC_RIELVEST_API_URL` | same value |
| `NEXT_PUBLIC_CSX_STREAM_URL` | `wss://api.csx.com.kh/tradingview/raw_websockets?webSocketToken=AacCeEsStOk3n1` |

Both API URL variables are needed and they are not redundant: pages are rendered on the server using `RIELVEST_API_URL`, while the **price chart and the ⌘K command palette fetch from the browser** using the `NEXT_PUBLIC_` one. Include `/api` and no trailing slash.

---

## Step 4 — Close the CORS loop

Because two features call the API from the browser, the API has to allow the UI's origin. Go back to the **API** project's environment variables and set:

```
CORS_ORIGINS=https://<your-ui>.vercel.app,*.vercel.app
```

Then **redeploy the API** (Deployments → ⋯ → Redeploy). Environment variable changes do not apply to an existing deployment.

The `*.vercel.app` entry exists so preview deployments — which get a new hostname every push — keep working. It is matched as a host suffix over https only; `evil-notvercel.app` does not match. If you later add a custom domain, list it explicitly.

Verify from the browser console on your deployed UI:

```js
fetch(`${location.origin}`) && fetch("https://<your-api>.vercel.app/api/health").then(r => r.json()).then(console.log)
```

A CORS failure shows as a red console error rather than a returned object.

---

## Step 5 — Run the migrations once

Vercel's build does **not** run migrations, deliberately — a build should not mutate a database. Run them from your machine, pointed at the same Supabase project:

```bash
npm run migrate:deploy
```

This uses `DIRECT_URL` (port 5432) because Supabase's pooler cannot run DDL.

If the database is empty, load the history — this takes a few minutes and is the one long job:

```bash
npm run ingest -- all
```

---

## Step 6 — Confirm the cron

Vercel → API project → **Settings → Cron Jobs**. You should see `/api/cron/refresh` at `30 8 * * 1-5`.

That is 08:30 UTC = **15:30 Phnom Penh**, weekdays, after the 15:00 close. On Hobby it fires somewhere in the following hour.

Trigger it by hand to prove the wiring:

```bash
curl -s https://<your-api>.vercel.app/api/cron/refresh -H "Authorization: Bearer $CRON_SECRET"
```

Without the header it returns `401`; with no `CRON_SECRET` configured it returns `500 not_configured`. Both are correct.

---

## Things that will bite you

**"The API works but the chart and ⌘K don't."**
`CORS_ORIGINS` is wrong, or the API was not redeployed after changing it. Step 4.

**Everything is slow.**
Check the region. The `vercel.json` in **each** repo pins `sin1` (Singapore) to sit beside Supabase's `ap-southeast-1` and near Cambodian readers. Vercel's default is `iad1` (Washington), which puts a ~250 ms Pacific round trip in front of *every* query — and the briefing makes several. If you moved the Supabase project, move the region to match.

**`JWT_SECRET is required` on cold start.**
The auth router is still mounted, so the variable is mandatory even though you are not using accounts. Set it.

**The data never updates.**
Look at the cron's invocation log. The adapters are deliberately all-or-nothing per source: if csx.com.kh is down they write nothing rather than write partial data, and `/api/health` keeps serving the last good session from Postgres. A failed refresh is visible, not silent.

**If the refresh times out.**
300s is the Hobby ceiling, and the cron is set to exactly that. A slow upstream plus backoff could reach it. You would get a partial refresh, not corruption — each source commits independently. Re-run that source by hand:

```bash
npm run ingest -- csx-trade-summary
```

**Preview deployments hit production data.**
Both environments share `DATABASE_URL` unless you scope it per-environment in Vercel. For a read-mostly app this is usually what you want; just know that running an ingest against a preview writes to the real database.

---

## If you ever want intraday refreshes

You do not need Pro. `/api/cron/refresh` authenticates purely on the bearer secret and does not care who calls it, so any external scheduler works — a GitHub Actions workflow on a schedule, or cron-job.org:

```bash
curl https://<your-api>.vercel.app/api/cron/refresh -H "Authorization: Bearer $CRON_SECRET"
```

Point it at 09:30, 12:00 and 15:30 ICT and the briefing stops saying "figures are from the last completed session" during market hours.
