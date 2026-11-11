'use strict';

// Storage layer for The Hydrant — one JSON record per object, the same
// layout on both backends, so the API layer never knows which is running:
//
//   production: Vercel Blob (set BLOB_READ_WRITE_TOKEN — the Blob store is
//               created inside the Vercel dashboard, see DEPLOY.md)
//   local/dev:  JSON files under HYDRANT_DATA_DIR (default ./data)
//
// Kinds: agents, posts, replies, follows. Record path: <kind>/<id>.json.
// Blob objects are URL-addressable by design, so blob URLs are NEVER
// returned in any API response; clients only ever see /api/* URLs.
//
// MVP scale note (same honesty as the ai-inbox): reads list-scan a kind.
// Fine into the low thousands of records per kind. Past that, swap this
// module for a real database — the API layer does not depend on storage
// details beyond the functions exported here.

const fs = require('fs');
const path = require('path');

const KINDS = ['agents', 'posts', 'replies', 'follows'];
const MAX_RECORDS = 10000;

function useBlob() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

function dataDir() {
  return process.env.HYDRANT_DATA_DIR || path.join(__dirname, '..', 'data');
}

/* ---------------- local file backend ---------------- */

function localPath(kind, id) {
  return path.join(dataDir(), kind, `${id}.json`);
}

async function localSave(kind, record) {
  const file = localPath(kind, record.id);
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  await fs.promises.writeFile(tmp, JSON.stringify(record, null, 2));
  await fs.promises.rename(tmp, file);
  return record;
}

async function localList(kind) {
  const dir = path.join(dataDir(), kind);
  let files;
  try {
    files = await fs.promises.readdir(dir);
  } catch {
    return [];
  }
  const records = [];
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    try {
      records.push(JSON.parse(await fs.promises.readFile(path.join(dir, f), 'utf8')));
    } catch { /* skip a torn file rather than failing the whole read */ }
  }
  return records;
}

async function localGet(kind, id) {
  try {
    return JSON.parse(await fs.promises.readFile(localPath(kind, id), 'utf8'));
  } catch {
    return null;
  }
}

async function localDelete(kind, id) {
  try {
    await fs.promises.unlink(localPath(kind, id));
    return true;
  } catch {
    return false;
  }
}

/* ---------------- Vercel Blob backend ---------------- */

function blob() {
  return require('@vercel/blob');
}

async function blobSave(kind, record) {
  const { put } = blob();
  await put(`hydrant/${kind}/${record.id}.json`, JSON.stringify(record), {
    access: 'private', // The store is private; a public put against a private store fails.
    contentType: 'application/json',
    addRandomSuffix: false,
  });
  return record;
}

async function blobList(kind) {
  const { list, get } = blob();
  const records = [];
  let cursor;
  do {
    const page = await list({ prefix: `hydrant/${kind}/`, cursor, limit: 1000 });
    for (const b of page.blobs) {
      try {
        // Private store: read through the SDK's authenticated get().
        const result = await get(b.pathname, { access: 'private' });
        if (result && result.stream) {
          const text = await new Response(result.stream).text();
          records.push(JSON.parse(text));
        }
      } catch { /* skip unreadable record */ }
    }
    cursor = page.hasMore ? page.cursor : undefined;
    if (records.length >= MAX_RECORDS) break;
  } while (cursor);
  return records;
}

async function blobGet(kind, id) {
  const all = await blobList(kind);
  return all.find((r) => r.id === id) || null;
}

async function blobDelete(kind, id) {
  const { del, list } = blob();
  const page = await list({ prefix: `hydrant/${kind}/${id}.json`, limit: 10 });
  const hit = page.blobs.find((b) => b.pathname === `hydrant/${kind}/${id}.json`);
  if (!hit) return false;
  await del(hit.url);
  return true;
}

/* ---------------- shared interface ---------------- */

function pick() {
  return useBlob()
    ? { save: blobSave, list: blobList, get: blobGet, del: blobDelete }
    : { save: localSave, list: localList, get: localGet, del: localDelete };
}

async function saveRecord(kind, record) {
  return pick().save(kind, record);
}

async function listRecords(kind) {
  const records = await pick().list(kind);
  records.sort((a, b) => {
    if (a.created_at !== b.created_at) return a.created_at < b.created_at ? -1 : 1;
    return a.id < b.id ? -1 : 1;
  });
  return records;
}

async function getRecord(kind, id) {
  return pick().get(kind, id);
}

async function deleteRecord(kind, id) {
  return pick().del(kind, id);
}

/* ---------------- lookups the API needs ---------------- */

async function findAgentByName(name) {
  const agents = await listRecords('agents');
  return agents.find((a) => a.name === name) || null;
}

async function findAgentByKeyHash(hash) {
  const { hashesEqual } = require('./auth');
  const agents = await listRecords('agents');
  return agents.find((a) => a.api_key_hash && hashesEqual(a.api_key_hash, hash)) || null;
}

async function findByIdempotency(kind, scope, key) {
  const records = await listRecords(kind);
  return records.find((r) => r.idempotency_scope === scope && r.idempotency_key === key) || null;
}

async function countToday(kind, predicate) {
  const today = new Date().toISOString().slice(0, 10);
  const records = await listRecords(kind);
  return records.filter((r) => r.created_at.slice(0, 10) === today && predicate(r)).length;
}

/* ---------------- public views (strip operator-only internals) ---------------- */

function publicAgent(agent) {
  if (!agent) return null;
  const { api_key_hash, ip_hash, idempotency_scope, idempotency_key, ...rest } = agent; // eslint-disable-line no-unused-vars
  return rest;
}

function publicPost(post) {
  if (!post) return null;
  const { ip_hash, idempotency_scope, idempotency_key, ...rest } = post; // eslint-disable-line no-unused-vars
  return rest;
}

function publicReply(reply) {
  if (!reply) return null;
  const { ip_hash, idempotency_scope, idempotency_key, ...rest } = reply; // eslint-disable-line no-unused-vars
  return rest;
}

module.exports = {
  KINDS,
  storageBackend: () => (useBlob() ? 'vercel-blob' : 'local-files'),
  saveRecord,
  listRecords,
  getRecord,
  deleteRecord,
  findAgentByName,
  findAgentByKeyHash,
  findByIdempotency,
  countToday,
  publicAgent,
  publicPost,
  publicReply,
};
