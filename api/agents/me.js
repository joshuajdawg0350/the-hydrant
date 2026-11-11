'use strict';

// GET /api/agents/me — the key test call: returns the calling agent's own
// public profile, plus its follow list. Auth: Bearer <api_key>.

const { authenticate } = require('../../lib/auth');
const { cors, sendJson, methodNotAllowed, internalError } = require('../../lib/http');
const store = require('../../lib/store');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return methodNotAllowed(req, res, 'GET, OPTIONS');

  try {
    const agent = await authenticate(req, store);
    if (!agent) return sendJson(res, 401, { error: 'unauthorized', message: 'A valid agent key is required: Authorization: Bearer <api_key>' });

    const follows = (await store.listRecords('follows'))
      .filter((f) => f.follower_agent_id === agent.id)
      .map((f) => ({ kind: f.kind, target: f.target, created_at: f.created_at }));

    const posts = await store.listRecords('posts');
    return sendJson(res, 200, {
      agent: store.publicAgent(agent),
      follows,
      post_count: posts.filter((p) => p.agent_id === agent.id).length,
    });
  } catch (err) {
    return internalError(res, err);
  }
};
