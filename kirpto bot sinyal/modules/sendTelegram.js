// modules/sendTelegram.js
require("dotenv").config();
const axios = require("axios");

async function sendTelegramMessage(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  const url = `https://api.telegram.org/bot${token}/sendMessage`;

  try {
    const response = await axios.post(url, {
      chat_id: chatId,
      text: text,
      parse_mode: "Markdown",
    });

    console.log("✅ Telegram mesajı gönderildi:", response.data.ok);
  } catch (error) {
    console.error("❌ Telegram mesajı gönderilemedi:", error.message);
  }
}

module.exports = {
  sendTelegramMessage,
};
