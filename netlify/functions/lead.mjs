const MAX_BODY_BYTES = 4096;
const PDF_PATH = '/smartchild-checklist-oge-ege-informatics.pdf';
const PDF_FILENAME = 'smartchild-checklist-oge-ege-informatics.pdf';
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const MAX_REQUESTS_PER_WINDOW = 5;
const MAX_RATE_LIMIT_BUCKETS = 1000;
const EXTERNAL_REQUEST_TIMEOUT_MS = 8000;

// Best-effort per-function-instance protection only. Netlify may run several
// instances, so a shared WAF/edge rate limit is still required for production.
function isRateLimited(buckets, clientIp, now = Date.now()) {
  const previous = buckets.get(clientIp);
  if (previous && now - previous.start < RATE_LIMIT_WINDOW_MS) {
    previous.count += 1;
    return previous.count > MAX_REQUESTS_PER_WINDOW;
  }

  for (const [key, value] of buckets) {
    if (now - value.start >= RATE_LIMIT_WINDOW_MS) buckets.delete(key);
  }
  if (buckets.size >= MAX_RATE_LIMIT_BUCKETS) {
    const oldestKey = buckets.keys().next().value;
    if (oldestKey !== undefined) buckets.delete(oldestKey);
  }
  buckets.set(clientIp, { start: now, count: 1 });
  return false;
}

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}

function validEmail(value) {
  if (typeof value !== 'string' || value.length > 254) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

async function sendResend({ fetchImpl, apiKey, message, signal }) {
  const response = await fetchImpl('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(message),
    signal,
  });

  if (!response.ok) {
    // Do not log provider response bodies, which may contain personal data.
    throw Object.assign(new Error('Resend request failed'), {
      providerStatus: response.status,
    });
  }
}

export function createLeadHandler({
  env = process.env,
  fetchImpl = fetch,
  logger = console,
} = {}) {
  const rateLimitBuckets = new Map();

  return async function handleLead(request) {
    if (request.method !== 'POST') {
      return json(405, { ok: false, error: 'Метод не поддерживается.' });
    }

    const requestUrl = new URL(request.url);
    const origin = request.headers.get('origin');
    if (origin && origin !== requestUrl.origin) {
      return json(403, { ok: false, error: 'Запрос отклонён.' });
    }

    const contentType = (request.headers.get('content-type') || '').toLowerCase();
    if (!/^application\/json(?:\s*;|\s*$)/.test(contentType)) {
      return json(415, { ok: false, error: 'Ожидается JSON-запрос.' });
    }

    // Netlify supplies this value from the client connection.
    const clientIp = request.headers.get('x-nf-client-connection-ip') || 'unknown';
    if (isRateLimited(rateLimitBuckets, clientIp)) {
      return new Response(JSON.stringify({
        ok: false,
        error: 'Слишком много попыток. Попробуйте через 15 минут.',
      }), {
        status: 429,
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store',
          'x-content-type-options': 'nosniff',
          'retry-after': String(RATE_LIMIT_WINDOW_MS / 1000),
        },
      });
    }

    const declaredLength = Number(request.headers.get('content-length') || 0);
    if (declaredLength > MAX_BODY_BYTES) {
      return json(413, { ok: false, error: 'Запрос слишком большой.' });
    }

    let rawBody;
    try {
      rawBody = await request.text();
    } catch {
      return json(400, { ok: false, error: 'Некорректные данные.' });
    }

    if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
      return json(413, { ok: false, error: 'Запрос слишком большой.' });
    }

    let body;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return json(400, { ok: false, error: 'Некорректные данные.' });
    }

    const recipient = typeof body?.email === 'string'
      ? body.email.trim().toLowerCase()
      : '';

    if (!validEmail(recipient)) {
      return json(400, {
        ok: false,
        error: 'Введите корректный адрес электронной почты.',
      });
    }

    const missing = ['RESEND_API_KEY', 'FROM_EMAIL', 'NOTIFY_EMAIL']
      .filter((key) => !env[key]);

    if (missing.length) {
      return json(503, {
        ok: false,
        error: 'Форма временно не настроена. Попробуйте позже.',
      });
    }

    // Netlify's URL is preferred; PUBLIC_SITE_URL can explicitly override it.
    // The resulting URL must point to the deployed static PDF.
    let siteUrl;
    try {
      siteUrl = new URL(env.PUBLIC_SITE_URL || env.URL || requestUrl.origin);
      if (!['http:', 'https:'].includes(siteUrl.protocol)) throw new Error();
    } catch {
      return json(503, {
        ok: false,
        error: 'Материал временно недоступен. Попробуйте позже.',
      });
    }

    let pdfBytes;
    try {
      const pdfUrl = new URL(PDF_PATH, siteUrl);
      const pdfResponse = await fetchImpl(pdfUrl, {
        signal: AbortSignal.timeout(EXTERNAL_REQUEST_TIMEOUT_MS),
      });
      if (!pdfResponse.ok) throw new Error('PDF fetch failed');

      pdfBytes = Buffer.from(await pdfResponse.arrayBuffer());
      if (
        pdfBytes.length === 0 ||
        pdfBytes.length > 2 * 1024 * 1024 ||
        pdfBytes.subarray(0, 5).toString('ascii') !== '%PDF-'
      ) {
        throw new Error('Invalid PDF');
      }
    } catch {
      return json(503, {
        ok: false,
        error: 'Чек-лист пока недоступен. Попробуйте позже.',
      });
    }

    const apiKey = env.RESEND_API_KEY;
    const attachment = {
      filename: PDF_FILENAME,
      content: pdfBytes.toString('base64'),
    };

    try {
      await sendResend({
        fetchImpl,
        apiKey,
        signal: AbortSignal.timeout(EXTERNAL_REQUEST_TIMEOUT_MS),
        message: {
          from: env.FROM_EMAIL,
          to: [recipient],
          subject: 'Ваш чек-лист подготовки к ОГЭ и ЕГЭ по информатике',
          text: 'Здравствуйте! Во вложении — чек-лист подготовки к ОГЭ и ЕГЭ по информатике. Успехов в подготовке!\n\nSmartChild',
          attachments: [attachment],
        },
      });
    } catch (error) {
      logger.error(
        'Lead email delivery failed:',
        error?.providerStatus ? `HTTP ${error.providerStatus}` : 'provider error',
      );
      return json(502, {
        ok: false,
        error: 'Не удалось отправить письмо. Попробуйте позже.',
      });
    }

    try {
      await sendResend({
        fetchImpl,
        apiKey,
        signal: AbortSignal.timeout(EXTERNAL_REQUEST_TIMEOUT_MS),
        message: {
          from: env.FROM_EMAIL,
          to: [env.NOTIFY_EMAIL],
          subject: 'Новая заявка на чек-лист SmartChild',
          text: `Новый запрос чек-листа. Email посетителя: ${recipient}`,
        },
      });
    } catch (error) {
      // The visitor email was already accepted; don't encourage duplicate retries.
      logger.error(
        'Lead owner notification failed:',
        error?.providerStatus ? `HTTP ${error.providerStatus}` : 'provider error',
      );
    }

    return json(200, {
      ok: true,
      message: 'Запрос принят. Если адрес указан верно, письмо с материалом скоро поступит на почту.',
    });
  };
}

export const config = { path: '/api/lead' };

export default createLeadHandler();
