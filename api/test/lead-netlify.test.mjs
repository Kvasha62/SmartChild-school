import test from 'node:test';
import assert from 'node:assert/strict';
import { createLeadHandler } from '../../netlify/functions/lead.mjs';

const env = {
  RESEND_API_KEY: 'test-only-not-a-real-key',
  FROM_EMAIL: 'SmartChild <sender@example.test>',
  NOTIFY_EMAIL: 'owner@example.test',
  PUBLIC_SITE_URL: 'https://school.example.test',
};

const pdf = Buffer.from('%PDF-1.4\nfake test PDF\n%%EOF\n');

function makeRequest({
  method = 'POST',
  url = 'https://school.example.test/api/lead',
  headers = {
    origin: 'https://school.example.test',
    'content-type': 'application/json',
  },
  body = JSON.stringify({ email: 'Student@Example.com' }),
} = {}) {
  return new Request(url, { method, headers, body });
}

function fakeFetch({ failEmailAt = 0, failPdf = false } = {}) {
  const emailMessages = [];
  let emailCalls = 0;

  const fetchImpl = async (input, init = {}) => {
    const url = String(input);

    if (url === 'https://school.example.test/smartchild-checklist-oge-ege-informatics.pdf') {
      if (failPdf) return new Response('not found', { status: 404 });
      return new Response(pdf, {
        status: 200,
        headers: { 'content-type': 'application/pdf' },
      });
    }

    assert.equal(url, 'https://api.resend.com/emails');
    assert.equal(init.method, 'POST');
    assert.equal(init.headers.authorization, `Bearer ${env.RESEND_API_KEY}`);
    emailCalls += 1;
    emailMessages.push(JSON.parse(init.body));

    if (emailCalls === failEmailAt) {
      return new Response('provider error', { status: 500 });
    }
    return new Response(JSON.stringify({ id: `email-${emailCalls}` }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  return { fetchImpl, emailMessages };
}

test('sends the PDF to the visitor first, then notifies the owner', async () => {
  const { fetchImpl, emailMessages } = fakeFetch();
  const handler = createLeadHandler({ env, fetchImpl, logger: { error() {} } });

  const response = await handler(makeRequest());
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(emailMessages.length, 2);
  assert.deepEqual(emailMessages[0].to, ['student@example.com']);
  assert.equal(emailMessages[0].attachments[0].filename, 'smartchild-checklist-oge-ege-informatics.pdf');
  assert.equal(
    Buffer.from(emailMessages[0].attachments[0].content, 'base64').toString(),
    pdf.toString(),
  );
  assert.deepEqual(emailMessages[1].to, ['owner@example.test']);
});

test('rejects invalid email without calling Resend', async () => {
  let providerCalls = 0;
  const { fetchImpl } = fakeFetch();
  const handler = createLeadHandler({
    env,
    fetchImpl: async (...args) => {
      if (String(args[0]).includes('api.resend.com')) providerCalls += 1;
      return fetchImpl(...args);
    },
    logger: { error() {} },
  });

  const response = await handler(makeRequest({ body: JSON.stringify({ email: 'bad' }) }));
  assert.equal(response.status, 400);
  assert.equal(providerCalls, 0);
});

test('does not report failure if only owner notification fails', async () => {
  const { fetchImpl } = fakeFetch({ failEmailAt: 2 });
  const logs = [];
  const handler = createLeadHandler({
    env,
    fetchImpl,
    logger: { error: (...args) => logs.push(args) },
  });

  const response = await handler(makeRequest());
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(logs.length, 1);
  assert.equal(logs[0][0], 'Lead owner notification failed:');
  assert.equal(JSON.stringify(logs).includes('student@example.com'), false);
});

test('returns a controlled error if visitor email delivery fails', async () => {
  const { fetchImpl } = fakeFetch({ failEmailAt: 1 });
  const handler = createLeadHandler({ env, fetchImpl, logger: { error() {} } });

  const response = await handler(makeRequest());
  assert.equal(response.status, 502);
  assert.equal((await response.json()).ok, false);
});

test('fails closed when the PDF is unavailable', async () => {
  const { fetchImpl } = fakeFetch({ failPdf: true });
  const handler = createLeadHandler({ env, fetchImpl, logger: { error() {} } });

  const response = await handler(makeRequest());
  assert.equal(response.status, 503);
  assert.equal((await response.json()).ok, false);
});

test('rejects a cross-origin request', async () => {
  const { fetchImpl } = fakeFetch();
  const handler = createLeadHandler({ env, fetchImpl, logger: { error() {} } });

  const response = await handler(makeRequest({
    headers: {
      origin: 'https://evil.example',
      'content-type': 'application/json',
    },
  }));

  assert.equal(response.status, 403);
});

test('requires provider configuration', async () => {
  const { fetchImpl } = fakeFetch();
  const handler = createLeadHandler({
    env: {},
    fetchImpl,
    logger: { error() {} },
  });

  const response = await handler(makeRequest());
  assert.equal(response.status, 503);
});

test('rejects unsupported HTTP methods without external calls', async () => {
  let externalCalls = 0;
  const handler = createLeadHandler({
    env,
    fetchImpl: async () => {
      externalCalls += 1;
      throw new Error('Unexpected external call');
    },
    logger: { error() {} },
  });

  const response = await handler(makeRequest({ method: 'GET', body: null }));
  assert.equal(response.status, 405);
  assert.equal(externalCalls, 0);
});

test('rejects non-JSON content types without external calls', async () => {
  let externalCalls = 0;
  const handler = createLeadHandler({
    env,
    fetchImpl: async () => {
      externalCalls += 1;
      throw new Error('Unexpected external call');
    },
    logger: { error() {} },
  });

  const response = await handler(makeRequest({
    headers: {
      origin: 'https://school.example.test',
      'content-type': 'text/plain',
    },
  }));

  assert.equal(response.status, 415);
  assert.equal(externalCalls, 0);
});

test('rejects oversized request bodies without external calls', async () => {
  let externalCalls = 0;
  const handler = createLeadHandler({
    env,
    fetchImpl: async () => {
      externalCalls += 1;
      throw new Error('Unexpected external call');
    },
    logger: { error() {} },
  });

  const response = await handler(makeRequest({
    body: JSON.stringify({ email: 'student@example.com', extra: 'x'.repeat(5000) }),
  }));

  assert.equal(response.status, 413);
  assert.equal(externalCalls, 0);
});

test('rejects malformed JSON without external calls', async () => {
  let externalCalls = 0;
  const handler = createLeadHandler({
    env,
    fetchImpl: async () => {
      externalCalls += 1;
      throw new Error('Unexpected external call');
    },
    logger: { error() {} },
  });

  const response = await handler(makeRequest({ body: '{"email":' }));

  assert.equal(response.status, 400);
  assert.equal(externalCalls, 0);
});

test('returns a controlled error when the Resend network call throws', async () => {
  let resendCalls = 0;
  const handler = createLeadHandler({
    env,
    fetchImpl: async (input) => {
      const url = String(input);
      if (url === 'https://school.example.test/smartchild-checklist-oge-ege-informatics.pdf') {
        return new Response(pdf, { status: 200 });
      }
      assert.equal(url, 'https://api.resend.com/emails');
      resendCalls += 1;
      throw new TypeError('simulated network failure');
    },
    logger: { error() {} },
  });

  const response = await handler(makeRequest());

  assert.equal(response.status, 502);
  assert.equal((await response.json()).ok, false);
  assert.equal(resendCalls, 1);
});

test('does not notify the owner when visitor delivery fails', async () => {
  const { fetchImpl } = fakeFetch({ failEmailAt: 1 });
  let resendCalls = 0;
  const handler = createLeadHandler({
    env,
    fetchImpl: async (...args) => {
      if (String(args[0]) === 'https://api.resend.com/emails') resendCalls += 1;
      return fetchImpl(...args);
    },
    logger: { error() {} },
  });

  const response = await handler(makeRequest());

  assert.equal(response.status, 502);
  assert.equal(resendCalls, 1);
});


test('rate-limits repeated requests from the same client and returns Retry-After', async () => {
  const { fetchImpl } = fakeFetch();
  const handler = createLeadHandler({ env, fetchImpl, logger: { error() {} } });
  const headers = {
    origin: 'https://school.example.test',
    'content-type': 'application/json',
    'x-nf-client-connection-ip': '203.0.113.10',
  };

  for (let i = 0; i < 5; i += 1) {
    const response = await handler(makeRequest({
      headers,
      body: JSON.stringify({ email: 'not-an-email' }),
    }));
    assert.equal(response.status, 400, `request ${i + 1} should reach validation`);
  }

  const limited = await handler(makeRequest({ headers }));
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get('retry-after'), '900');
  assert.equal((await limited.json()).ok, false);
});

test('applies a timeout signal to the PDF fetch and handles a timeout safely', async () => {
  const handler = createLeadHandler({
    env,
    fetchImpl: async (input, init = {}) => {
      assert.equal(String(input), 'https://school.example.test/smartchild-checklist-oge-ege-informatics.pdf');
      assert.ok(init.signal instanceof AbortSignal);
      assert.equal(init.signal.aborted, false);
      const error = new Error('simulated PDF timeout');
      error.name = 'AbortError';
      throw error;
    },
    logger: { error() {} },
  });

  const response = await handler(makeRequest());
  assert.equal(response.status, 503);
  assert.equal((await response.json()).ok, false);
});

test('applies a timeout signal to Resend and handles a timeout safely', async () => {
  let resendCalls = 0;
  const handler = createLeadHandler({
    env,
    fetchImpl: async (input, init = {}) => {
      const url = String(input);
      assert.ok(init.signal instanceof AbortSignal);
      if (url === 'https://school.example.test/smartchild-checklist-oge-ege-informatics.pdf') {
        return new Response(pdf, { status: 200 });
      }
      assert.equal(url, 'https://api.resend.com/emails');
      resendCalls += 1;
      assert.equal(init.signal.aborted, false);
      const error = new Error('simulated Resend timeout');
      error.name = 'AbortError';
      throw error;
    },
    logger: { error() {} },
  });

  const response = await handler(makeRequest());
  assert.equal(response.status, 502);
  assert.equal((await response.json()).ok, false);
  assert.equal(resendCalls, 1);
});
