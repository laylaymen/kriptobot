const fs = require('fs');
const path = require('path');
const { sendMessageIfAllowed } = require('./messageManager');
const config = require('../strategies/config.json');

/**
 * Enhanced Strategy Manager
 * Now supports both legacy candle data and Enhanced UMF enriched data
 */

const evaluateStrategies = async (symbol, candles, logEvent, enhancedContext = null) => {
  const strategyFiles = fs.readdirSync(path.join(__dirname, '../strategies'));

  for (const file of strategyFiles) {
    if (!file.endsWith('.js')) continue;
    const name = file.replace('.js', '');
    if (!config[name]?.enabled) continue;

    try {
      const strategy = require(`../strategies/${file}`);
      
      // Enhanced strategy call with additional context
      const strategyInput = {
        symbol,
        candles,
        enriched: enhancedContext?.enrichedData || null,
        position: enhancedContext?.position || global.ACTIVE_POSITION,
        timestamp: enhancedContext?.timestamp || Date.now()
      };
      
      // Check if strategy supports enhanced mode
      const triggered = strategy.checkEnhanced ? 
        await strategy.checkEnhanced(strategyInput) : 
        await strategy.check(candles);

      if (triggered) {
        // Enhanced message generation with context
        const messageInput = {
          price: candles['15m']?.close,
          symbol,
          enriched: enhancedContext?.enrichedData,
          strategyName: name,
          triggered
        };
        
        const message = strategy.messageEnhanced ? 
          strategy.messageEnhanced(messageInput) : 
          strategy.message(candles['15m']?.close);
        
        // Enhanced message with microstructure data if available
        let finalMessage = message;
        if (enhancedContext?.enrichedData?.microstructure) {
          const micro = enhancedContext.enrichedData.microstructure;
          const enhancedInfo = [];
          
          if (micro.priceImpact !== undefined) {
            enhancedInfo.push(`Impact: ${(micro.priceImpact * 10000).toFixed(1)}bps`);
          }
          if (micro.orderFlowImbalance !== undefined) {
            enhancedInfo.push(`OFI: ${(micro.orderFlowImbalance * 100).toFixed(1)}%`);
          }
          if (micro.volatilityClustering !== undefined) {
            enhancedInfo.push(`VolCluster: ${micro.volatilityClustering.toFixed(2)}`);
          }
          
          if (enhancedInfo.length > 0) {
            finalMessage += `\n📊 Microstructure: ${enhancedInfo.join(', ')}`;
          }
        }
        
        // Enhanced TCA information
        if (enhancedContext?.enrichedData?.tca) {
          const tca = enhancedContext.enrichedData.tca;
          const tcaInfo = [];
          
          if (tca.implementationShortfall !== undefined) {
            tcaInfo.push(`IS: ${(tca.implementationShortfall * 10000).toFixed(1)}bps`);
          }
          if (tca.marketImpactCost !== undefined) {
            tcaInfo.push(`MIC: ${(tca.marketImpactCost * 10000).toFixed(1)}bps`);
          }
          
          if (tcaInfo.length > 0) {
            finalMessage += `\n💰 TCA: ${tcaInfo.join(', ')}`;
          }
        }

        await sendMessageIfAllowed(finalMessage);
        if (logEvent) {
          const logMessage = enhancedContext ? 
            `Enhanced strategy triggered: ${name} with microstructure data` :
            `Strategy triggered: ${name}`;
          logEvent(finalMessage, logMessage);
        }
      }
      
    } catch (error) {
      console.error(`❌ Error in strategy ${name}:`, error.message);
      if (logEvent) logEvent(`Strategy error: ${name} - ${error.message}`, 'ERROR');
    }
  }
};

/**
 * Enhanced strategy evaluation specifically for UMF enriched data
 */
const evaluateEnhancedStrategies = async (symbol, umfData, logEvent) => {
  try {
    // Convert UMF data to legacy candle format for backward compatibility
    const candles = convertUMFToCandles(umfData);
    
    // Prepare enhanced context
    const enhancedContext = {
      enrichedData: umfData.enriched,
      position: global.ACTIVE_POSITION,
      timestamp: umfData.timestamp || Date.now(),
      symbol
    };
    
    await evaluateStrategies(symbol, candles, logEvent, enhancedContext);
    
  } catch (error) {
    console.error(`❌ Enhanced strategy evaluation error for ${symbol}:`, error.message);
    if (logEvent) logEvent(`Enhanced strategy error: ${error.message}`, 'ERROR');
  }
};

/**
 * Convert Enhanced UMF data format to legacy candle format
 * for backward compatibility with existing strategies
 */
function convertUMFToCandles(umfData) {
  const candles = {};
  
  // Extract different timeframes from UMF data
  if (umfData.klines) {
    for (const [timeframe, klineData] of Object.entries(umfData.klines)) {
      candles[timeframe] = {
        open: klineData.open,
        high: klineData.high,
        low: klineData.low,
        close: klineData.close,
        volume: klineData.volume
      };
    }
  } else if (umfData.kind === 'kline') {
    // Single kline data
    const timeframe = umfData.timeframe || '15m';
    candles[timeframe] = {
      open: umfData.open,
      high: umfData.high,
      low: umfData.low,
      close: umfData.close,
      volume: umfData.volume
    };
  }
  
  return candles;
}

/**
 * Get strategy performance metrics
 */
const getStrategyMetrics = () => {
  const strategyFiles = fs.readdirSync(path.join(__dirname, '../strategies'));
  const metrics = {};
  
  for (const file of strategyFiles) {
    if (!file.endsWith('.js')) continue;
    const name = file.replace('.js', '');
    
    metrics[name] = {
      enabled: config[name]?.enabled || false,
      lastTriggered: null, // TODO: Add timestamp tracking
      triggerCount: 0, // TODO: Add counter
      successRate: null // TODO: Add performance tracking
    };
  }
  
  return metrics;
};

module.exports = { 
  evaluateStrategies, 
  evaluateEnhancedStrategies,
  convertUMFToCandles,
  getStrategyMetrics
};
