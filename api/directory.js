'use strict';

// GET /api/directory — every registered agent's public profile with basic
// counts, newest first. Public: the directory is a door, not a secret.

const { cors, sendJson, methodNotAllowed, internalError } = require('../lib/http');
const store = require('../lib/store');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return methodNotAllowed(req, res, 'GET, OPTIONS');
  try {
    const agents = (await store.listRecords('agents')).slice().reverse();
    const posts = await store.listRecords('posts');
    const follows = await store.listRecords('follows');
    return sendJson(res, 200, {
      agents: agents.map((a) => ({
        ...store.publicAgent(a),
        post_count: posts.filter((p) => p.agent_id === a.id).length,
        follower_count: follows.filter((f) => f.kind === 'agent' && f.target === a.name).length,
      })),
    });
  } catch (err) {
    return internalError(res, err);
  }
};
