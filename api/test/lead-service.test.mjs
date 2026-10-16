import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { processLead, isValidEmail } from '../src/lead-service.mjs';

const env = {
  SMTP_HOST: 'smtp.example.test', SMTP_PORT: '465', SMTP_USER: 'sender@example.test',
  SMTP_PASS: 'test-only-placeholder-not-a-real-secret', FROM_EMAIL: 'sender@example.test',
  NOTIFY_EMAIL: 'owner@example.test', CHECKLIST_PATH: '/fake/checklist.pdf',
};

 test('validates email shape', () => {
  assert.equal(isValidEmail('student@example.com'), true);
  assert.equal(isValidEmail('bad-address'), false);
  assert.equal(isValidEmail(''), false);
  assert.equal(isValidEmail('x'.repeat(255) + '@example.com'), false);
});

test('rejects invalid email without sending mail', async () => {
  let sends = 0;
  const result = await processLead({ email: 'invalid', env, sendMail: async () => sends++, fileAccess: async () => {} });
  assert.equal(result.status, 400);
  assert.equal(sends, 0);
});

test('fails closed when SMTP configuration is missing', async () => {
  let sends = 0;
  const result = await processLead({ email: 'student@example.com', env: {}, sendMail: async () => sends++, fileAccess: async () => {} });
  assert.equal(result.status, 503);
  assert.equal(sends, 0);
});

test('does not send when PDF is missing', async () => {
  let sends = 0;
  const result = await processLead({ email: 'student@example.com', env, sendMail: async () => sends++, fileAccess: async () => { throw new Error('missing'); } });
  assert.equal(result.status, 503);
  assert.equal(sends, 0);
});

test('sends visitor PDF first and owner notification second', async () => {
  const sent = [];
  const result = await processLead({ email: ' Student@Example.com ', env, sendMail: async (message) => sent.push(message), fileAccess: async () => {} });
  assert.equal(result.status, 200);
  assert.equal(sent.length, 2);
  assert.equal(sent[0].to, 'student@example.com');
  assert.equal(sent[0].attachments[0].contentType, 'application/pdf');
  assert.equal(sent[1].to, 'owner@example.test');
});

test('resolves relative checklist paths from the api directory', async () => {
  const repoRoot = resolve(fileURLToPath(new URL('../../', import.meta.url)));
  const relativeEnv = {
    ...env,
    CHECKLIST_PATH: '../public/smartchild-checklist-oge-ege-informatics.pdf',
  };
  let checkedPath;
  let sentMessages = [];

  const result = await processLead({
    email: 'student@example.com',
    env: relativeEnv,
    fileAccess: async (path) => { checkedPath = path; },
    sendMail: async (message) => { sentMessages.push(message); },
  });

  const expectedPath = resolve(repoRoot, 'public/smartchild-checklist-oge-ege-informatics.pdf');
  assert.equal(checkedPath, expectedPath);
  assert.equal(sentMessages[0].attachments[0].path, expectedPath);
  assert.equal(result.status, 200);
});

test('returns 502 if the visitor email cannot be sent', async () => {
  let sends = 0;
  const originalError = console.error;
  console.error = () => {};
  try {
    const result = await processLead({
      email: 'student@example.com',
      env,
      sendMail: async () => {
        sends += 1;
        throw new Error('smtp failed');
      },
      fileAccess: async () => {},
    });
    assert.equal(result.status, 502);
    assert.equal(result.body.ok, false);
    assert.equal(sends, 1);
  } finally {
    console.error = originalError;
  }
});

test('does not report delivery failure if only the owner notification fails', async () => {
  let sends = 0;
  const logs = [];
  const originalError = console.error;
  console.error = (...args) => logs.push(args);
  try {
    const result = await processLead({
      email: 'student@example.com',
      env,
      sendMail: async () => {
        sends += 1;
        if (sends === 2) throw new Error('notification failed');
      },
      fileAccess: async () => {},
    });

    assert.equal(sends, 2);
    assert.equal(result.status, 200);
    assert.equal(result.body.ok, true);
    assert.match(result.body.message, /письмо с материалом скоро поступит/i);
    assert.equal(logs.length, 1);
    assert.equal(logs[0][0], 'Lead owner notification failed:');
    assert.equal(logs[0][1], 'Error');
    assert.equal(JSON.stringify(logs).includes('student@example.com'), false);
  } finally {
    console.error = originalError;
  }
});
