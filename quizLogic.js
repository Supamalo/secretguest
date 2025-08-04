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
    // Получаем адреса из KV
    const addressesRaw = await env[ADDRESSES_KV].get(cafeKey);
    if (!addressesRaw) {
      await sendMessage(chatId, "Нет адресов для выбранного заведения.");
      await answerCallback(callbackId);
      return new Response('OK', { status: 200 });
    }
    const addresses = JSON.parse(addressesRaw);
    userData.set(userId, { state: "awaiting_address", cafe: cafeKey });
    const keyboard = {
      inline_keyboard: addresses.map(addr => [
        { text: addr, callback_data: `address_${addr}` }
      ])
    };
    await sendMessage(chatId, "Выберите точку:", keyboard);
    await answerCallback(callbackId);
    return new Response('OK', { status: 200 });
  }

  if (data.startsWith("address_")) {
    const address = data.replace("address_", "");
    const user = userData.get(userId);
    if (!user || user.state !== "awaiting_address") {
      await sendMessage(chatId, "Пожалуйста, начните с /start.");
      await answerCallback(callbackId);
      return new Response('OK', { status: 200 });
    }
    userData.set(userId, { ...user, address, state: "awaiting_name" });
    await sendMessage(chatId, "Введите фамилию и имя через пробел:");
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
  const result = {
    telegramId: userId,
    username: message.from.username || '',
    firstName,
    lastName,
    cafe: cafeNames[user.cafe],
    address: user.address,
    timestamp: new Date().toISOString()
  };
  // Сохраняем в KV
  try {
    await env[RESULTS_KV].put(`${userId}_${Date.now()}`, JSON.stringify(result));
  } catch (e) {
    // ignore
  }
  // Отправляем в канал
  const msg = `Новая заявка:\n${lastName} ${firstName}\n${cafeNames[user.cafe]}\n${user.address}`;
  await sendMessage(GROUP_ID, msg);
  await sendMessage(chatId, "Спасибо! Ваши данные отправлены.");
  userData.delete(userId);
  return new Response('OK', { status: 200 });
}