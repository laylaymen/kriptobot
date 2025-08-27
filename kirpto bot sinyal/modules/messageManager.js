const { Telegraf } = require('telegraf');
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
const chatId = process.env.TELEGRAM_CHAT_ID;

let lastMessage = "";
let lastTime = 0;

const sendMessageIfAllowed = async (message) => {
  const nowDate = new Date().toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' });
  const hour = new Date(nowDate).getHours();
  const now = Date.now();

  const isNight = hour >= 1 && hour < 8;
  const timeLabel = new Date(now).toLocaleTimeString('tr-TR');

  const finalMessage = `${message}\n⏱️ ${timeLabel}`;
  const isSameMessage = finalMessage === lastMessage;
  const isSpam = now - lastTime < 60000;

  if (isNight && !message.includes("STOP")) return;
  if (isSameMessage && isSpam) return;

  await bot.telegram.sendMessage(chatId, finalMessage);
  lastMessage = finalMessage;
  lastTime = now;
};

module.exports = { sendMessageIfAllowed };
