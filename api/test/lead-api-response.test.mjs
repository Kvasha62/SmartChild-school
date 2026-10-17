import test from 'node:test';
import assert from 'node:assert/strict';
import { readLeadApiResponse } from '../../src/lib/lead-api-response.mjs';

function response({ status = 200, ok = true, json }) {
  return {
    status,
    ok,
    json: json ?? (async () => ({ ok: true, message: 'Проверьте почту.' })),
  };
}

test('accepts a successful JSON response', async () => {
  const result = await readLeadApiResponse(response({}));

  assert.equal(result.ok, true);
  assert.equal(result.message, 'Проверьте почту.');
});

test('shows a friendly error when a proxy returns HTML instead of JSON', async () => {
  const htmlResponse = response({
    status: 502,
    ok: false,
    json: async () => {
      throw new SyntaxError('Unexpected token <');
    },
  });

  await assert.rejects(
    readLeadApiResponse(htmlResponse),
    { message: 'Сервис временно недоступен. Попробуйте позже.' },
  );
});

test('shows a specific message for HTTP 429 without parsing the body', async () => {
  let jsonCalled = false;
  const limitedResponse = response({
    status: 429,
    ok: false,
    json: async () => {
      jsonCalled = true;
      throw new Error('Body should not be parsed');
    },
  });

  await assert.rejects(
    readLeadApiResponse(limitedResponse),
    { message: 'Слишком много запросов. Попробуйте позже.' },
  );
  assert.equal(jsonCalled, false);
});

test('preserves a safe API error returned as JSON', async () => {
  const failedResponse = response({
    status: 503,
    ok: false,
    json: async () => ({
      ok: false,
      error: 'Сервис временно недоступен.',
    }),
  });

  await assert.rejects(
    readLeadApiResponse(failedResponse),
    { message: 'Сервис временно недоступен.' },
  );
});

test('rejects a successful HTTP response with an invalid payload shape', async () => {
  const invalidResponse = response({
    json: async () => ({ message: 'No ok field' }),
  });

  await assert.rejects(
    readLeadApiResponse(invalidResponse),
    { message: 'Не удалось отправить запрос.' },
  );
});
