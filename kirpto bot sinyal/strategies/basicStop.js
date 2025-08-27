module.exports = {
  name: "basicStop",

  check: (candles) => {
    const stopAbove = global.ACTIVE_POSITION?.stopAbove;
    const stopBelow = global.ACTIVE_POSITION?.stopBelow;
    const type = global.ACTIVE_POSITION?.type;

    const c15 = parseFloat(candles["15m"].close);
    const c4h = parseFloat(candles["4h"].close);
    const c1d = parseFloat(candles["1d"].close);

    let condition15, condition4h, condition1d, direction, level;

    if (type === "short" && stopAbove !== null) {
      level = stopAbove;
      condition15 = c15 > stopAbove;
      condition4h = c4h > stopAbove;
      condition1d = c1d > stopAbove;
      direction = "üstünde";
    }

    if (type === "long" && stopBelow !== null) {
      level = stopBelow;
      condition15 = c15 < stopBelow;
      condition4h = c4h < stopBelow;
      condition1d = c1d < stopBelow;
      direction = "altında";
    }

    const metCount = [condition15, condition4h, condition1d].filter(
      Boolean,
    ).length;

    // Bilgilendirme durumu
    const status = {
      "15m": condition15 ? "✅" : "❌",
      "4h": condition4h ? "✅" : "❌",
      "1d": condition1d ? "✅" : "❌",
    };

    module.exports._status = {
      status,
      level,
      direction,
      metCount,
      current: { c15, c4h, c1d },
      symbol: global.ACTIVE_POSITION?.symbol || "COIN",
    };

    return metCount > 0; // En azından bir tanesi bile uygunsa mesaj gönder
  },

  message: (price) => {
    const { status, level, direction, metCount, current, symbol } =
      module.exports._status;

    const header =
      metCount === 3
        ? "🛑 KESİN STOP — Pozisyonu kapat!"
        : metCount === 2
          ? "⚠️ STOP yaklaşıyor"
          : "🔔 DİKKAT — Stop riski oluştu";

    return (
      `${header}\n${symbol} pozisyonu ${level} ${direction}.\n` +
      `📊 15M: ${current.c15} → ${status["15m"]}\n` +
      `🕓 4H: ${current.c4h} → ${status["4h"]}\n` +
      `📅 1D: ${current.c1d} → ${status["1d"]}`
    );
  },
};
