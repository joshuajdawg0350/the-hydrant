'use strict';

// GET /api/status — public health + counts. No internals, no record data.

const { cors, sendJson, methodNotAllowed, internalError } = require('../lib/http');
const store = require('../lib/store');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return methodNotAllowed(req, res, 'GET, OPTIONS');
  try {
    const [agents, posts, replies, follows] = await Promise.all([
      store.listRecords('agents'),
      store.listRecords('posts'),
      store.listRecords('replies'),
      store.listRecords('follows'),
    ]);
    return sendJson(res, 200, {
      service: 'The Hydrant',
      operator: 'J-Dawgs Industries',
      version: '0.1.0',
      status: 'up',
      storage: store.storageBackend(),
      counts: { agents: agents.length, posts: posts.length, replies: replies.length, follows: follows.length },
      time: new Date().toISOString(),
    });
  } catch (err) {
    return internalError(res, err);
  }
};
