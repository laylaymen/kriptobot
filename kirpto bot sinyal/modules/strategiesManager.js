const fs = require('fs');
const path = require('path');
const { sendMessageIfAllowed } = require('./messageManager');
const config = require('../strategies/config.json');

const evaluateStrategies = async (symbol, candles, logEvent) => {
  const strategyFiles = fs.readdirSync(path.join(__dirname, '../strategies'));

  for (const file of strategyFiles) {
    if (!file.endsWith('.js')) continue;
    const name = file.replace('.js', '');
    if (!config[name]?.enabled) continue;

    const strategy = require(`../strategies/${file}`);
    const triggered = await strategy.check(candles);

    if (triggered) {
      const message = strategy.message(candles['15m'].close);
      await sendMessageIfAllowed(message);
      if (logEvent) logEvent(message, `Strateji tetiklendi: ${name}`);
    }
  }
};

module.exports = { evaluateStrategies };
