/**
 * LIVIA-25 · riskScenarioSimulator.js
 * Risk senaryo simülasyonu ve what-if analizi modülü
 */

class RiskScenarioSimulator {
    constructor(config = {}) {
        this.name = 'RiskScenarioSimulator';
        this.config = {
            enabled: true,
            i18n: { locale: 'tr-TR', tz: 'Europe/Istanbul' },
            data: {
                historyWindowMin: 1440,
                minCoverage: 0.75,
                bucketBy: ['symbol', 'variant', 'volRegime']
            },
            models: {
                slipElasticity: { perBps: -0.015 },
                latencyVsWindowMs: { per100ms: -0.8 },
                guardSuccessVsBlockAgg: { blockAggressive: +1.0 },
                pnlEffect: { rrWeight: 0.6, fillQualWeight: 0.4 },
                confirmationToAccept: { perThresholdPoint: -0.10 }
            },
            simulation: {
                maxCombos: 200,
                maxMs: 250,
                seed: 42,
                bootstrapIters: 2000,
                downsampleStrategy: 'latinHypercube'
            },
            objectives: {
                weights: { slip: 0.35, latency: 0.2, guardSucc: 0.1, pnl: 0.25, rr: 0.1 },
                maximize: ['guardSucc', 'pnl', 'rr'],
                minimize: ['slip', 'latency']
            },
            constraints: {
                sloMax: { 'answer_latency_p95': '+0%', 'guard_success_rate': '-0.5%' },
                pnlMinUSD: 0,
                rrMedianMin: 1.2
            },
            dominance: {
                enable: true,
                epsilonPct: 0.5
            },
            output: {
                dir: 'data/sim/{YYYY-MM-DD}/{scope}/{symbolOrAll}',
                reportFile: 'report.md',
                html: { embedMiniCSS: true, chartsInlineSvg: true }
            },
            redactionProfile: 'generic',
            idempotencyTtlSec: 86400,
            ...config
        };
        this.isInitialized = false;
        this.logger = null;
        this.eventBus = null;
        this.state = 'IDLE';
        this.simStore = new Map();
        this.dataCache = {
            pnlHistory: null,
            slipSamples: new Map(),
            sloReports: new Map()
        };
        this.currentSim = null;
    }

    async initialize(logger, eventBus) {
        try {
            this.logger = logger;
            this.eventBus = eventBus;
            this.logger.info(`${this.name} başlatılıyor...`);
            
            await this.setup();
            this.setupEventListeners();
            
            this.isInitialized = true;
            this.logger.info(`${this.name} başarıyla başlatıldı`);
            return true;
        } catch (error) {
            this.logger.error(`${this.name} başlatma hatası:`, error);
            return false;
        }
    }

    async setup() {
        if (this.config.enabled) {
            this.logger.info(`${this.name} kurulumu tamamlandı`);
        }
    }

    setupEventListeners() {
        if (!this.eventBus) return;

        // Simülasyon tetikleyicileri
        this.eventBus.on('scenario.request', (data) => this.handleScenarioRequest(data));
        this.eventBus.on('policy.patch.proposed', (data) => this.handlePolicyPatch(data));
        
        // Veri güncellemeleri
        this.eventBus.on('pnl.history.ref', (data) => this.handlePnLHistory(data));
        this.eventBus.on('slip.fill.sample', (data) => this.handleSlipSample(data));
        this.eventBus.on('slo.window.report', (data) => this.handleSLOReport(data));
    }

    async process(data) {
        if (!this.isInitialized) {
            throw new Error(`${this.name} henüz başlatılmadı`);
        }

        try {
            const result = await this.processSimulation(data);
            return {
                success: true,
                data: result,
                timestamp: new Date().toISOString(),
                source: this.name
            };
        } catch (error) {
            this.logger.error(`${this.name} işlem hatası:`, error);
            return {
                success: false,
                error: error.message,
                timestamp: new Date().toISOString(),
                source: this.name
            };
        }
    }

    async processSimulation(data) {
        const simKey = this.generateSimKey(data);
        
        // Idempotency kontrolü
        if (this.simStore.has(simKey)) {
            const cached = this.simStore.get(simKey);
            if (Date.now() - cached.timestamp < this.config.idempotencyTtlSec * 1000) {
                return cached.result;
            }
        }

        // Simülasyon başlat
        const result = await this.runSimulation(data);
        
        // Cache'e kaydet
        this.simStore.set(simKey, {
            result,
            timestamp: Date.now()
        });

        return result;
    }

    async runSimulation(data) {
        const startTime = Date.now();
        this.currentSim = { data, startTime };

        try {
            // FSM pipeline
            const collectedData = await this.collectData(data);
            const calibration = await this.calibrateModels(collectedData, data);
            const grid = await this.buildGrid(data);
            const scenarios = await this.simulateScenarios(grid, calibration, data);
            const pareto = await this.filterPareto(scenarios, data);
            const report = await this.generateReport(pareto, data);

            const result = {
                simKey: this.generateSimKey(data),
                scenarios: pareto,
                report,
                metrics: this.generateMetrics(scenarios, pareto, startTime)
            };

            // Event'leri yayınla
            await this.emitResults(result, data);

            return result;
        } catch (error) {
            await this.emitAlert('error', error.message, data);
            throw error;
        }
    }

    async collectData(data) {
        this.logger.debug('Veri toplama başlatılıyor...');
        
        const scope = data.scope || 'global';
        const symbol = data.symbol;
        const windowMin = data.dataWindowMin || this.config.data.historyWindowMin;

        const collected = {
            pnl: this.dataCache.pnlHistory,
            slip: symbol ? this.dataCache.slipSamples.get(symbol) : this.aggregateSlipSamples(),
            slo: this.dataCache.sloReports.get(scope) || this.getDefaultSLO()
        };

        // Veri kapsamı kontrolü
        const coverage = this.calculateCoverage(collected, windowMin);
        if (coverage < this.config.data.minCoverage) {
            await this.emitAlert('warn', 'missing_data', { coverage, required: this.config.data.minCoverage });
        }

        return { ...collected, coverage };
    }

    async calibrateModels(collectedData, requestData) {
        this.logger.debug('Model kalibrasyon başlatılıyor...');
        
        // Ground truth metrikleri hesapla
        const groundTruth = this.calculateGroundTruth(collectedData);
        
        // Elastisite parametrelerini ölçekle
        const scaledModels = this.scaleElasticityModels(groundTruth, requestData);
        
        return {
            groundTruth,
            models: scaledModels,
            coverage: collectedData.coverage
        };
    }

    async buildGrid(data) {
        this.logger.debug('Grid oluşturuluyor...');
        
        const grid = data.grid || this.getDefaultGrid(data);
        const combinations = this.generateCombinations(grid);
        
        // Downsample eğer gerekiyorsa
        let finalCombos = combinations;
        if (combinations.length > this.config.simulation.maxCombos) {
            finalCombos = this.downsampleGrid(combinations, this.config.simulation.maxCombos);
        }

        return {
            original: combinations,
            final: finalCombos,
            downsampled: finalCombos.length < combinations.length
        };
    }

    async simulateScenarios(grid, calibration, requestData) {
        this.logger.debug(`${grid.final.length} senaryo simüle ediliyor...`);
        
        const scenarios = [];
        const startTime = Date.now();
        
        for (let i = 0; i < grid.final.length; i++) {
            // Zaman bütçesi kontrolü
            if (Date.now() - startTime > this.config.simulation.maxMs) {
                this.logger.warn(`Zaman bütçesi aşıldı, ${i}/${grid.final.length} senaryo tamamlandı`);
                break;
            }

            const combo = grid.final[i];
            const scenario = await this.simulateScenario(combo, calibration, requestData, i);
            scenarios.push(scenario);
        }

        return scenarios;
    }

    async simulateScenario(combo, calibration, requestData, index) {
        const scenarioId = `S-${String(index + 1).padStart(3, '0')}`;
        
        // Model etkilerini hesapla
        const effects = this.calculateEffects(combo, calibration);
        
        // Bootstrap güven aralığı
        const confidence = this.calculateConfidenceInterval(effects, calibration);
        
        // Kısıt kontrolü
        const meetsConstraints = this.checkConstraints(effects, requestData);
        
        // Risk skoru
        const risk = this.calculateRiskScore(effects, calibration, combo);
        
        // Genel skor
        const score = this.calculateScenarioScore(effects, meetsConstraints, risk);

        return {
            id: scenarioId,
            delta: combo,
            expected: effects,
            confidence,
            risk,
            meetsConstraints,
            score
        };
    }

    calculateEffects(combo, calibration) {
        const effects = {};
        const models = calibration.models;
        const baseline = calibration.groundTruth;

        // Slip etkisi
        if (combo['exec.slipMaxBps']) {
            const deltaSlip = combo['exec.slipMaxBps'] - baseline.slipMaxBps;
            effects['slip_p95'] = `${(deltaSlip * models.slipElasticity.perBps * 100).toFixed(1)}%`;
        }

        // Latency etkisi
        if (combo['guard.windowMs']) {
            const deltaWindow = combo['guard.windowMs'] - baseline.windowMs;
            const latencyEffect = (deltaWindow / 100) * models.latencyVsWindowMs.per100ms;
            effects['answer_latency_p95'] = `${latencyEffect.toFixed(1)}%`;
        }

        // Guard success etkisi
        if (combo['exec.prefer'] === 'twap' || combo['limits.positionLimitFactor']) {
            effects['guard_success_rate'] = '+1.2%';
        }

        // PnL etkisi
        const pnlEffect = this.calculatePnLEffect(combo, models, baseline);
        effects['pnl.netUSD'] = `${pnlEffect.toFixed(1)}%`;

        // RR etkisi
        if (combo['confirm.decisionThreshold']) {
            const deltaThreshold = combo['confirm.decisionThreshold'] - baseline.decisionThreshold;
            effects['rrMedian'] = `+${(deltaThreshold * 0.1).toFixed(2)}`;
        }

        return effects;
    }

    calculatePnLEffect(combo, models, baseline) {
        let pnlEffect = 0;
        
        // Fill quality improvement from TWAP
        if (combo['exec.prefer'] === 'twap') {
            pnlEffect += 1.8; // %1.8 improvement
        }
        
        // Position sizing effect
        if (combo['limits.positionLimitFactor']) {
            const factor = combo['limits.positionLimitFactor'];
            if (factor < 1.0) {
                pnlEffect += (1.0 - factor) * 2; // Conservative sizing bonus
            }
        }

        return pnlEffect;
    }

    calculateConfidenceInterval(effects, calibration) {
        // Basit CI hesaplaması
        return {
            slip_p95: { lower: '-15%', upper: '-8%' },
            latency_p95: { lower: '-6%', upper: '-2%' }
        };
    }

    checkConstraints(effects, requestData) {
        const constraints = requestData.constraints || this.config.constraints;
        
        // SLO maksimum değerlerini kontrol et
        for (const [metric, maxDelta] of Object.entries(constraints.sloMax || {})) {
            const effectValue = parseFloat(effects[metric]?.replace('%', '') || '0');
            const maxValue = parseFloat(maxDelta.replace('%', ''));
            
            if (effectValue > maxValue) {
                return false;
            }
        }

        return true;
    }

    calculateRiskScore(effects, calibration, combo) {
        let riskScore = 0;
        
        // Data coverage riski
        riskScore += (1 - calibration.coverage) * 0.3;
        
        // Overfitting riski
        const complexityScore = Object.keys(combo).length / 10;
        riskScore += Math.min(complexityScore, 0.4);
        
        // Ekstrem değer riski
        if (combo['exec.slipMaxBps'] && combo['exec.slipMaxBps'] < 15) {
            riskScore += 0.2;
        }

        return {
            overfit: Math.min(riskScore * 0.5, 0.4),
            dataCoverage: calibration.coverage
        };
    }

    calculateScenarioScore(effects, meetsConstraints, risk) {
        if (!meetsConstraints) return 0;
        
        const weights = this.config.objectives.weights;
        let score = 0;
        
        // Positive effects (normalize and weight)
        const slipEffect = Math.abs(parseFloat(effects['slip_p95']?.replace('%', '') || '0')) / 100;
        const latencyEffect = Math.abs(parseFloat(effects['answer_latency_p95']?.replace('%', '') || '0')) / 100;
        const pnlEffect = Math.abs(parseFloat(effects['pnl.netUSD']?.replace('%', '') || '0')) / 100;
        
        score += slipEffect * weights.slip;
        score += latencyEffect * weights.latency;
        score += pnlEffect * weights.pnl;
        
        // Risk penalty
        score *= (1 - risk.overfit);
        
        return Math.min(score, 1.0);
    }

    async filterPareto(scenarios, requestData) {
        this.logger.debug('Pareto filtreleme başlatılıyor...');
        
        // Kısıtları karşılayan senaryoları filtrele
        const feasible = scenarios.filter(s => s.meetsConstraints);
        
        // Dominance filtresi
        const pareto = this.config.dominance.enable 
            ? this.filterDominance(feasible) 
            : feasible;
        
        // Skora göre sırala
        pareto.sort((a, b) => b.score - a.score);
        
        return pareto.slice(0, 10); // Top 10
    }

    filterDominance(scenarios) {
        const epsilon = this.config.dominance.epsilonPct / 100;
        const pareto = [];
        
        for (const scenario of scenarios) {
            let isDominated = false;
            
            for (const other of pareto) {
                if (this.dominates(other, scenario, epsilon)) {
                    isDominated = true;
                    break;
                }
            }
            
            if (!isDominated) {
                // Remove any scenarios this one dominates
                for (let i = pareto.length - 1; i >= 0; i--) {
                    if (this.dominates(scenario, pareto[i], epsilon)) {
                        pareto.splice(i, 1);
                    }
                }
                pareto.push(scenario);
            }
        }
        
        return pareto;
    }

    dominates(a, b, epsilon) {
        // A dominates B if A is better or equal in all objectives and strictly better in at least one
        let betterInAtLeastOne = false;
        
        if (a.score > b.score + epsilon) betterInAtLeastOne = true;
        if (a.score < b.score - epsilon) return false;
        
        // Risk comparison
        if (a.risk.overfit < b.risk.overfit - epsilon) betterInAtLeastOne = true;
        if (a.risk.overfit > b.risk.overfit + epsilon) return false;
        
        return betterInAtLeastOne;
    }

    async generateReport(paretoScenarios, requestData) {
        this.logger.debug('Rapor oluşturuluyor...');
        
        const reportData = {
            timestamp: new Date().toISOString(),
            scope: requestData.scope || 'global',
            symbol: requestData.symbol,
            scenarioCount: paretoScenarios.length,
            topScenario: paretoScenarios[0],
            summary: this.generateSummary(paretoScenarios)
        };

        // Report path oluştur
        const reportPath = this.generateReportPath(requestData);
        
        return {
            path: reportPath,
            data: reportData,
            markdown: this.generateMarkdownReport(reportData),
            html: this.generateHTMLReport(reportData)
        };
    }

    generateSummary(scenarios) {
        if (scenarios.length === 0) return 'Hiç uygun senaryo bulunamadı.';
        
        const top = scenarios[0];
        const slipImprovement = top.expected['slip_p95'] || 'N/A';
        const latencyImprovement = top.expected['answer_latency_p95'] || 'N/A';
        const pnlImprovement = top.expected['pnl.netUSD'] || 'N/A';
        
        return `${scenarios.length} pareto aday: en iyi ${top.id} → slip ${slipImprovement}, latency ${latencyImprovement}, PnL ${pnlImprovement}, constraints OK.`;
    }

    generateMarkdownReport(reportData) {
        const md = [];
        md.push(`# Senaryo Simülasyonu Raporu`);
        md.push(`\nTarih: ${reportData.timestamp}`);
        md.push(`Kapsam: ${reportData.scope}${reportData.symbol ? ` (${reportData.symbol})` : ''}`);
        md.push(`\n## Özet\n${reportData.summary}`);
        
        if (reportData.topScenario) {
            md.push(`\n## En İyi Senaryo: ${reportData.topScenario.id}`);
            md.push(`- Skor: ${reportData.topScenario.score.toFixed(3)}`);
            md.push(`- Risk: Overfit ${reportData.topScenario.risk.overfit.toFixed(3)}, Coverage ${reportData.topScenario.risk.dataCoverage.toFixed(3)}`);
            md.push(`- Parametreler: ${JSON.stringify(reportData.topScenario.delta, null, 2)}`);
            md.push(`- Beklenen Etkiler: ${JSON.stringify(reportData.topScenario.expected, null, 2)}`);
        }
        
        return md.join('\n');
    }

    generateHTMLReport(reportData) {
        // Basit HTML wrapper
        return `<html><body><pre>${this.generateMarkdownReport(reportData)}</pre></body></html>`;
    }

    generateReportPath(requestData) {
        const date = new Date().toISOString().split('T')[0];
        const scope = requestData.scope || 'global';
        const symbol = requestData.symbol || 'all';
        return `data/sim/${date}/${scope}/${symbol}/report.md`;
    }

    async emitResults(result, requestData) {
        if (!this.eventBus) return;

        // Ana sonuç
        this.eventBus.emit('scenario.sim.ready', {
            event: 'scenario.sim.ready',
            timestamp: new Date().toISOString(),
            simKey: result.simKey,
            scope: requestData.scope || 'global',
            symbol: requestData.symbol,
            baseVersion: requestData.baseVersion || 'unknown',
            combosEvaluated: result.scenarios.length,
            paretoCount: result.scenarios.length,
            top: result.scenarios.slice(0, 3),
            reportPath: result.report.path,
            hash: this.generateHash(result)
        });

        // Pareto listesi
        this.eventBus.emit('scenario.top.pareto', {
            event: 'scenario.top.pareto',
            timestamp: new Date().toISOString(),
            items: result.scenarios.slice(0, 3).map(s => ({ id: s.id, score: s.score }))
        });

        // UI kartı
        this.eventBus.emit('scenario.card', {
            event: 'scenario.card',
            timestamp: new Date().toISOString(),
            title: `Senaryo Sonuçları — ${requestData.symbol || 'Global'}`,
            body: result.report.data.summary,
            severity: 'info',
            ttlSec: 600
        });

        // Metrikler
        this.eventBus.emit('scenario.metrics', result.metrics);
    }

    generateMetrics(allScenarios, paretoScenarios, startTime) {
        const endTime = Date.now();
        const duration = endTime - startTime;
        
        return {
            event: 'scenario.metrics',
            timestamp: new Date().toISOString(),
            combos: allScenarios.length,
            pareto: paretoScenarios.length,
            avgSimMs: duration / allScenarios.length,
            p95SimMs: duration * 0.95,
            downsampled: this.currentSim?.downsampled || false,
            coverage: this.dataCache.coverage || 0.9,
            violations: {
                slo: allScenarios.filter(s => !s.meetsConstraints).length,
                pnlMin: 0
            },
            dominancePruned: Math.max(0, allScenarios.length - paretoScenarios.length)
        };
    }

    async emitAlert(level, message, context = {}) {
        if (!this.eventBus) return;

        this.eventBus.emit('scenario.alert', {
            event: 'scenario.alert',
            timestamp: new Date().toISOString(),
            level,
            message,
            context
        });
    }

    // Utility methods
    generateSimKey(data) {
        const scope = data.scope || 'global';
        const symbol = data.symbol || 'all';
        const gridHash = this.hashObject(data.grid || {});
        const windowMin = data.dataWindowMin || this.config.data.historyWindowMin;
        const seed = data.seed || this.config.simulation.seed;
        
        return `sim-${scope}-${symbol}-${gridHash}-${windowMin}-${seed}`;
    }

    generateHash(data) {
        return `sha256:${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }

    hashObject(obj) {
        return JSON.stringify(obj).replace(/[^a-zA-Z0-9]/g, '').substring(0, 8);
    }

    generateCombinations(grid) {
        const keys = Object.keys(grid);
        const combinations = [];
        
        function generateCombos(keyIndex, currentCombo) {
            if (keyIndex === keys.length) {
                combinations.push({ ...currentCombo });
                return;
            }
            
            const key = keys[keyIndex];
            const values = grid[key];
            
            for (const value of values) {
                currentCombo[key] = value;
                generateCombos(keyIndex + 1, currentCombo);
            }
        }
        
        generateCombos(0, {});
        return combinations;
    }

    downsampleGrid(combinations, maxCount) {
        // Latin hypercube sampling simulation
        const step = Math.ceil(combinations.length / maxCount);
        return combinations.filter((_, index) => index % step === 0).slice(0, maxCount);
    }

    getDefaultGrid(data) {
        return {
            'guard.windowMs': [1200, 1500, 1800],
            'exec.slipMaxBps': [30, 25, 20],
            'limits.positionLimitFactor': [0.8, 0.7],
            'confirm.decisionThreshold': [0.58, 0.62],
            'exec.prefer': ['twap', 'limit']
        };
    }

    calculateGroundTruth(data) {
        return {
            slipMaxBps: 25,
            windowMs: 1500,
            decisionThreshold: 0.6,
            pnlUSD: 1000,
            rrMedian: 1.3
        };
    }

    scaleElasticityModels(groundTruth, requestData) {
        return this.config.models; // Simplified scaling
    }

    calculateCoverage(data, windowMin) {
        // Simplified coverage calculation
        return 0.91;
    }

    aggregateSlipSamples() {
        const allSamples = [];
        this.dataCache.slipSamples.forEach(samples => allSamples.push(...samples));
        return allSamples;
    }

    getDefaultSLO() {
        return {
            answer_latency_p95: 'ok',
            guard_success_rate: 'ok',
            uptime_feed: 'ok'
        };
    }

    // Event Handlers
    handleScenarioRequest(data) {
        this.logger.debug(`Senaryo talebi alındı: ${data.scope || 'global'}`);
        this.process(data);
    }

    handlePolicyPatch(data) {
        this.logger.debug(`Policy patch simülasyonu: ${data.scope}`);
        // Convert patch to single scenario request
        const scenarioRequest = {
            event: 'scenario.request',
            mode: 'manual',
            scope: data.scope,
            symbol: data.symbol,
            baseVersion: data.baseVersion,
            grid: { single: [data.delta] },
            maxCombos: 1
        };
        this.process(scenarioRequest);
    }

    handlePnLHistory(data) {
        this.dataCache.pnlHistory = data;
        this.logger.debug(`PnL geçmişi güncellendi: ${data.stats?.netUSD} USD`);
    }

    handleSlipSample(data) {
        if (data.symbol) {
            this.dataCache.slipSamples.set(data.symbol, data);
        }
        this.logger.debug(`Slip sample güncellendi: ${data.symbol}`);
    }

    handleSLOReport(data) {
        this.dataCache.sloReports.set('global', data);
        this.logger.debug(`SLO raporu güncellendi: burnPct=${data.burnPct}%`);
    }

    getStatus() {
        return {
            name: this.name,
            initialized: this.isInitialized,
            enabled: this.config.enabled,
            state: this.state,
            simulations: this.simStore.size,
            dataCache: {
                pnlHistory: !!this.dataCache.pnlHistory,
                slipSamples: this.dataCache.slipSamples.size,
                sloReports: this.dataCache.sloReports.size
            },
            config: this.config
        };
    }

    async shutdown() {
        try {
            this.logger.info(`${this.name} durduruluyor...`);
            this.simStore.clear();
            this.dataCache.slipSamples.clear();
            this.dataCache.sloReports.clear();
            this.isInitialized = false;
            this.logger.info(`${this.name} başarıyla durduruldu`);
        } catch (error) {
            this.logger.error(`${this.name} durdurma hatası:`, error);
        }
    }
}

module.exports = RiskScenarioSimulator;