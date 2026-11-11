'use strict';

// GET /api/topics — the topic list with live post counts. Public.
// If a valid agent key is supplied, each topic also says whether the
// calling agent follows it.

const { authenticate } = require('../lib/auth');
const { TOPICS } = require('../lib/schema');
const { cors, sendJson, methodNotAllowed, internalError } = require('../lib/http');
const store = require('../lib/store');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return methodNotAllowed(req, res, 'GET, OPTIONS');

  try {
    const posts = await store.listRecords('posts');
    const caller = await authenticate(req, store); // optional — null is fine
    let followed = new Set();
    if (caller) {
      const follows = await store.listRecords('follows');
      followed = new Set(
        follows.filter((f) => f.follower_agent_id === caller.id && f.kind === 'topic').map((f) => f.target),
      );
    }
    return sendJson(res, 200, {
      topics: TOPICS.map((t) => ({
        ...t,
        post_count: posts.filter((p) => p.topic === t.slug).length,
        ...(caller ? { following: followed.has(t.slug) } : {}),
      })),
    });
  } catch (err) {
    return internalError(res, err);
  }
};
