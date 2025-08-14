import { sendMessage, answerCallback } from './telegramApi.js';
import { userData } from './main.js';

const cafeNames = {
  // croissant: "Круассан кафе", // скрыто по просьбе
  // porto: "Порто кофе",        // скрыто по просьбе
  kenigs: "Кенигсбеккер"
};

const ADDRESSES_KV = "sq_adresses";
const RESULTS_KV = "sq_checked";
const RESUME_KV = "sq-resume";
const USER_STATE_KV = "sq_user_state";

const GROUP_ID = "-1002607218317";
const ADMIN_IDS = ["642127857"];

// ===== helpers для состояния =====
async function saveUserState(env, userId, data) {
  await env[USER_STATE_KV].put(userId.toString(), JSON.stringify(data));
}
async function getUserState(env, userId) {
  const raw = await env[USER_STATE_KV].get(userId.toString());
  return raw ? JSON.parse(raw) : null;
}
async function clearUserState(env, userId) {
  await env[USER_STATE_KV].delete(userId.toString());
}

// ===== старт =====
export async function startFlow(chatId, env) {
  const keyboard = {
    inline_keyboard: [
      [{ text: "Хочу быть дегустатором", callback_data: "mode_candidate" }],
      ...(ADMIN_IDS.includes(chatId.toString())
        ? [[{ text: "Скорректировать места", callback_data: "mode_adjust_slots" }]]
        : [])
    ]
  };
  await sendMessage(chatId, "Выберите действие:", keyboard);
  return new Response("OK");
}

// ===== обработка кнопок =====
export async function processCallback(callbackQuery, env) {
  const { id: callbackId, from: { id: userId }, data, message } = callbackQuery;
  const chatId = message.chat.id;

  // Режим кандидата
  if (data === "mode_candidate") {
    await saveUserState(env, userId, { mode: "candidate" });
    const keyboard = {
      inline_keyboard: Object.entries(cafeNames).map(([key, name]) => [
        { text: name, callback_data: `cafe_${key}` }
      ])
    };
    await sendMessage(chatId, "Выберите сеть заведений:", keyboard);
    await answerCallback(callbackId);
    return new Response("OK");
  }

  // Режим корректировки мест (только для админов)
  if (data === "mode_adjust_slots" && ADMIN_IDS.includes(userId.toString())) {
    await saveUserState(env, userId, { mode: "adjust_slots", isAdmin: true });
    const keyboard = {
      inline_keyboard: Object.entries(cafeNames).map(([key, name]) => [
        { text: name, callback_data: `cafe_adjust_${key}` }
      ])
    };
    await sendMessage(chatId, "Выберите сеть заведений для корректировки мест:", keyboard);
    await answerCallback(callbackId);
    return new Response("OK");
  }

  // Выбор точки кандидатом
  if (data.startsWith("cafe_") && !data.startsWith("cafe_adjust_")) {
    const cafeKey = data.replace("cafe_", "");
    const pointsRaw = await env[ADDRESSES_KV].get(cafeKey);
    if (!pointsRaw) {
      await sendMessage(chatId, "Нет точек для выбранной сети.");
      await answerCallback(callbackId);
      return new Response("OK");
    }
    const points = JSON.parse(pointsRaw);
    const availablePoints = points.filter(p => (p.slots || 0) > 0);
    if (availablePoints.length === 0) {
      await sendMessage(chatId, "Нет точек для регистрации, попробуйте позже.");
      await answerCallback(callbackId);
      return new Response("OK");
    }
    await saveUserState(env, userId, { state: "awaiting_address", cafe: cafeKey });
    const keyboard = {
      inline_keyboard: availablePoints.map(p => [
        { text: p.address, callback_data: `address_${p.name}` }
      ])
    };
    await sendMessage(chatId, "Выберите точку:", keyboard);
    await answerCallback(callbackId);
    return new Response("OK");
  }

  // Выбор точки для корректировки
  if (data.startsWith("cafe_adjust_")) {
    const cafeKey = data.replace("cafe_adjust_", "");
    const pointsRaw = await env[ADDRESSES_KV].get(cafeKey);
    if (!pointsRaw) {
      await sendMessage(chatId, "Нет точек для выбранной сети.");
      await answerCallback(callbackId);
      return new Response("OK");
    }
    let points;
    try {
      points = JSON.parse(pointsRaw);
    } catch {
      await sendMessage(chatId, "Ошибка обработки данных сети.");
      await answerCallback(callbackId);
      return new Response("OK");
    }
    await saveUserState(env, userId, { state: "awaiting_adjust_address", cafe: cafeKey, points, isAdmin: true });
    const keyboard = {
      inline_keyboard: points.map(p => [
        { text: p.address, callback_data: `adjust_address_${p.name}` }
      ])
    };
    await sendMessage(chatId, "Выберите точку для корректировки мест:", keyboard);
    await answerCallback(callbackId);
    return new Response("OK");
  }

  // Кнопка возврата
  if (data === "back_to_cafes") {
    const user = await getUserState(env, userId) || {};
    await saveUserState(env, userId, { mode: user.mode });
    const keyboard = {
      inline_keyboard: Object.entries(cafeNames).map(([key, name]) => [
        { text: name, callback_data: `cafe_${key}` }
      ])
    };
    await sendMessage(chatId, "Выберите заведение:", keyboard);
    await answerCallback(callbackId);
    return new Response("OK");
  }

  // Выбор точки кандидатом (адрес)
  if (data.startsWith("address_")) {
    const pointName = data.replace("address_", "");
    const user = await getUserState(env, userId);
    if (!user || user.state !== "awaiting_address") {
      await sendMessage(chatId, "Бот предназначен для тайных дегустаторов.\n\nДля начала введите /start");
      await answerCallback(callbackId);
      return new Response("OK");
    }
    const pointsRaw = await env[ADDRESSES_KV].get(user.cafe);
    if (!pointsRaw) {
      await sendMessage(chatId, "Ошибка: данные сети не найдены.");
      await answerCallback(callbackId);
      return new Response("OK");
    }
    const points = JSON.parse(pointsRaw);
    const point = points.find(p => p.name === pointName);
    if (!point || (point.slots || 0) <= 0) {
      await sendMessage(chatId, "Эта точка уже занята.");
      await answerCallback(callbackId);
      return new Response("OK");
    }
    await saveUserState(env, userId, { ...user, address: point.address, pointName, state: "awaiting_name" });
    const keyboard = {
      inline_keyboard: [[{ text: "Вернуться к списку", callback_data: "back_to_cafes" }]]
    };
    await sendMessage(chatId, `Адрес точки: ${point.address}\n\nВведите фамилию и имя через пробел:`, keyboard);
    await answerCallback(callbackId);
    return new Response("OK");
  }

  // Выбор точки для корректировки (новое количество мест)
  if (data.startsWith("adjust_address_")) {
    const pointName = data.replace("adjust_address_", "");
    const user = await getUserState(env, userId);
    if (!user || user.state !== "awaiting_adjust_address" || !user.isAdmin) {
      await sendMessage(chatId, "У вас нет прав для этой операции.");
      await answerCallback(callbackId);
      return new Response("OK");
    }
    const point = user.points.find(p => p.name === pointName);
    if (!point) {
      await sendMessage(chatId, "Точка не найдена.");
      await answerCallback(callbackId);
      return new Response("OK");
    }
    await saveUserState(env, userId, { ...user, pointName, address: point.address, state: "awaiting_adjust_slots" });
    await sendMessage(chatId, `Текущее количество мест: ${point.slots || 0}\n\nВведите новое количество мест:`);
    await answerCallback(callbackId);
    return new Response("OK");
  }

  await answerCallback(callbackId);
  return new Response("OK");
}

// ===== обработка текстовых сообщений =====
export async function processNameInput(message, env) {
  const { from: { id: userId }, text, chat: { id: chatId }, contact } = message;

  if (text === "/start") {
    await clearUserState(env, userId);
    return startFlow(chatId, env);
  }

  const user = await getUserState(env, userId);
  if (!user) {
    await sendMessage(chatId, "Бот предназначен для тайных дегустаторов.\n\nДля начала введите /start");
    return new Response("OK");
  }

  // Ввод имени
  if (user.state === "awaiting_name") {
    if (!text || text.trim().split(" ").length < 2) {
      await sendMessage(chatId, "Введите фамилию и имя через пробел:");
      return new Response("OK");
    }
    await saveUserState(env, userId, { ...user, name: text.trim(), state: "awaiting_phone" });
    await sendMessage(chatId, "Отправьте номер телефона (кнопкой 'Отправить номер' или вручную в формате +7...)");
    return new Response("OK");
  }

  // Ввод телефона
  if (user.state === "awaiting_phone") {
    let phone = text;
    if (contact && contact.phone_number) {
      phone = contact.phone_number;
    }
    if (!phone || !phone.match(/^\+?\d{10,15}$/)) {
      await sendMessage(chatId, "Введите корректный номер телефона (в формате +7...)");
      return new Response("OK");
    }

    // Сохраняем результат
    const pointsRaw = await env[ADDRESSES_KV].get(user.cafe);
    const points = JSON.parse(pointsRaw);
    const point = points.find(p => p.name === user.pointName);
    if (point && (point.slots || 0) > 0) {
      point.slots -= 1;
      await env[ADDRESSES_KV].put(user.cafe, JSON.stringify(points));
    }

    const result = {
      name: user.name,
      phone: phone,
      cafe: user.cafe,
      address: user.address
    };
    await env[RESULTS_KV].put(`${userId}_${Date.now()}`, JSON.stringify(result));

    await sendMessage(chatId, "Спасибо, ваша заявка принята!");
    await sendMessage(GROUP_ID, `Новая заявка:\nИмя: ${result.name}\nТелефон: ${result.phone}\nСеть: ${cafeNames[result.cafe]}\nАдрес: ${result.address}`);

    await clearUserState(env, userId);
    return new Response("OK");
  }

  // Корректировка мест админом
  if (user.state === "awaiting_adjust_slots" && user.isAdmin) {
    const newSlots = parseInt(text, 10);
    if (isNaN(newSlots)) {
      await sendMessage(chatId, "Пожалуйста, введите корректное число.");
      return new Response("OK");
    }
    try {
      const pointsRaw = await env[ADDRESSES_KV].get(user.cafe);
      if (!pointsRaw) throw new Error("Ошибка: данные сети не найдены.");
      const points = JSON.parse(pointsRaw);
      const point = points.find(p => p.name === user.pointName);
      if (!point) throw new Error("Ошибка: точка не найдена.");
      point.slots = newSlots;
      await env[ADDRESSES_KV].put(user.cafe, JSON.stringify(points));
      await sendMessage(chatId, "Спасибо, места скорректированы");
      await sendMessage(GROUP_ID, `Скорректированы места\n\nСеть: ${cafeNames[user.cafe]}\nАдрес: ${user.address}\nТекущее количество мест: ${point.slots}`);
    } catch (e) {
      await sendMessage(chatId, e.message || "Ошибка при сохранении.");
    }
    await clearUserState(env, userId);
    return new Response("OK");
  }

  await sendMessage(chatId, "Неизвестная команда. Попробуйте /start.");
  return new Response("OK");
}