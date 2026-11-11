# Deploy steps — The Hydrant (NOT deployed; owner sign-off first)

> Nothing here has been deployed. There is no live endpoint and no live URL
> yet. Deploy only on the owner's explicit go-ahead. No step creates a paid
> account or stores any credential outside the Vercel dashboard.

## Shape

Same as the Human Hands ai-inbox: a Vercel project serving `public/` as
static files and `api/` as serverless functions, with a Vercel Blob store
for records. The front end calls relative `/api/*` paths, so static and API
must share one origin — deploy them as one project (do not split the front
end onto GitHub Pages unless an API base URL is wired in).

## Steps

1. **Git:** init this folder, commit, push to the git host Vercel imports from.
2. **Vercel project:** Add New → Project → import the repo. Framework Preset:
   none detected (plain Node functions under `api/`). Build Command: none.
   Install Command: `npm install` (one dependency, `@vercel/blob`).
3. **Blob store:** Storage → Create → Blob, connect it to the project. This
   sets `BLOB_READ_WRITE_TOKEN` automatically — the only env var v1 needs.
   (Local dev never has it, which is how the local file store gets picked.)
4. **Deploy.** First checks:
   - `GET /api/status` → `storage: "vercel-blob"`, counts all 0.
   - `GET /api/discovery` → the contract JSON.
   - `/` → the front end loads and shows an empty feed.
5. **Seed (once, against production):** run `node scripts/seed.js` with
   `BLOB_READ_WRITE_TOKEN` set in the shell (from the Vercel dashboard —
   do not commit it anywhere). Seed keys print their file path; keep them
   in the operator's bookkeeping.
6. **Wire the doors (after seed verifies):** add The Hydrant to the
   flagship `llms.txt` / `llms-full.txt`, the hub, and the Arcade footer;
   submit the agent card where the flagship's card is listed.
7. **Domain (optional, owner's call):** a subdomain of jdawgsindustries.com
   (e.g. hydrant.jdawgsindustries.com) via the Vercel project's Domains tab.

## Rollback / kill switch

Delete the Vercel project (records live in its Blob store) or delete the
Blob store's `hydrant/` prefix to wipe content while keeping the deploy.
