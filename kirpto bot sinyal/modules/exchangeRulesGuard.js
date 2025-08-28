/**
 * Exchange Rules Guard - Production Quality Layer
 * 
 * PRICE_FILTER / LOT_SIZE / MIN_NOTIONAL / MARKET_LOT_SIZE enforcement
 * Tolerant quantization and "nearest valid price/quantity" suggestions
 */

class ExchangeRulesGuard {
    constructor() {
        this.symbolRules = new Map();
        this.lastRulesUpdate = 0;
        this.rulesVersion = '';
    }

    /**
     * Load and parse exchange rules from Binance exchangeInfo
     */
    async loadRules(exchangeInfo) {
        const timestamp = Date.now();
        this.rulesVersion = `v${timestamp}`;
        
        for (const symbol of exchangeInfo.symbols) {
            const rules = this.parseSymbolFilters(symbol);
            this.symbolRules.set(symbol.symbol, {
                ...rules,
                status: symbol.status,
                baseAsset: symbol.baseAsset,
                quoteAsset: symbol.quoteAsset,
                isSpotTradingAllowed: symbol.isSpotTradingAllowed,
                isMarginTradingAllowed: symbol.isMarginTradingAllowed,
                loadedAt: timestamp
            });
        }
        
        this.lastRulesUpdate = timestamp;
        console.log(`✅ Loaded rules for ${this.symbolRules.size} symbols (${this.rulesVersion})`);
    }

    /**
     * Parse Binance symbol filters into structured rules
     */
    parseSymbolFilters(symbolInfo) {
        const rules = {
            priceFilter: null,
            lotSizeFilter: null,
            minNotionalFilter: null,
            marketLotSizeFilter: null,
            maxNumOrdersFilter: null,
            maxNumAlgoOrdersFilter: null,
            percentPriceFilter: null
        };

        for (const filter of symbolInfo.filters) {
            switch (filter.filterType) {
                case 'PRICE_FILTER':
                    rules.priceFilter = {
                        minPrice: parseFloat(filter.minPrice),
                        maxPrice: parseFloat(filter.maxPrice),
                        tickSize: parseFloat(filter.tickSize)
                    };
                    break;
                
                case 'LOT_SIZE':
                    rules.lotSizeFilter = {
                        minQty: parseFloat(filter.minQty),
                        maxQty: parseFloat(filter.maxQty),
                        stepSize: parseFloat(filter.stepSize)
                    };
                    break;
                
                case 'MIN_NOTIONAL':
                    rules.minNotionalFilter = {
                        minNotional: parseFloat(filter.minNotional),
                        applyToMarket: filter.applyToMarket,
                        avgPriceMins: parseInt(filter.avgPriceMins)
                    };
                    break;
                
                case 'MARKET_LOT_SIZE':
                    rules.marketLotSizeFilter = {
                        minQty: parseFloat(filter.minQty),
                        maxQty: parseFloat(filter.maxQty),
                        stepSize: parseFloat(filter.stepSize)
                    };
                    break;
                
                case 'MAX_NUM_ORDERS':
                    rules.maxNumOrdersFilter = {
                        maxNumOrders: parseInt(filter.maxNumOrders)
                    };
                    break;
                
                case 'MAX_NUM_ALGO_ORDERS':
                    rules.maxNumAlgoOrdersFilter = {
                        maxNumAlgoOrders: parseInt(filter.maxNumAlgoOrders)
                    };
                    break;
                
                case 'PERCENT_PRICE':
                    rules.percentPriceFilter = {
                        multiplierUp: parseFloat(filter.multiplierUp),
                        multiplierDown: parseFloat(filter.multiplierDown),
                        avgPriceMins: parseInt(filter.avgPriceMins)
                    };
                    break;
            }
        }

        return rules;
    }

    /**
     * Quantize value to nearest step (truncate by default)
     */
    quantize(value, step, roundMode = 'truncate') {
        if (!step || step <= 0) return value;
        
        switch (roundMode) {
            case 'round':
                return Math.round(value / step) * step;
            case 'ceil':
                return Math.ceil(value / step) * step;
            case 'truncate':
            default:
                return Math.floor(value / step) * step;
        }
    }

    /**
     * Assert price filters and throw detailed error
     */
    assertPriceFilters(price, symbol, field = 'price') {
        const rules = this.symbolRules.get(symbol);
        if (!rules || !rules.priceFilter) return;

        const { minPrice, maxPrice, tickSize } = rules.priceFilter;

        // Min/Max price check
        if (minPrice > 0 && price < minPrice) {
            throw new FilterError(
                `PRICE_FILTER:min - ${field}=${price} < minPrice=${minPrice}`,
                'PRICE_FILTER',
                'MIN_PRICE',
                symbol,
                field,
                { value: price, rule: minPrice, suggestion: minPrice }
            );
        }

        if (maxPrice > 0 && price > maxPrice) {
            throw new FilterError(
                `PRICE_FILTER:max - ${field}=${price} > maxPrice=${maxPrice}`,
                'PRICE_FILTER',
                'MAX_PRICE',
                symbol,
                field,
                { value: price, rule: maxPrice, suggestion: maxPrice }
            );
        }

        // Tick size check
        if (tickSize > 0) {
            const remainder = Math.abs((price / tickSize) - Math.round(price / tickSize));
            if (remainder > 1e-9) {
                const suggestion = this.quantize(price, tickSize, 'round');
                throw new FilterError(
                    `PRICE_FILTER:tick - ${field}=${price} not on tick grid (step=${tickSize})`,
                    'PRICE_FILTER',
                    'TICK_SIZE',
                    symbol,
                    field,
                    { value: price, rule: tickSize, suggestion, remainder }
                );
            }
        }
    }

    /**
     * Assert lot size filters and throw detailed error
     */
    assertLotSizeFilters(quantity, symbol, isMarketOrder = false, field = 'quantity') {
        const rules = this.symbolRules.get(symbol);
        if (!rules) return;

        const filter = isMarketOrder && rules.marketLotSizeFilter ? 
            rules.marketLotSizeFilter : rules.lotSizeFilter;
        
        if (!filter) return;

        const { minQty, maxQty, stepSize } = filter;

        // Min/Max quantity check
        if (minQty > 0 && quantity < minQty) {
            throw new FilterError(
                `LOT_SIZE:min - ${field}=${quantity} < minQty=${minQty}`,
                isMarketOrder ? 'MARKET_LOT_SIZE' : 'LOT_SIZE',
                'MIN_QTY',
                symbol,
                field,
                { value: quantity, rule: minQty, suggestion: minQty }
            );
        }

        if (maxQty > 0 && quantity > maxQty) {
            throw new FilterError(
                `LOT_SIZE:max - ${field}=${quantity} > maxQty=${maxQty}`,
                isMarketOrder ? 'MARKET_LOT_SIZE' : 'LOT_SIZE',
                'MAX_QTY',
                symbol,
                field,
                { value: quantity, rule: maxQty, suggestion: maxQty }
            );
        }

        // Step size check
        if (stepSize > 0) {
            const remainder = Math.abs((quantity / stepSize) - Math.round(quantity / stepSize));
            if (remainder > 1e-9) {
                const suggestion = this.quantize(quantity, stepSize, 'round');
                throw new FilterError(
                    `LOT_SIZE:step - ${field}=${quantity} not on step grid (step=${stepSize})`,
                    isMarketOrder ? 'MARKET_LOT_SIZE' : 'LOT_SIZE',
                    'STEP_SIZE',
                    symbol,
                    field,
                    { value: quantity, rule: stepSize, suggestion, remainder }
                );
            }
        }
    }

    /**
     * Assert notional value filters
     */
    assertNotionalFilters(notional, symbol, isMarketOrder = false, field = 'notional') {
        const rules = this.symbolRules.get(symbol);
        if (!rules || !rules.minNotionalFilter) return;

        const { minNotional, applyToMarket } = rules.minNotionalFilter;

        // Check if filter applies to this order type
        if (isMarketOrder && !applyToMarket) return;

        if (minNotional > 0 && notional < minNotional) {
            throw new FilterError(
                `MIN_NOTIONAL - ${field}=${notional} < minNotional=${minNotional}`,
                'MIN_NOTIONAL',
                'MIN_NOTIONAL',
                symbol,
                field,
                { value: notional, rule: minNotional, suggestion: minNotional }
            );
        }
    }

    /**
     * Get valid price suggestion (nearest valid price)
     */
    getValidPrice(price, symbol, roundMode = 'round') {
        const rules = this.symbolRules.get(symbol);
        if (!rules || !rules.priceFilter) return price;

        const { minPrice, maxPrice, tickSize } = rules.priceFilter;
        
        // Quantize to tick size
        let validPrice = tickSize > 0 ? this.quantize(price, tickSize, roundMode) : price;
        
        // Clamp to min/max
        if (minPrice > 0) validPrice = Math.max(validPrice, minPrice);
        if (maxPrice > 0) validPrice = Math.min(validPrice, maxPrice);
        
        return validPrice;
    }

    /**
     * Get valid quantity suggestion
     */
    getValidQuantity(quantity, symbol, isMarketOrder = false, roundMode = 'round') {
        const rules = this.symbolRules.get(symbol);
        if (!rules) return quantity;

        const filter = isMarketOrder && rules.marketLotSizeFilter ? 
            rules.marketLotSizeFilter : rules.lotSizeFilter;
        
        if (!filter) return quantity;

        const { minQty, maxQty, stepSize } = filter;
        
        // Quantize to step size
        let validQty = stepSize > 0 ? this.quantize(quantity, stepSize, roundMode) : quantity;
        
        // Clamp to min/max
        if (minQty > 0) validQty = Math.max(validQty, minQty);
        if (maxQty > 0) validQty = Math.min(validQty, maxQty);
        
        return validQty;
    }

    /**
     * Validate complete order and return suggestions
     */
    validateOrder(order) {
        const { symbol, price, quantity, side, type } = order;
        const isMarketOrder = type === 'MARKET';
        const notional = price * quantity;
        
        const result = {
            valid: true,
            errors: [],
            warnings: [],
            suggestions: {
                price: price,
                quantity: quantity,
                notional: notional
            }
        };

        try {
            // Check symbol exists and is tradeable
            const rules = this.symbolRules.get(symbol);
            if (!rules) {
                result.errors.push(`Symbol ${symbol} not found in exchange rules`);
                result.valid = false;
                return result;
            }

            if (rules.status !== 'TRADING') {
                result.errors.push(`Symbol ${symbol} status is ${rules.status}, not TRADING`);
                result.valid = false;
                return result;
            }

            // Validate price (for limit orders)
            if (!isMarketOrder && price > 0) {
                this.assertPriceFilters(price, symbol, 'price');
                result.suggestions.price = this.getValidPrice(price, symbol);
            }

            // Validate quantity
            this.assertLotSizeFilters(quantity, symbol, isMarketOrder, 'quantity');
            result.suggestions.quantity = this.getValidQuantity(quantity, symbol, isMarketOrder);

            // Validate notional
            const adjustedNotional = result.suggestions.price * result.suggestions.quantity;
            this.assertNotionalFilters(adjustedNotional, symbol, isMarketOrder, 'notional');
            result.suggestions.notional = adjustedNotional;

            // Check if suggestions differ from original
            if (Math.abs(result.suggestions.price - price) > 1e-9) {
                result.warnings.push(`Price adjusted from ${price} to ${result.suggestions.price}`);
            }
            
            if (Math.abs(result.suggestions.quantity - quantity) > 1e-9) {
                result.warnings.push(`Quantity adjusted from ${quantity} to ${result.suggestions.quantity}`);
            }

        } catch (error) {
            if (error instanceof FilterError) {
                result.errors.push(error.message);
                result.valid = false;
                
                // Add suggestion from error
                if (error.details.suggestion !== undefined) {
                    const field = error.field;
                    if (field === 'price') result.suggestions.price = error.details.suggestion;
                    if (field === 'quantity') result.suggestions.quantity = error.details.suggestion;
                }
            } else {
                result.errors.push(`Validation error: ${error.message}`);
                result.valid = false;
            }
        }

        return result;
    }

    /**
     * Get symbol rules
     */
    getSymbolRules(symbol) {
        return this.symbolRules.get(symbol);
    }

    /**
     * Get all symbols with status
     */
    getAllSymbols() {
        return Array.from(this.symbolRules.entries()).map(([symbol, rules]) => ({
            symbol,
            status: rules.status,
            baseAsset: rules.baseAsset,
            quoteAsset: rules.quoteAsset
        }));
    }

    /**
     * Check if rules are stale (need refresh)
     */
    isStale(maxAgeMs = 24 * 60 * 60 * 1000) { // 24 hours default
        return Date.now() - this.lastRulesUpdate > maxAgeMs;
    }

    /**
     * Get guard statistics
     */
    getStats() {
        return {
            symbolCount: this.symbolRules.size,
            lastUpdate: this.lastRulesUpdate,
            rulesVersion: this.rulesVersion,
            isStale: this.isStale(),
            ageMinutes: Math.floor((Date.now() - this.lastRulesUpdate) / 60000)
        };
    }
}

/**
 * Custom error for filter violations
 */
class FilterError extends Error {
    constructor(message, filterType, violation, symbol, field, details) {
        super(message);
        this.name = 'FilterError';
        this.filterType = filterType;
        this.violation = violation;
        this.symbol = symbol;
        this.field = field;
        this.details = details;
    }
}

module.exports = {
    ExchangeRulesGuard,
    FilterError
};
