/**
 * Synthetic Market Simulator - BR-02
 * Generates synthetic market flow by regime: trend/range/breakout/illiquid/shock
 * Produces realistic microstructure with spread, depth, queue dynamics
 */

import { EventEmitter } from 'events';

interface SimManifest {
    simId: string;
    seed: number;
    symbols: string[];
    regime: 'trend' | 'range' | 'breakout' | 'illiquid' | 'shock';
    durationMin: number;
    tf: 'M1' | 'M5';
    params: {
        volBps: number;
        drift?: number;
        meanReversionK?: number;
        shockTimes?: number[];
    };
}

interface SimControl {
    cmd: 'start' | 'pause' | 'resume' | 'stop';
    speed?: '1' | '2' | '5' | 'bar';
}

interface MarketRefs {
    symbol: string;
    bid: number;
    ask: number;
    last: number;
    volume: number;
    timestamp: number;
    source: string;
    synthetic: boolean;
}

interface MarketTradeTick {
    symbol: string;
    price: number;
    size: number;
    side: 'buy' | 'sell';
    timestamp: number;
    source: string;
}

interface FundingSnapshot {
    symbol: string;
    rate: number;
    nextFunding: number;
    premium: number;
    timestamp: number;
}

interface SimStatus {
    state: 'idle' | 'running' | 'paused' | 'stopped' | 'error';
    simId: string;
    progressPct: number;
    currentTime: number;
    elapsedMin: number;
    remainingMin: number;
}

interface SimMetrics {
    eventsPerSec: number;
    avgSpreadBps: number;
    realizedVolBps: number;
    priceRange: { min: number; max: number };
    windowSec: number;
}

interface SimAlert {
    level: 'info' | 'warn' | 'error';
    message: string;
    context: any;
    timestamp: string;
}

interface PriceState {
    price: number;
    drift: number;
    volatility: number;
    ouLevel: number; // Ornstein-Uhlenbeck level for mean reversion
    lastShockTime: number;
    shockDecay: number;
}

interface MicrostructureState {
    spread: number;
    depth: number;
    queueSkew: number; // Bid/ask queue imbalance
}

interface Config {
    micro: {
        spreadBaseBps: number;
        depthUSD: number;
        queueSkew: number;
    };
    shock: {
        jumpSigma: number;
        decayHalfLifeSec: number;
    };
    ou: { // Ornstein-Uhlenbeck for range regime
        theta: number;
        sigmaBps: number;
    };
    drift: {
        trendBpsPerBar: number;
    };
    maxEventsPerSec: number;
    tz: string;
}

class SyntheticMarketSimulator extends EventEmitter {
    private config: Config;
    private logger: any;
    private isInitialized: boolean = false;
    
    // Simulation state
    private currentSim: SimManifest | null = null;
    private simState: SimStatus = {
        state: 'idle',
        simId: '',
        progressPct: 0,
        currentTime: 0,
        elapsedMin: 0,
        remainingMin: 0
    };
    
    // Price states by symbol
    private priceStates: Map<string, PriceState> = new Map();
    private microStates: Map<string, MicrostructureState> = new Map();
    
    // Simulation control
    private simTimer: NodeJS.Timeout | null = null;
    private speedMultiplier: number = 1;
    private barIntervalMs: number = 60000; // Default 1 minute
    
    // Random number generator (seeded)
    private rng: { next: () => number };
    
    // Statistics
    private stats: {
        totalEvents: number;
        avgSpreadBps: number;
        realizedVolBps: number;
        priceRanges: Map<string, { min: number; max: number }>;
        windowStart: number;
    } = {
        totalEvents: 0,
        avgSpreadBps: 0,
        realizedVolBps: 0,
        priceRanges: new Map(),
        windowStart: Date.now()
    };

    constructor(config: Partial<Config> = {}) {
        super();
        this.config = {
            micro: {
                spreadBaseBps: 8,
                depthUSD: 1e6,
                queueSkew: 0.6
            },
            shock: {
                jumpSigma: 8,
                decayHalfLifeSec: 120
            },
            ou: {
                theta: 0.05,
                sigmaBps: 15
            },
            drift: {
                trendBpsPerBar: 5
            },
            maxEventsPerSec: 100,
            tz: 'Europe/Istanbul',
            ...config
        };

        // Initialize seeded RNG
        this.rng = this.createSeededRNG(12345); // Default seed

        // Metrics emission
        setInterval(() => {
            this.emitMetrics();
        }, 60000);
    }

    async initialize(logger: any): Promise<boolean> {
        try {
            this.logger = logger;
            this.logger.info('SyntheticMarketSimulator initializing...');
            
            this.isInitialized = true;
            this.logger.info('SyntheticMarketSimulator initialized successfully');
            return true;
        } catch (error) {
            this.logger.error('SyntheticMarketSimulator initialization error:', error);
            return false;
        }
    }

    /**
     * Process simulation manifest
     */
    async processSimManifest(data: SimManifest): Promise<void> {
        if (!this.isInitialized) return;

        try {
            // Stop any current simulation
            if (this.simState.state === 'running' || this.simState.state === 'paused') {
                await this.stopSimulation();
            }

            this.currentSim = data;
            
            // Initialize RNG with provided seed
            this.rng = this.createSeededRNG(data.seed);
            
            // Set bar interval based on timeframe
            this.barIntervalMs = data.tf === 'M1' ? 60000 : 5 * 60000;
            
            // Initialize price and microstructure states
            this.initializeStates(data);
            
            // Update simulation status
            this.simState = {
                state: 'idle',
                simId: data.simId,
                progressPct: 0,
                currentTime: Date.now(),
                elapsedMin: 0,
                remainingMin: data.durationMin
            };

            this.emitStatus();
            this.logger.info(`SyntheticMarketSimulator loaded manifest ${data.simId}: ${data.regime} regime, ${data.durationMin}min`);

        } catch (error) {
            this.logger.error('SyntheticMarketSimulator manifest processing error:', error);
            await this.emitAlert('error', `Failed to process manifest: ${error.message}`);
        }
    }

    /**
     * Process simulation control commands
     */
    async processSimControl(data: SimControl): Promise<void> {
        if (!this.isInitialized) return;

        try {
            switch (data.cmd) {
                case 'start':
                    await this.startSimulation();
                    break;
                case 'pause':
                    await this.pauseSimulation();
                    break;
                case 'resume':
                    await this.resumeSimulation();
                    break;
                case 'stop':
                    await this.stopSimulation();
                    break;
            }

            // Update speed if provided
            if (data.speed) {
                this.updateSpeed(data.speed);
            }

        } catch (error) {
            this.logger.error('SyntheticMarketSimulator control processing error:', error);
            await this.emitAlert('error', `Control command failed: ${error.message}`);
        }
    }

    private async startSimulation(): Promise<void> {
        if (!this.currentSim) {
            throw new Error('No simulation manifest loaded');
        }

        if (this.simState.state === 'running') {
            return; // Already running
        }

        this.simState.state = 'running';
        this.simState.currentTime = Date.now();
        
        // Start simulation loop
        this.startSimulationLoop();
        
        this.emitStatus();
        await this.emitAlert('info', `Simulation ${this.currentSim.simId} started`);
    }

    private async pauseSimulation(): Promise<void> {
        if (this.simState.state !== 'running') {
            return;
        }

        this.simState.state = 'paused';
        
        if (this.simTimer) {
            clearInterval(this.simTimer);
            this.simTimer = null;
        }
        
        this.emitStatus();
        await this.emitAlert('info', 'Simulation paused');
    }

    private async resumeSimulation(): Promise<void> {
        if (this.simState.state !== 'paused') {
            return;
        }

        this.simState.state = 'running';
        this.startSimulationLoop();
        
        this.emitStatus();
        await this.emitAlert('info', 'Simulation resumed');
    }

    private async stopSimulation(): Promise<void> {
        this.simState.state = 'stopped';
        
        if (this.simTimer) {
            clearInterval(this.simTimer);
            this.simTimer = null;
        }
        
        this.emitStatus();
        await this.emitAlert('info', 'Simulation stopped');
    }

    private updateSpeed(speed: '1' | '2' | '5' | 'bar'): void {
        switch (speed) {
            case '1': this.speedMultiplier = 1; break;
            case '2': this.speedMultiplier = 2; break;
            case '5': this.speedMultiplier = 5; break;
            case 'bar': this.speedMultiplier = 100; break; // Very fast for bar-by-bar
        }
    }

    private startSimulationLoop(): void {
        if (!this.currentSim) return;

        const intervalMs = Math.max(10, 1000 / (this.config.maxEventsPerSec * this.speedMultiplier));
        
        this.simTimer = setInterval(() => {
            this.simulationTick();
        }, intervalMs);
    }

    private simulationTick(): void {
        if (!this.currentSim || this.simState.state !== 'running') {
            return;
        }

        try {
            // Update elapsed time
            const now = Date.now();
            const elapsedMs = now - this.simState.currentTime;
            this.simState.elapsedMin = elapsedMs / 60000;
            this.simState.remainingMin = Math.max(0, this.currentSim.durationMin - this.simState.elapsedMin);
            this.simState.progressPct = (this.simState.elapsedMin / this.currentSim.durationMin) * 100;

            // Check if simulation is complete
            if (this.simState.elapsedMin >= this.currentSim.durationMin) {
                this.stopSimulation();
                return;
            }

            // Generate market data for each symbol
            for (const symbol of this.currentSim.symbols) {
                this.generateMarketData(symbol, now);
            }

            // Update status periodically
            if (Math.floor(this.simState.progressPct) % 5 === 0) {
                this.emitStatus();
            }

        } catch (error) {
            this.logger.error('SyntheticMarketSimulator tick error:', error);
            this.simState.state = 'error';
            this.emitStatus();
        }
    }

    private generateMarketData(symbol: string, timestamp: number): void {
        const priceState = this.priceStates.get(symbol);
        const microState = this.microStates.get(symbol);
        
        if (!priceState || !microState || !this.currentSim) return;

        // Update price based on regime
        this.updatePriceByRegime(priceState, this.currentSim.regime, this.currentSim.params);
        
        // Update microstructure
        this.updateMicrostructure(microState, priceState, this.currentSim.regime);
        
        // Generate market refs
        const spread = (priceState.price * microState.spread) / 10000; // Convert bps to price
        const bid = priceState.price - spread / 2;
        const ask = priceState.price + spread / 2;

        const marketRefs: MarketRefs = {
            symbol,
            bid,
            ask,
            last: priceState.price,
            volume: this.generateVolume(microState.depth),
            timestamp,
            source: 'synthetic',
            synthetic: true
        };

        this.emit('market.refs', marketRefs);

        // Occasionally generate trade ticks
        if (this.rng.next() < 0.1) { // 10% chance
            const tradeTick: MarketTradeTick = {
                symbol,
                price: this.rng.next() > 0.5 ? ask : bid,
                size: this.generateTradeSize(),
                side: this.rng.next() > 0.5 ? 'buy' : 'sell',
                timestamp,
                source: 'synthetic'
            };

            this.emit('market.trade.tick', tradeTick);
        }

        // Update statistics
        this.updateStats(symbol, marketRefs, microState);
        this.stats.totalEvents++;
    }

    private updatePriceByRegime(priceState: PriceState, regime: string, params: SimManifest['params']): void {
        const dt = 1; // Time step (normalized)
        let priceChange = 0;

        switch (regime) {
            case 'trend':
                // Trending market with drift
                const drift = params.drift || this.config.drift.trendBpsPerBar;
                priceChange = (drift / 10000) * priceState.price * dt;
                priceChange += this.generateNoise(params.volBps) * priceState.price;
                break;

            case 'range':
                // Mean-reverting range-bound market (Ornstein-Uhlenbeck)
                const theta = this.config.ou.theta;
                const sigma = this.config.ou.sigmaBps / 10000;
                const meanReversion = -theta * (priceState.price - priceState.ouLevel) * dt;
                const diffusion = sigma * Math.sqrt(dt) * this.gaussianRandom();
                priceChange = meanReversion * priceState.price + diffusion * priceState.price;
                break;

            case 'breakout':
                // High volatility breakout with momentum
                const momentum = priceState.drift * 0.8; // Momentum persistence
                priceState.drift = momentum + this.generateNoise(params.volBps * 2);
                priceChange = priceState.drift * priceState.price;
                break;

            case 'illiquid':
                // Low volume, wide spreads, occasional jumps
                if (this.rng.next() < 0.02) { // 2% chance of jump
                    priceChange = this.generateNoise(params.volBps * 3) * priceState.price;
                } else {
                    priceChange = this.generateNoise(params.volBps * 0.5) * priceState.price;
                }
                break;

            case 'shock':
                // Market shock with decay
                this.applyShockIfScheduled(priceState, params.shockTimes || []);
                priceChange = this.generateNoise(params.volBps) * priceState.price;
                priceChange += priceState.shockDecay * priceState.price;
                
                // Decay shock effect
                priceState.shockDecay *= Math.exp(-Math.log(2) / this.config.shock.decayHalfLifeSec);
                break;
        }

        // Apply price change
        priceState.price = Math.max(0.01, priceState.price + priceChange);
        
        // Update volatility estimate (EWMA)
        const returnPct = Math.abs(priceChange / priceState.price) * 100;
        priceState.volatility = 0.94 * priceState.volatility + 0.06 * returnPct;
    }

    private updateMicrostructure(microState: MicrostructureState, priceState: PriceState, regime: string): void {
        // Adjust spread based on regime and volatility
        let spreadMultiplier = 1.0;
        
        switch (regime) {
            case 'illiquid':
                spreadMultiplier = 2.0 + priceState.volatility * 0.1;
                break;
            case 'shock':
                spreadMultiplier = 1.5 + Math.abs(priceState.shockDecay) * 10;
                break;
            case 'breakout':
                spreadMultiplier = 1.2 + priceState.volatility * 0.05;
                break;
            default:
                spreadMultiplier = 1.0 + priceState.volatility * 0.02;
        }

        microState.spread = this.config.micro.spreadBaseBps * spreadMultiplier;
        
        // Adjust depth inversely with spread
        microState.depth = this.config.micro.depthUSD / spreadMultiplier;
        
        // Random queue skew
        microState.queueSkew = this.config.micro.queueSkew + (this.rng.next() - 0.5) * 0.2;
    }

    private applyShockIfScheduled(priceState: PriceState, shockTimes: number[]): void {
        const currentMinute = Math.floor(this.simState.elapsedMin);
        
        for (const shockTime of shockTimes) {
            if (Math.abs(currentMinute - shockTime) < 0.1 && 
                Math.abs(currentMinute - priceState.lastShockTime) > 1) {
                
                // Apply shock
                const shockMagnitude = this.gaussianRandom() * this.config.shock.jumpSigma / 100;
                priceState.shockDecay = shockMagnitude;
                priceState.lastShockTime = currentMinute;
                
                this.logger.info(`SyntheticMarketSimulator applied shock: ${(shockMagnitude * 100).toFixed(2)}%`);
                break;
            }
        }
    }

    private generateNoise(volBps: number): number {
        return this.gaussianRandom() * (volBps / 10000);
    }

    private generateVolume(depth: number): number {
        // Generate random volume based on depth
        return depth * (0.1 + this.rng.next() * 0.9);
    }

    private generateTradeSize(): number {
        // Log-normal distribution for trade sizes
        const u = this.rng.next();
        const v = this.rng.next();
        const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
        return Math.max(0.01, Math.exp(z * 0.5 + 2)); // Mean around $7.39
    }

    private initializeStates(manifest: SimManifest): void {
        this.priceStates.clear();
        this.microStates.clear();

        for (const symbol of manifest.symbols) {
            // Initialize with reasonable crypto prices
            const basePrice = symbol.includes('BTC') ? 50000 : 
                             symbol.includes('ETH') ? 3000 : 
                             symbol.includes('BNB') ? 400 : 1;

            this.priceStates.set(symbol, {
                price: basePrice,
                drift: 0,
                volatility: manifest.params.volBps / 10000,
                ouLevel: basePrice, // Mean reversion level
                lastShockTime: -999,
                shockDecay: 0
            });

            this.microStates.set(symbol, {
                spread: this.config.micro.spreadBaseBps,
                depth: this.config.micro.depthUSD,
                queueSkew: this.config.micro.queueSkew
            });
        }
    }

    private updateStats(symbol: string, marketRefs: MarketRefs, microState: MicrostructureState): void {
        // Track price ranges
        const range = this.stats.priceRanges.get(symbol) || { min: marketRefs.last, max: marketRefs.last };
        range.min = Math.min(range.min, marketRefs.last);
        range.max = Math.max(range.max, marketRefs.last);
        this.stats.priceRanges.set(symbol, range);

        // Update average spread
        this.stats.avgSpreadBps = (this.stats.avgSpreadBps * 0.95) + (microState.spread * 0.05);

        // Update realized volatility (simplified)
        const priceState = this.priceStates.get(symbol);
        if (priceState) {
            this.stats.realizedVolBps = (this.stats.realizedVolBps * 0.95) + (priceState.volatility * 100 * 0.05);
        }
    }

    private createSeededRNG(seed: number): { next: () => number } {
        let state = seed;
        return {
            next: () => {
                state = (state * 1664525 + 1013904223) % 0x100000000;
                return state / 0x100000000;
            }
        };
    }

    private gaussianRandom(): number {
        // Box-Muller transform for Gaussian random numbers
        const u1 = this.rng.next();
        const u2 = this.rng.next();
        return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    }

    private emitStatus(): void {
        this.emit('sim.status', { ...this.simState });
    }

    private emitMetrics(): void {
        const metrics: SimMetrics = {
            eventsPerSec: this.stats.totalEvents / 60, // Events in last minute
            avgSpreadBps: Math.round(this.stats.avgSpreadBps),
            realizedVolBps: Math.round(this.stats.realizedVolBps),
            priceRange: this.stats.priceRanges.size > 0 
                ? Array.from(this.stats.priceRanges.values())[0] 
                : { min: 0, max: 0 },
            windowSec: 60
        };

        this.emit('sim.metrics', metrics);

        // Reset event counter
        this.stats.totalEvents = 0;
    }

    private async emitAlert(level: 'info' | 'warn' | 'error', message: string, context?: any): Promise<void> {
        const alert: SimAlert = {
            level,
            message,
            context: context || {},
            timestamp: new Date().toISOString()
        };

        this.emit('sim.alert', alert);
    }

    /**
     * Get module status
     */
    getStatus(): any {
        return {
            name: 'SyntheticMarketSimulator',
            initialized: this.isInitialized,
            currentSim: this.currentSim?.simId || null,
            simState: this.simState,
            priceStates: this.priceStates.size,
            stats: this.stats
        };
    }

    async shutdown(): Promise<void> {
        try {
            this.logger.info('SyntheticMarketSimulator shutting down...');
            
            if (this.simTimer) {
                clearInterval(this.simTimer);
                this.simTimer = null;
            }
            
            this.removeAllListeners();
            this.priceStates.clear();
            this.microStates.clear();
            this.isInitialized = false;
            this.logger.info('SyntheticMarketSimulator shutdown complete');
        } catch (error) {
            this.logger.error('SyntheticMarketSimulator shutdown error:', error);
        }
    }
}

export default SyntheticMarketSimulator;
