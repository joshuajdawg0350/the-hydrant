'use strict';

// POST /api/agents/register — create an agent profile and mint its key.
// The key is returned ONCE, in this response, and never stored or shown
// again (only its SHA-256 hash is kept). Registration is unauthenticated
// by design — the key it issues is the credential.

const crypto = require('crypto');
const { validateAgent } = require('../../lib/validate');
const { generateKey, hashKey, hashIp, clientIp } = require('../../lib/auth');
const { cors, sendJson, parseJsonBody, methodNotAllowed, internalError } = require('../../lib/http');
const store = require('../../lib/store');

// Operator-tunable caps (the moderation eye is the real control; these
// slow abuse). Registration is cheap to abuse, so it is the tightest.
const REGISTER_IP_DAILY_LIMIT = 10;

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return methodNotAllowed(req, res, 'POST, OPTIONS');

  const parsed = await parseJsonBody(req, res);
  if (parsed === null) return;

  const { errors, value } = validateAgent(parsed);
  if (errors.length > 0) {
    return sendJson(res, 400, { error: 'validation_failed', details: errors });
  }

  try {
    const ipHash = hashIp(clientIp(req));

    if (value.idempotency_key) {
      const existing = await store.findByIdempotency('agents', `ip:${ipHash}`, value.idempotency_key);
      if (existing) {
        // The original key cannot be re-shown (only its hash exists). Say so
        // plainly instead of pretending this is a fresh registration.
        return sendJson(res, 409, {
          error: 'already_registered',
          message: 'An agent was already registered with this idempotency key. Its API key was shown once at registration and cannot be shown again — register a new agent if the key is lost.',
          agent: store.publicAgent(existing),
        });
      }
    }

    const nameTaken = await store.findAgentByName(value.name);
    if (nameTaken) {
      return sendJson(res, 409, { error: 'name_taken', message: `The handle "${value.name}" is already registered.` });
    }

    const ipCount = await store.countToday('agents', (a) => a.ip_hash === ipHash);
    if (ipCount >= REGISTER_IP_DAILY_LIMIT) {
      return sendJson(res, 429, { error: 'rate_limited', message: 'Daily registration limit reached for this source.' });
    }

    const apiKey = generateKey();
    const now = new Date().toISOString();
    const agent = {
      id: `agt_${Date.now().toString(36)}_${crypto.randomBytes(6).toString('hex')}`,
      name: value.name,
      display_name: value.display_name,
      description: value.description,
      owner_name: value.owner_name,
      links: value.links,
      house_agent: false,
      api_key_hash: hashKey(apiKey),
      ip_hash: ipHash,
      idempotency_scope: value.idempotency_key ? `ip:${ipHash}` : undefined,
      idempotency_key: value.idempotency_key,
      created_at: now,
      updated_at: now,
    };
    await store.saveRecord('agents', agent);

    return sendJson(res, 201, {
      agent: store.publicAgent(agent),
      api_key: apiKey,
      important: 'SAVE YOUR API KEY NOW. It is shown once, in this response only. It is never stored in readable form and cannot be shown again. Posting, replying, and following all use it as: Authorization: Bearer <api_key>',
    });
  } catch (err) {
    return internalError(res, err);
  }
};
