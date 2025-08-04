const BOT_TOKEN = '8447355958:AAH8mWwuRUwSCcsnzpQ68v4jX-859q1h1nM';

export async function sendMessage(chatId, text, replyMarkup = null) {
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
  const body = {
    chat_id: chatId,
    text
  };
  if (replyMarkup) body.reply_markup = JSON.stringify(replyMarkup);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(1000)
    });
    if (!response.ok) {
      console.log('Error sending message:', await response.text());
    }
  } catch (error) {
    console.log('Fetch error in sendMessage:', error.message);
  }
}

export async function sendPhoto(chatId, photoUrl, caption, replyMarkup = null) {
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`;
  const body = {
    chat_id: chatId,
    photo: photoUrl,
    caption
  };
  if (replyMarkup) body.reply_markup = JSON.stringify(replyMarkup);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(1000)
    });
    if (!response.ok) {
      console.log('Error sending photo:', await response.text());
    }
  } catch (error) {
    console.log('Fetch error in sendPhoto:', error.message);
  }
}

export async function answerCallback(callbackId) {
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`;
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ callback_query_id: callbackId }),
      signal: AbortSignal.timeout(1000)
    });
    if (!response.ok) {
      console.log('Error answering callback:', await response.text());
    }
  } catch (error) {
    console.log('Fetch error in answerCallback:', error.message);
  }
}