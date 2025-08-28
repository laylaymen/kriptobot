/**
 * UMF Integration Example for index.js
 * 
 * Mevcut index.js'e UMF entegrasyonu için örnek kod
 */

// Bu kodu mevcut index.js'in başına ekleyin:

const { quickStart, bus } = require('./modules/unifiedMarketFeed');
const { 
    LiquiditySweepAdapter, 
    TechnicalIndicatorsAdapter 
} = require('./modules/umfAdapters');

/**
 * UMF'yi mevcut bot ile entegre et
 */
async function initializeUnifiedMarketFeed() {
    try {
        console.log('🚀 Initializing UnifiedMarketFeed integration...');
        
        // config.json'dan sembolleri al (eğer varsa)
        const config = require('./strategies/config.json');
        const symbols = config.symbols || ['BTCUSDT', 'ETHUSDT'];
        
        // UMF'yi başlat
        const umf = await quickStart(symbols, {
            intervals: ['1m', '5m', '15m', '1h'],
            enableTrades: true,
            enableTicker: true,
            enableOrderbook: true,
            enableFunding: false // Spot trading
        });
        
        // Mevcut modüllerle entegrasyon
        symbols.forEach(symbol => {
            // Technical indicators için UMF adapter
            const techAdapter = new TechnicalIndicatorsAdapter(symbol, ['1m', '5m', '15m']);
            
            // Liquidity sweep detection
            const liquidityAdapter = new LiquiditySweepAdapter(symbol);
        });
        
        // UMF event'lerini mevcut sisteme bridge et
        bridgeUMFToExistingSystem();
        
        console.log('✅ UMF integration completed');
        return umf;
        
    } catch (error) {
        console.error('❌ UMF integration failed:', error.message);
        throw error;
    }
}

/**
 * UMF event'lerini mevcut sisteme bridge et
 */
function bridgeUMFToExistingSystem() {
    // UMF candle verilerini technicalIndicatorsEngine'e bridge et
    bus.on('umf.candle.BTCUSDT.1m', (candle) => {
        // Mevcut technical indicators engine'ine veri besle
        if (global.technicalIndicatorsEngine) {
            const ohlcv = {
                timestamp: candle.tsClose,
                open: parseFloat(candle.o),
                high: parseFloat(candle.h),
                low: parseFloat(candle.l),
                close: parseFloat(candle.c),
                volume: parseFloat(candle.v)
            };
            
            // technicalIndicatorsEngine.updateData() gibi bir fonksiyon varsa çağır
            // global.technicalIndicatorsEngine.updateData('BTCUSDT', '1m', ohlcv);
        }
    });
    
    // Trade verilerini mevcut sistemlere bridge et
    bus.on('umf.trade.BTCUSDT', (trade) => {
        // Mevcut trade tracking sistemine besle
        if (global.tradeTracker) {
            // global.tradeTracker.recordTrade(trade);
        }
    });
    
    // Clock sync verilerini sistem health check'e besle
    bus.on('umf.clock', (clock) => {
        if (Math.abs(clock.driftMs) > 100) {
            console.warn(`⚠️ Time drift detected: ${clock.driftMs}ms`);
            // Telegram uyarısı gönder
            if (global.sendTelegram) {
                global.sendTelegram(`🕐 Time Drift Warning: ${clock.driftMs}ms`);
            }
        }
    });
    
    // Orderbook verilerini risk sistemlerine besle
    bus.on('umf.book.BTCUSDT', (book) => {
        // Risk detection sistemlerine besle
        if (global.riskDetector) {
            const spread = parseFloat(book.asks[0][0]) - parseFloat(book.bids[0][0]);
            const midPrice = (parseFloat(book.asks[0][0]) + parseFloat(book.bids[0][0])) / 2;
            const spreadPct = (spread / midPrice) * 100;
            
            // Yüksek spread uyarısı
            if (spreadPct > 0.1) { // %0.1'den fazla
                console.warn(`⚠️ High spread detected: ${spreadPct.toFixed(3)}%`);
            }
        }
    });
}

/**
 * Mevcut strategy'leri UMF ile güncellenmiş veri kullanacak şekilde modifiye et
 */
function upgradeStrategiesToUMF() {
    // basicStop.js strategy'sini UMF ile entegre et
    bus.on('umf.candle.BTCUSDT.5m', (candle) => {
        // Stop loss hesaplamaları için güncel fiyat bilgisi
        const currentPrice = parseFloat(candle.c);
        
        // Mevcut positions varsa stop loss güncelle
        if (global.positions && global.positions.BTCUSDT) {
            // basicStop logic here
        }
    });
    
    // volumeCompression.js strategy'sini UMF ile entegre et
    bus.on('umf.candle.BTCUSDT.15m', (candle) => {
        const volume = parseFloat(candle.v);
        const avgVolume = global.avgVolume || volume;
        
        // Volume compression detection
        if (volume < avgVolume * 0.5) {
            console.log(`📉 Volume compression detected: ${volume} vs avg ${avgVolume}`);
            // Strategy logic here
        }
    });
}

// Export functions for use in main index.js
module.exports = {
    initializeUnifiedMarketFeed,
    bridgeUMFToExistingSystem,
    upgradeStrategiesToUMF
};

/* 
 * MEVCUT INDEX.JS'E ENTEGRASYON ÖRNEĞİ:
 * 
 * // index.js'in başına ekle:
 * const { initializeUnifiedMarketFeed } = require('./umf-integration');
 * 
 * // main() fonksiyonunda UMF'yi başlat:
 * async function main() {
 *     try {
 *         // Mevcut initialization'lar...
 *         
 *         // UMF initialization
 *         await initializeUnifiedMarketFeed();
 *         
 *         // Diğer modülların başlatılması...
 *         
 *     } catch (error) {
 *         console.error('Bot initialization failed:', error);
 *         process.exit(1);
 *     }
 * }
 */
