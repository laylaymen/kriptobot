/**
 * Enhanced Normalizer - Production Ready
 * 
 * Handles schema validation, type safety, and edge cases
 */

const crypto = require('crypto');

// Define ValidationError class
class ValidationError extends Error {
    constructor(message, symbol, field, value, type) {
        super(message);
        this.name = 'ValidationError';
        this.symbol = symbol;
        this.field = field;
        this.value = value;
        this.type = type;
    }
}

class EventNormalizer {
    constructor(config = {}) {
        this.config = {
            validatePrices: true,
            validateQuantities: true,
            validateNotional: true,
            strictValidation: false,
            dropInvalidEvents: false,
            maxClockSkew: 5000,
            dedupWindowMs: 10000,
            ...config
        };
        
        this.exchangeRules = new Map();
        this.recentEvents = new Map(); // For deduplication
        this.sequence = 0;
        
        // Cleanup old dedup entries periodically
        setInterval(() => this.cleanupDedup(), 30000);
    }

    /**
     * Main normalization entry point
     */
    normalize(rawEvent, symbolMeta, serverTime) {
        try {
            const now = Date.now();
            this.sequence++;
            
            // Deduplication check
            const eventKey = this.generateEventKey(rawEvent);
            if (this.isDuplicate(eventKey)) {
                return null;
            }
            
            // Route to specific normalizer based on stream type
            let normalizedEvent = null;
            
            if (rawEvent.k) {
                normalizedEvent = this.normalizeKline(rawEvent, symbolMeta, now, serverTime);
            } else if (rawEvent.a !== undefined && rawEvent.p !== undefined) {
                normalizedEvent = this.normalizeTrade(rawEvent, symbolMeta, now, serverTime);
            } else if (rawEvent.b !== undefined && rawEvent.a !== undefined && Array.isArray(rawEvent.b)) {
                normalizedEvent = this.normalizeDepth(rawEvent, symbolMeta, now, serverTime);
            } else if (rawEvent.b && rawEvent.a && !Array.isArray(rawEvent.b)) {
                normalizedEvent = this.normalizeTicker(rawEvent, symbolMeta, now, serverTime);
            } else if (rawEvent.p && rawEvent.r !== undefined) {
                normalizedEvent = this.normalizeFunding(rawEvent, symbolMeta, now, serverTime);
            } else {
                console.warn('Unknown event type:', Object.keys(rawEvent));
                return null;
            }
            
            if (normalizedEvent) {
                // Add common fields
                normalizedEvent.sequence = this.sequence;
                normalizedEvent.schemaVersion = '1.0';
                normalizedEvent.source = 'binance';
                
                // Store for dedup
                this.recentEvents.set(eventKey, now);
                
                // Validate if enabled
                if (this.config.strictValidation) {
                    const validation = this.validateEvent(normalizedEvent);
                    if (!validation.valid) {
                        if (this.config.dropInvalidEvents) {
                            console.warn(`Dropping invalid event: ${validation.errors.join(', ')}`);
                            return null;
                        } else {
                            normalizedEvent.validated = false;
                            normalizedEvent.validationErrors = validation.errors;
                        }
                    } else {
                        normalizedEvent.validated = true;
                    }
                } else {
                    normalizedEvent.validated = true;
                }
            }
            
            return normalizedEvent;
            
        } catch (error) {
            console.error('Normalization error:', error.message);
            if (this.config.strictValidation) {
                throw error;
            }
            return null;
        }
    }

    /**
     * Normalize Kline events
     */
    normalizeKline(raw, symbolMeta, now, serverTime) {
        const k = raw.k;
        const symbol = k.s || raw.s;
        const rules = this.exchangeRules.get(symbol);
        
        const event = {
            kind: 'kline',
            symbol,
            marketType: symbolMeta?.marketType || 'spot',
            eventTime: raw.E || k.T,
            ingestTime: now,
            latencyMs: now - (raw.E || k.T),
            clockSkewMs: serverTime ? (serverTime - now) : undefined,
            
            tf: k.i,
            tsOpen: k.t,
            tsClose: k.T,
            o: this.parsePrice(k.o, symbol, 'open'),
            h: this.parsePrice(k.h, symbol, 'high'),
            l: this.parsePrice(k.l, symbol, 'low'),
            c: this.parsePrice(k.c, symbol, 'close'),
            v: this.parseQuantity(k.v, symbol, 'volume'),
            quoteV: this.parseQuantity(k.q, symbol, 'quoteVolume'),
            closed: k.x,
            trades: parseInt(k.n) || 0,
            
            validated: false
        };
        
        // Validation
        if (rules && this.config.validatePrices) {
            this.validatePriceRange(event.o, symbol, rules, 'open');
            this.validatePriceRange(event.h, symbol, rules, 'high');
            this.validatePriceRange(event.l, symbol, rules, 'low');
            this.validatePriceRange(event.c, symbol, rules, 'close');
        }
        
        if (rules && this.config.validateQuantities) {
            this.validateQuantityRange(event.v, symbol, rules, 'volume');
        }
        
        // Sanity checks
        if (event.h < event.l) {
            throw new ValidationError('High < Low', symbol, 'high_low', { h: event.h, l: event.l }, 'PRICE_LOGIC');
        }
        
        if (event.o < event.l || event.o > event.h) {
            console.warn(`Open price outside H/L range for ${symbol}: ${event.o} not in [${event.l}, ${event.h}]`);
        }
        
        if (event.c < event.l || event.c > event.h) {
            console.warn(`Close price outside H/L range for ${symbol}: ${event.c} not in [${event.l}, ${event.h}]`);
        }
        
        return event;
    }

    /**
     * Normalize Trade events
     */
    normalizeTrade(raw, symbolMeta, now, serverTime) {
        const symbol = raw.s;
        const rules = this.exchangeRules.get(symbol);
        
        const price = this.parsePrice(raw.p, symbol, 'price');
        const qty = this.parseQuantity(raw.q, symbol, 'quantity');
        
        const event = {
            kind: 'trade',
            symbol,
            marketType: symbolMeta?.marketType || 'spot',
            eventTime: raw.E || raw.T,
            ingestTime: now,
            latencyMs: now - (raw.E || raw.T),
            clockSkewMs: serverTime ? (serverTime - now) : undefined,
            
            id: parseInt(raw.a) || 0,
            price,
            qty,
            quoteQty: price * qty,
            isBuyerMaker: raw.m,
            tradeTime: raw.T || raw.E,
            
            validated: false
        };
        
        // Generate composite fill ID for dedup
        if (raw.a && raw.t) {
            event.compositeFillId = `${symbol}_${raw.a}_${raw.t}`;
        }
        
        // Validation
        if (rules) {
            if (this.config.validatePrices) {
                this.validatePriceRange(price, symbol, rules, 'price');
            }
            
            if (this.config.validateQuantities) {
                this.validateQuantityRange(qty, symbol, rules, 'quantity');
            }
            
            if (this.config.validateNotional) {
                this.validateNotional(event.quoteQty, symbol, rules, 'notional');
            }
        }
        
        return event;
    }

    /**
     * Normalize Depth events
     */
    normalizeDepth(raw, symbolMeta, now, serverTime) {
        const symbol = raw.s;
        const rules = this.exchangeRules.get(symbol);
        
        const event = {
            kind: 'depth',
            symbol,
            marketType: symbolMeta?.marketType || 'spot',
            eventTime: raw.E,
            ingestTime: now,
            latencyMs: now - raw.E,
            clockSkewMs: serverTime ? (serverTime - now) : undefined,
            
            lastUpdateId: raw.u || raw.lastUpdateId,
            snapshotVersion: raw.snapshotVersion,
            bids: [],
            asks: [],
            
            validated: false
        };
        
        // Parse and validate bids/asks
        if (raw.b) {
            event.bids = raw.b.map(([price, qty]) => [
                this.parsePrice(price, symbol, 'bid_price'),
                this.parseQuantity(qty, symbol, 'bid_qty')
            ]).filter(([price, qty]) => qty > 0); // Remove zero quantities
        }
        
        if (raw.a) {
            event.asks = raw.a.map(([price, qty]) => [
                this.parsePrice(price, symbol, 'ask_price'),
                this.parseQuantity(qty, symbol, 'ask_qty')
            ]).filter(([price, qty]) => qty > 0); // Remove zero quantities
        }
        
        // Sort bids (highest first) and asks (lowest first)
        event.bids.sort((a, b) => b[0] - a[0]);
        event.asks.sort((a, b) => a[0] - b[0]);
        
        // Check for crossed book (bid >= ask)
        if (event.bids.length > 0 && event.asks.length > 0) {
            const topBid = event.bids[0][0];
            const topAsk = event.asks[0][0];
            
            if (topBid >= topAsk) {
                event.crossedBook = true;
                console.warn(`Crossed book detected for ${symbol}: bid=${topBid} >= ask=${topAsk}`);
            }
        }
        
        // Calculate enrichment fields
        if (event.bids.length > 0 && event.asks.length > 0) {
            const topBid = event.bids[0][0];
            const topAsk = event.asks[0][0];
            
            event.midPrice = (topBid + topAsk) / 2;
            event.spread = topAsk - topBid;
            event.spreadBps = (event.spread / event.midPrice) * 10000;
            
            // Calculate volume imbalance
            const bidVolume = event.bids.reduce((sum, [, qty]) => sum + qty, 0);
            const askVolume = event.asks.reduce((sum, [, qty]) => sum + qty, 0);
            
            event.bidVolume = bidVolume;
            event.askVolume = askVolume;
            event.imbalance = bidVolume / (bidVolume + askVolume);
            event.topN = Math.min(event.bids.length, event.asks.length);
        }
        
        return event;
    }

    /**
     * Normalize Ticker events
     */
    normalizeTicker(raw, symbolMeta, now, serverTime) {
        const symbol = raw.s;
        
        const bidPx = this.parsePrice(raw.b, symbol, 'bid_price');
        const askPx = this.parsePrice(raw.a, symbol, 'ask_price');
        
        const event = {
            kind: 'ticker',
            symbol,
            marketType: symbolMeta?.marketType || 'spot',
            eventTime: raw.E || now,
            ingestTime: now,
            latencyMs: now - (raw.E || now),
            clockSkewMs: serverTime ? (serverTime - now) : undefined,
            
            bidPx,
            bidSz: this.parseQuantity(raw.B, symbol, 'bid_size'),
            askPx,
            askSz: this.parseQuantity(raw.A, symbol, 'ask_size'),
            
            validated: false
        };
        
        // Enrichment
        event.midPrice = (bidPx + askPx) / 2;
        event.spread = askPx - bidPx;
        event.spreadBps = (event.spread / event.midPrice) * 10000;
        
        // Validation
        if (bidPx >= askPx) {
            console.warn(`Invalid ticker spread for ${symbol}: bid=${bidPx} >= ask=${askPx}`);
        }
        
        return event;
    }

    /**
     * Normalize Funding events
     */
    normalizeFunding(raw, symbolMeta, now, serverTime) {
        const symbol = raw.s;
        
        const event = {
            kind: 'funding',
            symbol,
            marketType: symbolMeta?.marketType || 'umPerp',
            eventTime: raw.E,
            ingestTime: now,
            latencyMs: now - raw.E,
            clockSkewMs: serverTime ? (serverTime - now) : undefined,
            
            markPrice: this.parsePrice(raw.p, symbol, 'mark_price'),
            indexPrice: raw.i ? this.parsePrice(raw.i, symbol, 'index_price') : undefined,
            fundingRate: parseFloat(raw.r),
            nextFundingTime: parseInt(raw.T),
            
            validated: false
        };
        
        return event;
    }

    /**
     * Parse price with validation
     */
    parsePrice(priceStr, symbol, field) {
        if (!priceStr) return 0;
        const price = parseFloat(priceStr);
        
        if (isNaN(price) || price < 0) {
            throw new ValidationError(`Invalid price: ${priceStr}`, symbol, field, priceStr, 'PRICE_FORMAT');
        }
        
        return price;
    }

    /**
     * Parse quantity with validation
     */
    parseQuantity(qtyStr, symbol, field) {
        if (!qtyStr) return 0;
        const qty = parseFloat(qtyStr);
        
        if (isNaN(qty) || qty < 0) {
            throw new ValidationError(`Invalid quantity: ${qtyStr}`, symbol, field, qtyStr, 'QTY_FORMAT');
        }
        
        return qty;
    }

    /**
     * Validate price against exchange rules
     */
    validatePriceRange(price, symbol, rules, field) {
        if (!rules.filters?.priceFilter) return;
        
        const { minPrice, maxPrice, tickSize } = rules.filters.priceFilter;
        
        if (price < minPrice || price > maxPrice) {
            throw new ValidationError(
                `Price out of range: ${price} not in [${minPrice}, ${maxPrice}]`,
                symbol, field, price, 'PRICE_FILTER'
            );
        }
        
        // Check tick size
        if (tickSize > 0) {
            const remainder = price % tickSize;
            if (Math.abs(remainder) > 1e-8 && Math.abs(remainder - tickSize) > 1e-8) {
                console.warn(`Price not on tick: ${price} (tick=${tickSize}, remainder=${remainder})`);
            }
        }
    }

    /**
     * Validate quantity against exchange rules
     */
    validateQuantityRange(qty, symbol, rules, field) {
        if (!rules.filters?.lotSizeFilter) return;
        
        const { minQty, maxQty, stepSize } = rules.filters.lotSizeFilter;
        
        if (qty < minQty || qty > maxQty) {
            throw new ValidationError(
                `Quantity out of range: ${qty} not in [${minQty}, ${maxQty}]`,
                symbol, field, qty, 'LOT_SIZE'
            );
        }
        
        // Check step size
        if (stepSize > 0) {
            const remainder = qty % stepSize;
            if (Math.abs(remainder) > 1e-8 && Math.abs(remainder - stepSize) > 1e-8) {
                console.warn(`Quantity not on step: ${qty} (step=${stepSize}, remainder=${remainder})`);
            }
        }
    }

    /**
     * Validate notional value
     */
    validateNotional(notional, symbol, rules, field) {
        if (!rules.filters?.notionalFilter) return;
        
        const { minNotional, maxNotional } = rules.filters.notionalFilter;
        
        if (notional < minNotional) {
            throw new ValidationError(
                `Notional too small: ${notional} < ${minNotional}`,
                symbol, field, notional, 'MIN_NOTIONAL'
            );
        }
        
        if (maxNotional && notional > maxNotional) {
            throw new ValidationError(
                `Notional too large: ${notional} > ${maxNotional}`,
                symbol, field, notional, 'MAX_NOTIONAL'
            );
        }
    }

    /**
     * Generate unique event key for deduplication
     */
    generateEventKey(raw) {
        const keyData = {
            s: raw.s,
            E: raw.E,
            u: raw.u || raw.lastUpdateId,
            a: raw.a, // aggTrade ID
            t: raw.t, // trade ID
            k: raw.k ? { t: raw.k.t, T: raw.k.T } : undefined
        };
        
        return crypto.createHash('md5')
            .update(JSON.stringify(keyData))
            .digest('hex');
    }

    /**
     * Check if event is duplicate
     */
    isDuplicate(eventKey) {
        const lastSeen = this.recentEvents.get(eventKey);
        if (lastSeen && (Date.now() - lastSeen) < this.config.dedupWindowMs) {
            return true;
        }
        return false;
    }

    /**
     * Clean up old deduplication entries
     */
    cleanupDedup() {
        const now = Date.now();
        for (const [key, timestamp] of this.recentEvents) {
            if (now - timestamp > this.config.dedupWindowMs) {
                this.recentEvents.delete(key);
            }
        }
    }

    /**
     * Update exchange rules
     */
    updateExchangeRules(symbol, rules) {
        this.exchangeRules.set(symbol, rules);
    }

    /**
     * Validate complete event
     */
    validateEvent(event) {
        const errors = [];
        const warnings = [];
        
        // Required fields check
        if (!event.symbol) errors.push('Missing symbol');
        if (!event.eventTime) errors.push('Missing eventTime');
        if (!event.kind) errors.push('Missing event kind');
        
        // Clock skew check
        if (event.clockSkewMs && Math.abs(event.clockSkewMs) > this.config.maxClockSkew) {
            warnings.push(`High clock skew: ${event.clockSkewMs}ms`);
        }
        
        // Latency check
        if (event.latencyMs > 5000) {
            warnings.push(`High latency: ${event.latencyMs}ms`);
        }
        
        return {
            valid: errors.length === 0,
            errors,
            warnings,
            normalizedEvent: event
        };
    }

    /**
     * Get normalization statistics
     */
    getStats() {
        return {
            totalEvents: this.sequence,
            dedupCacheSize: this.recentEvents.size,
            rulesLoaded: this.exchangeRules.size,
            config: this.config
        };
    }
}

module.exports = {
    EventNormalizer,
    ValidationError
};
