// strategies/volumeCompression.js

function check(candles) {
  // candle datası: [{time, open, high, low, close, volume}, ...]
  // Sessiz patlama kontrolü yapılacak (şimdilik simülasyon)
  return true; // test modu - hep sinyal varmış gibi
}

function message() {
  const now = new Date();
  const time = now.toLocaleTimeString("tr-TR", { timeZone: "Europe/Istanbul" });
  return `📉 Sessiz bölge kırıldı. Fiyat: 19.75 – Hacim artışı var.\n📊 4H boyunca yatay sıkışma sonrası kırılım geldi.\n🕒 ${time}`;
}

module.exports = {
  check,
  message,
};
