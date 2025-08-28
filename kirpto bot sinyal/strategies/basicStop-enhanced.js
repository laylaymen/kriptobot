/**
 * Enhanced Basic Stop Strategy
 * Now supports both legacy candle data and Enhanced UMF enriched data
 */

module.exports = {
  name: "basicStop",

  // Legacy method for backward compatibility
  check: (candles) => {
    const stopAbove = global.ACTIVE_POSITION?.stopAbove;
    const stopBelow = global.ACTIVE_POSITION?.stopBelow;
    const type = global.ACTIVE_POSITION?.type;

    const c15 = parseFloat(candles["15m"]?.close || 0);
    const c4h = parseFloat(candles["4h"]?.close || 0);
    const c1d = parseFloat(candles["1d"]?.close || 0);

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

    const metCount = [condition15, condition4h, condition1d].filter(Boolean).length;

    // Store status for message generation
    module.exports._status = {
      status: {
        "15m": condition15 ? "✅" : "❌",
        "4h": condition4h ? "✅" : "❌",
        "1d": condition1d ? "✅" : "❌",
      },
      level,
      direction,
      metCount,
      current: { c15, c4h, c1d },
      symbol: global.ACTIVE_POSITION?.symbol || "COIN",
    };

    return metCount > 0;
  },

  // Enhanced method using UMF enriched data
  checkEnhanced: (strategyInput) => {
    const { candles, enriched, position } = strategyInput;
    
    // Use enhanced data if available
    if (enriched && enriched.microstructure) {
      return module.exports.checkWithMicrostructure(candles, enriched, position);
    }
    
    // Fallback to legacy method
    return module.exports.check(candles);
  },

  // Advanced stop logic using microstructure data
  checkWithMicrostructure: (candles, enriched, position) => {
    const stopAbove = position?.stopAbove;
    const stopBelow = position?.stopBelow;
    const type = position?.type;

    const c15 = parseFloat(candles["15m"]?.close || 0);
    const c4h = parseFloat(candles["4h"]?.close || 0);
    const c1d = parseFloat(candles["1d"]?.close || 0);

    let condition15, condition4h, condition1d, direction, level;
    let enhancedSignal = false;

    if (type === "short" && stopAbove !== null) {
      level = stopAbove;
      condition15 = c15 > stopAbove;
      condition4h = c4h > stopAbove;
      condition1d = c1d > stopAbove;
      direction = "üstünde";
      
      // Enhanced: Check for aggressive buying pressure
      if (enriched.microstructure.orderFlowImbalance > 0.4) {
        enhancedSignal = true;
      }
    }

    if (type === "long" && stopBelow !== null) {
      level = stopBelow;
      condition15 = c15 < stopBelow;
      condition4h = c4h < stopBelow;
      condition1d = c1d < stopBelow;
      direction = "altında";
      
      // Enhanced: Check for aggressive selling pressure
      if (enriched.microstructure.orderFlowImbalance < -0.4) {
        enhancedSignal = true;
      }
    }

    const metCount = [condition15, condition4h, condition1d].filter(Boolean).length;
    
    // Enhanced volatility check
    const volCluster = enriched.microstructure.volatilityClustering || 0;
    const highVolatility = volCluster > 1.5;
    
    // Enhanced momentum check
    const momentum = enriched.microstructure.momentum || 0;
    const strongMomentum = Math.abs(momentum) > 0.3;

    // Store enhanced status
    module.exports._status = {
      status: {
        "15m": condition15 ? "✅" : "❌",
        "4h": condition4h ? "✅" : "❌",
        "1d": condition1d ? "✅" : "❌",
      },
      level,
      direction,
      metCount,
      current: { c15, c4h, c1d },
      symbol: position?.symbol || "COIN",
      enhanced: {
        orderFlowImbalance: enriched.microstructure.orderFlowImbalance,
        volatilityClustering: volCluster,
        momentum,
        enhancedSignal,
        highVolatility,
        strongMomentum
      }
    };

    // Enhanced trigger logic: 
    // - Original conditions OR 
    // - Enhanced microstructure signals with high volatility
    return metCount > 0 || (enhancedSignal && (highVolatility || strongMomentum));
  },

  // Legacy message method
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

  // Enhanced message method with microstructure data
  messageEnhanced: (messageInput) => {
    const { symbol, enriched } = messageInput;
    const { status, level, direction, metCount, current, enhanced: enhancedStatus } =
      module.exports._status;

    let header;
    if (enhancedStatus?.enhancedSignal) {
      header = "🚨 ENHANCED STOP SIGNAL — Microstructure Alert!";
    } else {
      header = metCount === 3
        ? "🛑 KESİN STOP — Pozisyonu kapat!"
        : metCount === 2
          ? "⚠️ STOP yaklaşıyor"
          : "🔔 DİKKAT — Stop riski oluştu";
    }

    let message = (
      `${header}\n${symbol} pozisyonu ${level} ${direction}.\n` +
      `📊 15M: ${current.c15} → ${status["15m"]}\n` +
      `🕓 4H: ${current.c4h} → ${status["4h"]}\n` +
      `📅 1D: ${current.c1d} → ${status["1d"]}`
    );

    // Add enhanced microstructure information
    if (enhancedStatus) {
      message += `\n\n🔬 Microstructure Analysis:`;
      message += `\n📈 Order Flow Imbalance: ${(enhancedStatus.orderFlowImbalance * 100).toFixed(1)}%`;
      message += `\n🌊 Volatility Clustering: ${enhancedStatus.volatilityClustering.toFixed(2)}`;
      message += `\n⚡ Momentum: ${(enhancedStatus.momentum * 100).toFixed(1)}%`;
      
      if (enhancedStatus.enhancedSignal) {
        message += `\n🎯 Enhanced Signal: Aggressive ${enhancedStatus.orderFlowImbalance > 0 ? 'buying' : 'selling'} detected`;
      }
      
      if (enhancedStatus.highVolatility) {
        message += `\n⚠️ High Volatility Cluster Detected`;
      }
      
      if (enhancedStatus.strongMomentum) {
        message += `\n🔥 Strong Momentum Signal`;
      }
    }

    return message;
  },
};
