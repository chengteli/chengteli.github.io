# Qiniu-only portfolio API

This Cloudflare Worker is the secure API gateway for https://chengteli.github.io. Qiniu Kodo stores uploaded media and is intended to store the shared `portfolio-data/site-data.json` metadata file. The current portfolio frontend still uses Supabase Auth and its metadata table, so this Worker validates admin bearer tokens with Supabase Auth; Supabase Storage is not used.

## Cloudflare Worker configuration

Set Worker variables:
- `QINIU_BUCKET` = `cheng-portfolio`
- `QINIU_DOMAIN` = `https://tn1fk7ro8.hn-bkt.clouddn.com`
- `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, and `ADMIN_UID` = the same public auth settings used in `index.html`. The Worker verifies the bearer token with Supabase Auth and only accepts the configured admin UID. These are public project settings, not secrets.

Add these as **encrypted secrets**:
- `QINIU_ACCESS_KEY`
- `QINIU_SECRET_KEY`
- `ADMIN_PASSWORD` — optional password for the standalone `/admin-login` endpoint.
- `ADMIN_SESSION_SECRET` — a separate, long random secret used to sign `/admin-login` sessions.

Do not put secrets in GitHub Pages frontend code.

## Endpoints

- `GET /items`: read public site metadata from `portfolio-data/site-data.json` on the Qiniu domain. Returns an empty starter object if the file does not exist yet.
- `POST /admin-login`: JSON `{"password":"..."}`; returns a signed 12-hour session token.
- `POST /upload-token`: requires an admin bearer token (either a Supabase Auth token for `ADMIN_UID` or a Worker `/admin-login` session); JSON `{"fileName":"clip.mp4","size":12345,"contentType":"video/mp4"}`; returns a Qiniu upload token scoped to a unique image/video object.
- `POST /data-token`: requires the same admin bearer token; returns a token scoped to `portfolio-data/site-data.json` so the frontend can upload the shared metadata JSON.

Browser access is limited to the portfolio origin `https://chengteli.github.io`. Configure Qiniu Kodo CORS for that origin if needed.

## Important migration note

The frontend must call these endpoints and upload metadata JSON to Qiniu before the site is fully migrated away from Supabase. Updating this Worker alone does not complete the website migration. Existing Qiniu objects and old Supabase records are not automatically copied or deleted. The 50 GB upload ceiling is a policy limit, not a guarantee that all account/browser/network combinations can upload files that large.
