/**
 * LIVIA-44 · autoRetrainOrchestrator.js
 * Kriptobot Modüler Sistem - Auto Retrain Orchestrator
 * 
 * Amaç: Model yeniden-eğitimini (auto retrain) tetik‐planla‐yürüt: drift/schedule/manuel 
 * tetiklerle veri malzemeleme → HPO → eğitim → değerlendirme → paketleme → kanarya → terfi/geri alma
 * sürecini uçtan uca orkestre etmek.
 */

const { z } = require('zod');
const crypto = require('crypto');
const fs = require('fs').promises;
const path = require('path');

// Zod şemaları
const RetrainEventSchema = z.object({
  event: z.enum([
    'retrain.triggered', 'retrain.plan.request', 'dataset.snapshot.ready',
    'fsync.lag', 'dq.finding', 'schema.migration.classified',
    'training.job.progress', 'training.job.completed', 'eval.job.completed',
    'package.request'
  ]),
  timestamp: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?([+-]\d{2}:\d{2}|Z)$/),
  modelId: z.string().optional(),
  reason: z.enum(['drift', 'schedule', 'manual']).optional(),
  source: z.object({
    ref: z.string()
  }).optional(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
  hints: z.object({
    targetTag: z.string(),
    minDataDays: z.number(),
    segments: z.array(z.string())
  }).optional(),
  targetTag: z.string().optional(),
  objective: z.object({
    metric: z.enum(['auprc', 'auc', 'rmse']),
    direction: z.enum(['max', 'min'])
  }).optional(),
  constraints: z.object({
    maxTrainMin: z.number(),
    maxBudgetUSD: z.number(),
    maxConcurrent: z.number()
  }).optional(),
  hpo: z.object({
    algo: z.enum(['tpe', 'bayes', 'grid', 'hyperband']),
    maxTrials: z.number(),
    earlyStop: z.object({
      kind: z.string(),
      minSteps: z.number()
    })
  }).optional(),
  namespace: z.string().optional(),
  window: z.object({
    from: z.string(),
    to: z.string()
  }).optional(),
  features: z.array(z.string()).optional(),
  labels: z.object({
    name: z.string(),
    positiveRate: z.number()
  }).optional(),
  exclusions: z.object({
    DRILL: z.boolean(),
    incidentIds: z.array(z.string())
  }).optional(),
  stats: z.object({
    rows: z.number(),
    missingPct: z.object({}).passthrough()
  }).optional(),
  featureStore: z.enum(['online', 'offline']).optional(),
  lagMsP95: z.number().optional(),
  datasetId: z.string().optional(),
  kind: z.string().optional(),
  severity: z.enum(['warn', 'error']).optional(),
  classification: z.enum(['additive', 'breaking', 'mixed']).optional(),
  jobId: z.string().optional(),
  trial: z.number().optional(),
  step: z.number().optional(),
  metrics: z.object({}).passthrough().optional(),
  bestTrial: z.number().optional(),
  artifact: z.object({
    path: z.string(),
    hash: z.string()
  }).optional(),
  candidateTag: z.string().optional(),
  holdout: z.object({}).passthrough().optional(),
  offlineCanary: z.object({}).passthrough().optional(),
  formats: z.array(z.string()).optional(),
  opt: z.object({
    quantize: z.enum(['int8', 'none']),
    sig: z.string(),
    repeatableSeed: z.number()
  }).optional()
}).strict();

const ConfigSchema = z.object({
  triggers: z.object({
    fromDrift: z.object({
      minLevel: z.string().default('medium'),
      cooldownHours: z.number().default(12)
    }),
    schedule: z.object({
      cron: z.string().default('Mon,Thu 03:00')
    }),
    manual: z.object({
      requireRole: z.string().default('mlops|policy')
    })
  }),
  data: z.object({
    windowDays: z.number().default(14),
    exclude: z.object({
      DRILL: z.boolean().default(true),
      incident: z.boolean().default(true)
    }),
    minRows: z.number().default(100000),
    labelLatencyMaxMin: z.number().default(1440),
    splits: z.object({
      method: z.string().default('time_series'),
      train: z.number().default(0.7),
      val: z.number().default(0.15),
      holdout: z.number().default(0.15)
    }),
    balance: z.object({
      enabled: z.boolean().default(true),
      method: z.string().default('class_weight'),
      targetPosRate: z.number().default(0.25)
    })
  }),
  hpo: z.object({
    algo: z.string().default('tpe'),
    maxTrials: z.number().default(40),
    parallel: z.number().default(2),
    earlyStop: z.object({
      kind: z.string().default('median'),
      minSteps: z.number().default(5)
    }),
    searchSpace: z.object({
      lr: z.string().default('[1e-5,1e-2]'),
      depth: z.string().default('[2,6]'),
      dropout: z.string().default('[0.0,0.5]'),
      l2: z.string().default('[0.0,0.01]')
    })
  }),
  training: z.object({
    framework: z.string().default('pytorch'),
    resources: z.object({
      gpu: z.number().default(1),
      cpu: z.number().default(4),
      memGB: z.number().default(16)
    }),
    maxTrainMin: z.number().default(60),
    seed: z.number().default(42),
    checkpoint: z.object({
      everyMin: z.number().default(5),
      keepLast: z.number().default(3)
    })
  }),
  evaluation: z.object({
    primary: z.string().default('auprc'),
    secondary: z.array(z.string()).default(['ece', 'latency_ms_p95', 'cost_usd']),
    segments: z.array(z.string()).default(['region', 'desk', 'symbol']),
    requireDelta: z.object({
      metric: z.string().default('+0.01_auc'),
      ece: z.string().default('-0.005')
    })
  }),
  packaging: z.object({
    formats: z.array(z.string()).default(['onnx', 'torchscript', 'docker']),
    quantize: z.string().default('none'),
    sign: z.object({
      algo: z.string().default('ed25519'),
      keyRef: z.string().default('kms:key/model-sign')
    }),
    reproducibility: z.object({
      lockDeps: z.boolean().default(true),
      recordEnv: z.boolean().default(true),
      dockerDigest: z.boolean().default(true)
    })
  }),
  gates: z.object({
    dq: z.string().default('LIVIA-41'),
    schema: z.string().default('LIVIA-42'),
    cost: z.string().default('LIVIA-34'),
    slo: z.string().default('LIVIA-32'),
    ethics: z.string().default('LIVIA-26')
  }),
  promotion: z.object({
    requireApproval: z.array(z.string()).default(['policy-lead']),
    canary: z.object({
      via: z.string().default('LIVIA-45'),
      steps: z.array(z.number()).default([10, 25, 50]),
      minStableMin: z.number().default(20)
    }),
    allocator: z.object({
      via: z.string().default('LIVIA-37'),
      minPctPerVariant: z.number().default(5)
    })
  }),
  storage: z.object({
    dataDir: z.string().default('artifacts/data/{modelId}/{targetTag}'),
    modelDir: z.string().default('artifacts/models/{modelId}/{targetTag}'),
    reportDir: z.string().default('data/retrain/{YYYY-MM-DD}/{modelId}_{targetTag}')
  }),
  costBudgetUSD: z.number().default(100),
  idempotencyTtlSec: z.number().default(86400)
}).strict();

class AutoRetrainOrchestrator {
  constructor(config = {}) {
    this.name = 'AutoRetrainOrchestrator';
    this.config = ConfigSchema.parse({
      triggers: {},
      data: {},
      hpo: {},
      training: {},
      evaluation: {},
      packaging: {},
      gates: {},
      promotion: {},
      storage: {},
      ...config
    });
    
    this.isInitialized = false;
    this.logger = null;
    this.eventBus = null;
    
    // FSM state
    this.state = 'IDLE'; // IDLE, PLAN, MATERIALIZE, TRAIN, EVAL, PACKAGE, PUBLISH, CANARY
    
    // Retrain State
    this.plans = new Map(); // planId -> retrain plan
    this.jobs = new Map(); // jobId -> training job
    this.candidates = new Map(); // candidateTag -> candidate info
    this.activeRetrains = new Map(); // modelId -> active retrain info
    
    // Metrics
    this.metrics = {
      plans: 0,
      jobs: 0,
      completed: 0,
      hpoTrials: 0,
      p95PlanMs: 0,
      p95MaterializeMin: 0,
      p95TrainMin: 0,
      p95EvalMin: 0,
      budgetUSD: 0,
      costGuardTrips: 0,
      gateFails: {
        dq: 0,
        schema: 0,
        cost: 0,
        ethics: 0
      }
    };
    
    // İdempotency ve audit
    this.processedRetrains = new Set();
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
    this.reportingPath = path.resolve(this.config.storage.reportDir.replace('{YYYY-MM-DD}', today));
    await fs.mkdir(this.reportingPath, { recursive: true });
  }

  setupEventHandlers() {
    if (!this.eventBus) return;

    // Retrain olaylarını dinle
    const retrainEvents = [
      'retrain.triggered', 'retrain.plan.request', 'dataset.snapshot.ready',
      'fsync.lag', 'dq.finding', 'schema.migration.classified',
      'training.job.progress', 'training.job.completed', 'eval.job.completed',
      'package.request'
    ];

    retrainEvents.forEach(eventType => {
      this.eventBus.on(eventType, async (data) => {
        await this.handleRetrainEvent(eventType, data);
      });
    });
  }

  async handleRetrainEvent(eventType, data) {
    if (!this.isInitialized) return;

    try {
      const startTime = Date.now();
      
      // Event'i normalize et
      const normalizedEvent = {
        event: eventType,
        timestamp: data.timestamp || new Date().toISOString(),
        ...data
      };

      // Validate
      const validatedEvent = RetrainEventSchema.parse(normalizedEvent);
      
      // Process based on event type
      await this.processRetrainEvent(validatedEvent);
      
      const duration = Date.now() - startTime;
      this.updateMetrics('plan', duration);
      
    } catch (error) {
      this.logger.error(`Retrain event processing error:`, error);
      this.emitAlert('error', 'processing_failed', { event: eventType, modelId: data.modelId });
    }
  }

  async processRetrainEvent(event) {
    switch (event.event) {
      case 'retrain.triggered':
        await this.handleRetrainTriggered(event);
        break;
      case 'retrain.plan.request':
        await this.handlePlanRequest(event);
        break;
      case 'dataset.snapshot.ready':
        await this.handleDatasetReady(event);
        break;
      case 'fsync.lag':
        await this.handleFSyncLag(event);
        break;
      case 'dq.finding':
        await this.handleDQFinding(event);
        break;
      case 'schema.migration.classified':
        await this.handleSchemaClassified(event);
        break;
      case 'training.job.progress':
        await this.handleTrainingProgress(event);
        break;
      case 'training.job.completed':
        await this.handleTrainingCompleted(event);
        break;
      case 'eval.job.completed':
        await this.handleEvalCompleted(event);
        break;
      case 'package.request':
        await this.handlePackageRequest(event);
        break;
    }
  }

  async handleRetrainTriggered(event) {
    this.state = 'PLAN';
    
    try {
      // Check idempotency
      const retrainKey = this.generateRetrainKey(event);
      if (this.processedRetrains.has(retrainKey)) {
        this.logger.debug(`Duplicate retrain trigger ignored: ${retrainKey}`);
        return;
      }
      
      // Check cooldown for drift triggers
      if (event.reason === 'drift' && !this.canTriggerDriftRetrain(event.modelId)) {
        this.logger.info(`Drift retrain in cooldown for ${event.modelId}`);
        return;
      }
      
      // Generate retrain plan
      const plan = await this.generateRetrainPlan(event);
      
      // Check gates before proceeding
      const gateResults = await this.checkGates(plan);
      if (!gateResults.allPassed) {
        await this.handleGateFailures(plan, gateResults);
        return;
      }
      
      // Store plan and proceed to materialization
      this.plans.set(plan.id, plan);
      this.activeRetrains.set(event.modelId, {
        planId: plan.id,
        startedAt: event.timestamp,
        reason: event.reason,
        priority: event.priority
      });
      
      // Emit plan ready
      this.emitPlanReady(plan);
      
      // Auto-proceed to materialization
      await this.startMaterialization(plan);
      
      // Mark as processed
      this.processedRetrains.add(retrainKey);
      this.metrics.plans++;
      
    } catch (error) {
      this.logger.error(`Retrain trigger handling error:`, error);
      this.emitAlert('error', 'plan_failed', { modelId: event.modelId, reason: event.reason });
    } finally {
      this.state = 'IDLE';
    }
  }

  async handlePlanRequest(event) {
    // Handle explicit plan requests
    const plan = await this.generateRetrainPlan(event);
    this.plans.set(plan.id, plan);
    this.emitPlanReady(plan);
  }

  async handleDatasetReady(event) {
    // Check if this is for an active retrain
    const plan = this.findPlanByDataset(event);
    if (plan) {
      await this.startMaterialization(plan, event);
    }
  }

  async handleFSyncLag(event) {
    if (event.lagMsP95 > 1000) { // High lag threshold
      this.logger.warn(`High FS lag detected: ${event.lagMsP95}ms, may delay materialization`);
      // Delay materialization for active plans
      this.delayActivePlans('fsync_lag', event.lagMsP95);
    }
  }

  async handleDQFinding(event) {
    if (event.severity === 'error') {
      this.logger.warn(`DQ error detected: ${event.kind}, pausing retrains`);
      await this.pauseActiveRetrains('dq_block', event);
      this.metrics.gateFails.dq++;
    }
  }

  async handleSchemaClassified(event) {
    if (event.classification === 'breaking') {
      this.logger.warn(`Breaking schema change detected for ${event.datasetId}`);
      // Wait for schema migration before proceeding
      await this.pauseActiveRetrains('schema_block', event);
    }
  }

  async handleTrainingProgress(event) {
    const job = this.jobs.get(event.jobId);
    if (job) {
      job.progress = {
        trial: event.trial,
        step: event.step,
        metrics: event.metrics || {}
      };
      
      // Emit HPO progress
      if (event.trial) {
        this.emitHPOProgress(event.jobId, job);
      }
    }
  }

  async handleTrainingCompleted(event) {
    this.state = 'EVAL';
    
    try {
      const job = this.jobs.get(event.jobId);
      if (!job) return;
      
      // Update job with results
      job.completed = true;
      job.bestTrial = event.bestTrial;
      job.artifact = event.artifact;
      job.metrics = event.metrics || {};
      
      // Start evaluation
      await this.startEvaluation(job);
      
      this.metrics.jobs++;
      this.metrics.hpoTrials += job.maxTrials || 40;
      
    } catch (error) {
      this.logger.error(`Training completion handling error:`, error);
    } finally {
      this.state = 'IDLE';
    }
  }

  async handleEvalCompleted(event) {
    this.state = 'PACKAGE';
    
    try {
      // Find associated job and plan
      const job = this.findJobByCandidate(event.candidateTag);
      const plan = job ? this.plans.get(job.planId) : null;
      
      if (!plan) return;
      
      // Check if candidate meets promotion criteria
      const meetsPromotion = await this.evaluatePromotionCriteria(event, plan);
      
      // Create candidate record
      const candidate = {
        tag: event.candidateTag,
        jobId: job.id,
        planId: plan.id,
        metrics: {
          holdout: event.holdout || {},
          offlineCanary: event.offlineCanary || {}
        },
        meetsPromotion,
        evaluatedAt: event.timestamp
      };
      
      this.candidates.set(event.candidateTag, candidate);
      
      // Emit candidate ready
      this.emitCandidateReady(candidate);
      
      // If meets promotion criteria, proceed to packaging
      if (meetsPromotion) {
        await this.startPackaging(candidate);
      } else {
        this.logger.info(`Candidate ${event.candidateTag} does not meet promotion criteria`);
      }
      
    } catch (error) {
      this.logger.error(`Eval completion handling error:`, error);
    } finally {
      this.state = 'IDLE';
    }
  }

  async handlePackageRequest(event) {
    const candidate = this.candidates.get(event.candidateTag);
    if (candidate) {
      await this.startPackaging(candidate, event);
    }
  }

  async generateRetrainPlan(event) {
    const modelId = event.modelId;
    const targetTag = event.hints?.targetTag || this.generateTargetTag(modelId);
    
    // Calculate data window
    const windowEnd = new Date(event.timestamp);
    const windowStart = new Date(windowEnd.getTime() - (this.config.data.windowDays * 24 * 60 * 60 * 1000));
    
    // Generate HPO search space
    const searchSpace = this.generateSearchSpace(event.hpo?.algo || this.config.hpo.algo);
    
    const plan = {
      id: this.generatePlanId(modelId, targetTag),
      modelId,
      targetTag,
      reason: event.reason || 'manual',
      priority: event.priority || 'normal',
      data: {
        window: {
          from: windowStart.toISOString(),
          to: windowEnd.toISOString()
        },
        segments: event.hints?.segments || ['global'],
        exclusions: this.config.data.exclude,
        minRows: this.config.data.minRows
      },
      splits: this.config.data.splits,
      hpo: {
        algo: event.hpo?.algo || this.config.hpo.algo,
        maxTrials: event.hpo?.maxTrials || this.config.hpo.maxTrials,
        searchSpace,
        earlyStop: event.hpo?.earlyStop || this.config.hpo.earlyStop
      },
      constraints: {
        maxTrainMin: event.constraints?.maxTrainMin || this.config.training.maxTrainMin,
        maxBudgetUSD: event.constraints?.maxBudgetUSD || this.config.costBudgetUSD,
        maxConcurrent: event.constraints?.maxConcurrent || 2
      },
      gates: this.config.gates,
      createdAt: event.timestamp,
      hash: ''
    };
    
    plan.hash = this.hashPlan(plan);
    return plan;
  }

  generateSearchSpace(algo) {
    const base = this.config.hpo.searchSpace;
    
    switch (algo) {
      case 'grid':
        return {
          lr: [1e-4, 5e-4, 1e-3, 5e-3],
          depth: [2, 3, 4, 5],
          dropout: [0.0, 0.1, 0.2, 0.3]
        };
      case 'tpe':
      case 'bayes':
      default:
        return base;
    }
  }

  async checkGates(plan) {
    const results = {
      allPassed: true,
      failures: []
    };
    
    // Mock gate checks (in practice would call actual gate services)
    
    // DQ gate
    if (Math.random() < 0.05) { // 5% failure rate
      results.allPassed = false;
      results.failures.push({ gate: 'dq', reason: 'freshness_breach' });
    }
    
    // Cost gate
    if (plan.constraints.maxBudgetUSD > this.config.costBudgetUSD) {
      results.allPassed = false;
      results.failures.push({ gate: 'cost', reason: 'budget_exceeded' });
    }
    
    return results;
  }

  async handleGateFailures(plan, gateResults) {
    gateResults.failures.forEach(failure => {
      this.metrics.gateFails[failure.gate] = (this.metrics.gateFails[failure.gate] || 0) + 1;
      this.emitAlert('error', `${failure.gate}_gate_failed`, {
        planId: plan.id,
        reason: failure.reason
      });
    });
    
    // Pause plan
    plan.status = 'PAUSED';
    plan.pauseReason = gateResults.failures.map(f => f.gate).join(',');
  }

  async startMaterialization(plan, datasetEvent) {
    this.state = 'MATERIALIZE';
    
    try {
      const startTime = Date.now();
      
      // Generate data manifest
      const manifest = await this.generateDataManifest(plan, datasetEvent);
      
      // Emit materialization ready
      this.eventBus?.emit('retrain.materialize.ready', {
        event: 'retrain.materialize.ready',
        timestamp: new Date().toISOString(),
        manifest,
        path: this.getManifestPath(plan)
      });
      
      // Auto-proceed to training
      await this.startTraining(plan, manifest);
      
      const duration = Date.now() - startTime;
      this.updateMetrics('materialize', duration / 60000); // Convert to minutes
      
    } catch (error) {
      this.logger.error(`Materialization error for plan ${plan.id}:`, error);
      this.emitAlert('error', 'materialize_failed', { planId: plan.id });
    } finally {
      this.state = 'IDLE';
    }
  }

  async generateDataManifest(plan, datasetEvent) {
    // Mock data manifest generation
    const features = ['feat:slip.p95', 'feat:lat.p95', 'feat:symbol'];
    const rows = datasetEvent?.stats?.rows || 240000;
    
    return {
      features,
      label: 'y_true',
      rows,
      window: plan.data.window,
      exclusions: plan.data.exclusions,
      dataHash: this.generateDataHash(plan),
      lineageRef: `state/lineage/${plan.modelId}/${plan.targetTag}/manifest.json`
    };
  }

  async startTraining(plan, manifest) {
    this.state = 'TRAIN';
    
    try {
      const jobId = this.generateJobId('train');
      
      const job = {
        id: jobId,
        planId: plan.id,
        targetTag: plan.targetTag,
        maxTrials: plan.hpo.maxTrials,
        resources: this.config.training.resources,
        manifest,
        startedAt: new Date().toISOString(),
        completed: false
      };
      
      this.jobs.set(jobId, job);
      
      // Emit training job enqueued
      this.eventBus?.emit('training.job.enqueued', {
        event: 'training.job.enqueued',
        timestamp: new Date().toISOString(),
        jobId,
        targetTag: plan.targetTag,
        trials: plan.hpo.maxTrials,
        resources: this.config.training.resources
      });
      
      // Mock training progress (in practice would monitor actual training)
      setTimeout(() => {
        this.simulateTrainingProgress(jobId);
      }, 5000);
      
    } catch (error) {
      this.logger.error(`Training start error for plan ${plan.id}:`, error);
      this.emitAlert('error', 'train_start_failed', { planId: plan.id });
    } finally {
      this.state = 'IDLE';
    }
  }

  simulateTrainingProgress(jobId) {
    const job = this.jobs.get(jobId);
    if (!job) return;

    // Simulate HPO trials
    for (let trial = 1; trial <= Math.min(5, job.maxTrials); trial++) {
      setTimeout(() => {
        const metrics = {
          val_auprc: 0.8 + Math.random() * 0.05,
          val_auc: 0.85 + Math.random() * 0.05,
          loss: 0.3 + Math.random() * 0.2
        };
        
        this.eventBus?.emit('training.job.progress', {
          event: 'training.job.progress',
          timestamp: new Date().toISOString(),
          jobId,
          trial,
          step: 50,
          metrics
        });
      }, trial * 2000);
    }
    
    // Simulate completion
    setTimeout(() => {
      this.eventBus?.emit('training.job.completed', {
        event: 'training.job.completed',
        timestamp: new Date().toISOString(),
        jobId,
        bestTrial: 3,
        artifact: {
          path: `artifacts/train/${job.targetTag}/best.ckpt`,
          hash: 'sha256:' + this.generateHash()
        },
        metrics: {
          val_auprc: 0.814,
          val_auc: 0.873,
          train_min: 48
        }
      });
    }, 10000);
  }

  async startEvaluation(job) {
    const plan = this.plans.get(job.planId);
    if (!plan) return;
    
    try {
      // Mock evaluation (in practice would run actual holdout evaluation)
      const holdoutMetrics = {
        auprc: 0.812,
        auc: 0.871,
        ece: 0.028,
        latency_ms_p95: 19
      };
      
      const championMetrics = await this.getChampionMetrics(plan.modelId);
      const offlineCanary = {
        delta_auc_vs_champion: holdoutMetrics.auc - (championMetrics.auc || 0.84),
        delta_ece_vs_champion: holdoutMetrics.ece - (championMetrics.ece || 0.034)
      };
      
      // Emit evaluation completed
      setTimeout(() => {
        this.eventBus?.emit('eval.job.completed', {
          event: 'eval.job.completed',
          timestamp: new Date().toISOString(),
          candidateTag: job.targetTag,
          holdout: holdoutMetrics,
          offlineCanary
        });
      }, 2000);
      
    } catch (error) {
      this.logger.error(`Evaluation error for job ${job.id}:`, error);
    }
  }

  async evaluatePromotionCriteria(evalEvent, plan) {
    const metrics = evalEvent.holdout || {};
    const offlineCanary = evalEvent.offlineCanary || {};
    
    // Check minimum improvement thresholds
    const deltaAuc = offlineCanary.delta_auc_vs_champion || 0;
    const deltaEce = offlineCanary.delta_ece_vs_champion || 0;
    
    const requiredAucDelta = 0.01; // From config
    const requiredEceDelta = -0.005; // Improvement in ECE
    
    const meetsCriteria = deltaAuc >= requiredAucDelta && deltaEce <= Math.abs(requiredEceDelta);
    
    return meetsCriteria;
  }

  async startPackaging(candidate, packageEvent) {
    this.state = 'PACKAGE';
    
    try {
      const formats = packageEvent?.formats || this.config.packaging.formats;
      
      // Mock packaging (in practice would create ONNX, TorchScript, etc.)
      const artifact = {
        onnx: `artifacts/models/${candidate.tag}/model.onnx`,
        hash: 'sha256:' + this.generateHash()
      };
      
      // Update candidate with packaged artifact
      candidate.artifact = artifact;
      candidate.packagedAt = new Date().toISOString();
      
      // Proceed to publish proposal
      await this.createPublishProposal(candidate);
      
    } catch (error) {
      this.logger.error(`Packaging error for candidate ${candidate.tag}:`, error);
      this.emitAlert('error', 'package_failed', { candidateTag: candidate.tag });
    } finally {
      this.state = 'IDLE';
    }
  }

  async createPublishProposal(candidate) {
    this.state = 'PUBLISH';
    
    try {
      const plan = this.plans.get(candidate.planId);
      const job = this.jobs.get(candidate.jobId);
      
      // Final gate checks
      const gateResults = await this.checkFinalGates(candidate);
      
      const proposal = {
        candidateTag: candidate.tag,
        champion: await this.getCurrentChampion(plan.modelId),
        gates: gateResults,
        proposal: {
          canarySteps: this.config.promotion.canary.steps,
          minStableMin: this.config.promotion.canary.minStableMin,
          flagId: `${plan.modelId.replace(':', '.')}.retrain.v2`
        },
        requiresApproval: this.config.promotion.requireApproval,
        hash: this.generateHash()
      };
      
      // Emit publish proposal
      this.eventBus?.emit('model.publish.proposed', {
        event: 'model.publish.proposed',
        timestamp: new Date().toISOString(),
        ...proposal
      });
      
      // Auto-request canary deployment if all gates pass
      if (gateResults.dq === 'pass' && gateResults.cost === 'pass') {
        await this.requestCanaryDeployment(candidate, proposal);
      }
      
      // Generate completion report
      await this.generateCompletionReport(candidate, plan, job);
      
      this.metrics.completed++;
      
    } catch (error) {
      this.logger.error(`Publish proposal error for candidate ${candidate.tag}:`, error);
    } finally {
      this.state = 'IDLE';
    }
  }

  async checkFinalGates(candidate) {
    // Mock final gate checks
    return {
      dq: 'pass',
      schema: 'pass',
      cost: 'pass',
      ethics: 'pass'
    };
  }

  async requestCanaryDeployment(candidate, proposal) {
    this.eventBus?.emit('canary.deploy.request', {
      event: 'canary.deploy.request',
      timestamp: new Date().toISOString(),
      candidateTag: candidate.tag,
      steps: proposal.proposal.canarySteps,
      via: this.config.promotion.canary.via,
      minStableMin: proposal.proposal.minStableMin
    });
  }

  async generateCompletionReport(candidate, plan, job) {
    try {
      const reportPath = this.getReportPath(plan.modelId, candidate.tag);
      const report = this.buildCompletionReport(candidate, plan, job);
      
      await fs.mkdir(path.dirname(reportPath), { recursive: true });
      await fs.writeFile(reportPath, report);
      
      // Emit report ready
      this.eventBus?.emit('retrain.report.ready', {
        event: 'retrain.report.ready',
        timestamp: new Date().toISOString(),
        modelId: plan.modelId,
        candidateTag: candidate.tag,
        format: 'md',
        path: reportPath,
        summary: this.generateReportSummary(candidate),
        hash: this.generateHash()
      });
      
      // Emit completion card
      this.emitCompletionCard(plan.modelId, candidate);
      
    } catch (error) {
      this.logger.error(`Report generation error:`, error);
    }
  }

  buildCompletionReport(candidate, plan, job) {
    const holdout = candidate.metrics.holdout || {};
    const offlineCanary = candidate.metrics.offlineCanary || {};
    
    return `# Auto Retrain Report

## Model: ${plan.modelId}
## Candidate: ${candidate.tag}
## Completed: ${candidate.evaluatedAt}

### Training Summary
- **Algorithm**: ${plan.hpo.algo}
- **Trials**: ${job.maxTrials}
- **Best Trial**: ${job.bestTrial}
- **Training Time**: ${job.metrics?.train_min || 48} minutes

### Performance Metrics
- **Holdout AUPRC**: ${holdout.auprc?.toFixed(3) || 'N/A'}
- **Holdout AUC**: ${holdout.auc?.toFixed(3) || 'N/A'}
- **ECE**: ${holdout.ece?.toFixed(3) || 'N/A'}
- **Latency P95**: ${holdout.latency_ms_p95 || 'N/A'}ms

### Champion Comparison
- **AUC Delta**: ${offlineCanary.delta_auc_vs_champion?.toFixed(3) || 'N/A'}
- **ECE Delta**: ${offlineCanary.delta_ece_vs_champion?.toFixed(3) || 'N/A'}

### Promotion Status
- **Meets Criteria**: ${candidate.meetsPromotion ? 'YES' : 'NO'}
- **Canary Recommended**: ${candidate.meetsPromotion ? 'YES' : 'NO'}

### Artifacts
- **Model Path**: ${candidate.artifact?.onnx || 'N/A'}
- **Hash**: ${candidate.artifact?.hash || 'N/A'}

---
Generated by LIVIA-44 AutoRetrainOrchestrator
`;
  }

  generateReportSummary(candidate) {
    const holdout = candidate.metrics.holdout || {};
    const offlineCanary = candidate.metrics.offlineCanary || {};
    
    const aucDelta = offlineCanary.delta_auc_vs_champion || 0;
    const auprDelta = (holdout.auprc || 0) - 0.8; // Baseline assumption
    const ece = holdout.ece || 0;
    const latency = holdout.latency_ms_p95 || 0;
    
    const action = candidate.meetsPromotion ? 'Canary önerildi' : 'Champion korundu';
    
    return `AUCPR ${auprDelta >= 0 ? '+' : ''}${auprDelta.toFixed(3)}, AUC ${aucDelta >= 0 ? '+' : ''}${aucDelta.toFixed(3)}, ECE ${ece.toFixed(3)} • Latency p95 ${latency}ms • ${action}.`;
  }

  emitCompletionCard(modelId, candidate) {
    const holdout = candidate.metrics.holdout || {};
    const offlineCanary = candidate.metrics.offlineCanary || {};
    const modelName = modelId.split(':').pop();
    
    const aucDelta = offlineCanary.delta_auc_vs_champion || 0;
    const ece = holdout.ece || 0;
    const latency = holdout.latency_ms_p95 || 0;
    
    let body = `Holdout AUC ${aucDelta >= 0 ? '+' : ''}${aucDelta.toFixed(3)} • ECE ${ece.toFixed(3)} • p95 ${latency}ms`;
    
    if (candidate.meetsPromotion) {
      body += ' • Canary önerildi';
    }
    
    this.eventBus?.emit('retrain.card', {
      event: 'retrain.card',
      timestamp: new Date().toISOString(),
      title: `Retrain Hazır — ${modelName} ${candidate.tag}`,
      body,
      severity: 'info',
      ttlSec: 900
    });
  }

  // Helper methods

  canTriggerDriftRetrain(modelId) {
    const activeRetrain = this.activeRetrains.get(modelId);
    if (!activeRetrain) return true;
    
    const cooldownHours = this.config.triggers.fromDrift.cooldownHours;
    const cooldownMs = cooldownHours * 60 * 60 * 1000;
    const elapsed = Date.now() - new Date(activeRetrain.startedAt).getTime();
    
    return elapsed >= cooldownMs;
  }

  generateRetrainKey(event) {
    const base = `${event.modelId}:${event.reason}:${event.timestamp.split('T')[0]}`;
    return crypto.createHash('sha256').update(base).digest('hex');
  }

  generateTargetTag(modelId) {
    const suffix = Math.random().toString(36).substr(2, 6);
    return `v${Date.now().toString().slice(-6)}-${suffix}`;
  }

  generatePlanId(modelId, targetTag) {
    return `plan:${modelId}:${targetTag}:${Date.now()}`;
  }

  generateJobId(prefix) {
    return `${prefix}#${Date.now().toString(36)}${Math.random().toString(36).substr(2, 6)}`;
  }

  generateDataHash(plan) {
    const data = JSON.stringify({
      window: plan.data.window,
      exclusions: plan.data.exclusions,
      modelId: plan.modelId
    }, Object.keys(plan.data).sort());
    return 'sha256:' + crypto.createHash('sha256').update(data).digest('hex');
  }

  hashPlan(plan) {
    const planCopy = { ...plan };
    delete planCopy.hash;
    const planString = JSON.stringify(planCopy, Object.keys(planCopy).sort());
    return 'sha256:' + crypto.createHash('sha256').update(planString).digest('hex');
  }

  generateHash() {
    return crypto.createHash('sha256').update(Date.now().toString()).digest('hex');
  }

  findPlanByDataset(datasetEvent) {
    // Find plan that matches dataset namespace/window
    return Array.from(this.plans.values()).find(plan => 
      datasetEvent.namespace === 'kb_default' && 
      plan.status !== 'COMPLETED'
    );
  }

  findJobByCandidate(candidateTag) {
    return Array.from(this.jobs.values()).find(job => 
      job.targetTag === candidateTag
    );
  }

  async getChampionMetrics(modelId) {
    // Mock champion metrics
    return {
      auc: 0.84,
      ece: 0.034,
      latency_ms_p95: 22
    };
  }

  async getCurrentChampion(modelId) {
    // Mock current champion version
    const match = modelId.match(/model:(.+)/);
    return match ? `${match[1]}_v5` : 'unknown_v5';
  }

  getManifestPath(plan) {
    const sanitized = plan.modelId.replace(/[^a-zA-Z0-9_-]/g, '_');
    return `${this.config.storage.dataDir}/${sanitized}/${plan.targetTag}/manifest.json`;
  }

  getReportPath(modelId, targetTag) {
    const today = new Date().toISOString().split('T')[0];
    const sanitized = modelId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const dir = this.config.storage.reportDir
      .replace('{YYYY-MM-DD}', today)
      .replace('{modelId}_{targetTag}', `${sanitized}_${targetTag}`);
    
    return path.join(dir, 'report.md');
  }

  emitPlanReady(plan) {
    this.eventBus?.emit('retrain.plan.ready', {
      event: 'retrain.plan.ready',
      timestamp: new Date().toISOString(),
      modelId: plan.modelId,
      targetTag: plan.targetTag,
      data: plan.data,
      splits: plan.splits,
      hpo: plan.hpo,
      constraints: plan.constraints,
      gates: plan.gates,
      hash: plan.hash
    });
  }

  emitCandidateReady(candidate) {
    const rationale = [];
    const offlineCanary = candidate.metrics.offlineCanary || {};
    
    if (offlineCanary.delta_auc_vs_champion > 0) {
      rationale.push(`>champion by +${offlineCanary.delta_auc_vs_champion.toFixed(3)} AUC`);
    }
    if (offlineCanary.delta_ece_vs_champion < 0) {
      rationale.push('ECE improved');
    }
    if (candidate.metrics.holdout?.latency_ms_p95 < 25) {
      rationale.push('latency OK');
    }
    
    this.eventBus?.emit('model.candidate.ready', {
      event: 'model.candidate.ready',
      timestamp: new Date().toISOString(),
      modelId: this.plans.get(candidate.planId)?.modelId,
      candidateTag: candidate.tag,
      artifact: candidate.artifact,
      metrics: candidate.metrics.holdout,
      meetsPromotion: candidate.meetsPromotion ? 'true' : 'false',
      rationale
    });
  }

  emitHPOProgress(jobId, job) {
    const progress = job.progress || {};
    
    this.eventBus?.emit('hpo.progress', {
      event: 'hpo.progress',
      timestamp: new Date().toISOString(),
      jobId,
      completed: progress.trial || 0,
      total: job.maxTrials,
      best: {
        trial: progress.trial,
        val_auprc: progress.metrics?.val_auprc || 0,
        params: { lr: 0.0007, depth: 4, dropout: 0.2 } // Mock params
      }
    });
  }

  delayActivePlans(reason, value) {
    this.plans.forEach(plan => {
      if (plan.status !== 'COMPLETED') {
        plan.delayed = { reason, value, until: Date.now() + 600000 }; // 10 min delay
      }
    });
  }

  async pauseActiveRetrains(reason, event) {
    this.activeRetrains.forEach((retrain, modelId) => {
      const plan = this.plans.get(retrain.planId);
      if (plan && plan.status !== 'COMPLETED') {
        plan.status = 'PAUSED';
        plan.pauseReason = reason;
        this.logger.info(`Paused retrain for ${modelId}: ${reason}`);
      }
    });
  }

  emitAlert(level, message, context = {}) {
    this.eventBus?.emit('retrain.alert', {
      event: 'retrain.alert',
      timestamp: new Date().toISOString(),
      level,
      message,
      context
    });
  }

  updateMetrics(operation, duration) {
    switch (operation) {
      case 'plan':
        this.metrics.p95PlanMs = this.updateP95(this.metrics.p95PlanMs, duration);
        break;
      case 'materialize':
        this.metrics.p95MaterializeMin = this.updateP95(this.metrics.p95MaterializeMin, duration);
        break;
      case 'train':
        this.metrics.p95TrainMin = this.updateP95(this.metrics.p95TrainMin, duration);
        break;
      case 'eval':
        this.metrics.p95EvalMin = this.updateP95(this.metrics.p95EvalMin, duration);
        break;
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
      activePlans: this.plans.size,
      activeJobs: this.jobs.size,
      candidates: this.candidates.size,
      activeRetrains: this.activeRetrains.size,
      metrics: this.metrics,
      config: this.config
    };
  }

  async getMetrics() {
    return {
      timestamp: new Date().toISOString(),
      ...this.metrics,
      state: this.state,
      activePlans: this.plans.size,
      activeJobs: this.jobs.size
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

module.exports = AutoRetrainOrchestrator;