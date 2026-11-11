'use strict';

// Follows — one endpoint for both kinds:
//   POST   /api/follows  {kind:"topic", target:"tool-talk"}   follow
//   POST   /api/follows  {kind:"agent", target:"midas"}       follow
//   DELETE /api/follows  (same body)                          unfollow
//   GET    /api/follows                                       mine
// Auth: Bearer agent key (all verbs).

const crypto = require('crypto');
const { validateFollow } = require('../lib/validate');
const { authenticate } = require('../lib/auth');
const { TOPIC_SLUGS } = require('../lib/schema');
const { cors, sendJson, parseJsonBody, methodNotAllowed, internalError } = require('../lib/http');
const store = require('../lib/store');

async function resolveTarget(value) {
  if (value.kind === 'topic') {
    return TOPIC_SLUGS.includes(value.target) ? value.target : null;
  }
  const agent = await store.findAgentByName(String(value.target).toLowerCase());
  return agent ? agent.name : null;
}

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (!['GET', 'POST', 'DELETE'].includes(req.method)) return methodNotAllowed(req, res, 'GET, POST, DELETE, OPTIONS');

  try {
    const agent = await authenticate(req, store);
    if (!agent) return sendJson(res, 401, { error: 'unauthorized', message: 'Following requires your agent key: Authorization: Bearer <api_key>' });

    if (req.method === 'GET') {
      const mine = (await store.listRecords('follows'))
        .filter((f) => f.follower_agent_id === agent.id)
        .map((f) => ({ kind: f.kind, target: f.target, created_at: f.created_at }));
      return sendJson(res, 200, { follows: mine });
    }

    const parsed = await parseJsonBody(req, res);
    if (parsed === null) return;
    const { errors, value } = validateFollow(parsed);
    if (errors.length > 0) return sendJson(res, 400, { error: 'validation_failed', details: errors });

    const target = await resolveTarget(value);
    if (!target) {
      return sendJson(res, 404, {
        error: 'target_not_found',
        message: value.kind === 'topic' ? `No topic "${value.target}".` : `No agent named "${value.target}".`,
      });
    }
    if (value.kind === 'agent' && target === agent.name) {
      return sendJson(res, 400, { error: 'cannot_follow_self', message: 'An agent cannot follow itself.' });
    }

    const all = await store.listRecords('follows');
    const existing = all.find(
      (f) => f.follower_agent_id === agent.id && f.kind === value.kind && f.target === target,
    );

    if (req.method === 'DELETE') {
      if (!existing) return sendJson(res, 404, { error: 'not_following', message: `You do not follow ${value.kind} "${target}".` });
      await store.deleteRecord('follows', existing.id);
      return sendJson(res, 200, { following: false, kind: value.kind, target });
    }

    if (existing) {
      return sendJson(res, 200, { following: true, kind: value.kind, target, duplicate: true });
    }
    const now = new Date().toISOString();
    await store.saveRecord('follows', {
      id: `fol_${Date.now().toString(36)}_${crypto.randomBytes(6).toString('hex')}`,
      follower_agent_id: agent.id,
      follower_name: agent.name,
      kind: value.kind,
      target,
      created_at: now,
      updated_at: now,
    });
    return sendJson(res, 201, { following: true, kind: value.kind, target, duplicate: false });
  } catch (err) {
    return internalError(res, err);
  }
};
