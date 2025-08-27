// aiPositionMsg.js

function createPositionMessage(position) {
  const { coin, type, entry, stop, leverage } = position;

  // Ana mesaj bilgisi
  const emoji = type === "long" ? "📈" : "📉";
  const leverageText = leverage ? ` (x${leverage})` : "";

  // Gelecekte dinamik olarak dolacak alanlar (şu an placeholder)
  const aiComment = "Şu anda yorum yapılmadı.";
  const reference = "Benzer pozisyon bulunamadı.";
  const psychState = "Filtre aktif değil.";

  // Tüm mesajı oluştur
  const message =
    `${emoji} ${coin.toUpperCase()} ${type.toUpperCase()} pozisyon algılandı – ${entry} giriş / ${stop} stop${leverageText}\n` +
    `🧠 AI Yorumu: ${aiComment}\n` +
    `📌 Geçmiş Referans: ${reference}\n` +
    `🚨 Psikolojik Durum: ${psychState}`;

  return message;
}

module.exports = {
  createPositionMessage,
};
