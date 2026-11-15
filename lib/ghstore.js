'use strict';

// GitHub JSON document store — the post-Blob storage backend (2026-11-15).
//
// Why this exists: Vercel suspended both Blob stores on 2026-11-15 (free-tier
// Blob operations cap), so the apps' data moved to a PRIVATE GitHub repo
// (default joshuajdawg0350/jdawgs-app-data) holding one JSON file per record
// at exactly the paths the Blob layout used. The Vercel functions read/write
// it server-side via the GitHub Contents API.
//
// Config (Vercel env vars; the token lives ONLY here, never in code):
//   GH_STORE_TOKEN   — GitHub token with repo access to the data repo.
//   GH_STORE_OWNER   — default 'joshuajdawg0350'
//   GH_STORE_REPO    — default 'jdawgs-app-data'
//   GH_STORE_BRANCH  — default 'main'
//   GH_STORE_API_BASE — default 'https://api.github.com' (test override only)
//
// Access pattern is deliberately simple: whole-document JSON reads/writes.
// Datasets are tiny (tens of records), so a scan is one directory listing
// plus one GET per file. No cross-request caching: every exported read is
// fresh, matching the old Blob semantics.

function cfg() {
  return {
    token: process.env.GH_STORE_TOKEN || '',
    owner: process.env.GH_STORE_OWNER || 'joshuajdawg0350',
    repo: process.env.GH_STORE_REPO || 'jdawgs-app-data',
    branch: process.env.GH_STORE_BRANCH || 'main',
    api: process.env.GH_STORE_API_BASE || 'https://api.github.com',
  };
}

function configured() {
  return Boolean(cfg().token);
}

function encPath(p) {
  return p.split('/').map(encodeURIComponent).join('/');
}

async function gh(method, path, body) {
  const c = cfg();
  const res = await fetch(`${c.api}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${c.token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'jdawgs-app-store',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res;
}

function contentsUrl(path, withRef) {
  const c = cfg();
  const base = `/repos/${c.owner}/${c.repo}/contents/${encPath(path)}`;
  return withRef ? `${base}?ref=${encodeURIComponent(c.branch)}` : base;
}

// GET one file -> { data, sha } or null when it does not exist.
async function getJson(path) {
  const res = await gh('GET', contentsUrl(path, true));
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`gh_get_failed_${res.status}`);
  const payload = await res.json();
  const text = Buffer.from(String(payload.content || '').replace(/\s/g, ''), 'base64').toString('utf8');
  return { data: JSON.parse(text), sha: payload.sha };
}

// List one directory -> [{ name, path, type, sha }] ([] when missing).
async function listDir(path) {
  const res = await gh('GET', contentsUrl(path, true));
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`gh_list_failed_${res.status}`);
  const payload = await res.json();
  if (!Array.isArray(payload)) return [];
  return payload.map((e) => ({ name: e.name, path: e.path, type: e.type, sha: e.sha }));
}

// Read every JSON document under a prefix. Layouts are either flat
// (<prefix><file>.json) or one level deep (<prefix><dir>/<file>.json),
// which covers hydrant/<kind>/, inbox/<date>/ and signups/<date>/.
async function scanJson(prefix) {
  const out = [];
  const top = await listDir(prefix.replace(/\/$/, ''));
  for (const entry of top) {
    if (entry.type === 'file' && entry.name.endsWith('.json')) {
      const got = await getJson(entry.path);
      if (got) out.push({ path: entry.path, data: got.data });
    } else if (entry.type === 'dir') {
      const sub = await listDir(entry.path);
      for (const e2 of sub) {
        if (e2.type === 'file' && e2.name.endsWith('.json')) {
          const got = await getJson(e2.path);
          if (got) out.push({ path: e2.path, data: got.data });
        }
      }
    }
  }
  return out;
}

// Create or overwrite one JSON document. Retries once on a sha conflict.
async function putJson(path, obj) {
  const c = cfg();
  const content = Buffer.from(JSON.stringify(obj), 'utf8').toString('base64');
  for (let attempt = 0; attempt < 2; attempt++) {
    const existing = await getJson(path);
    const body = {
      message: `data: write ${path}`,
      content,
      branch: c.branch,
      ...(existing ? { sha: existing.sha } : {}),
    };
    const res = await gh('PUT', contentsUrl(path, false), body);
    if (res.ok) return obj;
    if ((res.status === 409 || res.status === 422) && attempt === 0) continue;
    throw new Error(`gh_put_failed_${res.status}`);
  }
  throw new Error('gh_put_failed_conflict');
}

// Delete one document -> true when something was deleted.
async function deleteJson(path) {
  const c = cfg();
  const existing = await getJson(path);
  if (!existing) return false;
  const res = await gh('DELETE', contentsUrl(path, false), {
    message: `data: delete ${path}`,
    sha: existing.sha,
    branch: c.branch,
  });
  if (!res.ok) throw new Error(`gh_delete_failed_${res.status}`);
  return true;
}

module.exports = { configured, getJson, listDir, scanJson, putJson, deleteJson };
