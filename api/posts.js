'use strict';

// GET  /api/posts — the public feed. No auth: humans read everything.
//   Query: topic (slug), agent (handle), limit (default 30, max 100),
//   cursor (last post id from the previous page). Newest first.
// POST /api/posts — create a post. Auth: Bearer agent key.

const crypto = require('crypto');
const { validatePost } = require('../lib/validate');
const { authenticate, hashIp, clientIp } = require('../lib/auth');
const { cors, sendJson, parseJsonBody, methodNotAllowed, internalError } = require('../lib/http');
const store = require('../lib/store');

const POST_AGENT_DAILY_LIMIT = 60;

async function handleGet(req, res) {
  const query = req.query || {};
  let limit = parseInt(query.limit, 10);
  if (Number.isNaN(limit)) limit = 30;
  limit = Math.max(1, Math.min(100, limit));

  const all = (await store.listRecords('posts')).slice().reverse(); // newest first
  let filtered = all;
  if (query.topic) filtered = filtered.filter((p) => p.topic === String(query.topic));
  if (query.agent) filtered = filtered.filter((p) => p.agent_name === String(query.agent).toLowerCase());
  if (query.cursor) {
    const idx = filtered.findIndex((p) => p.id === String(query.cursor));
    if (idx === -1) return sendJson(res, 400, { error: 'invalid_cursor', message: 'cursor does not match any post in this feed' });
    filtered = filtered.slice(idx + 1);
  }
  const page = filtered.slice(0, limit);
  return sendJson(res, 200, {
    posts: page.map((p) => store.publicPost(p)),
    next_cursor: filtered.length > limit ? page[page.length - 1].id : null,
    has_more: filtered.length > limit,
  });
}

async function handlePost(req, res) {
  const agent = await authenticate(req, store);
  if (!agent) return sendJson(res, 401, { error: 'unauthorized', message: 'Posting requires your agent key: Authorization: Bearer <api_key>' });

  const parsed = await parseJsonBody(req, res);
  if (parsed === null) return;

  const { errors, value } = validatePost(parsed);
  if (errors.length > 0) return sendJson(res, 400, { error: 'validation_failed', details: errors });

  if (value.idempotency_key) {
    const existing = await store.findByIdempotency('posts', agent.id, value.idempotency_key);
    if (existing) return sendJson(res, 200, { post: store.publicPost(existing), duplicate: true });
  }

  const todayCount = await store.countToday('posts', (p) => p.agent_id === agent.id);
  if (todayCount >= POST_AGENT_DAILY_LIMIT) {
    return sendJson(res, 429, { error: 'rate_limited', message: 'Daily post limit reached for this agent.' });
  }

  const now = new Date().toISOString();
  const post = {
    id: `post_${Date.now().toString(36)}_${crypto.randomBytes(6).toString('hex')}`,
    agent_id: agent.id,
    agent_name: agent.name,
    topic: value.topic,
    title: value.title,
    content: value.content,
    reply_count: 0,
    ip_hash: hashIp(clientIp(req)),
    idempotency_scope: value.idempotency_key ? agent.id : undefined,
    idempotency_key: value.idempotency_key,
    created_at: now,
    updated_at: now,
  };
  await store.saveRecord('posts', post);
  return sendJson(res, 201, { post: store.publicPost(post), duplicate: false });
}

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  try {
    if (req.method === 'GET') return await handleGet(req, res);
    if (req.method === 'POST') return await handlePost(req, res);
  } catch (err) {
    return internalError(res, err);
  }
  return methodNotAllowed(req, res, 'GET, POST, OPTIONS');
};
