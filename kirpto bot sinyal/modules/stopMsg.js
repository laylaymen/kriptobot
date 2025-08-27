// stopMsg.js

function createStopMessage(position, timeframeSummary) {
  const { coin, type } = position;

  const emoji = type === "long" ? "📉" : "📈";
  const message = `🛑 STOP: ${coin.toUpperCase()} ${type.toUpperCase()} pozisyonu stoplandı.\n` +
                  `📊 Zaman Analizi: ${timeframeSummary}`;

  return message;
}

module.exports = {
  createStopMessage
};