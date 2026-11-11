'use strict';

// Shared handler plumbing for The Hydrant API (kept in one place; the
// ai-inbox repeats this per handler — same behavior, less drift).

const { MAX_BODY_CHARS } = require('./validate');

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Idempotency-Key, X-Idempotency-Key');
}

function sendJson(res, status, body) {
  res.status(status).setHeader('Content-Type', 'application/json').json(body);
}

async function readBody(req) {
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === 'string') return req.body;
    if (Buffer.isBuffer(req.body)) return req.body.toString('utf8');
    return JSON.stringify(req.body);
  }
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > MAX_BODY_CHARS) {
      const err = new Error('body_too_large');
      err.code = 'body_too_large';
      throw err;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

// Parse a JSON request body with the inbox's error vocabulary.
// Returns the parsed object, or null after already answering the request.
async function parseJsonBody(req, res) {
  const contentType = req.headers['content-type'] || '';
  if (contentType && !contentType.includes('application/json')) {
    sendJson(res, 415, { error: 'unsupported_media_type', message: 'Content-Type must be application/json.' });
    return null;
  }
  let raw;
  try {
    raw = await readBody(req);
  } catch (err) {
    if (err.code === 'body_too_large') {
      sendJson(res, 413, { error: 'body_too_large', message: `Body must be at most ${MAX_BODY_CHARS} characters.` });
      return null;
    }
    throw err;
  }
  if (raw.length > MAX_BODY_CHARS) {
    sendJson(res, 413, { error: 'body_too_large', message: `Body must be at most ${MAX_BODY_CHARS} characters.` });
    return null;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw || '{}');
  } catch {
    sendJson(res, 400, { error: 'invalid_json', message: 'Body must be valid JSON.' });
    return null;
  }
  // Idempotency-Key header support (body field wins if both are present).
  if (parsed && typeof parsed === 'object' && parsed.idempotency_key === undefined) {
    const headerKey = req.headers['idempotency-key'] || req.headers['x-idempotency-key'];
    if (typeof headerKey === 'string' && headerKey.trim() !== '') {
      parsed.idempotency_key = headerKey.trim();
    }
  }
  return parsed;
}

function methodNotAllowed(req, res, allow) {
  res.setHeader('Allow', allow);
  return sendJson(res, 405, { error: 'method_not_allowed' });
}

function internalError(res, err) {
  console.error(err);
  return sendJson(res, 500, { error: 'internal_error' });
}

module.exports = { cors, sendJson, parseJsonBody, methodNotAllowed, internalError };
