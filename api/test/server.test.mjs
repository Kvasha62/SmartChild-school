import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createLeadServer } from '../src/server.mjs';

const allowedOrigin = 'http://localhost:4321';
const baseEnv = {
  ALLOWED_ORIGINS: allowedOrigin,
  SMTP_HOST: 'smtp.example.test',
  SMTP_PORT: '465',
  SMTP_SECURE: 'true',
  SMTP_USER: 'sender@example.test',
  SMTP_PASS: 'test-only-secret',
  FROM_EMAIL: 'sender@example.test',
  NOTIFY_EMAIL: 'owner@example.test',
  CHECKLIST_PATH: '/path/does/not/need/to/exist-for-this-test.pdf',
};

async function withServer(options, run) {
  const server = createLeadServer(options);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

function fakeMailer({ sendMail = async () => ({ accepted: ['test@example.com'] }), createError = null } = {}) {
  return {
    createTransport() {
      if (createError) throw createError;
      return { sendMail };
    },
  };
}

const validLead = {
  method: 'POST',
  headers: { origin: allowedOrigin, 'content-type': 'application/json' },
  body: JSON.stringify({ email: 'test@example.com' }),
};

test('returns JSON 403 for a disallowed Origin', async () => {
  await withServer({ env: baseEnv, mailer: fakeMailer() }, async (url) => {
    const response = await fetch(`${url}/api/lead`, {
      ...validLead,
      headers: { ...validLead.headers, origin: 'https://evil.example' },
    });
    assert.equal(response.status, 403);
    assert.equal((await response.json()).ok, false);
  });
});

test('handles an allowed CORS preflight', async () => {
  await withServer({ env: baseEnv, mailer: fakeMailer() }, async (url) => {
    const response = await fetch(`${url}/api/lead`, {
      method: 'OPTIONS',
      headers: { origin: allowedOrigin, 'access-control-request-method': 'POST' },
    });
    assert.equal(response.status, 204);
    assert.equal(response.headers.get('access-control-allow-origin'), allowedOrigin);
    assert.match(response.headers.get('access-control-allow-methods') || '', /POST/);
  });
});

test('returns 404 for an unknown route', async () => {
  await withServer({ env: baseEnv, mailer: fakeMailer() }, async (url) => {
    const response = await fetch(`${url}/not-found`, { headers: { origin: allowedOrigin } });
    assert.equal(response.status, 404);
    assert.equal((await response.json()).ok, false);
  });
});

test('rejects non-JSON and JSONP content types', async () => {
  await withServer({ env: baseEnv, mailer: fakeMailer() }, async (url) => {
    for (const contentType of ['text/plain', 'application/jsonp']) {
      const response = await fetch(`${url}/api/lead`, {
        method: 'POST',
        headers: { origin: allowedOrigin, 'content-type': contentType },
        body: '{}',
      });
      assert.equal(response.status, 415, contentType);
    }
  });
});

test('returns 400 for malformed JSON', async () => {
  await withServer({ env: baseEnv, mailer: fakeMailer() }, async (url) => {
    const response = await fetch(`${url}/api/lead`, {
      method: 'POST',
      headers: { origin: allowedOrigin, 'content-type': 'application/json' },
      body: '{bad json',
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).ok, false);
  });
});

test('returns 413 when request body exceeds the limit', async () => {
  await withServer({ env: baseEnv, mailer: fakeMailer() }, async (url) => {
    const response = await fetch(`${url}/api/lead`, {
      method: 'POST',
      headers: { origin: allowedOrigin, 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'a'.repeat(5000) }),
    });
    assert.equal(response.status, 413);
    assert.equal((await response.json()).ok, false);
  });
});

test('successfully processes a lead without sending real email', async () => {
  const sentMessages = [];
  const env = {
    ...baseEnv,
    CHECKLIST_PATH: fileURLToPath(
      new URL('../../public/smartchild-checklist-oge-ege-informatics.pdf', import.meta.url),
    ),
  };
  const mailer = fakeMailer({
    sendMail: async (message) => {
      sentMessages.push(message);
      return { accepted: [message.to] };
    },
  });

  await withServer({ env, mailer }, async (url) => {
    const response = await fetch(`${url}/api/lead`, validLead);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('access-control-allow-origin'), allowedOrigin);
    assert.equal(body.ok, true);
    assert.equal(sentMessages.length, 2);
    assert.equal(sentMessages[0].to, 'test@example.com');
    assert.equal(sentMessages[1].to, 'owner@example.test');
  });
});

test('returns controlled 500 JSON if mail transport construction throws', async () => {
  await withServer({ env: baseEnv, mailer: fakeMailer({ createError: new Error('secret provider details') }) }, async (url) => {
    const response = await fetch(`${url}/api/lead`, validLead);
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), {
      ok: false,
      error: 'Внутренняя ошибка. Попробуйте позже.',
    });
  });
});

test('returns 429 after more than five requests from one client', async () => {
  await withServer({ env: baseEnv, mailer: fakeMailer() }, async (url) => {
    const statuses = [];
    for (let i = 0; i < 6; i += 1) {
      const response = await fetch(`${url}/api/lead`, {
        ...validLead,
        body: JSON.stringify({ email: 'not-an-email' }),
      });
      statuses.push(response.status);
      await response.arrayBuffer();
    }
    assert.deepEqual(statuses, [400, 400, 400, 400, 400, 429]);
  });
});

test('does not trust X-Forwarded-For by default', async () => {
  await withServer({ env: baseEnv, mailer: fakeMailer() }, async (url) => {
    const statuses = [];
    for (let i = 0; i < 6; i += 1) {
      const response = await fetch(`${url}/api/lead`, {
        ...validLead,
        headers: { ...validLead.headers, 'x-forwarded-for': `198.51.100.${i + 1}` },
        body: JSON.stringify({ email: 'bad' }),
      });
      statuses.push(response.status);
      await response.arrayBuffer();
    }
    assert.deepEqual(statuses, [400, 400, 400, 400, 400, 429]);
  });
});
