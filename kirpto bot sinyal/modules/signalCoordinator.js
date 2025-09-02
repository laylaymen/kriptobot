/**
 * 🧠 Grafik Beyni - Signal Coordinator
 * Ana sinyal koordinasyon merkezi - tüm modülleri koordine eder
 */

const EventEmitter = require('events');

class SignalCoordinator extends EventEmitter {
    constructor(config = {}) {
        super();
        
        this.config = {
            updateInterval: 60000, // 1 dakika
            maxSignalHistory: 1000,
            scoreThreshold: 0.6,
            enableSystemIntegration: true,
            ...config
        };
        
        // Modül registrasyonu
        this.modules = new Map();
        this.activeSignals = new Map();
        this.signalHistory = [];
        this.performanceStats = new Map();
        
        // Sistem entegrasyonları
        this.systems = {
            vivo: null,
            livia: null,
            otobilinc: null,
            denetimAsistani: null
        };
        
        // Güncellik takibi
        this.lastUpdate = Date.now();
        this.updateTimer = null;
        
        this.initializeCoordinator();
    }
    
    initializeCoordinator() {
        console.log('🧠 Grafik Beyni Signal Coordinator başlatılıyor...');
        
        // Tüm Grafik Beyni modüllerini yükle
        this.loadGrafikBeyniModules();
        
        // Otomatik güncelleme başlat
        this.startPeriodicUpdates();
        
        // Event handlers
        this.on('signal-generated', this.handleSignalGeneration.bind(this));
        this.on('system-notification', this.handleSystemNotification.bind(this));
    }
    
    /**
     * Tüm Grafik Beyni modüllerini yükle ve kaydet
     */
    loadGrafikBeyniModules() {
        try {
            console.log('📦 Loading Grafik Beyni modules...');
            
            // Formation Detection Modules
            const FormationIdentifier = require('./grafikBeyni/formationIdentifier');
            const FormationCompletenessJudge = require('./grafikBeyni/formationCompletenessJudge');
            const AscendingTriangleDetector = require('./grafikBeyni/ascendingTriangleDetector');
            const DescendingTriangleDetector = require('./grafikBeyni/descendingTriangleDetector');
            const SymmetricalTriangleDetector = require('./grafikBeyni/symmetricalTriangleDetector');
            const BullFlagDetector = require('./grafikBeyni/bullFlagDetector');
            const BearFlagDetector = require('./grafikBeyni/bearFlagDetector');
            const WedgeDetector = require('./grafikBeyni/wedgeDetector');
            const HeadAndShouldersDetector = require('./grafikBeyni/headAndShouldersDetector');
            const InverseHeadAndShouldersDetector = require('./grafikBeyni/inverseHeadAndShouldersDetector');
            const CupAndHandleDetector = require('./grafikBeyni/cupAndHandleDetector');
            
            // Technical Analysis Modules
            const TpOptimizer = require('./grafikBeyni/tpOptimizer');
            const ExitTimingAdvisor = require('./grafikBeyni/exitTimingAdvisor');
            const TrendConfidenceEvaluator = require('./grafikBeyni/trendConfidenceEvaluator');
            const TrendDetector = require('./grafikBeyni/trendDetector');
            const FormPatternRecognizer = require('./grafikBeyni/formPatternRecognizer');
            const SupportResistanceMapper = require('./grafikBeyni/supportResistanceMapper');
            const VolumeConfirmBreakout = require('./grafikBeyni/volumeConfirmBreakout');
            const FalseBreakFilter = require('./grafikBeyni/falseBreakFilter');
            const PriceActionAnalyzer = require('./grafikBeyni/priceActionAnalyzer');
            const CandlestickInterpreter = require('./grafikBeyni/candlestickInterpreter');
            const TrendStrengthMeter = require('./grafikBeyni/trendStrengthMeter');
            const VolatilityAssessment = require('./grafikBeyni/volatilityAssessment');
            
            // Market Intelligence Modules
            const PriceActionBiasGenerator = require('./grafikBeyni/priceActionBiasGenerator');
            const RiskToRewardValidator = require('./grafikBeyni/riskToRewardValidator');
            
            // Register all modules
            this.registerModule('formationIdentifier', new FormationIdentifier());
            this.registerModule('formationCompletenessJudge', new FormationCompletenessJudge());
            this.registerModule('ascendingTriangleDetector', new AscendingTriangleDetector());
            this.registerModule('descendingTriangleDetector', new DescendingTriangleDetector());
            this.registerModule('symmetricalTriangleDetector', new SymmetricalTriangleDetector());
            this.registerModule('bullFlagDetector', new BullFlagDetector());
            this.registerModule('bearFlagDetector', new BearFlagDetector());
            this.registerModule('wedgeDetector', new WedgeDetector());
            this.registerModule('headAndShouldersDetector', new HeadAndShouldersDetector());
            this.registerModule('inverseHeadAndShouldersDetector', new InverseHeadAndShouldersDetector());
            this.registerModule('cupAndHandleDetector', new CupAndHandleDetector());
            this.registerModule('tpOptimizer', new TpOptimizer());
            this.registerModule('exitTimingAdvisor', new ExitTimingAdvisor());
            this.registerModule('trendConfidenceEvaluator', new TrendConfidenceEvaluator());
            this.registerModule('trendDetector', new TrendDetector());
            this.registerModule('formPatternRecognizer', new FormPatternRecognizer());
            this.registerModule('supportResistanceMapper', new SupportResistanceMapper());
            this.registerModule('volumeConfirmBreakout', new VolumeConfirmBreakout());
            this.registerModule('falseBreakFilter', new FalseBreakFilter());
            this.registerModule('priceActionAnalyzer', new PriceActionAnalyzer());
            this.registerModule('candlestickInterpreter', new CandlestickInterpreter());
            this.registerModule('trendStrengthMeter', new TrendStrengthMeter());
            this.registerModule('volatilityAssessment', new VolatilityAssessment());
            this.registerModule('priceActionBiasGenerator', new PriceActionBiasGenerator());
            this.registerModule('riskToRewardValidator', new RiskToRewardValidator());
            
            console.log(`✅ Successfully loaded ${this.modules.size} Grafik Beyni modules`);
            
        } catch (error) {
            console.error('❌ Error loading Grafik Beyni modules:', error);
        }
    }
    
    /**
     * Modül kaydı
     */
    registerModule(name, moduleInstance) {
        if (!moduleInstance || typeof moduleInstance.analyze !== 'function') {
            throw new Error(`Module ${name} must have analyze() method`);
        }
        
        this.modules.set(name, {
            instance: moduleInstance,
            enabled: true,
            lastUpdate: null,
            performance: {
                totalSignals: 0,
                successfulSignals: 0,
                averageScore: 0,
                lastValidation: null
            }
        });
        
        console.log(`📦 Module registered: ${name}`);
    }
    
    /**
     * Sistem entegrasyonu
     */
    connectSystem(systemName, systemInstance) {
        if (this.systems.hasOwnProperty(systemName)) {
            this.systems[systemName] = systemInstance;
            console.log(`🔗 System connected: ${systemName}`);
        }
    }
    
    /**
     * Ana analiz fonksiyonu - Grafik Beyni akışını orchestrate eder
     */
    async analyzeMarket(marketData) {
        try {
            const analysisResults = [];
            const timestamp = Date.now();
            
            console.log('🧠 Starting Grafik Beyni analysis pipeline...');
            
            // Phase 1: Market Intelligence & Bias Generation
            const biasResult = await this.runPhase1Analysis(marketData);
            
            // Phase 2: Formation Detection
            const formationResults = await this.runPhase2Analysis(marketData, biasResult);
            
            // Phase 3: Formation Intelligence & Validation
            const validatedResults = await this.runPhase3Analysis(marketData, formationResults, biasResult);
            
            // Phase 4: Technical Analysis & Optimization
            const optimizedResults = await this.runPhase4Analysis(marketData, validatedResults);
            
            // Phase 5: Final Signal Coordination
            const coordinatedSignals = await this.coordinateGrafikBeyniSignals(optimizedResults, marketData);
            
            // Send to VIVO if signals exist
            if (coordinatedSignals.length > 0) {
                await this.sendToVIVO(coordinatedSignals);
            }
            
            console.log(`✅ Grafik Beyni analysis completed. Generated ${coordinatedSignals.length} signals.`);
            return coordinatedSignals;
            
        } catch (error) {
            console.error('🚨 Grafik Beyni analysis error:', error);
            return [];
        }
    }
    
    /**
     * Phase 1: Market Intelligence & Bias Generation
     */
    async runPhase1Analysis(marketData) {
        console.log('📊 Phase 1: Market Intelligence Analysis');
        
        const phase1Results = {};
        
        // Generate market bias
        const biasGenerator = this.modules.get('priceActionBiasGenerator')?.instance;
        if (biasGenerator) {
            phase1Results.marketBias = await biasGenerator.analyze(marketData);
        }
        
        // Trend confidence evaluation
        const trendEvaluator = this.modules.get('trendConfidenceEvaluator')?.instance;
        if (trendEvaluator) {
            phase1Results.trendConfidence = await trendEvaluator.analyze(marketData);
        }
        
        // Trend detection
        const trendDetector = this.modules.get('trendDetector')?.instance;
        if (trendDetector) {
            phase1Results.trendAnalysis = await trendDetector.analyze(marketData);
        }
        
        return phase1Results;
    }
    
    /**
     * Phase 2: Formation Detection
     */
    async runPhase2Analysis(marketData, biasResult) {
        console.log('🔍 Phase 2: Formation Detection');
        
        const formationDetectors = [
            'ascendingTriangleDetector',
            'descendingTriangleDetector',
            'symmetricalTriangleDetector',
            'bullFlagDetector',
            'bearFlagDetector',
            'wedgeDetector',
            'headAndShouldersDetector',
            'inverseHeadAndShouldersDetector',
            'cupAndHandleDetector'
        ];
        
        const detectionPromises = formationDetectors.map(async (detectorName) => {
            const detector = this.modules.get(detectorName)?.instance;
            if (detector) {
                try {
                    const result = await detector.analyze(marketData);
                    return { detector: detectorName, result };
                } catch (error) {
                    console.warn(`⚠️ ${detectorName} failed:`, error.message);
                    return null;
                }
            }
            return null;
        });
        
        const results = await Promise.allSettled(detectionPromises);
        return results
            .filter(r => r.status === 'fulfilled' && r.value)
            .map(r => r.value)
            .filter(Boolean);
    }
    
    /**
     * Phase 3: Formation Intelligence & Validation
     */
    async runPhase3Analysis(marketData, formationResults, biasResult) {
        console.log('🎯 Phase 3: Formation Intelligence');
        
        const phase3Results = {};
        
        // Format formation results for formationIdentifier
        const detectedFormations = formationResults
            .filter(f => f.result && f.result.formationDetected)
            .map(f => ({
                ...f.result,
                source: f.detector
            }));
        
        // Formation identification and selection
        const formationIdentifier = this.modules.get('formationIdentifier')?.instance;
        if (formationIdentifier) {
            const identifierInput = {
                detectedFormations,
                trendStrength: biasResult.trendConfidence?.trendStrength || 0.5,
                volumeSpike: marketData.volumeSpike || false,
                rsi: marketData.rsi || 50
            };
            phase3Results.confirmedFormation = await formationIdentifier.analyze(identifierInput);
        }
        
        // Formation completeness validation
        const completenessJudge = this.modules.get('formationCompletenessJudge')?.instance;
        if (completenessJudge && phase3Results.confirmedFormation) {
            const judgeInput = {
                formationType: phase3Results.confirmedFormation.confirmedFormation,
                breakoutTrigger: phase3Results.confirmedFormation.breakoutTrigger,
                confidenceScore: phase3Results.confirmedFormation.confidenceScore,
                trendAlignment: biasResult.trendConfidence?.trendExists || false,
                ...marketData
            };
            phase3Results.formationReadiness = await completenessJudge.analyze(judgeInput);
        }
        
        // Risk/reward validation
        const riskValidator = this.modules.get('riskToRewardValidator')?.instance;
        if (riskValidator && phase3Results.confirmedFormation) {
            const riskInput = {
                expectedProfit: 3.0, // Default values, would come from TP optimizer
                potentialStopLoss: 1.5,
                trendStrength: biasResult.trendConfidence?.trendStrength || 0.5,
                formation: phase3Results.confirmedFormation.confirmedFormation,
                biasDirection: biasResult.marketBias?.biasDirection || 'neutral',
                ...marketData
            };
            phase3Results.riskReward = await riskValidator.analyze(riskInput);
        }
        
        return phase3Results;
    }
    
    /**
     * Phase 4: Technical Analysis & Optimization
     */
    async runPhase4Analysis(marketData, validatedResults) {
        console.log('⚡ Phase 4: Technical Optimization');
        
        const phase4Results = {};
        
        // Only proceed if formation is ready and risk/reward is acceptable
        if (!validatedResults.formationReadiness?.formationReady || 
            !validatedResults.riskReward?.isTradeValid) {
            console.log('⏳ Formation not ready or poor risk/reward - skipping optimization');
            return phase4Results;
        }
        
        // Technical analysis modules
        const technicalModules = [
            'tpOptimizer',
            'exitTimingAdvisor',
            'formPatternRecognizer',
            'supportResistanceMapper',
            'volumeConfirmBreakout',
            'falseBreakFilter',
            'priceActionAnalyzer',
            'candlestickInterpreter',
            'trendStrengthMeter',
            'volatilityAssessment'
        ];
        
        const technicalPromises = technicalModules.map(async (moduleName) => {
            const module = this.modules.get(moduleName)?.instance;
            if (module) {
                try {
                    const result = await module.analyze(marketData);
                    return { module: moduleName, result };
                } catch (error) {
                    console.warn(`⚠️ ${moduleName} failed:`, error.message);
                    return null;
                }
            }
            return null;
        });
        
        const results = await Promise.allSettled(technicalPromises);
        results
            .filter(r => r.status === 'fulfilled' && r.value)
            .forEach(r => {
                if (r.value) {
                    phase4Results[r.value.module] = r.value.result;
                }
            });
        
        return phase4Results;
    }
    
    /**
     * Grafik Beyni sinyallerini koordine et
     */
    async coordinateGrafikBeyniSignals(analysisResults, marketData) {
        // Bu fonksiyon tüm analiz sonuçlarını alıp final sinyalleri üretir
        const signals = [];
        
        // Formation signal varsa oluştur
        if (analysisResults.confirmedFormation && 
            analysisResults.formationReadiness?.formationReady &&
            analysisResults.riskReward?.isTradeValid) {
            
            const signal = {
                modül: 'grafikBeyni',
                sinyalTipi: analysisResults.confirmedFormation.confirmedFormation,
                skor: analysisResults.confirmedFormation.confidenceScore,
                varyant: analysisResults.confirmedFormation.breakoutDirection,
                teyitZinciri: [
                    'formation-detected',
                    'formation-ready',
                    'risk-reward-acceptable'
                ],
                
                // Grafik Beyni specific data
                formationData: analysisResults.confirmedFormation,
                readinessData: analysisResults.formationReadiness,
                riskData: analysisResults.riskReward,
                technicalData: analysisResults.technical || {},
                
                timestamp: Date.now(),
                confidence: analysisResults.confirmedFormation.confidenceScore,
                riskLevel: analysisResults.riskReward.tradeQualityRating || 'medium'
            };
            
            signals.push(signal);
        }
        
        return signals;
    }
    
    /**
     * Modül analizi çalıştırma
     */
    async runModuleAnalysis(name, moduleInstance, marketData) {
        try {
            const startTime = Date.now();
            const result = await moduleInstance.analyze(marketData);
            const executionTime = Date.now() - startTime;
            
            if (result && result.signals) {
                // Standart sinyal formatını kontrol et
                result.signals = result.signals.map(signal => this.validateSignalFormat(signal, name));
                
                return {
                    moduleName: name,
                    signals: result.signals,
                    executionTime,
                    timestamp: Date.now(),
                    metadata: result.metadata || {}
                };
            }
            
            return null;
            
        } catch (error) {
            console.error(`❌ Module ${name} execution error:`, error);
            return null;
        }
    }
    
    /**
     * Sinyal formatını doğrula ve standartlaştır
     */
    validateSignalFormat(signal, moduleName) {
        const standardSignal = {
            modül: moduleName,
            sinyalTipi: signal.sinyalTipi || signal.type || 'unknown',
            skor: Math.max(0, Math.min(1, signal.skor || signal.score || 0)),
            varyant: signal.varyant || signal.variant || 'default',
            teyitZinciri: signal.teyitZinciri || signal.confirmationChain || [],
            kullanıcıUyumu: signal.kullanıcıUyumu || signal.userAlignment || 0.5,
            
            // Ek alanlar
            timestamp: signal.timestamp || Date.now(),
            marketCondition: signal.marketCondition || 'unknown',
            riskLevel: signal.riskLevel || 'medium',
            timeframe: signal.timeframe || '15m',
            confidence: signal.confidence || signal.skor || 0.5,
            
            // Raw data
            rawData: signal
        };
        
        return standardSignal;
    }
    
    /**
     * Sinyalleri koordine et ve en iyilerini seç
     */
    coordinateSignals(analysisResults, marketData) {
        const allSignals = [];
        
        // Tüm sinyalleri topla
        analysisResults.forEach(result => {
            if (result.signals) {
                allSignals.push(...result.signals);
            }
        });
        
        if (allSignals.length === 0) return [];
        
        // Sinyalleri skorla ve sırala
        const scoredSignals = allSignals
            .map(signal => this.calculateCompositeScore(signal, marketData))
            .filter(signal => signal.compositeScore >= this.config.scoreThreshold)
            .sort((a, b) => b.compositeScore - a.compositeScore);
        
        // En iyi 5 sinyali seç
        const bestSignals = scoredSignals.slice(0, 5);
        
        // Sinyal geçmişine ekle
        this.addToSignalHistory(bestSignals);
        
        return bestSignals;
    }
    
    /**
     * Kompozit skor hesaplama
     */
    calculateCompositeScore(signal, marketData) {
        let compositeScore = signal.skor;
        
        // Teyit zinciri bonusu
        if (signal.teyitZinciri.length > 0) {
            compositeScore += signal.teyitZinciri.length * 0.1;
        }
        
        // Kullanıcı uyumu bonusu
        compositeScore += (signal.kullanıcıUyumu - 0.5) * 0.2;
        
        // Market condition bonus
        if (marketData && marketData.condition) {
            if (signal.marketCondition === marketData.condition.trend) {
                compositeScore += 0.15;
            }
        }
        
        // Risk level adjustment
        const riskMultiplier = {
            'low': 1.1,
            'medium': 1.0,
            'high': 0.9
        };
        compositeScore *= riskMultiplier[signal.riskLevel] || 1.0;
        
        // 0-1 arası sınırla
        compositeScore = Math.max(0, Math.min(1, compositeScore));
        
        return {
            ...signal,
            compositeScore,
            ranking: 0 // Sonradan sıralama ile doldurulacak
        };
    }
    
    /**
     * VIVO'ya sinyal gönderme
     */
    async sendToVIVO(signals) {
        try {
            if (this.systems.vivo && typeof this.systems.vivo.receiveSignals === 'function') {
                await this.systems.vivo.receiveSignals(signals);
                console.log(`📤 ${signals.length} signal sent to VIVO`);
            } else {
                // VIVO bağlı değilse event emit et
                this.emit('signals-ready', {
                    signals,
                    timestamp: Date.now(),
                    source: 'grafikBeyni'
                });
            }
        } catch (error) {
            console.error('❌ VIVO signal transmission error:', error);
        }
    }
    
    /**
     * Sinyal geçmişine ekleme
     */
    addToSignalHistory(signals) {
        signals.forEach(signal => {
            this.signalHistory.push({
                ...signal,
                addedAt: Date.now()
            });
        });
        
        // Geçmiş limitini kontrol et
        if (this.signalHistory.length > this.config.maxSignalHistory) {
            this.signalHistory = this.signalHistory.slice(-this.config.maxSignalHistory);
        }
    }
    
    /**
     * Modül performansını güncelle
     */
    updateModulePerformance(moduleName, result) {
        const moduleInfo = this.modules.get(moduleName);
        if (moduleInfo && result.signals) {
            const perf = moduleInfo.performance;
            
            perf.totalSignals += result.signals.length;
            perf.lastUpdate = Date.now();
            
            // Ortalama skor güncelle
            const totalScore = result.signals.reduce((sum, signal) => sum + signal.skor, 0);
            const avgScore = result.signals.length > 0 ? totalScore / result.signals.length : 0;
            
            if (perf.averageScore === 0) {
                perf.averageScore = avgScore;
            } else {
                perf.averageScore = (perf.averageScore * 0.8) + (avgScore * 0.2); // EMA
            }
        }
    }
    
    /**
     * Periyodik güncelleme başlat
     */
    startPeriodicUpdates() {
        this.updateTimer = setInterval(() => {
            this.performValidation();
        }, this.config.updateInterval);
        
        console.log(`⏰ Periodic updates started (${this.config.updateInterval}ms)`);
    }
    
    /**
     * Modül doğrulaması - son 3 sinyal için sonuç kontrolü
     */
    async performValidation() {
        console.log('🔍 Performing module validation...');
        
        for (const [name, moduleInfo] of this.modules) {
            try {
                if (moduleInfo.instance.validateRecentSignals) {
                    const validation = await moduleInfo.instance.validateRecentSignals();
                    
                    if (validation) {
                        moduleInfo.performance.lastValidation = validation;
                        
                        // Başarı oranını güncelle
                        if (validation.successRate !== undefined) {
                            moduleInfo.performance.successfulSignals = 
                                moduleInfo.performance.totalSignals * validation.successRate;
                        }
                    }
                }
            } catch (error) {
                console.warn(`⚠️ Validation error for ${name}:`, error.message);
            }
        }
    }
    
    /**
     * Event handlers
     */
    handleSignalGeneration(data) {
        console.log(`📡 Signal generated by ${data.module}:`, data.signal?.sinyalTipi);
    }
    
    handleSystemNotification(data) {
        console.log(`🔔 System notification from ${data.system}:`, data.message);
    }
    
    /**
     * İstatistikler al
     */
    getStats() {
        const moduleStats = {};
        
        for (const [name, moduleInfo] of this.modules) {
            moduleStats[name] = {
                ...moduleInfo.performance,
                enabled: moduleInfo.enabled,
                lastUpdate: moduleInfo.lastUpdate
            };
        }
        
        return {
            totalModules: this.modules.size,
            activeModules: Array.from(this.modules.values()).filter(m => m.enabled).length,
            totalSignalsInHistory: this.signalHistory.length,
            lastUpdate: this.lastUpdate,
            moduleStats,
            systemConnections: Object.keys(this.systems).filter(k => this.systems[k] !== null)
        };
    }
    
    /**
     * Temizlik
     */
    cleanup() {
        if (this.updateTimer) {
            clearInterval(this.updateTimer);
        }
        this.removeAllListeners();
        console.log('🧹 Signal Coordinator cleaned up');
    }
}

module.exports = SignalCoordinator;
