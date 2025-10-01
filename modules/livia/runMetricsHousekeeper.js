/**
 * LIVIA-31: Run Metrics Housekeeper
 * LIVIA ekosistemindeki tüm zaman serisi ve olay depolarını otomatik bakımla sağlıklı tutan sistem
 */

const { z } = require('zod');
const EventEmitter = require('events');
const crypto = require('crypto');

// Input schemas
const HousekeepingRequestSchema = z.object({
    event: z.literal('housekeeping.request'),
    timestamp: z.string(),
    mode: z.enum(['auto', 'manual']),
    window: z.object({
        from: z.string(),
        to: z.string()
    }),
    taskSet: z.array(z.enum(['rollup', 'compact', 'dedup', 'ttl_enforce', 'coldstore', 'index_optimize', 'dlq_cleanup', 'verify'])),
    priority: z.enum(['low', 'normal', 'high']),
    dryRun: z.boolean().default(false)
}).strict();

const StorageThresholdStatusSchema = z.object({
    event: z.literal('storage.threshold.status'),
    timestamp: z.string(),
    volume: z.string(),
    freePct: z.number(),
    bytesFree: z.number()
}).strict();

const DistDlqSchema = z.object({
    event: z.literal('dist.dlq'),
    timestamp: z.string(),
    deliveryKey: z.string(),
    reason: z.string(),
    deadLetterPath: z.string()
}).strict();

const KnowledgeIndexedSchema = z.object({
    event: z.literal('knowledge.indexed'),
    timestamp: z.string(),
    index: z.string(),
    docId: z.string(),
    upserted: z.boolean()
}).strict();

// Output schemas
const HousekeepingPlannedSchema = z.object({
    event: z.literal('housekeeping.planned'),
    timestamp: z.string(),
    hkKey: z.string(),
    taskSet: z.array(z.string()),
    window: z.object({
        from: z.string(),
        to: z.string()
    }),
    targets: z.record(z.number())
}).strict();

const HousekeepingProgressSchema = z.object({
    event: z.literal('housekeeping.progress'),
    timestamp: z.string(),
    hkKey: z.string(),
    task: z.string(),
    status: z.enum(['running', 'completed', 'failed']),
    details: z.string()
}).strict();

const HousekeepingCompletedSchema = z.object({
    event: z.literal('housekeeping.completed'),
    timestamp: z.string(),
    hkKey: z.string(),
    tasksOk: z.array(z.string()),
    bytesFreed: z.number(),
    filesMoved: z.number(),
    dlqReplayed: z.number(),
    reportPath: z.string(),
    hash: z.string()
}).strict();

class RunMetricsHousekeeper extends EventEmitter {
    constructor(eventBus, logger, config = {}) {
        super();
        this.eventBus = eventBus;
        this.logger = logger;
        this.name = 'RunMetricsHousekeeper';
        
        this.config = {
            i18n: { locale: 'tr-TR', tz: 'Europe/Istanbul' },
            retention: {
                'metrics.timeseries': { hotDays: 14, warmDays: 60, coldDays: 365, keepForever: false },
                'events.raw': { hotDays: 14, warmDays: 90, coldDays: 365, keepForever: false },
                'digest': { hotDays: 90, warmDays: 365, coldDays: 0, keepForever: true },
                'postmortem': { hotDays: 365, warmDays: 3650, coldDays: 0, keepForever: true },
                'policy': { hotDays: 365, warmDays: 3650, coldDays: 0, keepForever: true },
                'knowledge.index': { hotDays: 365, warmDays: 0, coldDays: 0, keepForever: true },
                'ethics.worm': { hotDays: 0, warmDays: 0, coldDays: 0, keepForever: true }
            },
            compaction: {
                timeseries: [
                    { from: '5s', to: '1m', agg: ['min', 'max', 'avg', 'p95'] },
                    { from: '1m', to: '5m', agg: ['min', 'max', 'avg', 'p95'] },
                    { from: '5m', to: '1h', agg: ['min', 'max', 'avg', 'p95'] }
                ],
                fileFormat: 'parquet',
                compression: { codec: 'zstd', level: 11 }
            },
            dedup: {
                tsToleranceSec: 1
            },
            coldstore: {
                enabled: true,
                provider: 's3',
                bucket: 'archive',
                prefix: 'livia',
                multipartChunkMB: 32,
                storageClass: 'STANDARD_IA',
                encryptAtRest: true
            },
            indexOptimize: {
                knowledge: { vector: true, bm25: true, vacuum: true, reindexIfFragPct: 0.2 }
            },
            dlq: {
                replay: { enabled: true, maxPerRun: 50, backoffMs: 500 },
                ttlDays: 30
            },
            diskGuard: {
                minFreePct: 15,
                emergencyTasks: ['ttl_enforce', 'coldstore', 'compact']
            },
            schedule: {
                dailyAt: '03:30',
                weeklyDeepAt: 'Sun 04:30'
            },
            redactionProfile: 'generic',
            scanSecretsBeforeArchive: true,
            idempotencyTtlSec: 86400,
            ...config
        };

        this.state = {
            status: 'IDLE',
            activeJobs: new Map(),
            completedJobs: new Map(),
            storageStatus: new Map(),
            dlqItems: new Map(),
            metrics: {
                planned: 0,
                completed: 0,
                failed: 0,
                p95PlanMs: 0,
                p95ExecMs: 0,
                bytesFreed: 0,
                filesCompacted: 0,
                filesArchived: 0,
                indexOptimized: { vector: 0, bm25: 0 },
                costEstimateUSD: 0,
                lowSpaceAuto: false
            }
        };

        this.taskExecutors = new Map();
        this.dataTargets = new Map();
        this.isInitialized = false;
    }

    async initialize() {
        try {
            this.logger.info(`${this.name} başlatılıyor...`);
            
            // Event listeners
            this.eventBus.on('housekeeping.request', this.handleHousekeepingRequest.bind(this));
            this.eventBus.on('storage.threshold.status', this.handleStorageThresholdStatus.bind(this));
            this.eventBus.on('dist.dlq', this.handleDistDlq.bind(this));
            this.eventBus.on('knowledge.indexed', this.handleKnowledgeIndexed.bind(this));

            // Initialize task executors
            this.initializeTaskExecutors();
            
            // Initialize data targets map
            this.initializeDataTargets();
            
            // Schedule automatic housekeeping
            this.scheduleAutomaticHousekeeping();
            
            this.isInitialized = true;
            this.logger.info(`${this.name} başarıyla başlatıldı`);
            return true;
        } catch (error) {
            this.logger.error(`${this.name} başlatma hatası:`, error);
            return false;
        }
    }

    initializeTaskExecutors() {
        this.taskExecutors.set('rollup', this.executeRollup.bind(this));
        this.taskExecutors.set('compact', this.executeCompact.bind(this));
        this.taskExecutors.set('dedup', this.executeDedup.bind(this));
        this.taskExecutors.set('ttl_enforce', this.executeTtlEnforce.bind(this));
        this.taskExecutors.set('coldstore', this.executeColdstore.bind(this));
        this.taskExecutors.set('index_optimize', this.executeIndexOptimize.bind(this));
        this.taskExecutors.set('dlq_cleanup', this.executeDlqCleanup.bind(this));
        this.taskExecutors.set('verify', this.executeVerify.bind(this));
        
        this.logger.info(`Initialized ${this.taskExecutors.size} task executors`);
    }

    initializeDataTargets() {
        this.dataTargets.set('metrics', {
            basePath: 'data/metrics',
            pattern: '**/*.parquet',
            type: 'timeseries'
        });
        
        this.dataTargets.set('events', {
            basePath: 'data/events',
            pattern: '**/*.jsonl',
            type: 'events'
        });
        
        this.dataTargets.set('digest', {
            basePath: 'data/digest',
            pattern: '**/*.md',
            type: 'artifact'
        });
        
        this.dataTargets.set('postmortem', {
            basePath: 'data/postmortem',
            pattern: '**/*.md',
            type: 'artifact'
        });
        
        this.dataTargets.set('policy', {
            basePath: 'data/policy',
            pattern: '**/*.yaml',
            type: 'artifact'
        });
        
        this.dataTargets.set('kbIndex', {
            basePath: 'state/kb',
            pattern: '**/*',
            type: 'index'
        });
        
        this.dataTargets.set('dlq', {
            basePath: 'state/dlq',
            pattern: '**/*.json',
            type: 'dlq'
        });
        
        this.dataTargets.set('ethics', {
            basePath: 'state/ethics/worm',
            pattern: '**/*.log',
            type: 'worm'
        });
        
        this.logger.info(`Initialized ${this.dataTargets.size} data targets`);
    }

    scheduleAutomaticHousekeeping() {
        // Schedule daily housekeeping
        const dailyTime = this.config.schedule.dailyAt;
        this.logger.info(`Scheduled daily housekeeping at ${dailyTime}`);
        
        // Schedule weekly deep housekeeping
        const weeklyTime = this.config.schedule.weeklyDeepAt;
        this.logger.info(`Scheduled weekly deep housekeeping at ${weeklyTime}`);
        
        // In real implementation, use cron or similar scheduler
        // For now, just log the schedule
    }

    handleHousekeepingRequest(data) {
        try {
            const validated = HousekeepingRequestSchema.parse(data);
            this.logger.info(`Housekeeping request: ${validated.mode} - ${validated.taskSet.length} tasks`);
            this.processHousekeepingRequest(validated);
        } catch (error) {
            this.logger.error('Housekeeping request validation error:', error);
            this.emitAlert('error', 'invalid_housekeeping_request');
        }
    }

    handleStorageThresholdStatus(data) {
        try {
            const validated = StorageThresholdStatusSchema.parse(data);
            this.updateStorageStatus(validated);
            
            // Check if emergency housekeeping is needed
            if (validated.freePct < this.config.diskGuard.minFreePct) {
                this.triggerEmergencyHousekeeping(validated);
            }
        } catch (error) {
            this.logger.error('Storage threshold validation error:', error);
        }
    }

    handleDistDlq(data) {
        try {
            const validated = DistDlqSchema.parse(data);
            this.recordDlqItem(validated);
        } catch (error) {
            this.logger.error('DLQ validation error:', error);
        }
    }

    handleKnowledgeIndexed(data) {
        try {
            const validated = KnowledgeIndexedSchema.parse(data);
            this.recordKnowledgeIndexing(validated);
        } catch (error) {
            this.logger.error('Knowledge indexed validation error:', error);
        }
    }

    updateStorageStatus(storageData) {
        this.state.storageStatus.set(storageData.volume, {
            freePct: storageData.freePct,
            bytesFree: storageData.bytesFree,
            updatedAt: storageData.timestamp
        });
        
        this.logger.debug(`Storage status updated: ${storageData.volume} - ${storageData.freePct.toFixed(1)}% free`);
    }

    triggerEmergencyHousekeeping(storageData) {
        this.logger.warn(`Low disk space detected: ${storageData.freePct.toFixed(1)}% free - triggering emergency housekeeping`);
        
        const emergencyRequest = {
            event: 'housekeeping.request',
            timestamp: new Date().toISOString(),
            mode: 'auto',
            window: {
                from: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(), // 30 days ago
                to: new Date().toISOString()
            },
            taskSet: this.config.diskGuard.emergencyTasks,
            priority: 'high',
            dryRun: false
        };
        
        this.processHousekeepingRequest(emergencyRequest);
        this.state.metrics.lowSpaceAuto = true;
    }

    recordDlqItem(dlqData) {
        this.state.dlqItems.set(dlqData.deliveryKey, {
            reason: dlqData.reason,
            deadLetterPath: dlqData.deadLetterPath,
            timestamp: dlqData.timestamp
        });
        
        this.logger.debug(`DLQ item recorded: ${dlqData.deliveryKey} - ${dlqData.reason}`);
    }

    recordKnowledgeIndexing(indexData) {
        // Track knowledge base indexing for optimization planning
        this.logger.debug(`Knowledge indexed: ${indexData.docId} in ${indexData.index}`);
    }

    async processHousekeepingRequest(request) {
        const planStartTime = Date.now();
        
        try {
            this.state.status = 'PLANNING';
            
            // Generate housekeeping key for idempotency
            const hkKey = this.generateHousekeepingKey(request);
            
            if (this.state.activeJobs.has(hkKey)) {
                this.logger.info(`Housekeeping job already active: ${hkKey}`);
                return;
            }
            
            // Create job plan
            const jobPlan = await this.createJobPlan(request, hkKey);
            
            if (!jobPlan) {
                this.emitAlert('error', 'job_planning_failed');
                return;
            }
            
            // Store active job
            this.state.activeJobs.set(hkKey, jobPlan);
            
            // Emit planned event
            this.emitHousekeepingPlanned(jobPlan);
            
            // Execute job
            await this.executeJob(jobPlan);
            
            // Update metrics
            this.state.metrics.planned++;
            const planTime = Date.now() - planStartTime;
            this.updatePlanMetrics(planTime);
            
        } catch (error) {
            this.logger.error(`Housekeeping processing error:`, error);
            this.emitAlert('error', 'housekeeping_processing_failed');
        } finally {
            this.state.status = 'IDLE';
        }
    }

    generateHousekeepingKey(request) {
        const keyData = {
            taskSet: request.taskSet.sort(),
            window: request.window,
            scope: 'global',
            tier: request.priority
        };
        
        return 'hk:' + crypto
            .createHash('sha256')
            .update(JSON.stringify(keyData))
            .digest('hex')
            .substring(0, 16);
    }

    async createJobPlan(request, hkKey) {
        const planStartTime = Date.now();
        
        try {
            // Determine targets for each task
            const targets = await this.analyzeTargets(request);
            
            // Check for conflicts with ethics/WORM data
            const conflicts = this.checkWormConflicts(request.taskSet);
            
            // Filter out conflicting tasks
            const safeTasks = request.taskSet.filter(task => !conflicts.includes(task));
            
            if (safeTasks.length === 0) {
                this.logger.warn('All tasks conflict with WORM protection');
                return null;
            }
            
            // Priority ordering for emergency situations
            const orderedTasks = this.orderTasks(safeTasks, request.priority);
            
            const jobPlan = {
                hkKey,
                request,
                tasks: orderedTasks,
                targets,
                status: 'PLANNED',
                startedAt: null,
                completedAt: null,
                currentTask: 0,
                results: {
                    bytesFreed: 0,
                    filesMoved: 0,
                    dlqReplayed: 0,
                    tasksOk: [],
                    tasksFailed: [],
                    errors: []
                },
                createdAt: new Date().toISOString()
            };
            
            return jobPlan;
            
        } catch (error) {
            this.logger.error('Job planning error:', error);
            return null;
        }
    }

    async analyzeTargets(request) {
        const targets = {};
        
        // Count files in each target category
        for (const [targetName, targetConfig] of this.dataTargets.entries()) {
            const count = await this.countTargetFiles(targetConfig, request.window);
            targets[targetName] = count;
        }
        
        return targets;
    }

    async countTargetFiles(targetConfig, window) {
        // Simulate file counting based on target type
        switch (targetConfig.type) {
            case 'timeseries':
                return Math.floor(Math.random() * 20) + 5; // 5-25 files
            case 'events':
                return Math.floor(Math.random() * 15) + 3; // 3-18 files
            case 'artifact':
                return Math.floor(Math.random() * 10) + 1; // 1-11 files
            case 'index':
                return 1; // Usually one index
            case 'dlq':
                return this.state.dlqItems.size;
            case 'worm':
                return 0; // Never touch WORM data
            default:
                return 0;
        }
    }

    checkWormConflicts(taskSet) {
        const conflicts = [];
        
        // Tasks that might conflict with WORM data
        const riskTasks = ['ttl_enforce', 'coldstore', 'compact'];
        
        for (const task of taskSet) {
            if (riskTasks.includes(task)) {
                // Check if any WORM data would be affected
                // For now, we'll be conservative and avoid these tasks on ethics data
                // In real implementation, check actual paths
            }
        }
        
        return conflicts;
    }

    orderTasks(tasks, priority) {
        // Task ordering by priority and dependencies
        const taskOrder = {
            'verify': 0,        // Verify first for safety
            'ttl_enforce': 1,   // TTL enforcement
            'rollup': 2,        // Rollup before compaction
            'compact': 3,       // Compaction
            'dedup': 4,         // Deduplication
            'coldstore': 5,     // Cold storage
            'index_optimize': 6, // Index optimization
            'dlq_cleanup': 7    // DLQ cleanup last
        };
        
        // For emergency situations, prioritize space-freeing tasks
        if (priority === 'high') {
            return tasks.sort((a, b) => {
                const spaceFreeTasks = ['ttl_enforce', 'coldstore', 'compact'];
                const aFreeSpace = spaceFreeTasks.includes(a) ? -1 : 0;
                const bFreeSpace = spaceFreeTasks.includes(b) ? -1 : 0;
                
                if (aFreeSpace !== bFreeSpace) {
                    return aFreeSpace - bFreeSpace;
                }
                
                return (taskOrder[a] || 99) - (taskOrder[b] || 99);
            });
        }
        
        // Normal ordering
        return tasks.sort((a, b) => (taskOrder[a] || 99) - (taskOrder[b] || 99));
    }

    async executeJob(jobPlan) {
        const execStartTime = Date.now();
        
        try {
            jobPlan.status = 'RUNNING';
            jobPlan.startedAt = new Date().toISOString();
            
            this.logger.info(`Starting housekeeping job: ${jobPlan.hkKey} (${jobPlan.tasks.length} tasks)`);
            
            // Execute tasks sequentially
            for (let i = 0; i < jobPlan.tasks.length; i++) {
                jobPlan.currentTask = i;
                const task = jobPlan.tasks[i];
                
                try {
                    await this.executeTask(task, jobPlan);
                    jobPlan.results.tasksOk.push(task);
                } catch (error) {
                    this.logger.error(`Task ${task} failed:`, error);
                    jobPlan.results.tasksFailed.push(task);
                    jobPlan.results.errors.push({
                        task,
                        error: error.message,
                        timestamp: new Date().toISOString()
                    });
                    
                    // Continue with other tasks unless it's a critical failure
                    if (error.critical) {
                        this.logger.error(`Critical failure in task ${task}, stopping job`);
                        break;
                    }
                }
            }
            
            // Generate report
            const report = await this.generateJobReport(jobPlan);
            
            // Complete job
            await this.completeJob(jobPlan, report);
            
            // Update execution metrics
            const execTime = Date.now() - execStartTime;
            this.updateExecMetrics(execTime);
            
        } catch (error) {
            this.logger.error(`Job execution error for ${jobPlan.hkKey}:`, error);
            await this.failJob(jobPlan, error);
        }
    }

    async executeTask(task, jobPlan) {
        const taskStartTime = Date.now();
        
        this.logger.info(`Executing task: ${task}`);
        
        // Emit progress
        this.emitHousekeepingProgress(jobPlan.hkKey, task, 'running', `Starting ${task}`);
        
        // Get task executor
        const executor = this.taskExecutors.get(task);
        if (!executor) {
            throw new Error(`No executor found for task: ${task}`);
        }
        
        // Execute task
        const result = await executor(jobPlan);
        
        // Update job results
        if (result) {
            if (result.bytesFreed) jobPlan.results.bytesFreed += result.bytesFreed;
            if (result.filesMoved) jobPlan.results.filesMoved += result.filesMoved;
            if (result.dlqReplayed) jobPlan.results.dlqReplayed += result.dlqReplayed;
        }
        
        // Emit completion
        const details = result ? `${task} completed: ${JSON.stringify(result)}` : `${task} completed`;
        this.emitHousekeepingProgress(jobPlan.hkKey, task, 'completed', details);
        
        const taskTime = Date.now() - taskStartTime;
        this.logger.info(`Task ${task} completed in ${taskTime}ms`);
    }

    async executeRollup(jobPlan) {
        this.logger.info('Executing rollup task');
        
        // Simulate timeseries rollup
        const metricsFiles = jobPlan.targets.metrics || 0;
        
        if (metricsFiles === 0) {
            return { bytesFreed: 0, filesProcessed: 0 };
        }
        
        // Simulate processing
        const bytesFreed = metricsFiles * 1024 * 1024 * 10; // 10MB per file
        const filesProcessed = metricsFiles;
        
        // Update global metrics
        this.state.metrics.filesCompacted += filesProcessed;
        this.state.metrics.bytesFreed += bytesFreed;
        
        return { bytesFreed, filesProcessed };
    }

    async executeCompact(jobPlan) {
        this.logger.info('Executing compact task');
        
        // Simulate compaction
        const eventsFiles = jobPlan.targets.events || 0;
        
        if (eventsFiles === 0) {
            return { bytesFreed: 0, filesProcessed: 0 };
        }
        
        // Simulate compression savings
        const bytesFreed = eventsFiles * 1024 * 1024 * 5; // 5MB per file
        const filesProcessed = eventsFiles;
        
        // Update global metrics
        this.state.metrics.filesCompacted += filesProcessed;
        this.state.metrics.bytesFreed += bytesFreed;
        
        return { bytesFreed, filesProcessed };
    }

    async executeDedup(jobPlan) {
        this.logger.info('Executing dedup task');
        
        // Simulate deduplication
        const eventsFiles = jobPlan.targets.events || 0;
        
        if (eventsFiles === 0) {
            return { bytesFreed: 0, duplicatesRemoved: 0 };
        }
        
        // Simulate duplicate removal
        const duplicatesRemoved = Math.floor(eventsFiles * 0.1); // 10% duplicates
        const bytesFreed = duplicatesRemoved * 1024 * 512; // 512KB per duplicate
        
        this.state.metrics.bytesFreed += bytesFreed;
        
        return { bytesFreed, duplicatesRemoved };
    }

    async executeTtlEnforce(jobPlan) {
        this.logger.info('Executing TTL enforce task');
        
        const retention = this.config.retention;
        const now = new Date();
        let totalBytesFreed = 0;
        let totalFilesRemoved = 0;
        
        // Process each data type according to retention policy
        for (const [dataType, policy] of Object.entries(retention)) {
            if (policy.keepForever) {
                this.logger.debug(`Skipping ${dataType} - keepForever enabled`);
                continue;
            }
            
            // Simulate TTL enforcement
            const filesCount = jobPlan.targets[dataType.split('.')[0]] || 0;
            const expiredFiles = Math.floor(filesCount * 0.2); // 20% expired
            
            if (expiredFiles > 0) {
                const bytesFreed = expiredFiles * 1024 * 1024 * 3; // 3MB per file
                totalBytesFreed += bytesFreed;
                totalFilesRemoved += expiredFiles;
                
                this.logger.debug(`TTL enforced for ${dataType}: ${expiredFiles} files, ${bytesFreed} bytes`);
            }
        }
        
        this.state.metrics.bytesFreed += totalBytesFreed;
        
        return { bytesFreed: totalBytesFreed, filesRemoved: totalFilesRemoved };
    }

    async executeColdstore(jobPlan) {
        this.logger.info('Executing coldstore task');
        
        if (!this.config.coldstore.enabled) {
            this.logger.info('Coldstore disabled, skipping');
            return { bytesFreed: 0, filesMoved: 0 };
        }
        
        // Simulate cold storage upload
        const artifactFiles = (jobPlan.targets.digest || 0) + (jobPlan.targets.postmortem || 0) + (jobPlan.targets.policy || 0);
        
        if (artifactFiles === 0) {
            return { bytesFreed: 0, filesMoved: 0 };
        }
        
        // Check for secrets before archiving
        if (this.config.scanSecretsBeforeArchive) {
            const secretsFound = await this.scanForSecrets(artifactFiles);
            if (secretsFound > 0) {
                this.emitAlert('warn', 'secrets_found_before_archive');
                return { bytesFreed: 0, filesMoved: 0, secretsBlocked: secretsFound };
            }
        }
        
        // Simulate upload to cold storage
        const bytesFreed = artifactFiles * 1024 * 1024 * 8; // 8MB per file
        const filesMoved = artifactFiles;
        
        // Update global metrics
        this.state.metrics.filesArchived += filesMoved;
        this.state.metrics.bytesFreed += bytesFreed;
        
        // Estimate cost
        const costUSD = (bytesFreed / (1024 * 1024 * 1024)) * 0.01; // $0.01 per GB
        this.state.metrics.costEstimateUSD += costUSD;
        
        return { bytesFreed, filesMoved, costUSD };
    }

    async scanForSecrets(fileCount) {
        // Simulate secrets scanning
        const secretsEvent = {
            event: 'secret.scan.request',
            timestamp: new Date().toISOString(),
            profileId: 'generic',
            mode: 'text',
            content: null,
            path: 'housekeeping/archive-candidates',
            source: {
                event: 'housekeeping.coldstore',
                hash: 'hk-scan'
            },
            options: {
                severity: 'high',
                blockOnHigh: true,
                classify: true
            }
        };
        
        this.eventBus.emit('secret.scan.request', secretsEvent);
        
        // Simulate scan result
        return Math.floor(Math.random() * fileCount * 0.05); // 5% chance of secrets
    }

    async executeIndexOptimize(jobPlan) {
        this.logger.info('Executing index optimize task');
        
        const kbFiles = jobPlan.targets.kbIndex || 0;
        
        if (kbFiles === 0) {
            return { optimized: 0 };
        }
        
        // Send optimization request to knowledge base
        const optimizeEvent = {
            event: 'knowledge.optimize.request',
            timestamp: new Date().toISOString(),
            tasks: ['vector', 'bm25', 'vacuum'],
            fragThreshold: this.config.indexOptimize.knowledge.reindexIfFragPct
        };
        
        this.eventBus.emit('knowledge.optimize.request', optimizeEvent);
        
        // Update metrics
        this.state.metrics.indexOptimized.vector += 1;
        this.state.metrics.indexOptimized.bm25 += 1;
        
        return { optimized: 1, tasks: ['vector', 'bm25', 'vacuum'] };
    }

    async executeDlqCleanup(jobPlan) {
        this.logger.info('Executing DLQ cleanup task');
        
        const dlqConfig = this.config.dlq;
        const now = new Date();
        let replayed = 0;
        let removed = 0;
        
        // Process DLQ items
        for (const [deliveryKey, dlqItem] of this.state.dlqItems.entries()) {
            const itemAge = now.getTime() - new Date(dlqItem.timestamp).getTime();
            const itemAgeDays = itemAge / (1000 * 60 * 60 * 24);
            
            if (itemAgeDays > dlqConfig.ttlDays) {
                // Remove old items
                this.state.dlqItems.delete(deliveryKey);
                removed++;
            } else if (dlqConfig.replay.enabled && replayed < dlqConfig.replay.maxPerRun) {
                // Try to replay
                const replaySuccess = await this.replayDlqItem(deliveryKey, dlqItem);
                if (replaySuccess) {
                    this.state.dlqItems.delete(deliveryKey);
                    replayed++;
                }
            }
        }
        
        this.logger.info(`DLQ cleanup: ${replayed} replayed, ${removed} removed`);
        
        return { dlqReplayed: replayed, dlqRemoved: removed };
    }

    async replayDlqItem(deliveryKey, dlqItem) {
        // Simulate DLQ replay
        const replayEvent = {
            event: 'dist.dlq.replay',
            timestamp: new Date().toISOString(),
            deliveryKey,
            originalReason: dlqItem.reason,
            deadLetterPath: dlqItem.deadLetterPath
        };
        
        this.eventBus.emit('dist.dlq.replay', replayEvent);
        
        // Simulate success rate
        return Math.random() > 0.3; // 70% success rate
    }

    async executeVerify(jobPlan) {
        this.logger.info('Executing verify task');
        
        // Simulate verification of processed files
        let verified = 0;
        let checksumErrors = 0;
        
        // Verify a sample of files
        const totalFiles = Object.values(jobPlan.targets).reduce((sum, count) => sum + count, 0);
        const sampleSize = Math.min(totalFiles, 20); // Verify up to 20 files
        
        for (let i = 0; i < sampleSize; i++) {
            const isValid = await this.verifyFile(`sample-file-${i}`);
            if (isValid) {
                verified++;
            } else {
                checksumErrors++;
            }
        }
        
        if (checksumErrors > 0) {
            this.emitAlert('warn', `checksum_mismatch: ${checksumErrors} files`);
        }
        
        return { verified, checksumErrors };
    }

    async verifyFile(filePath) {
        // Simulate file verification
        // In real implementation, this would check checksums, read samples, etc.
        return Math.random() > 0.01; // 99% success rate
    }

    async generateJobReport(jobPlan) {
        const report = {
            hkKey: jobPlan.hkKey,
            summary: this.generateJobSummary(jobPlan),
            execution: {
                totalTasks: jobPlan.tasks.length,
                tasksOk: jobPlan.results.tasksOk.length,
                tasksFailed: jobPlan.results.tasksFailed.length,
                duration: jobPlan.completedAt ? 
                    new Date(jobPlan.completedAt).getTime() - new Date(jobPlan.startedAt).getTime() : 0
            },
            results: jobPlan.results,
            metrics: {
                bytesFreed: jobPlan.results.bytesFreed,
                filesMoved: jobPlan.results.filesMoved,
                dlqReplayed: jobPlan.results.dlqReplayed
            },
            recommendations: this.generateRecommendations(jobPlan),
            timestamp: new Date().toISOString()
        };
        
        // Format as markdown
        const reportContent = this.formatReportAsMarkdown(report);
        const reportPath = this.getReportPath(jobPlan);
        
        // In real implementation, write to file
        this.logger.info(`Report generated for job ${jobPlan.hkKey}: ${reportPath}`);
        
        return {
            path: reportPath,
            content: reportContent,
            hash: this.generateHash(reportContent),
            summary: report.summary
        };
    }

    generateJobSummary(jobPlan) {
        const results = jobPlan.results;
        const bytesFreedMB = Math.round(results.bytesFreed / (1024 * 1024));
        
        let summary = `${results.tasksOk.length}/${jobPlan.tasks.length} görev tamamlandı`;
        
        if (results.bytesFreed > 0) {
            summary += ` • ${bytesFreedMB}MB alan açıldı`;
        }
        
        if (results.filesMoved > 0) {
            summary += ` • ${results.filesMoved} dosya arşivlendi`;
        }
        
        if (results.dlqReplayed > 0) {
            summary += ` • ${results.dlqReplayed} DLQ yeniden denendi`;
        }
        
        if (results.tasksFailed.length > 0) {
            summary += ` • ${results.tasksFailed.length} görev başarısız`;
        }
        
        return summary;
    }

    generateRecommendations(jobPlan) {
        const recommendations = [];
        const results = jobPlan.results;
        
        if (results.tasksFailed.length > 0) {
            recommendations.push('Başarısız görevleri manuel olarak gözden geçirin ve tekrar deneyin');
        }
        
        if (results.bytesFreed < 1024 * 1024 * 100) { // Less than 100MB
            recommendations.push('Az alan açıldı - retention politikalarını gözden geçirmeyi düşünün');
        }
        
        if (this.state.dlqItems.size > 100) {
            recommendations.push('DLQ birikimi yüksek - dağıtım sistemini kontrol edin');
        }
        
        const storageHealth = this.getStorageHealth();
        if (storageHealth.minFreePct < 20) {
            recommendations.push('Disk alanı hala düşük - ek temizlik veya kapasity artırımı gerekli');
        }
        
        return recommendations;
    }

    getStorageHealth() {
        let minFreePct = 100;
        
        for (const storage of this.state.storageStatus.values()) {
            minFreePct = Math.min(minFreePct, storage.freePct);
        }
        
        return { minFreePct };
    }

    getReportPath(jobPlan) {
        const date = new Date().toISOString().split('T')[0];
        return `data/reports/housekeeping/${date}/${jobPlan.hkKey}-report.md`;
    }

    formatReportAsMarkdown(report) {
        return `# Housekeeping Report: ${report.hkKey}

## Summary
${report.summary}

## Execution Details
- Total Tasks: ${report.execution.totalTasks}
- Successful: ${report.execution.tasksOk}
- Failed: ${report.execution.tasksFailed}
- Duration: ${Math.round(report.execution.duration / 1000)}s

## Results
- Bytes Freed: ${Math.round(report.results.bytesFreed / (1024 * 1024))}MB
- Files Moved: ${report.results.filesMoved}
- DLQ Replayed: ${report.results.dlqReplayed}

## Recommendations
${report.recommendations.map(rec => `- ${rec}`).join('\n')}

---
Generated on ${report.timestamp}
`;
    }

    async completeJob(jobPlan, report) {
        jobPlan.status = 'COMPLETED';
        jobPlan.completedAt = new Date().toISOString();
        
        // Move to completed jobs
        this.state.completedJobs.set(jobPlan.hkKey, jobPlan);
        this.state.activeJobs.delete(jobPlan.hkKey);
        
        // Emit completion event
        this.emitHousekeepingCompleted(jobPlan, report);
        
        // Update metrics
        this.state.metrics.completed++;
        
        this.logger.info(`Housekeeping job completed: ${jobPlan.hkKey}`);
    }

    async failJob(jobPlan, error) {
        jobPlan.status = 'FAILED';
        jobPlan.completedAt = new Date().toISOString();
        jobPlan.results.errors.push({
            task: 'job',
            error: error.message,
            timestamp: new Date().toISOString()
        });
        
        // Move to completed jobs
        this.state.completedJobs.set(jobPlan.hkKey, jobPlan);
        this.state.activeJobs.delete(jobPlan.hkKey);
        
        // Emit failure event
        this.emitHousekeepingFailed(jobPlan, error);
        
        // Update metrics
        this.state.metrics.failed++;
        
        this.logger.error(`Housekeeping job failed: ${jobPlan.hkKey} - ${error.message}`);
    }

    updatePlanMetrics(planTimeMs) {
        const currentP95 = this.state.metrics.p95PlanMs;
        const newP95 = currentP95 === 0 ? planTimeMs : (currentP95 * 0.95 + planTimeMs * 0.05);
        this.state.metrics.p95PlanMs = Math.round(newP95);
    }

    updateExecMetrics(execTimeMs) {
        const currentP95 = this.state.metrics.p95ExecMs;
        const newP95 = currentP95 === 0 ? execTimeMs : (currentP95 * 0.95 + execTimeMs * 0.05);
        this.state.metrics.p95ExecMs = Math.round(newP95);
    }

    generateHash(content) {
        return 'sha256:' + crypto
            .createHash('sha256')
            .update(content)
            .digest('hex')
            .substring(0, 16);
    }

    emitHousekeepingPlanned(jobPlan) {
        const event = {
            event: 'housekeeping.planned',
            timestamp: new Date().toISOString(),
            hkKey: jobPlan.hkKey,
            taskSet: jobPlan.tasks,
            window: jobPlan.request.window,
            targets: jobPlan.targets
        };
        
        this.eventBus.emit('housekeeping.planned', event);
    }

    emitHousekeepingProgress(hkKey, task, status, details) {
        const event = {
            event: 'housekeeping.progress',
            timestamp: new Date().toISOString(),
            hkKey,
            task,
            status,
            details
        };
        
        this.eventBus.emit('housekeeping.progress', event);
    }

    emitHousekeepingCompleted(jobPlan, report) {
        const event = {
            event: 'housekeeping.completed',
            timestamp: new Date().toISOString(),
            hkKey: jobPlan.hkKey,
            tasksOk: jobPlan.results.tasksOk,
            bytesFreed: jobPlan.results.bytesFreed,
            filesMoved: jobPlan.results.filesMoved,
            dlqReplayed: jobPlan.results.dlqReplayed,
            reportPath: report.path,
            hash: report.hash
        };
        
        this.eventBus.emit('housekeeping.completed', event);
    }

    emitHousekeepingFailed(jobPlan, error) {
        const event = {
            event: 'housekeeping.failed',
            timestamp: new Date().toISOString(),
            hkKey: jobPlan.hkKey,
            error: error.message,
            tasksCompleted: jobPlan.results.tasksOk.length,
            tasksFailed: jobPlan.results.tasksFailed.length
        };
        
        this.eventBus.emit('housekeeping.failed', event);
    }

    emitAlert(level, message) {
        const event = {
            event: 'housekeeping.alert',
            timestamp: new Date().toISOString(),
            level,
            message,
            context: {
                status: this.state.status,
                activeJobs: this.state.activeJobs.size,
                dlqItems: this.state.dlqItems.size,
                storageVolumes: this.state.storageStatus.size
            }
        };

        this.eventBus.emit('housekeeping.alert', event);
        this.logger.warn(`Housekeeping alert: ${level} - ${message}`);
    }

    emitMetrics() {
        const event = {
            event: 'housekeeping.metrics',
            timestamp: new Date().toISOString(),
            ...this.state.metrics,
            activeJobs: this.state.activeJobs.size,
            completedJobs: this.state.completedJobs.size,
            dlqItems: this.state.dlqItems.size,
            storageHealth: this.getStorageHealth()
        };

        this.eventBus.emit('housekeeping.metrics', event);
    }

    getStatus() {
        return {
            name: this.name,
            initialized: this.isInitialized,
            status: this.state.status,
            activeJobs: this.state.activeJobs.size,
            completedJobs: this.state.completedJobs.size,
            taskExecutors: this.taskExecutors.size,
            dataTargets: this.dataTargets.size,
            storageStatus: Object.fromEntries(this.state.storageStatus),
            dlqItems: this.state.dlqItems.size,
            metrics: this.state.metrics
        };
    }

    async shutdown() {
        try {
            this.logger.info(`${this.name} durduruluyor...`);
            
            // Cancel any active jobs
            const activeJobs = Array.from(this.state.activeJobs.values());
            for (const job of activeJobs) {
                job.status = 'CANCELLED';
                job.completedAt = new Date().toISOString();
                this.logger.info(`Cancelled job: ${job.hkKey}`);
            }
            
            // Emit final metrics
            this.emitMetrics();
            
            // Log summary
            this.logger.info(`Housekeeping summary: ${this.state.metrics.completed} completed, ${this.state.metrics.failed} failed`);
            this.logger.info(`Storage freed: ${Math.round(this.state.metrics.bytesFreed / (1024 * 1024))}MB`);
            
            this.isInitialized = false;
            this.logger.info(`${this.name} başarıyla durduruldu`);
        } catch (error) {
            this.logger.error(`${this.name} durdurma hatası:`, error);
        }
    }
}

module.exports = RunMetricsHousekeeper;