/**
 * LIVIA-43 · modelDriftWatcher.js
 * Kriptobot Modüler Sistem - Model Drift Watcher
 * 
 * Amaç: Üretimdeki modeller için covariate drift (özellik dağılımı kayması) ve 
 * concept drift (etiket/ilişki kayması) ile performans/kalibrasyon bozulmalarını erken saptamak;
 * risk seviyesine göre aksiyon planı üretmek.
 */

const { z } = require('zod');
const crypto = require('crypto');
const fs = require('fs').promises;
const path = require('path');

// Zod şemaları
const ModelEventSchema = z.object({
  event: z.enum([
    'model.registered', 'model.prediction.logged', 'groundtruth.logged',
    'feature.snapshot', 'model.canary.metrics', 'dq.finding', 'fsync.lag'
  ]),
  timestamp: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?([+-]\d{2}:\d{2}|Z)$/),
  modelId: z.string().optional(),
  version: z.string().optional(),
  task: z.enum(['binary', 'multiclass', 'regression', 'ranking']).optional(),
  features: z.array(z.object({
    name: z.string(),
    type: z.enum(['float', 'categorical', 'binary'])
  })).optional(),
  baseline: z.object({
    window: z.string(),
    metrics: z.object({}).passthrough(),
    featureStats: z.object({}).passthrough(),
    thresholds: z.object({}).passthrough().optional()
  }).optional(),
  sampleId: z.string().optional(),
  pred: z.object({
    score: z.number(),
    label_hat: z.number().optional()
  }).optional(),
  segment: z.object({}).passthrough().optional(),
  y_true: z.number().optional(),
  labelAt: z.string().optional(),
  window: z.string().optional(),
  stats: z.object({}).passthrough().optional(),
  n: z.number().optional(),
  champion: z.string().optional(),
  challenger: z.string().optional(),
  metrics: z.object({}).passthrough().optional(),
  datasetId: z.string().optional(),
  kind: z.string().optional(),
  details: z.object({}).passthrough().optional(),
  featureStore: z.string().optional(),
  lagMsP95: z.number().optional()
}).strict();

const ConfigSchema = z.object({
  windows: z.array(z.string()).default(['1h', '6h', '24h', '7d']),
  detectors: z.object({
    psi: z.object({
      enabled: z.boolean().default(true),
      threshold: z.object({
        low: z.number().default(0.1),
        medium: z.number().default(0.2),
        high: z.number().default(0.25),
        critical: z.number().default(0.35)
      })
    }),
    ks: z.object({
      enabled: z.boolean().default(true),
      pValueMax: z.number().default(0.01)
    }),
    jsd: z.object({
      enabled: z.boolean().default(true),
      threshold: z.object({ high: z.number().default(0.15) })
    }),
    domainClassifier: z.object({
      enabled: z.boolean().default(true),
      aucHigh: z.number().default(0.75)
    }),
    mmd: z.object({
      enabled: z.boolean().default(false),
      threshold: z.number().default(0.15)
    }),
    shapDrift: z.object({
      enabled: z.boolean().default(true),
      topK: z.number().default(10),
      popCorrDrop: z.number().default(0.2)
    })
  }),
  concept: z.object({
    labelPolicy: z.object({
      maxDelayMin: z.number().default(1440),
      requireMinPositives: z.number().default(200),
      requireMinSamples: z.number().default(1000)
    }),
    tests: z.object({
      pageHinkley: z.object({
        delta: z.number().default(0.005),
        lambda: z.number().default(50)
      }),
      ddm: z.object({
        warn: z.number().default(2.0),
        alarm: z.number().default(3.0)
      })
    }),
    performance: z.object({
      aucDropHigh: z.number().default(0.05),
      eceHigh: z.number().default(0.05),
      rmseWorsePct: z.number().default(0.1)
    })
  }),
  segments: z.object({
    sliceBy: z.array(z.string()).default(['region', 'desk', 'symbol']),
    topN: z.number().default(10),
    minSamples: z.number().default(300)
  }),
  actions: z.object({
    fallback: z.object({
      enabled: z.boolean().default(true),
      mode: z.string().default('immediate'),
      minLevel: z.string().default('critical')
    }),
    thresholdAdjust: z.object({
      enabled: z.boolean().default(true),
      maxDelta: z.number().default(0.05)
    }),
    retrain: z.object({
      onLevel: z.string().default('medium'),
      via: z.string().default('LIVIA-44'),
      priority: z.string().default('high')
    }),
    canary: z.object({
      onLevel: z.string().default('medium'),
      via: z.string().default('LIVIA-45'),
      steps: z.array(z.number()).default([10, 25, 50]),
      minStableMin: z.number().default(20)
    }),
    trafficAllocator: z.object({
      via: z.string().default('LIVIA-37'),
      minPctPerVariant: z.number().default(5)
    })
  }),
  integrations: z.object({
    dq: z.string().default('LIVIA-41'),
    schemaMig: z.string().default('LIVIA-42'),
    slo: z.string().default('LIVIA-32'),
    cost: z.string().default('LIVIA-34'),
    flags: z.string().default('LIVIA-35'),
    experiments: z.string().default('LIVIA-36'),
    bandit: z.string().default('LIVIA-37'),
    retrain: z.string().default('LIVIA-44'),
    canary: z.string().default('LIVIA-45'),
    fsync: z.string().default('LIVIA-46'),
    lineage: z.string().default('LIVIA-39'),
    provenance: z.string().default('LIVIA-38'),
    dist: z.string().default('LIVIA-22'),
    redact: z.string().default('LIVIA-21')
  }),
  reporting: z.object({
    outputDir: z.string().default('data/model-health/{YYYY-MM-DD}/{modelId}_{version}'),
    mdFile: z.string().default('report.md'),
    htmlFile: z.string().default('report.html'),
    html: z.object({
      embedMiniCSS: z.boolean().default(true),
      chartsInlineSvg: z.boolean().default(true)
    }),
    include: z.object({
      topShiftFeatures: z.number().default(10),
      segmentTables: z.boolean().default(true),
      calibrationPlot: z.boolean().default(true)
    })
  }),
  rbacViews: z.object({
    observer: z.object({
      hideFeatureNames: z.boolean().default(false),
      hideSHAPValues: z.boolean().default(true)
    })
  }),
  idempotencyTtlSec: z.number().default(3600)
}).strict();

class ModelDriftWatcher {
  constructor(config = {}) {
    this.name = 'ModelDriftWatcher';
    this.config = ConfigSchema.parse({
      windows: undefined,
      detectors: {},
      concept: {},
      segments: {},
      actions: {},
      integrations: {},
      reporting: {},
      rbacViews: {},
      ...config
    });
    
    this.isInitialized = false;
    this.logger = null;
    this.eventBus = null;
    
    // FSM state
    this.state = 'IDLE'; // IDLE, EVAL, DECIDE, ENFORCE, REPORT
    
    // Model Drift State
    this.models = new Map(); // modelId -> model info with baseline
    this.predictions = new Map(); // modelId -> prediction buffer
    this.features = new Map(); // modelId -> feature stats windows
    this.labels = new Map(); // modelId -> ground truth buffer
    this.driftHistory = new Map(); // modelId -> drift detection history
    this.pageHinkleyStates = new Map(); // modelId -> Page-Hinkley states
    
    // Metrics
    this.metrics = {
      evaluations: 0,
      covariateHigh: 0,
      conceptHigh: 0,
      guards: 0,
      p95EvalMs: 0,
      labelLatencyP95Min: 0,
      segmentsFlagged: 0,
      actions: {
        fallback: 0,
        retrain: 0,
        canary: 0,
        threshold: 0
      }
    };
    
    // İdempotency ve audit
    this.processedDrifts = new Set();
    this.auditLog = [];
  }

  async initialize(logger, eventBus) {
    try {
      this.logger = logger;
      this.eventBus = eventBus;
      this.logger.info(`${this.name} başlatılıyor...`);
      
      await this.setupStorage();
      this.setupEventHandlers();
      
      this.isInitialized = true;
      this.logger.info(`${this.name} başarıyla başlatıldı`);
      return true;
    } catch (error) {
      this.logger.error(`${this.name} başlatma hatası:`, error);
      return false;
    }
  }

  async setupStorage() {
    const today = new Date().toISOString().split('T')[0];
    this.reportingPath = path.resolve(this.config.reporting.outputDir.replace('{YYYY-MM-DD}', today));
    await fs.mkdir(this.reportingPath, { recursive: true });
  }

  setupEventHandlers() {
    if (!this.eventBus) return;

    // Model drift olaylarını dinle
    const driftEvents = [
      'model.registered', 'model.prediction.logged', 'groundtruth.logged',
      'feature.snapshot', 'model.canary.metrics', 'dq.finding', 'fsync.lag'
    ];

    driftEvents.forEach(eventType => {
      this.eventBus.on(eventType, async (data) => {
        await this.handleModelEvent(eventType, data);
      });
    });
  }

  async handleModelEvent(eventType, data) {
    if (!this.isInitialized) return;

    try {
      this.state = 'EVAL';
      const startTime = Date.now();
      
      // Event'i normalize et
      const normalizedEvent = {
        event: eventType,
        timestamp: data.timestamp || new Date().toISOString(),
        ...data
      };

      // Validate
      const validatedEvent = ModelEventSchema.parse(normalizedEvent);
      
      // Process based on event type
      await this.processModelEvent(validatedEvent);
      
      const duration = Date.now() - startTime;
      this.updateMetrics('eval', duration);
      this.metrics.evaluations++;
      
    } catch (error) {
      this.logger.error(`Model drift event processing error:`, error);
      this.emitAlert('error', 'processing_failed', { event: eventType, modelId: data.modelId });
    } finally {
      this.state = 'IDLE';
    }
  }

  async processModelEvent(event) {
    switch (event.event) {
      case 'model.registered':
        await this.handleModelRegistered(event);
        break;
      case 'model.prediction.logged':
        await this.handlePredictionLogged(event);
        break;
      case 'groundtruth.logged':
        await this.handleGroundTruthLogged(event);
        break;
      case 'feature.snapshot':
        await this.handleFeatureSnapshot(event);
        break;
      case 'model.canary.metrics':
        await this.handleCanaryMetrics(event);
        break;
      case 'dq.finding':
        await this.handleDQFinding(event);
        break;
      case 'fsync.lag':
        await this.handleFSyncLag(event);
        break;
    }
  }

  async handleModelRegistered(event) {
    this.models.set(event.modelId, {
      id: event.modelId,
      version: event.version,
      task: event.task || 'binary',
      features: event.features || [],
      baseline: event.baseline || {},
      thresholds: event.baseline?.thresholds || {},
      registeredAt: event.timestamp
    });

    // Initialize tracking structures
    this.predictions.set(event.modelId, []);
    this.features.set(event.modelId, new Map());
    this.labels.set(event.modelId, []);
    this.driftHistory.set(event.modelId, []);
    this.pageHinkleyStates.set(event.modelId, this.initializePageHinkley());

    this.logger.info(`Model registered for drift monitoring: ${event.modelId} v${event.version}`);
  }

  async handlePredictionLogged(event) {
    if (!this.predictions.has(event.modelId)) return;

    const predictions = this.predictions.get(event.modelId);
    predictions.push({
      sampleId: event.sampleId,
      timestamp: event.timestamp,
      features: event.features || {},
      pred: event.pred,
      segment: event.segment || {}
    });

    // Keep only recent predictions (sliding window)
    const maxPredictions = 10000;
    if (predictions.length > maxPredictions) {
      predictions.splice(0, predictions.length - maxPredictions);
    }

    // Trigger drift detection if we have enough data
    if (predictions.length % 100 === 0) {
      await this.checkCovariateDrift(event.modelId);
    }
  }

  async handleGroundTruthLogged(event) {
    if (!this.labels.has(event.modelId)) return;

    const labels = this.labels.get(event.modelId);
    labels.push({
      sampleId: event.sampleId,
      y_true: event.y_true,
      labelAt: event.labelAt || event.timestamp,
      timestamp: event.timestamp
    });

    // Update Page-Hinkley with prediction error if we have the prediction
    const predictions = this.predictions.get(event.modelId);
    const prediction = predictions?.find(p => p.sampleId === event.sampleId);
    
    if (prediction) {
      await this.updatePageHinkley(event.modelId, prediction, event.y_true);
    }

    // Trigger concept drift check if we have enough labels
    if (labels.length % 50 === 0) {
      await this.checkConceptDrift(event.modelId);
    }
  }

  async handleFeatureSnapshot(event) {
    if (!this.features.has(event.modelId)) return;

    const featureWindows = this.features.get(event.modelId);
    featureWindows.set(event.window, {
      timestamp: event.timestamp,
      stats: event.stats || {},
      n: event.n || 0
    });

    // Trigger covariate drift detection
    await this.checkCovariateDrift(event.modelId);
  }

  async handleCanaryMetrics(event) {
    // Process canary vs champion metrics for concept drift
    const metrics = event.metrics || {};
    
    if (metrics.auc_delta && Math.abs(metrics.auc_delta) > this.config.concept.performance.aucDropHigh) {
      await this.emitConceptDrift(event.modelId, {
        level: 'high',
        metrics: {
          auc: metrics.auc_challenger || 0,
          delta_auc: metrics.auc_delta,
          ece: metrics.ece_challenger || 0
        },
        tests: { canary_comparison: 'alarm' },
        segments: []
      });
    }
  }

  async handleDQFinding(event) {
    if (event.kind === 'schema_drift') {
      // Schema drift affects model inputs - pause drift decisions
      this.logger.warn(`DQ schema drift detected for ${event.datasetId}, pausing drift decisions`);
      this.emitAlert('warn', 'dq_block', { datasetId: event.datasetId, reason: 'schema_drift' });
    }
  }

  async handleFSyncLag(event) {
    if (event.lagMsP95 > 1000) { // High lag threshold
      this.metrics.labelLatencyP95Min = event.lagMsP95 / 60000; // Convert to minutes
      this.emitAlert('warn', 'fsync_lag_high', { 
        featureStore: event.featureStore, 
        lagMs: event.lagMsP95 
      });
    }
  }

  async checkCovariateDrift(modelId) {
    const model = this.models.get(modelId);
    const featureWindows = this.features.get(modelId);
    const predictions = this.predictions.get(modelId);
    
    if (!model || !featureWindows || !predictions.length) return;

    try {
      // Calculate drift scores for each detector
      const driftResults = {
        detectors: {},
        overall: {},
        level: 'low',
        topShift: []
      };

      // PSI (Population Stability Index)
      if (this.config.detectors.psi.enabled) {
        driftResults.detectors.psi = await this.calculatePSI(model, predictions);
      }

      // KS (Kolmogorov-Smirnov)
      if (this.config.detectors.ks.enabled) {
        driftResults.detectors.ks = await this.calculateKS(model, predictions);
      }

      // Domain Classifier AUC
      if (this.config.detectors.domainClassifier.enabled) {
        driftResults.overall.domainAUC = await this.calculateDomainAUC(model, predictions);
      }

      // Determine overall drift level
      driftResults.level = this.determineDriftLevel(driftResults.detectors);
      driftResults.topShift = this.identifyTopShiftFeatures(driftResults.detectors);

      // Emit drift event if significant
      if (driftResults.level !== 'low') {
        await this.emitCovariateDrift(modelId, driftResults);
      }

      this.metrics.covariateHigh += (driftResults.level === 'high' || driftResults.level === 'critical') ? 1 : 0;

    } catch (error) {
      this.logger.error(`Covariate drift calculation error for ${modelId}:`, error);
    }
  }

  async checkConceptDrift(modelId) {
    const model = this.models.get(modelId);
    const labels = this.labels.get(modelId);
    const predictions = this.predictions.get(modelId);
    
    if (!model || !labels.length || !predictions.length) return;

    try {
      // Check if we have minimum required samples
      if (labels.length < this.config.concept.labelPolicy.requireMinSamples) {
        this.emitAlert('warn', 'underpowered', { 
          modelId, 
          samples: labels.length, 
          required: this.config.concept.labelPolicy.requireMinSamples 
        });
        return;
      }

      // Calculate performance metrics
      const metrics = await this.calculatePerformanceMetrics(modelId, predictions, labels);
      
      // Check Page-Hinkley and DDM results
      const phState = this.pageHinkleyStates.get(modelId);
      const tests = {
        page_hinkley: phState.alarm ? 'alarm' : 'ok',
        ddm: phState.warning ? 'warn' : 'ok',
        calibration: metrics.ece > this.config.concept.performance.eceHigh ? 'off' : 'ok'
      };

      // Determine concept drift level
      const level = this.determineConceptLevel(metrics, tests);
      
      // Analyze segments
      const segments = await this.analyzeSegmentDrift(modelId, predictions, labels);

      if (level !== 'low') {
        await this.emitConceptDrift(modelId, { metrics, tests, level, segments });
      }

      this.metrics.conceptHigh += (level === 'high' || level === 'critical') ? 1 : 0;

    } catch (error) {
      this.logger.error(`Concept drift calculation error for ${modelId}:`, error);
    }
  }

  async calculatePSI(model, predictions) {
    // Simplified PSI calculation
    const psiScores = {};
    const baseline = model.baseline?.featureStats || {};
    
    // Calculate PSI for each feature
    model.features?.forEach(feature => {
      if (feature.type === 'categorical') {
        // Categorical PSI
        const baselineDist = baseline[feature.name]?.counts || {};
        const currentDist = this.calculateCategoricalDistribution(predictions, feature.name);
        psiScores[feature.name] = this.calculateCategoricalPSI(baselineDist, currentDist);
      } else {
        // Numerical PSI (simplified with buckets)
        const baselineHist = baseline[feature.name]?.hist || [];
        const currentHist = this.calculateNumericalHistogram(predictions, feature.name);
        psiScores[feature.name] = this.calculateNumericalPSI(baselineHist, currentHist);
      }
    });
    
    return psiScores;
  }

  async calculateKS(model, predictions) {
    // Simplified KS test implementation
    const ksScores = {};
    
    model.features?.forEach(feature => {
      if (feature.type !== 'categorical') {
        // Extract current values
        const currentValues = predictions
          .map(p => p.features[feature.name])
          .filter(v => v !== undefined && v !== null);
        
        if (currentValues.length > 0) {
          // Simplified KS statistic (would use proper implementation in production)
          ksScores[feature.name] = Math.random() * 0.3; // Mock for demo
        }
      }
    });
    
    return ksScores;
  }

  async calculateDomainAUC(model, predictions) {
    // Simplified domain classifier AUC (would train actual classifier in production)
    return 0.65 + Math.random() * 0.2; // Mock value between 0.65-0.85
  }

  async calculatePerformanceMetrics(modelId, predictions, labels) {
    // Join predictions with labels
    const joined = [];
    predictions.forEach(pred => {
      const label = labels.find(l => l.sampleId === pred.sampleId);
      if (label) {
        joined.push({
          pred: pred.pred.score,
          true: label.y_true
        });
      }
    });

    if (joined.length === 0) {
      return { auc: 0, delta_auc: 0, ece: 0, ppv: 0, fnr: 0 };
    }

    // Calculate simplified metrics
    const auc = this.calculateAUC(joined);
    const ece = this.calculateECE(joined);
    const baseline = this.models.get(modelId).baseline?.metrics || {};
    
    return {
      auc,
      delta_auc: auc - (baseline.auc || 0),
      ece,
      ppv: this.calculatePPV(joined),
      fnr: this.calculateFNR(joined)
    };
  }

  calculateAUC(data) {
    // Simplified AUC calculation
    if (data.length === 0) return 0;
    
    // Sort by prediction score
    data.sort((a, b) => b.pred - a.pred);
    
    let tp = 0, fp = 0;
    const totalPos = data.filter(d => d.true === 1).length;
    const totalNeg = data.length - totalPos;
    
    if (totalPos === 0 || totalNeg === 0) return 0.5;
    
    let auc = 0;
    let prevFpr = 0;
    
    data.forEach(d => {
      if (d.true === 1) {
        tp++;
      } else {
        fp++;
        const tpr = tp / totalPos;
        const fpr = fp / totalNeg;
        auc += tpr * (fpr - prevFpr);
        prevFpr = fpr;
      }
    });
    
    return auc;
  }

  calculateECE(data) {
    // Simplified Expected Calibration Error
    const bins = 10;
    const binWidth = 1.0 / bins;
    let ece = 0;
    
    for (let i = 0; i < bins; i++) {
      const binMin = i * binWidth;
      const binMax = (i + 1) * binWidth;
      
      const binData = data.filter(d => d.pred >= binMin && d.pred < binMax);
      if (binData.length === 0) continue;
      
      const avgPred = binData.reduce((sum, d) => sum + d.pred, 0) / binData.length;
      const avgTrue = binData.reduce((sum, d) => sum + d.true, 0) / binData.length;
      
      ece += Math.abs(avgPred - avgTrue) * (binData.length / data.length);
    }
    
    return ece;
  }

  calculatePPV(data) {
    // Positive Predictive Value (Precision)
    const threshold = 0.5;
    const tp = data.filter(d => d.pred >= threshold && d.true === 1).length;
    const fp = data.filter(d => d.pred >= threshold && d.true === 0).length;
    return tp + fp > 0 ? tp / (tp + fp) : 0;
  }

  calculateFNR(data) {
    // False Negative Rate
    const threshold = 0.5;
    const fn = data.filter(d => d.pred < threshold && d.true === 1).length;
    const tp = data.filter(d => d.pred >= threshold && d.true === 1).length;
    return tp + fn > 0 ? fn / (tp + fn) : 0;
  }

  calculateCategoricalDistribution(predictions, featureName) {
    const counts = {};
    let total = 0;
    
    predictions.forEach(pred => {
      const value = pred.features[featureName];
      if (value !== undefined) {
        counts[value] = (counts[value] || 0) + 1;
        total++;
      }
    });
    
    // Convert to proportions
    Object.keys(counts).forEach(key => {
      counts[key] = counts[key] / total;
    });
    
    return counts;
  }

  calculateCategoricalPSI(baseline, current) {
    let psi = 0;
    const allKeys = new Set([...Object.keys(baseline), ...Object.keys(current)]);
    
    allKeys.forEach(key => {
      const p = current[key] || 0.001; // Small epsilon for missing categories
      const q = baseline[key] || 0.001;
      psi += (p - q) * Math.log(p / q);
    });
    
    return psi;
  }

  calculateNumericalHistogram(predictions, featureName, bins = 10) {
    const values = predictions
      .map(p => p.features[featureName])
      .filter(v => v !== undefined && v !== null);
    
    if (values.length === 0) return [];
    
    values.sort((a, b) => a - b);
    const min = values[0];
    const max = values[values.length - 1];
    const binWidth = (max - min) / bins;
    
    const histogram = [];
    for (let i = 0; i < bins; i++) {
      const binMin = min + i * binWidth;
      const binMax = min + (i + 1) * binWidth;
      const count = values.filter(v => v >= binMin && (i === bins - 1 ? v <= binMax : v < binMax)).length;
      histogram.push([binMin, binMax, count / values.length]);
    }
    
    return histogram;
  }

  calculateNumericalPSI(baselineHist, currentHist) {
    // Simplified numerical PSI calculation
    let psi = 0;
    const minLength = Math.min(baselineHist.length, currentHist.length);
    
    for (let i = 0; i < minLength; i++) {
      const p = currentHist[i][2] || 0.001;
      const q = baselineHist[i][2] || 0.001;
      psi += (p - q) * Math.log(p / q);
    }
    
    return psi;
  }

  determineDriftLevel(detectors) {
    let maxLevel = 'low';
    
    Object.entries(detectors).forEach(([detector, scores]) => {
      Object.values(scores).forEach(score => {
        if (detector === 'psi') {
          const thresholds = this.config.detectors.psi.threshold;
          if (score >= thresholds.critical) maxLevel = 'critical';
          else if (score >= thresholds.high && maxLevel !== 'critical') maxLevel = 'high';
          else if (score >= thresholds.medium && !['critical', 'high'].includes(maxLevel)) maxLevel = 'medium';
        }
      });
    });
    
    return maxLevel;
  }

  determineConceptLevel(metrics, tests) {
    if (tests.page_hinkley === 'alarm' || Math.abs(metrics.delta_auc) > 0.08) return 'critical';
    if (tests.ddm === 'warn' || Math.abs(metrics.delta_auc) > this.config.concept.performance.aucDropHigh) return 'high';
    if (metrics.ece > this.config.concept.performance.eceHigh) return 'medium';
    return 'low';
  }

  identifyTopShiftFeatures(detectors) {
    const featureScores = [];
    
    Object.entries(detectors).forEach(([detector, scores]) => {
      Object.entries(scores).forEach(([feature, score]) => {
        featureScores.push({ feature, score, detector });
      });
    });
    
    return featureScores
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map(fs => fs.feature);
  }

  async analyzeSegmentDrift(modelId, predictions, labels) {
    const segments = [];
    const sliceBy = this.config.segments.sliceBy;
    
    // Group by segments
    const segmentGroups = {};
    predictions.forEach(pred => {
      sliceBy.forEach(dim => {
        const value = pred.segment[dim];
        if (value) {
          const key = `${dim}=${value}`;
          if (!segmentGroups[key]) segmentGroups[key] = [];
          segmentGroups[key].push(pred);
        }
      });
    });
    
    // Analyze each segment
    Object.entries(segmentGroups).forEach(([segment, segmentPreds]) => {
      if (segmentPreds.length >= this.config.segments.minSamples) {
        const segmentLabels = labels.filter(l => 
          segmentPreds.some(p => p.sampleId === l.sampleId)
        );
        
        if (segmentLabels.length > 0) {
          const segmentMetrics = this.calculatePerformanceMetrics(modelId, segmentPreds, segmentLabels);
          const baseline = this.models.get(modelId).baseline?.metrics || {};
          
          if (Math.abs(segmentMetrics.delta_auc) > 0.05) {
            segments.push({
              segment,
              delta_auc: segmentMetrics.delta_auc
            });
          }
        }
      }
    });
    
    return segments.slice(0, this.config.segments.topN);
  }

  initializePageHinkley() {
    return {
      sum: 0,
      count: 0,
      mean: 0,
      variance: 0,
      alarm: false,
      warning: false,
      threshold: this.config.concept.tests.pageHinkley.lambda
    };
  }

  async updatePageHinkley(modelId, prediction, trueLabel) {
    const state = this.pageHinkleyStates.get(modelId);
    if (!state) return;

    // Calculate prediction error
    const error = Math.abs(prediction.pred.score - trueLabel);
    
    // Update statistics
    state.count++;
    const delta = error - state.mean;
    state.mean += delta / state.count;
    state.variance += delta * (error - state.mean);
    
    // Page-Hinkley test
    const stdDev = Math.sqrt(state.variance / state.count);
    const normalizedError = (error - state.mean) / (stdDev + 1e-8);
    
    state.sum = Math.max(0, state.sum + normalizedError - this.config.concept.tests.pageHinkley.delta);
    
    // Check alarms
    state.warning = state.sum > this.config.concept.tests.ddm.warn;
    state.alarm = state.sum > this.config.concept.tests.ddm.alarm;
    
    this.pageHinkleyStates.set(modelId, state);
  }

  async emitCovariateDrift(modelId, driftResults) {
    const driftEvent = {
      event: 'model.drift.covariate',
      timestamp: new Date().toISOString(),
      modelId,
      version: this.models.get(modelId)?.version || 'unknown',
      window: '24h',
      detectors: driftResults.detectors,
      overall: driftResults.overall,
      level: driftResults.level,
      topShift: driftResults.topShift,
      hash: this.generateDriftHash(driftResults)
    };

    this.eventBus?.emit('model.drift.covariate', driftEvent);
    
    if (driftResults.level === 'high' || driftResults.level === 'critical') {
      await this.triggerGuard(modelId, 'covariate', driftResults.level, driftResults);
    }
  }

  async emitConceptDrift(modelId, conceptResults) {
    const conceptEvent = {
      event: 'model.drift.concept',
      timestamp: new Date().toISOString(),
      modelId,
      version: this.models.get(modelId)?.version || 'unknown',
      window: '24h',
      metrics: conceptResults.metrics,
      tests: conceptResults.tests,
      level: conceptResults.level,
      segments: conceptResults.segments
    };

    this.eventBus?.emit('model.drift.concept', conceptEvent);
    
    if (conceptResults.level === 'high' || conceptResults.level === 'critical') {
      await this.triggerGuard(modelId, 'concept', conceptResults.level, conceptResults);
    }
  }

  async triggerGuard(modelId, kind, level, results) {
    this.state = 'DECIDE';
    
    try {
      // Generate action plan based on drift type and level
      const actionPlan = this.generateActionPlan(kind, level, results);
      
      // Emit guard trigger
      const guardEvent = {
        event: 'model.guard.triggered',
        timestamp: new Date().toISOString(),
        modelId,
        version: this.models.get(modelId)?.version || 'unknown',
        kind,
        level,
        trigger: this.generateTriggerDescription(kind, results),
        actionPlan,
        hash: this.generateDriftHash(results)
      };

      this.eventBus?.emit('model.guard.triggered', guardEvent);
      
      // Execute actions if configured
      if (this.shouldExecuteActions(level)) {
        this.state = 'ENFORCE';
        await this.executeActions(modelId, actionPlan);
      }
      
      // Generate report and card
      await this.generateDriftReport(modelId, kind, level, results, actionPlan);
      
      this.metrics.guards++;
      
    } catch (error) {
      this.logger.error(`Guard trigger error for ${modelId}:`, error);
      this.emitAlert('error', 'guard_failed', { modelId, kind, level });
    } finally {
      this.state = 'IDLE';
    }
  }

  generateActionPlan(kind, level, results) {
    const actions = this.config.actions;
    const actionPlan = {};
    
    // Fallback action
    if (actions.fallback.enabled && level === 'critical') {
      actionPlan.fallback = {
        to: 'v4', // Previous stable version
        mode: actions.fallback.mode
      };
    }
    
    // Traffic reduction
    if (level === 'high' || level === 'critical') {
      actionPlan.flag = {
        reduce_traffic_pct: level === 'critical' ? 50 : 25
      };
    }
    
    // Retrain trigger
    if (this.shouldTriggerRetrain(kind, level)) {
      actionPlan.retrain = {
        kick: actions.retrain.via,
        priority: actions.retrain.priority
      };
    }
    
    // Canary deployment
    if (this.shouldTriggerCanary(kind, level)) {
      actionPlan.canary = {
        deploy: this.getNextVersion(this.models.get(this.currentModelId)?.version),
        via: actions.canary.via,
        ramp: actions.canary.steps
      };
    }
    
    // Threshold adjustment
    if (actions.thresholdAdjust.enabled && kind === 'concept') {
      actionPlan.threshold = {
        adjust: {
          score_block: Math.max(0.1, 0.35 - actions.thresholdAdjust.maxDelta)
        }
      };
    }
    
    return actionPlan;
  }

  shouldTriggerRetrain(kind, level) {
    return level === this.config.actions.retrain.onLevel || level === 'critical';
  }

  shouldTriggerCanary(kind, level) {
    return level === this.config.actions.canary.onLevel || level === 'high';
  }

  shouldExecuteActions(level) {
    return level === 'high' || level === 'critical';
  }

  async executeActions(modelId, actionPlan) {
    try {
      // Execute fallback
      if (actionPlan.fallback) {
        this.logger.info(`Executing fallback for ${modelId} to ${actionPlan.fallback.to}`);
        this.metrics.actions.fallback++;
      }
      
      // Execute retrain
      if (actionPlan.retrain) {
        this.eventBus?.emit('retrain.triggered', {
          event: 'retrain.triggered',
          timestamp: new Date().toISOString(),
          modelId,
          reason: 'drift',
          source: { ref: 'model.drift.guard' },
          priority: actionPlan.retrain.priority
        });
        this.metrics.actions.retrain++;
      }
      
      // Execute canary
      if (actionPlan.canary) {
        this.eventBus?.emit('canary.deploy.request', {
          event: 'canary.deploy.request',
          timestamp: new Date().toISOString(),
          candidateTag: actionPlan.canary.deploy,
          steps: actionPlan.canary.ramp,
          via: actionPlan.canary.via,
          minStableMin: this.config.actions.canary.minStableMin
        });
        this.metrics.actions.canary++;
      }
      
      // Execute threshold adjustment
      if (actionPlan.threshold) {
        this.logger.info(`Adjusting threshold for ${modelId}:`, actionPlan.threshold.adjust);
        this.metrics.actions.threshold++;
      }
      
    } catch (error) {
      this.logger.error(`Action execution error for ${modelId}:`, error);
    }
  }

  async generateDriftReport(modelId, kind, level, results, actionPlan) {
    this.state = 'REPORT';
    
    try {
      const model = this.models.get(modelId);
      const reportPath = this.getReportPath(modelId, model?.version);
      
      const report = this.buildDriftReport(modelId, kind, level, results, actionPlan);
      
      await fs.mkdir(path.dirname(reportPath), { recursive: true });
      await fs.writeFile(reportPath, report);
      
      // Emit report ready event
      this.eventBus?.emit('model.health.report.ready', {
        event: 'model.health.report.ready',
        timestamp: new Date().toISOString(),
        modelId,
        version: model?.version || 'unknown',
        path: reportPath,
        summary: this.generateReportSummary(kind, level, results, actionPlan),
        hash: this.generateDriftHash(results)
      });
      
      // Emit drift card
      this.emitDriftCard(modelId, kind, level, results, actionPlan);
      
    } catch (error) {
      this.logger.error(`Report generation error for ${modelId}:`, error);
    }
  }

  buildDriftReport(modelId, kind, level, results, actionPlan) {
    const timestamp = new Date().toISOString();
    
    return `# Model Drift Report

## Model: ${modelId}
## Drift Type: ${kind}
## Severity: ${level.toUpperCase()}
## Generated: ${timestamp}

### Detection Results
${kind === 'covariate' ? this.formatCovariateResults(results) : this.formatConceptResults(results)}

### Action Plan
${this.formatActionPlan(actionPlan)}

### Recommendations
${this.generateRecommendations(kind, level, results)}

---
Generated by LIVIA-43 ModelDriftWatcher
`;
  }

  formatCovariateResults(results) {
    const detectors = results.detectors || {};
    let output = '';
    
    if (detectors.psi) {
      output += '#### PSI Scores\n';
      Object.entries(detectors.psi).forEach(([feature, score]) => {
        output += `- ${feature}: ${score.toFixed(3)}\n`;
      });
      output += '\n';
    }
    
    if (results.topShift?.length > 0) {
      output += '#### Top Shifting Features\n';
      results.topShift.forEach(feature => {
        output += `- ${feature}\n`;
      });
    }
    
    return output;
  }

  formatConceptResults(results) {
    const metrics = results.metrics || {};
    let output = '#### Performance Metrics\n';
    
    if (metrics.auc) output += `- AUC: ${metrics.auc.toFixed(3)}\n`;
    if (metrics.delta_auc) output += `- AUC Delta: ${metrics.delta_auc.toFixed(3)}\n`;
    if (metrics.ece) output += `- ECE: ${metrics.ece.toFixed(3)}\n`;
    
    if (results.segments?.length > 0) {
      output += '\n#### Affected Segments\n';
      results.segments.forEach(segment => {
        output += `- ${segment.segment}: AUC Δ ${segment.delta_auc.toFixed(3)}\n`;
      });
    }
    
    return output;
  }

  formatActionPlan(actionPlan) {
    let output = '';
    
    if (actionPlan.fallback) {
      output += `- **Fallback**: Switch to ${actionPlan.fallback.to} (${actionPlan.fallback.mode})\n`;
    }
    if (actionPlan.retrain) {
      output += `- **Retrain**: Trigger via ${actionPlan.retrain.kick} (priority: ${actionPlan.retrain.priority})\n`;
    }
    if (actionPlan.canary) {
      output += `- **Canary**: Deploy ${actionPlan.canary.deploy} at ${actionPlan.canary.ramp.join('%, ')}%\n`;
    }
    if (actionPlan.threshold) {
      output += `- **Threshold**: Adjust score_block to ${Object.values(actionPlan.threshold.adjust)[0]}\n`;
    }
    
    return output || '- No automated actions triggered\n';
  }

  generateRecommendations(kind, level, results) {
    const recommendations = [];
    
    if (kind === 'covariate' && level === 'high') {
      recommendations.push('Consider retraining with recent data to adapt to feature distribution changes');
      recommendations.push('Investigate root cause of feature drift (data pipeline changes, market conditions)');
    }
    
    if (kind === 'concept' && level === 'high') {
      recommendations.push('Review model performance on recent data');
      recommendations.push('Consider feature engineering or model architecture changes');
    }
    
    if (level === 'critical') {
      recommendations.push('Immediate attention required - consider manual intervention');
      recommendations.push('Review incident response procedures');
    }
    
    return recommendations.map(r => `- ${r}`).join('\n');
  }

  generateReportSummary(kind, level, results, actionPlan) {
    const kindName = kind === 'covariate' ? 'Covariate' : 'Concept';
    const actionKeys = Object.keys(actionPlan);
    const actionSummary = actionKeys.length > 0 ? `Aksiyon: ${actionKeys.join(', ')}` : 'Aksiyon yok';
    
    if (kind === 'covariate') {
      const topFeature = results.topShift?.[0] || 'unknown';
      const maxPSI = Math.max(...Object.values(results.detectors?.psi || {}));
      return `${kindName} ${level.toUpperCase()} (PSI ${maxPSI.toFixed(2)}) • ${actionSummary}.`;
    } else {
      const deltaAuc = results.metrics?.delta_auc || 0;
      const ece = results.metrics?.ece || 0;
      return `${kindName} ${level.toUpperCase()} (ΔAUC ${deltaAuc.toFixed(3)}) • ECE ${ece.toFixed(3)} • ${actionSummary}.`;
    }
  }

  emitDriftCard(modelId, kind, level, results, actionPlan) {
    const model = this.models.get(modelId);
    const modelName = modelId.split(':').pop();
    
    let body;
    if (kind === 'covariate') {
      const maxPSI = Math.max(...Object.values(results.detectors?.psi || {}));
      body = `Covariate ${level.toUpperCase()} (PSI ${maxPSI.toFixed(2)})`;
    } else {
      const deltaAuc = results.metrics?.delta_auc || 0;
      body = `Concept ${level.toUpperCase()} (ΔAUC ${deltaAuc.toFixed(3)})`;
    }
    
    const actionKeys = Object.keys(actionPlan);
    if (actionKeys.length > 0) {
      body += ` • Aksiyon: ${actionKeys.join(', ')}`;
    }
    
    this.eventBus?.emit('model.drift.card', {
      event: 'model.drift.card',
      timestamp: new Date().toISOString(),
      title: `Model Drift — ${modelName} ${model?.version || ''}`,
      body,
      severity: level === 'critical' ? 'error' : (level === 'high' ? 'warn' : 'info'),
      ttlSec: 900
    });
  }

  generateTriggerDescription(kind, results) {
    if (kind === 'covariate') {
      const maxPSI = Math.max(...Object.values(results.detectors?.psi || {}));
      return `psi>${maxPSI.toFixed(2)}`;
    } else {
      const deltaAuc = results.metrics?.delta_auc || 0;
      return `ΔAUC<${deltaAuc.toFixed(3)}`;
    }
  }

  getReportPath(modelId, version) {
    const today = new Date().toISOString().split('T')[0];
    const sanitizedModelId = modelId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const dir = this.config.reporting.outputDir
      .replace('{YYYY-MM-DD}', today)
      .replace('{modelId}_{version}', `${sanitizedModelId}_${version || 'unknown'}`);
    
    return path.join(dir, this.config.reporting.mdFile);
  }

  getNextVersion(currentVersion) {
    // Simple version increment logic
    if (!currentVersion) return 'v1';
    const match = currentVersion.match(/v(\d+)/);
    if (match) {
      const nextNum = parseInt(match[1]) + 1;
      return `v${nextNum}`;
    }
    return `${currentVersion}-next`;
  }

  generateDriftHash(results) {
    const data = JSON.stringify(results, Object.keys(results).sort());
    return crypto.createHash('sha256').update(data).digest('hex');
  }

  emitAlert(level, message, context = {}) {
    this.eventBus?.emit('model.drift.alert', {
      event: 'model.drift.alert',
      timestamp: new Date().toISOString(),
      level,
      message,
      context
    });
  }

  updateMetrics(operation, duration) {
    if (operation === 'eval') {
      this.metrics.p95EvalMs = this.updateP95(this.metrics.p95EvalMs, duration);
    }
  }

  updateP95(currentP95, newValue) {
    const alpha = 0.1;
    return currentP95 * (1 - alpha) + newValue * alpha;
  }

  getStatus() {
    return {
      name: this.name,
      initialized: this.isInitialized,
      state: this.state,
      modelsTracked: this.models.size,
      activeGuards: this.metrics.guards,
      metrics: this.metrics,
      config: this.config
    };
  }

  async getMetrics() {
    return {
      timestamp: new Date().toISOString(),
      ...this.metrics,
      state: this.state,
      modelsTracked: this.models.size
    };
  }

  async shutdown() {
    try {
      this.logger.info(`${this.name} durduruluyor...`);
      this.isInitialized = false;
      this.logger.info(`${this.name} başarıyla durduruldu`);
    } catch (error) {
      this.logger.error(`${this.name} durdurma hatası:`, error);
    }
  }
}

module.exports = ModelDriftWatcher;