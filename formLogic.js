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

const GROUP_ID = "-1002607218317";
const ADMIN_IDS = ["642127857","6062747639"];

// ===== helpers для состояния =====
// Удалено: состояние пользователя не сохраняется в KV

// ===== старт =====
export async function startFlow(chatId, env) {
  // Сохраняем пустое состояние пользователя при старте
  userData.set(chatId, {});
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
    userData.set(userId, { mode: "candidate" });
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
    userData.set(userId, { mode: "adjust_slots", isAdmin: true });
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
    // Сохраняем состояние только в памяти, если нужно
    userData.set(userId, { state: "awaiting_address", cafe: cafeKey });
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
    // Сохраняем состояние только в памяти, если нужно
    userData.set(userId, { state: "awaiting_adjust_address", cafe: cafeKey, isAdmin: ADMIN_IDS.includes(userId.toString()) });
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
    const user = userData.get(userId) || {};
    userData.set(userId, { mode: user.mode });
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
    const user = userData.get(userId);
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
    userData.set(userId, { ...user, address: point.address, pointName, state: "awaiting_name" });
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
    const user = userData.get(userId);
    if (!user || user.state !== "awaiting_adjust_address" || !user.isAdmin) {
      await sendMessage(chatId, "У вас нет прав для этой операции.");
      await answerCallback(callbackId);
      return new Response("OK");
    }
    // Получаем актуальный список точек из KV
    const pointsRaw = await env[ADDRESSES_KV].get(user.cafe);
    let points = pointsRaw ? JSON.parse(pointsRaw) : [];
    const point = points.find(p => p.name === pointName);
    if (!point) {
      await sendMessage(chatId, "Точка не найдена.");
      await answerCallback(callbackId);
      return new Response("OK");
    }
    userData.set(userId, { ...user, pointName, address: point.address, state: "awaiting_adjust_slots", isAdmin: ADMIN_IDS.includes(userId.toString()) });
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

  const user = userData.get(userId);
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
    userData.set(userId, { ...user, name: text.trim(), state: "awaiting_phone" });
    // Добавляем кнопку "Отправить номер"
    const keyboard = {
      keyboard: [
        [{ text: "Отправить номер", request_contact: true }]
      ],
      resize_keyboard: true,
      one_time_keyboard: true
    };
    await sendMessage(chatId, "Отправьте номер телефона (кнопкой 'Отправить номер' или вручную в формате +7...)", keyboard);
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

    // Получаем username
    const username = message.from && message.from.username ? message.from.username : null;

    const result = {
      name: user.name,
      phone: phone,
      cafe: user.cafe,
      address: user.address,
      username: username
    };
    await env[RESULTS_KV].put(`${userId}_${Date.now()}`, JSON.stringify(result));

    await sendMessage(chatId, "Спасибо, ваша заявка принята!");
    // Формируем сообщение для канала с username (только если есть)
    let channelMsg = `Заявка на проверку:\n\nКандидат: ${result.name}`;
    if (result.username) {
      channelMsg += `\nUsername: @${result.username}`;
    }
    channelMsg += `\nТелефон: ${result.phone}\nСеть: ${cafeNames[result.cafe]}\nАдрес: ${result.address}`;
    await sendMessage(GROUP_ID, channelMsg);

    userData.delete(userId);
    return new Response("OK");
  }

  // Корректировка мест админом
  if (user.state === "awaiting_adjust_slots" && user.isAdmin) {
    const newSlots = parseInt(text, 10);
    if (isNaN(newSlots) || newSlots < 0) {
      await sendMessage(chatId, "Введите корректное число мест:");
      return new Response("OK");
    }
    try {
      // Получаем актуальный список точек из KV
      const pointsRaw = await env[ADDRESSES_KV].get(user.cafe);
      let points = pointsRaw ? JSON.parse(pointsRaw) : [];
      // Находим нужную точку
      const idx = points.findIndex(p => p.name === user.pointName);
      if (idx === -1) {
        await sendMessage(chatId, "Точка не найдена.");
        userData.delete(userId);
        return new Response("OK");
      }
      points[idx].slots = newSlots;
      await env[ADDRESSES_KV].put(user.cafe, JSON.stringify(points));
      await sendMessage(chatId, `Спасибо, места скорректированы. Текущее количество мест: ${newSlots}`);

      // Получаем username для админского сообщения
      const username = message.from && message.from.username ? message.from.username : null;
      let adminMsg = `Скорректированы места\n\n`;
      if (username) {
        adminMsg += `Username: @${username}\n\n`;
      }
      adminMsg += `Сеть: ${cafeNames[user.cafe]}\nАдрес: ${points[idx].address}\nТекущее количество мест: ${newSlots}`;
      await sendMessage(GROUP_ID, adminMsg);

    } catch (e) {
      await sendMessage(chatId, e.message || "Ошибка при сохранении.");
    }
    userData.delete(userId);
    return new Response("OK");
  }

  await sendMessage(chatId, "Неизвестная команда. Попробуйте /start.");
  return new Response("OK");
}

