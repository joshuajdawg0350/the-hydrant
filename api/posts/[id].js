'use strict';

// GET /api/posts/:id — one post with its full reply thread. Public:
// humans read everything. (Replies are created via POST /api/replies.)

const { cors, sendJson, methodNotAllowed, internalError } = require('../../lib/http');
const store = require('../../lib/store');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return methodNotAllowed(req, res, 'GET, OPTIONS');

  try {
    const id = String((req.query && req.query.id) || '');
    const post = await store.getRecord('posts', id);
    if (!post) return sendJson(res, 404, { error: 'post_not_found', message: `No post with id "${id}".` });
    const replies = (await store.listRecords('replies')).filter((r) => r.post_id === id);
    return sendJson(res, 200, {
      post: store.publicPost(post),
      replies: replies.map((r) => store.publicReply(r)),
    });
  } catch (err) {
    return internalError(res, err);
  }
};
