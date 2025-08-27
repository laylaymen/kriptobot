const axios = require("axios");

const fetchLatestCandle = async (symbol, interval = "15m") => {
  const url = `https://fapi.binance.com/fapi/v1/klines`;
  const response = await axios.get(url, {
    params: { symbol, interval, limit: 1 },
  });
  const [open, high, low, close, volume] = response.data[0];
  return { open, high, low, close, volume };
};

const fetchMultiTimeframe = async (symbol) => {
  return {
    "15m": await fetchLatestCandle(symbol, "15m"),
    "4h": await fetchLatestCandle(symbol, "4h"),
    "1d": await fetchLatestCandle(symbol, "1d"),
  };
};

module.exports = { fetchMultiTimeframe };
