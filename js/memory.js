// What Quark remembers about you, kept in localStorage: your name, a rolling summary of what it knows and what you've
// been talking about (the brain rewrites it as you chat), a few durable facts, the current topic, and the recent turns.
// It only leaves the device as the short text the brain needs to carry on a conversation.

import { load, save } from './storage.js';

// Kid mode keeps its own, smaller memory so nothing from an adult's chats reaches a child (or the other way round).
let kidMode = false;
const keyName = () => (kidMode ? 'memoryKid' : 'memory');
const maxTurns = () => (kidMode ? 12 : 30);        // kept on the device
const MAX_TOPICS = 8;
const MAX_FACTS = 24;

const blank = () => ({ userName: '', summary: '', facts: [], topic: '', topics: [], history: [], firstMet: 0, lastSeen: 0, lastUserAt: 0 });
let data = null;
const d = () => data || (data = { ...blank(), ...load(keyName(), {}) });
const persist = () => save(keyName(), d());

export const memory = {
  /** Switch between the adult and the Kid memory. */
  setMode(mode) {
    const kid = mode === 'kid';
    if (kid !== kidMode) { kidMode = kid; data = null; }
  },
  get kid() { return kidMode; },

  get userName() { return d().userName; },
  setUserName(name) {
    d().userName = String(name || '').trim().slice(0, 24);
    persist();
  },

  /** A compact running summary of what Quark knows and the ongoing conversation. */
  get summary() { return d().summary; },
  get facts() { return d().facts; },
  get topic() { return d().topic; },

  /**
   * Apply the brain's memory_update: { summary, facts_add, name, topic }. An empty summary means "unchanged".
   * In kid mode only the name, the summary and the topic are kept (no extra facts). Returns the names of what changed.
   */
  applyUpdate(mu, { kid = false } = {}) {
    if (!mu || typeof mu !== 'object') return [];
    const changed = [];
    const m = d();
    const summary = String(mu.summary || '').trim().slice(0, 700);
    if (summary && summary !== m.summary) { m.summary = summary; changed.push('summary'); }
    if (!kid) {
      for (const f of (Array.isArray(mu.facts_add) ? mu.facts_add : []).slice(0, 3)) {
        const fact = String(f).trim().slice(0, 100);
        if (fact && !m.facts.some((x) => x.toLowerCase() === fact.toLowerCase())) { m.facts.push(fact); changed.push('fact'); }
      }
      if (m.facts.length > MAX_FACTS) m.facts.splice(0, m.facts.length - MAX_FACTS);
    }
    const name = String(mu.name || '').trim().slice(0, 24);
    if (name && name !== m.userName) { m.userName = name; changed.push('name'); }
    if (typeof mu.topic === 'string') {
      const t = mu.topic.trim().slice(0, 40);
      if (t !== m.topic) { m.topic = t; changed.push('topic'); }
      if (t) memory.addTopic(t, false);
    }
    if (changed.length) persist();
    return changed;
  },

  get topics() { return d().topics; },
  /** Remember something the user talked about. Newest first, no duplicates. */
  addTopic(topic, doPersist = true) {
    const t = String(topic || '').trim().slice(0, 40);
    if (!t) return;
    const list = d().topics.filter((x) => x.t.toLowerCase() !== t.toLowerCase());
    list.unshift({ t, at: Date.now() });
    d().topics = list.slice(0, MAX_TOPICS);
    if (doPersist) persist();
  },
  /** The newest topic that's recent enough to bring up naturally. */
  recentTopic(maxAgeMs = 3 * 24 * 3600 * 1000) {
    const x = d().topics[0];
    return x && Date.now() - x.at < maxAgeMs ? x.t : '';
  },

  get history() { return d().history; },
  pushTurn(role, text) {
    d().history.push({ role, text: String(text).slice(0, 320) });
    if (d().history.length > maxTurns()) d().history.splice(0, d().history.length - maxTurns());
    if (role === 'user') d().lastUserAt = Date.now();
    persist();
  },
  /** The last n turns (the brain gets 10 to 15). */
  recent(n = 15) { return d().history.slice(-n); },
  /** Seconds since the user last said something (0 if never). */
  get silenceSec() { return d().lastUserAt ? Math.round((Date.now() - d().lastUserAt) / 1000) : 0; },

  get firstMet() { return d().firstMet; },
  get lastSeen() { return d().lastSeen; },
  markSeen() {
    if (!d().firstMet) d().firstMet = Date.now();
    d().lastSeen = Date.now();
    persist();
  },
  /** Note that we saw them without counting it as having met (the first hello didn't happen yet). */
  touch() {
    d().lastSeen = Date.now();
    persist();
  },

  forget() {
    data = blank();
    persist();
  },
};
