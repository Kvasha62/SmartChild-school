import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import 'dotenv/config';
import nodemailer from 'nodemailer';
import { processLead } from './lead-service.mjs';

const MAX_BODY_BYTES = 4096;
const WINDOW_MS = 15 * 60 * 1000;
const MAX_REQUESTS_PER_WINDOW = 5;
const MAX_BUCKETS = 10000;

function getOrigin(req) {
  return typeof req.headers.origin === 'string' ? req.headers.origin : '';
}

function sendJson(res, status, body, origin = '') {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...(origin ? { 'access-control-allow-origin': origin, vary: 'Origin' } : {}),
  });
  res.end(JSON.stringify(body));
}

function allowedOrigin(origin, env) {
  if (!origin) return true; // permits local curl and server-side tests
  return (env.ALLOWED_ORIGINS || 'http://localhost:4321,http://127.0.0.1:4321')
    .split(',').map((item) => item.trim()).includes(origin);
}

function rateLimited(buckets, ip, now = Date.now()) {
  const previous = buckets.get(ip);
  if (!previous || now - previous.start >= WINDOW_MS) {
    // Expire old entries and cap memory use when new client IPs appear.
    for (const [key, value] of buckets) {
      if (now - value.start >= WINDOW_MS) buckets.delete(key);
    }
    if (buckets.size >= MAX_BUCKETS) {
      const oldestKey = buckets.keys().next().value;
      if (oldestKey !== undefined) buckets.delete(oldestKey);
    }
    buckets.set(ip, { start: now, count: 1 });
    return false;
  }
  previous.count += 1;
  return previous.count > MAX_REQUESTS_PER_WINDOW;
}

async function readBody(req) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > MAX_BODY_BYTES) throw Object.assign(new Error('body too large'), { status: 413 });
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw Object.assign(new Error('invalid JSON'), { status: 400 }); }
}

export function createLeadServer({ env = process.env, mailer = nodemailer } = {}) {
  // Keep limits isolated per server instance (also makes tests deterministic).
  const buckets = new Map();
  return createServer(async (req, res) => {
    const origin = getOrigin(req);
    if (!allowedOrigin(origin, env)) return sendJson(res, 403, { ok: false, error: 'Запрос отклонён.' });
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'access-control-allow-origin': origin || 'null',
        'access-control-allow-methods': 'POST, OPTIONS',
        'access-control-allow-headers': 'content-type',
        'access-control-max-age': '600',
        vary: 'Origin',
      });
      return res.end();
    }
    if (req.url !== '/api/lead' || req.method !== 'POST') {
      return sendJson(res, 404, { ok: false, error: 'Маршрут не найден.' }, origin);
    }
    const contentType = String(req.headers['content-type'] || '').toLowerCase();
    if (!/^application\/json(?:\s*;|\s*$)/.test(contentType)) {
      return sendJson(res, 415, { ok: false, error: 'Ожидается JSON-запрос.' }, origin);
    }
    // Only trust X-Forwarded-For when deployment explicitly enables it and
    // the API is reachable exclusively through a trusted reverse proxy.
    const forwardedFor = env.TRUST_PROXY === 'true' ? req.headers['x-forwarded-for'] : '';
    const ip = String(forwardedFor || req.socket.remoteAddress || 'unknown').split(',')[0].trim();
    if (rateLimited(buckets, ip)) return sendJson(res, 429, { ok: false, error: 'Слишком много попыток. Попробуйте через 15 минут.' }, origin);

    let body;
    try { body = await readBody(req); }
    catch (error) { return sendJson(res, error.status || 400, { ok: false, error: error.status === 413 ? 'Запрос слишком большой.' : 'Некорректные данные.' }, origin); }

    try {
      const smtpPort = Number(env.SMTP_PORT || 465);
      const transport = mailer.createTransport({
        host: env.SMTP_HOST,
        port: smtpPort,
        secure: env.SMTP_SECURE ? env.SMTP_SECURE === 'true' : smtpPort === 465,
        auth: env.SMTP_USER && env.SMTP_PASS ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
        connectionTimeout: 10000,
        greetingTimeout: 10000,
        socketTimeout: 15000,
      });
      const result = await processLead({
        email: body?.email,
        env,
        sendMail: (message) => transport.sendMail(message),
      });
      return sendJson(res, result.status, result.body, origin);
    } catch (error) {
      // Keep provider details and credentials out of HTTP responses and logs.
      console.error('Lead API request failed:', error?.code || error?.name || 'unknown error');
      if (!res.headersSent) {
        return sendJson(res, 500, { ok: false, error: 'Внутренняя ошибка. Попробуйте позже.' }, origin);
      }
      res.destroy();
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT || 8787);
  createLeadServer().listen(port, '127.0.0.1', () => {
    console.log(`SmartChild lead API listening on http://127.0.0.1:${port}`);
    console.log('SMTP secrets are read from environment variables; never paste them into chat or commit them.');
  });
}
