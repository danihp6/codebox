import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decodeEvent } from '@codebox/opencode';
import {
  DEFAULT_CHANGE_CONTENT,
  DEFAULT_CHANGE_FILE,
  E2E_MESSAGE_ID,
  startE2eOpenCode,
} from '../fakes/opencode.mjs';

const EXPECTED_TYPES = [
  'session.updated',
  'message.part.tool',
  'message.part.text',
  'message.part.tool',
  'session.usage',
  'session.updated',
];

async function getJson(url) {
  const response = await fetch(url);
  assert.equal(response.status, 200, url);
  return response.json();
}

function dataLines(frame) {
  return frame
    .split('\n')
    .filter((line) => line.startsWith('data: '))
    .map((line) => line.slice('data: '.length));
}

test('the e2e OpenCode fake answers the wire and edits the session directory', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'cb-e2e-open-'));
  const fake = await startE2eOpenCode({});
  const controller = new AbortController();
  try {
    assert.deepEqual(await getJson(`${fake.url}/api/info`), { version: 'e2e-1.0.0' });
    const models = await getJson(`${fake.url}/api/model`);
    assert.deepEqual(models, {
      data: [{ id: 'claude-sonnet-4', providerID: 'anthropic', name: 'Claude Sonnet 4' }],
    });
    const agents = await getJson(`${fake.url}/api/agent`);
    assert.deepEqual(agents, {
      data: [
        { name: 'build', mode: 'primary' },
        { name: 'plan', mode: 'primary' },
      ],
    });

    const created = await fetch(`${fake.url}/api/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'cb-run-probe', directory, agent: 'build', model: null }),
    });
    assert.equal(created.status, 200);
    const session = await created.json();
    assert.deepEqual(session, { id: 'ses_e2e1', title: 'cb-run-probe', directory });

    const stream = await fetch(`${fake.url}/api/event?sessionID=${session.id}`, {
      signal: controller.signal,
    });
    assert.equal(stream.status, 200);
    assert.match(stream.headers.get('content-type') ?? '', /text\/event-stream/);
    const reader = stream.body.getReader();
    const decoder = new TextDecoder();

    const prompted = await fetch(`${fake.url}/api/session/${session.id}/prompt`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'do the thing' }),
    });
    assert.equal(prompted.status, 202);

    const events = [];
    let buffer = '';
    while (events.length < EXPECTED_TYPES.length) {
      const chunk = await reader.read();
      assert.equal(chunk.done, false, 'the stream closed before every frame arrived');
      buffer += decoder.decode(chunk.value, { stream: true });
      let boundary = buffer.indexOf('\n\n');
      while (boundary !== -1) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        for (const line of dataLines(frame)) {
          const decoded = decodeEvent(JSON.parse(line));
          assert.notEqual(decoded, null, `decodeEvent rejected ${line}`);
          events.push(decoded);
        }
        boundary = buffer.indexOf('\n\n');
      }
    }
    controller.abort();

    assert.deepEqual(
      events.map((event) => event.type),
      EXPECTED_TYPES,
    );
    assert.equal(events.at(-1)?.status, 'idle');
    assert.deepEqual(events[2], {
      type: 'message.part.text',
      sessionId: 'ses_e2e1',
      messageId: E2E_MESSAGE_ID,
      delta: 'wrote e2e-change.txt',
    });
    assert.equal(
      readFileSync(join(directory, DEFAULT_CHANGE_FILE), 'utf8'),
      DEFAULT_CHANGE_CONTENT,
    );

    const interrupt = await fetch(`${fake.url}/api/session/${session.id}/interrupt`, {
      method: 'POST',
    });
    assert.equal(interrupt.status, 204);
    const permission = await fetch(`${fake.url}/api/session/${session.id}/permissions/perm_1`, {
      method: 'POST',
    });
    assert.equal(permission.status, 204);
    const closed = await fetch(`${fake.url}/api/session/${session.id}`, { method: 'DELETE' });
    assert.equal(closed.status, 204);
    const unknown = await fetch(`${fake.url}/api/nope`);
    assert.equal(unknown.status, 404);
    assert.ok(fake.requests.includes('GET /api/info'));
    assert.ok(fake.requests.includes('POST /api/session'));
  } finally {
    controller.abort();
    await fake.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
