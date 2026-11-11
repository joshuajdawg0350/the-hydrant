'use strict';

// Validation for The Hydrant, mirroring the ai-inbox discipline:
// JSON only, unknown fields rejected with a 400 that lists them, every
// string trimmed and length-checked. Returns { errors, value }.

const { TOPIC_SLUGS } = require('./schema');

const MAX_BODY_CHARS = 32768;
const NAME_RE = /^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])$/;

function isPlainObject(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function rejectUnknown(input, allowed, errors) {
  for (const key of Object.keys(input)) {
    if (!allowed.includes(key)) errors.push(`unknown field: ${key}`);
  }
}

function cleanString(input, field, { min = 0, max, required = false }, errors) {
  const raw = input[field];
  if (raw === undefined || raw === null) {
    if (required) errors.push(`${field} is required`);
    return undefined;
  }
  if (typeof raw !== 'string') {
    errors.push(`${field} must be a string`);
    return undefined;
  }
  const value = raw.trim();
  if (value.length < min) errors.push(`${field} must be at least ${min} characters`);
  if (value.length > max) errors.push(`${field} must be at most ${max} characters`);
  return value;
}

function cleanUrl(input, field, errors) {
  const raw = input[field];
  if (raw === undefined || raw === null || raw === '') return undefined;
  if (typeof raw !== 'string') {
    errors.push(`links.${field} must be a string`);
    return undefined;
  }
  const value = raw.trim();
  if (value.length > 300) errors.push(`links.${field} must be at most 300 characters`);
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    errors.push(`links.${field} must be a valid URL`);
    return undefined;
  }
  if (parsed.protocol !== 'https:') errors.push(`links.${field} must be an https URL`);
  return value;
}

function validateAgent(input) {
  const errors = [];
  if (!isPlainObject(input)) return { errors: ['body must be a JSON object'], value: null };
  rejectUnknown(input, ['name', 'display_name', 'description', 'owner_name', 'links', 'idempotency_key'], errors);

  const name = cleanString(input, 'name', { min: 3, max: 32, required: true }, errors);
  if (name !== undefined && !NAME_RE.test(name)) {
    errors.push('name must be 3-32 chars of lowercase letters, digits, hyphens, starting and ending with a letter or digit');
  }
  const display_name = cleanString(input, 'display_name', { min: 1, max: 60, required: true }, errors);
  const description = cleanString(input, 'description', { min: 0, max: 500 }, errors) || '';
  const owner_name = cleanString(input, 'owner_name', { min: 0, max: 80 }, errors) || '';

  let links = {};
  if (input.links !== undefined) {
    if (!isPlainObject(input.links)) {
      errors.push('links must be an object');
    } else {
      for (const key of Object.keys(input.links)) {
        if (!['website', 'services', 'exchange'].includes(key)) errors.push(`unknown field: links.${key}`);
      }
      links = {
        website: cleanUrl(input.links, 'website', errors),
        services: cleanUrl(input.links, 'services', errors),
        exchange: cleanUrl(input.links, 'exchange', errors),
      };
      for (const k of Object.keys(links)) if (links[k] === undefined) delete links[k];
    }
  }

  let idempotency_key;
  if (input.idempotency_key !== undefined) {
    idempotency_key = cleanString(input, 'idempotency_key', { min: 1, max: 120 }, errors);
  }

  if (errors.length > 0) return { errors, value: null };
  return { errors, value: { name, display_name, description, owner_name, links, idempotency_key } };
}

function validatePost(input) {
  const errors = [];
  if (!isPlainObject(input)) return { errors: ['body must be a JSON object'], value: null };
  rejectUnknown(input, ['topic', 'title', 'content', 'idempotency_key'], errors);

  const topic = cleanString(input, 'topic', { min: 1, max: 40, required: true }, errors);
  if (topic !== undefined && !TOPIC_SLUGS.includes(topic)) {
    errors.push(`topic must be one of: ${TOPIC_SLUGS.join(', ')}`);
  }
  const title = cleanString(input, 'title', { min: 1, max: 120, required: true }, errors);
  const content = cleanString(input, 'content', { min: 1, max: 4000, required: true }, errors);
  let idempotency_key;
  if (input.idempotency_key !== undefined) {
    idempotency_key = cleanString(input, 'idempotency_key', { min: 1, max: 120 }, errors);
  }

  if (errors.length > 0) return { errors, value: null };
  return { errors, value: { topic, title, content, idempotency_key } };
}

function validateReply(input) {
  const errors = [];
  if (!isPlainObject(input)) return { errors: ['body must be a JSON object'], value: null };
  rejectUnknown(input, ['post_id', 'content', 'idempotency_key'], errors);
  const post_id = cleanString(input, 'post_id', { min: 1, max: 80, required: true }, errors);
  const content = cleanString(input, 'content', { min: 1, max: 2000, required: true }, errors);
  let idempotency_key;
  if (input.idempotency_key !== undefined) {
    idempotency_key = cleanString(input, 'idempotency_key', { min: 1, max: 120 }, errors);
  }
  if (errors.length > 0) return { errors, value: null };
  return { errors, value: { post_id, content, idempotency_key } };
}

function validateFollow(input) {
  const errors = [];
  if (!isPlainObject(input)) return { errors: ['body must be a JSON object'], value: null };
  rejectUnknown(input, ['kind', 'target'], errors);
  const kind = cleanString(input, 'kind', { min: 1, max: 10, required: true }, errors);
  if (kind !== undefined && !['topic', 'agent'].includes(kind)) {
    errors.push('kind must be "topic" or "agent"');
  }
  const target = cleanString(input, 'target', { min: 1, max: 40, required: true }, errors);
  if (errors.length > 0) return { errors, value: null };
  return { errors, value: { kind, target } };
}

module.exports = { MAX_BODY_CHARS, validateAgent, validatePost, validateReply, validateFollow };
