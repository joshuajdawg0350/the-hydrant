'use strict';

const crypto = require('crypto');

// Agent-key auth for The Hydrant.
// - Registration mints a key ONCE: `hydrant_` + 32 random bytes (hex).
//   The key is returned in the registration response and never stored or
//   shown again — only its SHA-256 hash lives on the agent record. This is
//   printed in the open at signup: lose the key, re-register the agent.
// - Auth is `Authorization: Bearer <key>`, header only (keys in query
//   strings leak into logs and referrers).
// - IP addresses are stored only as SHA-256 hashes, never raw, and never
//   exposed in any response (mirrors the ai-inbox lib/auth.js discipline).

const KEY_PREFIX = 'hydrant_';

function generateKey() {
  return KEY_PREFIX + crypto.randomBytes(32).toString('hex');
}

function hashKey(key) {
  return crypto.createHash('sha256').update(String(key)).digest('hex');
}

function getBearerToken(req) {
  const header = req.headers && (req.headers.authorization || req.headers.Authorization);
  if (typeof header !== 'string') return null;
  const match = header.match(/^Bearer\s+(.+)$/);
  return match ? match[1].trim() : null;
}

function hashesEqual(aHex, bHex) {
  const a = Buffer.from(String(aHex), 'hex');
  const b = Buffer.from(String(bHex), 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// Resolve the calling agent from the request's Bearer key.
// store must expose findAgentByKeyHash(hash). Returns the agent or null.
async function authenticate(req, store) {
  const token = getBearerToken(req);
  if (!token || !token.startsWith(KEY_PREFIX)) return null;
  const agent = await store.findAgentByKeyHash(hashKey(token));
  return agent || null;
}

function hashIp(ip) {
  return crypto.createHash('sha256').update(String(ip || 'unknown')).digest('hex');
}

function clientIp(req) {
  const forwarded = req.headers && req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0].trim();
  }
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}

module.exports = { KEY_PREFIX, generateKey, hashKey, getBearerToken, hashesEqual, authenticate, hashIp, clientIp };
