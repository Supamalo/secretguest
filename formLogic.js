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
const GROUP_ID = "-1002607218317"; // заменить на ваш id
const ADMIN_IDS = ["642127857"]; // Список ID администраторов как строки

export async function startFlow(chatId, env) {
  const keyboard = {
    inline_keyboard: [
      [{ text: "Хочу быть дегустатором", callback_data: "mode_candidate" }],
      ...(ADMIN_IDS.includes(chatId.toString()) ? [[{ text: "Скорректировать места", callback_data: "mode_adjust_slots" }]] : [])
    ]
  };
  await sendMessage(chatId, "Выберите действие:", keyboard);
  return new Response('OK', { status: 200 });
}

export async function processCallback(callbackQuery, env) {
  const { id: callbackId, from: { id: userId }, data, message } = callbackQuery;
  const chatId = message.chat.id;

  if (data === "mode_candidate" || data === "mode_guest") {
    userData.set(userId, { mode: data === "mode_candidate" ? "candidate" : "guest" });
    const keyboard = {
      inline_keyboard: Object.entries(cafeNames).map(([key, name]) => [
        { text: name, callback_data: `cafe_${key}` }
      ])
    };
    await sendMessage(chatId, "Выберите сеть заведений:", keyboard);
    await answerCallback(callbackId);
    return new Response('OK', { status: 200 });
  }

  if (data === "mode_adjust_slots" && ADMIN_IDS.includes(userId.toString())) {
    userData.set(userId, { mode: "adjust_slots" });
    const keyboard = {
      inline_keyboard: Object.entries(cafeNames).map(([key, name]) => [
        { text: name, callback_data: `cafe_adjust_${key}` }
      ])
    };
    await sendMessage(chatId, "Выберите сеть заведений для корректировки мест:", keyboard);
    await answerCallback(callbackId);
    return new Response('OK', { status: 200 });
  }

  if (data.startsWith("cafe_") && !data.startsWith("cafe_adjust_")) {
    const cafeKey = data.replace("cafe_", "");
    const pointsRaw = await env[ADDRESSES_KV].get(cafeKey);
    if (!pointsRaw) {
      await sendMessage(chatId, "Нет точек для выбранной сети.");
      await answerCallback(callbackId);
      return new Response('OK', { status: 200 });
    }
    const points = JSON.parse(pointsRaw);
    const availablePoints = points.filter(point => (point.slots || 0) > 0);
    if (availablePoints.length === 0) {
      await sendMessage(chatId, "Нет точек для регистрации, попробуйте позже.");
      await answerCallback(callbackId);
      return new Response('OK', { status: 200 });
    }
    userData.set(userId, { state: "awaiting_address", cafe: cafeKey });
    const keyboard = {
      inline_keyboard: availablePoints.map(point => [
        { text: point.address, callback_data: `address_${point.name}` }
      ])
    };
    await sendMessage(chatId, "Выберите точку:", keyboard);
    await answerCallback(callbackId);
    return new Response('OK', { status: 200 });
  }

  if (data.startsWith("cafe_adjust_")) {
    const cafeKey = data.replace("cafe_adjust_", "");
    const pointsRaw = await env[ADDRESSES_KV].get(cafeKey);
    if (!pointsRaw) {
      await sendMessage(chatId, "Нет точек для выбранной сети.");
      await answerCallback(callbackId);
      return new Response('OK', { status: 200 });
    }
    let points;
    try {
      points = JSON.parse(pointsRaw);
    } catch (e) {
      await sendMessage(chatId, "Ошибка обработки данных сети.");
      await answerCallback(callbackId);
      return new Response('OK', { status: 200 });
    }
    userData.set(userId, { state: "awaiting_adjust_address", cafe: cafeKey, points });
    const keyboard = {
      inline_keyboard: points.map(point => [
        { text: point.address, callback_data: `adjust_address_${point.name}` }
      ])
    };
    await sendMessage(chatId, "Выберите точку для корректировки мест:", keyboard);
    await answerCallback(callbackId);
    return new Response('OK', { status: 200 });
  }

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
    return new Response('OK', { status: 200 });
  }

  if (data.startsWith("address_")) {
    const pointName = data.replace("address_", "");
    const user = userData.get(userId);
    if (!user || user.state !== "awaiting_address") {
      await sendMessage(chatId, "Бот предназначен для тайных дегустаторов.\n\nДля начала введите /start");
      await answerCallback(callbackId);
      return new Response('OK', { status: 200 });
    }
    const pointsRaw = await env[ADDRESSES_KV].get(user.cafe);
    if (!pointsRaw) {
      await sendMessage(chatId, "Ошибка: данные сети не найдены.");
      await answerCallback(callbackId);
      return new Response('OK', { status: 200 });
    }
    const points = JSON.parse(pointsRaw);
    const point = points.find(p => p.name === pointName);
    if (!point || (point.slots || 0) <= 0) {
      await sendMessage(chatId, "Эта точка уже занята.");
      await answerCallback(callbackId);
      return new Response('OK', { status: 200 });
    }
    userData.set(userId, { ...user, address: point.address, pointName, state: "awaiting_name" });
    const keyboard = {
      inline_keyboard: [
        [{ text: "Вернуться к списку", callback_data: "back_to_cafes" }]
      ]
    };
    await sendMessage(chatId, `Адрес точки: ${point.address}\n\nВведите фамилию и имя через пробел:`, keyboard);
    await answerCallback(callbackId);
    return new Response('OK', { status: 200 });
  }

if (data.startsWith("adjust_address_")) {
  const pointName = data.replace("adjust_address_", "");
  const user = userData.get(userId);
  if (!user || user.state !== "awaiting_adjust_address" || !ADMIN_IDS.includes(userId.toString())) {
    await sendMessage(chatId, "У вас нет прав для этой операции.");
    await answerCallback(callbackId);
    return new Response('OK', { status: 200 });
  }
  const point = user.points.find(p => p.name === pointName);
  if (!point) {
    await sendMessage(chatId, "Точка не найдена.");
    await answerCallback(callbackId);
    return new Response('OK', { status: 200 });
  }
  await sendMessage(chatId, "Debug: Point found " + JSON.stringify(point)); // Отладка
  userData.set(userId, { ...user, pointName, address: point.address, state: "awaiting_adjust_slots" });
  await sendMessage(chatId, `Текущее количество мест: ${point.slots || 0}\n\nВведите количество мест:`);
  await answerCallback(callbackId);
  return new Response('OK', { status: 200 });
}

  await answerCallback(callbackId);
  return new Response('OK', { status: 200 });
}

export async function processNameInput(message, env) {
  const { from: { id: userId }, text, chat: { id: chatId }, contact } = message;

  if (text === '/start') {
    userData.delete(userId);
    return startFlow(chatId, env);
  }

  const user = userData.get(userId);
  if (!user) {
    await sendMessage(chatId, "Бот предназначен для тайных дегустаторов.\n\nДля начала введите /start");
    return new Response('OK', { status: 200 });
  }

  if (user.state === "awaiting_name") {
    const nameParts = text.trim().split(/\s+/);
    if (nameParts.length < 2) {
      await sendMessage(chatId, "Пожалуйста, укажите фамилию и имя через пробел.");
      return new Response('OK', { status: 200 });
    }
    const lastName = nameParts[0];
    const firstName = nameParts.slice(1).join(' ');
    userData.set(userId, { ...user, lastName, firstName, state: "awaiting_phone" });
    const keyboard = {
      keyboard: [
        [{ text: "Поделиться номером", request_contact: true }]
      ],
      resize_keyboard: true,
      one_time_keyboard: true
    };
    await sendMessage(chatId, "Укажите пожалуйста номер телефона для связи (начиная с +7 или 8):", keyboard);
    return new Response('OK', { status: 200 });
  }

  if (user.state === "awaiting_phone") {
    let phone;
    if (contact && contact.phone_number) {
      phone = contact.phone_number.replace(/[\s\-()]/g, '');
      if (/^\+7\d{10}$/.test(phone)) {
      } else if (/^7\d{10}$/.test(phone)) {
        phone = '+7' + phone.slice(1);
      } else if (/^8\d{10}$/.test(phone)) {
        phone = '+7' + phone.slice(1);
      } else {
        const keyboard = {
          keyboard: [
            [{ text: "Поделиться номером", request_contact: true }]
          ],
          resize_keyboard: true,
          one_time_keyboard: true
        };
        await sendMessage(chatId, "Номер должен быть в формате +7XXXXXXXXXX или 8XXXXXXXXXX.\nПожалуйста, попробуйте еще раз:", keyboard);
        return new Response('OK', { status: 200 });
      }
    } else if (typeof text === 'string') {
      phone = text.trim().replace(/[\s\-()]/g, '');
      if (/^\+7\d{10}$/.test(phone)) {
      } else if (/^8\d{10}$/.test(phone)) {
        phone = '+7' + phone.slice(1);
      } else {
        const keyboard = {
          keyboard: [
            [{ text: "Поделиться номером", request_contact: true }]
          ],
          resize_keyboard: true,
          one_time_keyboard: true
        };
        await sendMessage(chatId, "Номер должен быть в формате +7XXXXXXXXXX или 8XXXXXXXXXX.\nПожалуйста, попробуйте еще раз:", keyboard);
        return new Response('OK', { status: 200 });
      }
    } else {
      const keyboard = {
        keyboard: [
          [{ text: "Поделиться номером", request_contact: true }]
        ],
        resize_keyboard: true,
        one_time_keyboard: true
      };
      await sendMessage(chatId, "Пожалуйста, отправьте номер телефона или поделитесь контактом.", keyboard);
      return new Response('OK', { status: 200 });
    }
    const now = new Date();
    const dateStr = `${now.getDate().toString().padStart(2, '0')}.${(now.getMonth() + 1).toString().padStart(2, '0')}.${now.getFullYear()}`;
    const result = {
      telegramId: userId,
      username: message.from.username || '',
      firstName: user.firstName,
      lastName: user.lastName,
      phone,
      cafe: cafeNames[user.cafe],
      address: user.address,
      timestamp: now.toISOString(),
      date: dateStr
    };
    try {
      if (user.mode === "candidate") {
        const pointsRaw = await env[ADDRESSES_KV].get(user.cafe);
        if (pointsRaw) {
          const points = JSON.parse(pointsRaw);
          const point = points.find(p => p.name === user.pointName);
          if (point && (point.slots || 0) > 0) {
            point.slots -= 1;
            await env[ADDRESSES_KV].put(user.cafe, JSON.stringify(points));
            await env[RESUME_KV].put(`${userId}_${Date.now()}`, JSON.stringify(result));
          } else {
            await sendMessage(chatId, "Ошибка: эта точка уже недоступна.");
            return new Response('OK', { status: 200 });
          }
        }
      } else {
        await env[RESULTS_KV].put(`${userId}_${Date.now()}`, JSON.stringify(result));
      }
    } catch (e) {
      // ignore
    }
    if (user.mode === "candidate") {
      let msg = `Заявка на проверку\n\nКандидат: ${user.lastName} ${user.firstName}`;
      if (message.from.username) {
        msg += `\nUsername: @${message.from.username}`;
      }
      msg += `\nТелефон: ${phone}\nСеть: ${cafeNames[user.cafe]}\nАдрес: ${user.address}`;
      await sendMessage(GROUP_ID, msg);
      await sendMessage(chatId, "Спасибо! Заявка на дегустацию отправлена, с Вами скоро свяжутся");
    } else {
      let msg = `Точка проверена\n\nТайный гость: ${user.lastName} ${user.firstName}`;
      if (message.from.username) {
        msg += `\nUsername: @${message.from.username}`;
      }
      msg += `\nТелефон: ${phone}\nСеть: ${cafeNames[user.cafe]}\nАдрес: ${user.address}\nДата: ${dateStr}`;
      await sendMessage(GROUP_ID, msg);
      await sendMessage(chatId, "Спасибо! Ваши данные отправлены.");
    }
    userData.delete(userId);
    return new Response('OK', { status: 200 });
  }

  if (user.state === "awaiting_adjust_slots" && ADMIN_IDS.includes(userId.toString())) {
    const delta = parseInt(text, 10);
    if (isNaN(delta)) {
      await sendMessage(chatId, "Пожалуйста, введите корректное число.");
      return new Response('OK', { status: 200 });
    }
    const pointsRaw = await env[ADDRESSES_KV].get(user.cafe);
    if (!pointsRaw) {
      await sendMessage(chatId, "Ошибка: данные сети не найдены.");
      userData.delete(userId);
      return new Response('OK', { status: 200 });
    }
    let points;
    try {
      points = JSON.parse(pointsRaw);
    } catch (e) {
      await sendMessage(chatId, "Ошибка обработки данных сети.");
      userData.delete(userId);
      return new Response('OK', { status: 200 });
    }
    const point = points.find(p => p.name === user.pointName);
    if (!point) {
      await sendMessage(chatId, "Ошибка: точка не найдена.");
      userData.delete(userId);
      return new Response('OK', { status: 200 });
    }
    point.slots = (point.slots || 0) + delta;
    await env[ADDRESSES_KV].put(user.cafe, JSON.stringify(points));
    await sendMessage(chatId, "Спасибо, места скорректированы");
    await sendMessage(GROUP_ID, `Скорректированы места\n\nСеть: ${cafeNames[user.cafe]}\nАдрес: ${user.address}\nТекущее количество мест: ${point.slots}`);
    userData.delete(userId);
    return new Response('OK', { status: 200 });
  }

  return new Response('OK', { status: 200 });
}