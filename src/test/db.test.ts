import { describe, it, expect, beforeEach } from 'vitest';
import { LocalDb } from '../lib/db';

describe('LocalDb Manager (IndexedDB)', () => {
  beforeEach(async () => {
    // Clear indexedDB before each test
    const db = await LocalDb.init();
    const tx = db.transaction(['sessions', 'messages', 'documents', 'documentChunks'], 'readwrite');
    tx.objectStore('sessions').clear();
    tx.objectStore('messages').clear();
    tx.objectStore('documents').clear();
    tx.objectStore('documentChunks').clear();
  });

  it('creates and retrieves sessions correctly sorted by updatedAt', async () => {
    const session1 = await LocalDb.createSession('First Session');
    await new Promise(r => setTimeout(r, 10));
    const session2 = await LocalDb.createSession('Second Session');

    expect(session1.id).toBeDefined();
    expect(session2.id).toBeDefined();
    expect(session1.title).toBe('First Session');
    expect(session1.synced).toBe(false);

    const sessions = await LocalDb.getSessions();
    expect(sessions.length).toBe(2);
    // Should be sorted by updatedAt descending
    expect(sessions[0].id).toBe(session2.id);
  });

  it('adds messages and links them to sessions', async () => {
    const session = await LocalDb.createSession('Test Session');
    const msg1 = await LocalDb.addMessage(session.id, 'user', 'Hello AI');
    const msg2 = await LocalDb.addMessage(session.id, 'assistant', 'Hello human!');

    expect(msg1.sessionId).toBe(session.id);
    expect(msg1.sender).toBe('user');
    expect(msg2.sender).toBe('assistant');

    const messages = await LocalDb.getMessages(session.id);
    expect(messages.length).toBe(2);
    expect(messages[0].text).toBe('Hello AI');
    expect(messages[1].text).toBe('Hello human!');
  });

  it('computes cosine similarity accurately', () => {
    const vecA = [1, 0, 0];
    const vecB = [1, 0, 0];
    const vecC = [0, 1, 0];

    expect(LocalDb.cosineSimilarity(vecA, vecB)).toBeCloseTo(1.0);
    expect(LocalDb.cosineSimilarity(vecA, vecC)).toBeCloseTo(0.0);
    expect(LocalDb.cosineSimilarity([0, 0, 0], vecA)).toBe(0);
  });

  it('filters and marks unsynced messages', async () => {
    const session = await LocalDb.createSession('Sync Session');
    const msg = await LocalDb.addMessage(session.id, 'user', 'Sync test message');

    const unsyncedBefore = await LocalDb.getUnsyncedMessages();
    expect(unsyncedBefore.length).toBe(1);
    expect(unsyncedBefore[0].id).toBe(msg.id);

    await LocalDb.markMessagesSynced([msg.id]);

    const unsyncedAfter = await LocalDb.getUnsyncedMessages();
    expect(unsyncedAfter.length).toBe(0);
  });
});
