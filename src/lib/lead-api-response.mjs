/**
 * Parse the lead API response and convert expected failures into
 * user-friendly messages.
 *
 * @param {{ status: number, ok: boolean, json: () => Promise<unknown> }} response
 */
export async function readLeadApiResponse(response) {
  if (response.status === 429) {
    throw new Error('Слишком много запросов. Попробуйте позже.');
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error('Сервис временно недоступен. Попробуйте позже.');
  }

  if (
    !response.ok ||
    !payload ||
    typeof payload !== 'object' ||
    !('ok' in payload) ||
    payload.ok !== true
  ) {
    const message =
      payload &&
      typeof payload === 'object' &&
      'error' in payload &&
      typeof payload.error === 'string'
        ? payload.error
        : 'Не удалось отправить запрос.';

    throw new Error(message);
  }

  return /** @type {{ ok: true, message?: string }} */ (payload);
}
