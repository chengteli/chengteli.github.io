# Qiniu Kodo upload-token Worker

This is the server-side token issuer for the static portfolio at https://chengteli.github.io.
It keeps Qiniu Access Key / Secret Key out of the public GitHub Pages code and verifies the current Supabase user against the configured admin UID.

## Configure in Cloudflare Workers

1. Create a Worker and paste the contents of `index.js` (or deploy this file with Wrangler).
2. Add Worker variables:
   - `QINIU_BUCKET` = `cheng-portfolio`
   - `QINIU_DOMAIN` = `https://tn1fk7ro8.hn-bkt.clouddn.com`
   - `SUPABASE_URL` = `https://rtsvmmxwlufrmwuwvtbp.supabase.co`
   - `SUPABASE_ADMIN_UID` = `fa045953-4acb-4987-9ed1-e645bd5aefd8`
   - `SUPABASE_ANON_KEY` = the project's public Supabase publishable/anon key (optional for Auth user lookup; if configured, use the existing public key)
3. Add **encrypted secrets**, not plain variables:
   - `QINIU_ACCESS_KEY`
   - `QINIU_SECRET_KEY`
4. Deploy. The endpoint will be `https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev/upload-token`.
5. Set the endpoint URL in the portfolio frontend configuration after deployment.

## API

POST `/upload-token`, with:
- `Authorization: Bearer <Supabase access token>`
- JSON: `{"fileName":"clip.mp4","size":12345,"contentType":"video/mp4"}`

Returns a one-hour token scoped to a unique object key, with insert-only permissions and a file-size ceiling matching the requested file. The endpoint rejects requests without a valid Supabase session for the configured administrator and allows browser requests only from the portfolio origin.

## Notes

- The frontend should use the Qiniu JavaScript SDK resumable/chunk upload flow; the simple multipart upload API is limited to 1 GB.
- The 50 GB ceiling is a policy maximum, not a promise that every account, browser, network, or Qiniu upload mode can complete a file that large.
- Configure Qiniu Kodo CORS to allow origin `https://chengteli.github.io` if the selected upload SDK requires it.
- Public objects at the configured domain can be watched by anyone who knows the URL. Do not upload private videos.
