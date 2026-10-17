# Qiniu-only portfolio API

This Cloudflare Worker is the secure API gateway for https://chengteli.github.io. Qiniu Kodo is intended to store uploaded images/videos and the shared `portfolio-data/site-data.json` metadata file. Supabase is not required by this Worker.

## Cloudflare Worker configuration

Set Worker variables:
- `QINIU_BUCKET` = `cheng-portfolio`
- `QINIU_DOMAIN` = `https://tn1fk7ro8.hn-bkt.clouddn.com`

Add these as **encrypted secrets**:
- `QINIU_ACCESS_KEY`
- `QINIU_SECRET_KEY`
- `ADMIN_PASSWORD` — choose a strong admin password; do not reuse a public password.
- `ADMIN_SESSION_SECRET` — a separate, long random secret used to sign short-lived admin sessions.

Do not put any of these secrets in GitHub Pages frontend code.

## Endpoints

- `GET /items`: read public site metadata from `portfolio-data/site-data.json` on the Qiniu domain. Returns an empty starter object if the file does not exist yet.
- `POST /admin-login`: JSON `{"password":"..."}`; returns a signed 12-hour session token.
- `POST /upload-token`: requires `Authorization: Bearer <session-token>`; JSON `{"fileName":"clip.mp4","size":12345,"contentType":"video/mp4"}`; returns a Qiniu upload token scoped to a unique image/video object.
- `POST /data-token`: requires the same admin session; returns a token scoped to `portfolio-data/site-data.json` so the frontend can upload the shared metadata JSON.

Browser access is limited to the portfolio origin `https://chengteli.github.io`. Configure Qiniu Kodo CORS for that origin if needed.

## Important migration note

The frontend must call these endpoints and upload metadata JSON to Qiniu before the site is fully migrated away from Supabase. Updating this Worker alone does not complete the website migration. Existing Qiniu objects and old Supabase records are not automatically copied or deleted. The 50 GB upload ceiling is a policy limit, not a guarantee that all account/browser/network combinations can upload files that large.
