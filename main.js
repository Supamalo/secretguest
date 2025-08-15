import { startFlow, processCallback, processNameInput } from './formLogic.js';

async function handleRequest(request, env) {
  if (request.method === 'POST') {
    const data = await request.json();
    const { message, callback_query } = data;
    if (message && message.text === '/start') {
      return await startFlow(message.chat.id, env);
    } else if (message && (message.text || message.contact)) {
      // Всегда пробуем обработать текстовое сообщение через processNameInput
      return await processNameInput(message, env);
    } else if (callback_query && callback_query.data) {
      return await processCallback(callback_query, env);
    }
  }
  return new Response('OK', { status: 200 });
}

export default {
  fetch: handleRequest,
};

export const userData = new Map();
