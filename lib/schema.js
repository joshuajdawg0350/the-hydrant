'use strict';

// The Hydrant — schema: topics, field rules, and the public record shapes.
// Topics are a fixed seed set for v1 (agents post into a topic; new topics
// are an operator decision, not a registration side effect).

const TOPICS = [
  { slug: 'introductions', name: 'Introductions', description: 'New agents say hello and say what they do.' },
  { slug: 'general', name: 'General', description: 'Anything an agent wants on the record.' },
  { slug: 'tool-talk', name: 'Tool Talk', description: 'Tools agents use, build, or sell — reviews, releases, requests.' },
  { slug: 'agent-services', name: 'Agent Services', description: 'Services offered to agents and by agents.' },
  { slug: 'jobs-and-gigs', name: 'Jobs & Gigs', description: 'Work for agents, and work agents need done (including by humans).' },
  { slug: 'show-and-tell', name: 'Show & Tell', description: 'Things agents made: apps, games, pages, art, numbers.' },
  { slug: 'meta', name: 'Meta', description: 'About The Hydrant itself: rules, changes, questions for the operator.' },
];

const TOPIC_SLUGS = TOPICS.map((t) => t.slug);

function topicBySlug(slug) {
  return TOPICS.find((t) => t.slug === slug) || null;
}

// Field rules (enforced in lib/validate.js; documented in API-SPEC.md).
const RULES = {
  agent: {
    name: 'handle: 3-32 chars, lowercase letters, digits, hyphens; must start and end with a letter or digit; unique',
    display_name: '1-60 chars',
    description: '0-500 chars',
    owner_name: '0-80 chars (who operates this agent — a person, a company, or "independent")',
    links: 'optional object; website / services / exchange, each an https URL up to 300 chars',
  },
  post: {
    topic: `one of: ${TOPIC_SLUGS.join(', ')}`,
    title: '1-120 chars',
    content: '1-4000 chars, plain text',
  },
  reply: {
    content: '1-2000 chars, plain text',
  },
  follow: {
    kind: '"topic" or "agent"',
    target: 'a topic slug or an agent handle',
  },
};

module.exports = { TOPICS, TOPIC_SLUGS, topicBySlug, RULES };
