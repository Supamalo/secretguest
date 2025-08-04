import { sendMessage, answerCallback } from './telegramApi.js';
import { userData } from './main.js';

const cafeNames = {
  croissant: "Круассан кафе",
  porto: "Порто кофе",
  kenigs: "Кенигсбеккер"
};

const ADDRESSES_KV = "sq_adresses";
const RESULTS_KV = "sq_checked";
const GROUP_ID = "-1002607218317"; // заменить на ваш id

export async function startFlow(chatId, env) {
  const keyboard = {
    inline_keyboard: Object.entries(cafeNames).map(([key, name]) => [
      { text: name, callback_data: `cafe_${key}` }
    ])
  };
  await sendMessage(chatId, "Выберите заведение:", keyboard);
  return new Response('OK', { status: 200 });
}

export async function processCallback(callbackQuery, env) {
  const { id: callbackId, from: { id: userId }, data, message } = callbackQuery;
  const chatId = message.chat.id;

  if (data.startsWith("cafe_")) {
    const cafeKey = data.replace("cafe_", "");
    // Получаем точки из KV
    const pointsRaw = await env[ADDRESSES_KV].get(cafeKey);
    if (!pointsRaw) {
      await sendMessage(chatId, "Нет точек для выбранного заведения.");
      await answerCallback(callbackId);
      return new Response('OK', { status: 200 });
    }
    const points = JSON.parse(pointsRaw); // [{ name, address }]
    userData.set(userId, { state: "awaiting_address", cafe: cafeKey, points });
    const keyboard = {
      inline_keyboard: points.map(point => [
        { text: point.name, callback_data: `address_${point.name}` }
      ])
    };
    await sendMessage(chatId, "Выберите точку:", keyboard);
    await answerCallback(callbackId);
    return new Response('OK', { status: 200 });
  }

  if (data.startsWith("address_")) {
    const pointName = data.replace("address_", "");
    const user = userData.get(userId);
    if (!user || user.state !== "awaiting_address") {
      await sendMessage(chatId, "Пожалуйста, начните с /start.");
      await answerCallback(callbackId);
      return new Response('OK', { status: 200 });
    }
    // Найти адрес по имени точки
    const point = (user.points || []).find(p => p.name === pointName);
    if (!point) {
      await sendMessage(chatId, "Точка не найдена.");
      await answerCallback(callbackId);
      return new Response('OK', { status: 200 });
    }
    userData.set(userId, { ...user, address: point.address, pointName, state: "awaiting_name" });
    await sendMessage(chatId, `Адрес точки: ${point.address}\n\nВведите фамилию и имя через пробел:`);
    await answerCallback(callbackId);
    return new Response('OK', { status: 200 });
  }

  await answerCallback(callbackId);
  return new Response('OK', { status: 200 });
}

export async function processNameInput(message, env) {
  const { from: { id: userId }, text, chat: { id: chatId } } = message;
  const user = userData.get(userId);
  if (!user || user.state !== "awaiting_name") {
    await sendMessage(chatId, "Пожалуйста, начните с /start.");
    return new Response('OK', { status: 200 });
  }
  const nameParts = text.trim().split(/\s+/);
  if (nameParts.length < 2) {
    await sendMessage(chatId, "Пожалуйста, укажите фамилию и имя через пробел.");
    return new Response('OK', { status: 200 });
  }
  const lastName = nameParts[0];
  const firstName = nameParts.slice(1).join(' ');
  const now = new Date();
  const result = {
    telegramId: userId,
    username: message.from.username || '',
    firstName,
    lastName,
    cafe: cafeNames[user.cafe],
    address: user.address,
    timestamp: now.toISOString(),
    date: `${now.getDate().toString().padStart(2, '0')}.${(now.getMonth()+1).toString().padStart(2, '0')}.${now.getFullYear()}`
  };
  // Сохраняем в KV
  try {
    await env[RESULTS_KV].put(`${userId}_${Date.now()}`, JSON.stringify(result));
  } catch (e) {
    // ignore
  }
  // Отправляем в канал
  const msg = `Точка проверена\n\nТайный гость: ${lastName} ${firstName}\nСеть: ${cafeNames[user.cafe]}\nАдрес: ${user.address}`;
  await sendMessage(GROUP_ID, msg);
  await sendMessage(chatId, "Спасибо! Ваши данные отправлены.");
  userData.delete(userId);
  return new Response('OK', { status: 200 });
}




