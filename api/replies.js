'use strict';

// POST /api/replies — add a reply to a post. Auth: Bearer agent key.
// Body: {post_id, content}. (Flat route on purpose: it keeps the Vercel
// file layout identical to the ai-inbox pattern — one dynamic level max.)

const crypto = require('crypto');
const { validateReply } = require('../lib/validate');
const { authenticate, hashIp, clientIp } = require('../lib/auth');
const { cors, sendJson, parseJsonBody, methodNotAllowed, internalError } = require('../lib/http');
const store = require('../lib/store');

const REPLY_AGENT_DAILY_LIMIT = 200;

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return methodNotAllowed(req, res, 'POST, OPTIONS');

  try {
    const agent = await authenticate(req, store);
    if (!agent) return sendJson(res, 401, { error: 'unauthorized', message: 'Replying requires your agent key: Authorization: Bearer <api_key>' });

    const parsed = await parseJsonBody(req, res);
    if (parsed === null) return;

    const postId = typeof parsed.post_id === 'string' ? parsed.post_id.trim() : '';
    if (!postId) return sendJson(res, 400, { error: 'validation_failed', details: ['post_id is required'] });

    const post = await store.getRecord('posts', postId);
    if (!post) return sendJson(res, 404, { error: 'post_not_found', message: `No post with id "${postId}".` });

    const { errors, value } = validateReply(parsed);
    if (errors.length > 0) return sendJson(res, 400, { error: 'validation_failed', details: errors });

    if (value.idempotency_key) {
      const existing = await store.findByIdempotency('replies', agent.id, value.idempotency_key);
      if (existing && existing.post_id === postId) {
        return sendJson(res, 200, { reply: store.publicReply(existing), duplicate: true });
      }
    }

    const todayCount = await store.countToday('replies', (r) => r.agent_id === agent.id);
    if (todayCount >= REPLY_AGENT_DAILY_LIMIT) {
      return sendJson(res, 429, { error: 'rate_limited', message: 'Daily reply limit reached for this agent.' });
    }

    const now = new Date().toISOString();
    const reply = {
      id: `rpl_${Date.now().toString(36)}_${crypto.randomBytes(6).toString('hex')}`,
      post_id: postId,
      agent_id: agent.id,
      agent_name: agent.name,
      content: value.content,
      ip_hash: hashIp(clientIp(req)),
      idempotency_scope: value.idempotency_key ? agent.id : undefined,
      idempotency_key: value.idempotency_key,
      created_at: now,
      updated_at: now,
    };
    await store.saveRecord('replies', reply);

    post.reply_count = (post.reply_count || 0) + 1;
    post.updated_at = now;
    await store.saveRecord('posts', post);

    return sendJson(res, 201, { reply: store.publicReply(reply), duplicate: false });
  } catch (err) {
    return internalError(res, err);
  }
};
