import { access, constants } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const API_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function isValidEmail(value) {
  if (typeof value !== 'string' || value.length > 254) return false;
  // Deliberately modest validation; the mail provider remains the final authority.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export async function processLead({ email, env, sendMail, fileAccess = access }) {
  const recipient = typeof email === 'string' ? email.trim().toLowerCase() : '';
  if (!isValidEmail(recipient)) {
    return { status: 400, body: { ok: false, error: 'Введите корректный адрес электронной почты.' } };
  }

  const required = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'FROM_EMAIL', 'NOTIFY_EMAIL', 'CHECKLIST_PATH'];
  const missing = required.filter((key) => !env[key]);
  if (missing.length) {
    return { status: 503, body: { ok: false, error: 'Форма временно не настроена. Попробуйте позже.' } };
  }

  // Relative CHECKLIST_PATH values are resolved from the api/ directory,
  // regardless of the process's current working directory.
  const checklistPath = resolve(API_DIR, env.CHECKLIST_PATH);

  try {
    await fileAccess(checklistPath, constants.R_OK);
  } catch {
    return { status: 503, body: { ok: false, error: 'Чек-лист пока готовится. Попробуйте позже.' } };
  }

  try {
    await sendMail({
      from: env.FROM_EMAIL,
      to: recipient,
      subject: 'Ваш чек-лист подготовки к ОГЭ и ЕГЭ по информатике',
      text: 'Здравствуйте! Во вложении — чек-лист подготовки к ОГЭ и ЕГЭ по информатике. Успехов в подготовке!\n\nSmartChild',
      attachments: [{ filename: 'smartchild-checklist-oge-ege-informatics.pdf', path: checklistPath, contentType: 'application/pdf' }],
    });
  } catch (error) {
    // The visitor email was not accepted; do not claim the request succeeded.
    console.error('Lead email delivery failed:', error?.code || error?.name || 'unknown error');
    return { status: 502, body: { ok: false, error: 'Не удалось отправить письмо. Попробуйте позже.' } };
  }

  try {
    await sendMail({
      from: env.FROM_EMAIL,
      to: env.NOTIFY_EMAIL,
      subject: 'Новая заявка на чек-лист SmartChild',
      text: `Новый запрос чек-листа. Email посетителя: ${recipient}`,
    });
  } catch (error) {
    // The visitor email was already accepted. Avoid encouraging a duplicate retry.
    // This logs only a safe error identifier, never the address or full SMTP error.
    console.error('Lead owner notification failed:', error?.code || error?.name || 'unknown error');
  }

  return {
    status: 200,
    body: {
      ok: true,
      message: 'Запрос принят. Если адрес указан верно, письмо с материалом скоро поступит на почту.',
    },
  };
}
