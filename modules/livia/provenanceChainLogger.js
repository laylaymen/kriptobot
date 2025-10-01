/**
 * LIVIA-38 · provenanceChainLogger.js
 * Kriptobot Modüler Sistem - Provenance Chain Logger
 * 
 * Amaç: Kararlar, modeller, veriler, politikalar arası iz kaydı (lineage) + time travel + immutable log
 * Event-driven, WORM append, query API, integrity checks
 */

const { z } = require('zod');
const crypto = require('crypto');
const fs = require('fs').promises;
const path = require('path');

// Zod şemaları
const ProvenanceEventSchema = z.object({
  event: z.enum([
    'decision.emitted', 'model.trained', 'dataset.registered', 
    'policy.change.applied', 'artifact.ready', 'provenance.query.request'
  ]),
  timestamp: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?([+-]\d{2}:\d{2}|Z)$/),
  id: z.string().min(1),
  source: z.object({}).passthrough().optional(),
  links: z.array(z.object({
    refType: z.enum(['decision', 'model', 'dataset', 'policy', 'artifact', 'event']),
    id: z.string(),
    relation: z.enum(['derives_from', 'depends_on', 'triggered_by', 'explains', 'governs'])
  })).optional(),
  content: z.object({}).passthrough().optional(),
  tags: z.object({}).passthrough().optional()
}).strict();

const ProvenanceQuerySchema = z.object({
  event: z.literal('provenance.query.request'),
  timestamp: z.string(),
  requestId: z.string(),
  targetId: z.string(),
  mode: z.enum(['upstream', 'downstream', 'both', 'explain_chain']),
  depthLimit: z.number().int().min(1).max(10).default(5),
  asOf: z.string().optional(), // time travel
  includeContent: z.boolean().default(false)
}).strict();

const ConfigSchema = z.object({
  storage: z.object({
    wormDir: z.string().default('state/provenance/worm'),
    chainFile: z.string().default('chain.log'),
    indexDir: z.string().default('state/provenance/index'),
    compactEvery: z.string().default('6h')
  }),
  integrity: z.object({
    hashAlgorithm: z.string().default('sha256'),
    merkleTree: z.boolean().default(true),
    signEntries: z.boolean().default(false)
  }),
  query: z.object({
    maxResults: z.number().default(1000),
    timeoutMs: z.number().default(5000),
    allowTimeTravel: z.boolean().default(true)
  }),
  retention: z.object({
    hotDays: z.number().default(30),
    warmDays: z.number().default(180),
    coldDays: z.number().default(1095) // 3 yıl
  }),
  idempotencyTtlSec: z.number().default(86400)
}).strict();

class ProvenanceChainLogger {
  constructor(config = {}) {
    this.name = 'ProvenanceChainLogger';
    this.config = ConfigSchema.parse({
      storage: {},
      integrity: {},
      query: {},
      retention: {},
      ...config
    });
    
    this.isInitialized = false;
    this.logger = null;
    this.eventBus = null;
    
    // İş durumu
    this.state = 'IDLE'; // IDLE, APPENDING, QUERYING, COMPACTING
    this.pendingEntries = new Map();
    this.queryCache = new Map();
    this.merkleRoot = null;
    this.lastSequence = 0;
    
    // İdempotency ve audit
    this.processedHashes = new Set();
    this.auditLog = [];
    this.metrics = {
      entriesAppended: 0,
      queriesProcessed: 0,
      timeravelQueries: 0,
      integrityChecks: 0,
      chainBreaks: 0
    };
  }

  async initialize(logger, eventBus) {
    try {
      this.logger = logger;
      this.eventBus = eventBus;
      this.logger.info(`${this.name} başlatılıyor...`);
      
      await this.setupStorage();
      await this.loadChainState();
      this.setupEventHandlers();
      
      this.isInitialized = true;
      this.logger.info(`${this.name} başarıyla başlatıldı - sequence: ${this.lastSequence}`);
      return true;
    } catch (error) {
      this.logger.error(`${this.name} başlatma hatası:`, error);
      return false;
    }
  }

  async setupStorage() {
    const wormPath = path.resolve(this.config.storage.wormDir);
    const indexPath = path.resolve(this.config.storage.indexDir);
    
    await fs.mkdir(wormPath, { recursive: true });
    await fs.mkdir(indexPath, { recursive: true });
    
    this.chainFilePath = path.join(wormPath, this.config.storage.chainFile);
    this.indexFilePath = path.join(indexPath, 'provenance_index.json');
  }

  async loadChainState() {
    try {
      // Chain dosyasından son sequence'i yükle
      const chainExists = await fs.access(this.chainFilePath).then(() => true).catch(() => false);
      if (chainExists) {
        const chainData = await fs.readFile(this.chainFilePath, 'utf-8');
        const lines = chainData.trim().split('\n').filter(Boolean);
        
        if (lines.length > 0) {
          const lastEntry = JSON.parse(lines[lines.length - 1]);
          this.lastSequence = lastEntry.sequence || 0;
          this.merkleRoot = lastEntry.merkleRoot;
        }
      }
      
      // Index dosyasını yükle
      const indexExists = await fs.access(this.indexFilePath).then(() => true).catch(() => false);
      if (indexExists) {
        const indexData = await fs.readFile(this.indexFilePath, 'utf-8');
        const index = JSON.parse(indexData);
        this.queryCache = new Map(Object.entries(index.cache || {}));
      }
      
      this.logger.info(`Provenance chain yüklendi - sequence: ${this.lastSequence}`);
    } catch (error) {
      this.logger.warn(`Chain state yüklenirken hata (devam ediliyor):`, error);
    }
  }

  setupEventHandlers() {
    if (!this.eventBus) return;

    // Provenance olaylarını dinle
    const provenanceEvents = [
      'decision.emitted', 'model.trained', 'dataset.registered',
      'policy.change.applied', 'artifact.ready'
    ];

    provenanceEvents.forEach(eventType => {
      this.eventBus.on(eventType, async (data) => {
        await this.handleProvenanceEvent(eventType, data);
      });
    });

    // Query isteklerini dinle
    this.eventBus.on('provenance.query.request', async (data) => {
      await this.handleQueryRequest(data);
    });
  }

  async handleProvenanceEvent(eventType, data) {
    if (!this.isInitialized) return;

    try {
      this.state = 'APPENDING';
      
      // Event'i normalize et
      const normalizedEvent = {
        event: eventType,
        timestamp: data.timestamp || new Date().toISOString(),
        id: data.id || this.generateId(),
        source: data.source || {},
        links: data.links || [],
        content: data.content || {},
        tags: data.tags || {}
      };

      // Validate
      const validatedEvent = ProvenanceEventSchema.parse(normalizedEvent);
      
      // İdempotency check
      const eventHash = this.hashEvent(validatedEvent);
      if (this.processedHashes.has(eventHash)) {
        this.logger.debug(`Provenance event zaten işlenmiş: ${eventHash.substring(0, 8)}`);
        return;
      }

      // Chain entry oluştur
      await this.appendToChain(validatedEvent, eventHash);
      
      this.processedHashes.add(eventHash);
      this.metrics.entriesAppended++;
      
      // Emit confirmation
      this.eventBus?.emit('provenance.appended', {
        event: 'provenance.appended',
        timestamp: new Date().toISOString(),
        chainId: 'main',
        sequenceNo: this.lastSequence,
        entryHash: eventHash,
        eventRef: { type: eventType, id: validatedEvent.id }
      });

    } catch (error) {
      this.logger.error(`Provenance event işleme hatası:`, error);
      this.auditLog.push({
        timestamp: new Date().toISOString(),
        level: 'error',
        event: 'append_failed',
        error: error.message,
        data: { eventType, id: data.id }
      });
    } finally {
      this.state = 'IDLE';
    }
  }

  async appendToChain(event, eventHash) {
    const sequence = ++this.lastSequence;
    const timestamp = new Date().toISOString();
    
    // Merkle tree için previous hash
    const prevHash = this.merkleRoot || 'genesis';
    
    const chainEntry = {
      sequence,
      timestamp,
      eventHash,
      prevHash,
      event,
      merkleRoot: this.config.integrity.merkleTree ? 
        this.calculateMerkleRoot(eventHash, prevHash) : null
    };

    // WORM append
    const logLine = JSON.stringify(chainEntry) + '\n';
    await fs.appendFile(this.chainFilePath, logLine, 'utf-8');
    
    this.merkleRoot = chainEntry.merkleRoot;
    
    this.logger.debug(`Provenance entry appended: seq=${sequence}, hash=${eventHash.substring(0, 8)}`);
  }

  async handleQueryRequest(data) {
    if (!this.isInitialized) return;

    try {
      this.state = 'QUERYING';
      
      const query = ProvenanceQuerySchema.parse(data);
      
      // Cache check
      const cacheKey = this.generateCacheKey(query);
      if (this.queryCache.has(cacheKey)) {
        const cached = this.queryCache.get(cacheKey);
        this.emitQueryResult(query, cached, true);
        return;
      }

      // Execute query
      const result = await this.executeQuery(query);
      
      // Cache result
      this.queryCache.set(cacheKey, result);
      this.metrics.queriesProcessed++;
      
      if (query.asOf) {
        this.metrics.timeravelQueries++;
      }

      this.emitQueryResult(query, result, false);

    } catch (error) {
      this.logger.error(`Provenance query hatası:`, error);
      this.emitQueryError(data.requestId, error.message);
    } finally {
      this.state = 'IDLE';
    }
  }

  async executeQuery(query) {
    // Chain dosyasını oku
    const chainData = await fs.readFile(this.chainFilePath, 'utf-8');
    const entries = chainData.trim().split('\n')
      .filter(Boolean)
      .map(line => JSON.parse(line));

    // Time travel filter
    let filteredEntries = entries;
    if (query.asOf) {
      const asOfTime = new Date(query.asOf);
      filteredEntries = entries.filter(entry => 
        new Date(entry.timestamp) <= asOfTime
      );
    }

    // Target'ı bul
    const targetEntries = filteredEntries.filter(entry => 
      entry.event.id === query.targetId
    );

    if (targetEntries.length === 0) {
      return { nodes: [], edges: [], error: 'Target not found' };
    }

    // Graph traversal
    const result = await this.traverseProvenance(
      targetEntries[0], 
      filteredEntries, 
      query.mode, 
      query.depthLimit
    );

    return {
      nodes: result.nodes.slice(0, this.config.query.maxResults),
      edges: result.edges,
      traversalMode: query.mode,
      asOf: query.asOf,
      generatedAt: new Date().toISOString()
    };
  }

  async traverseProvenance(startEntry, allEntries, mode, maxDepth) {
    const nodes = new Map();
    const edges = [];
    const visited = new Set();
    
    const queue = [{ entry: startEntry, depth: 0 }];
    
    while (queue.length > 0) {
      const { entry, depth } = queue.shift();
      
      if (depth >= maxDepth || visited.has(entry.eventHash)) {
        continue;
      }
      
      visited.add(entry.eventHash);
      
      // Add node
      nodes.set(entry.event.id, {
        id: entry.event.id,
        type: entry.event.event,
        timestamp: entry.event.timestamp,
        sequence: entry.sequence,
        content: entry.event.content || {}
      });

      // Traverse links
      if (entry.event.links) {
        for (const link of entry.event.links) {
          if (this.shouldTraverseLink(link.relation, mode)) {
            // Find linked entries
            const linkedEntries = allEntries.filter(e => 
              e.event.id === link.id
            );
            
            for (const linkedEntry of linkedEntries) {
              edges.push({
                from: entry.event.id,
                to: linkedEntry.event.id,
                relation: link.relation,
                timestamp: entry.timestamp
              });
              
              queue.push({ entry: linkedEntry, depth: depth + 1 });
            }
          }
        }
      }
    }

    return {
      nodes: Array.from(nodes.values()),
      edges
    };
  }

  shouldTraverseLink(relation, mode) {
    const upstreamRelations = ['derives_from', 'depends_on', 'triggered_by'];
    const downstreamRelations = ['explains', 'governs'];
    
    switch (mode) {
      case 'upstream':
        return upstreamRelations.includes(relation);
      case 'downstream':
        return downstreamRelations.includes(relation);
      case 'both':
        return true;
      case 'explain_chain':
        return relation === 'explains';
      default:
        return false;
    }
  }

  emitQueryResult(query, result, fromCache) {
    this.eventBus?.emit('provenance.query.result', {
      event: 'provenance.query.result',
      timestamp: new Date().toISOString(),
      requestId: query.requestId,
      targetId: query.targetId,
      mode: query.mode,
      result,
      cached: fromCache,
      asOf: query.asOf
    });
  }

  emitQueryError(requestId, errorMessage) {
    this.eventBus?.emit('provenance.query.error', {
      event: 'provenance.query.error',
      timestamp: new Date().toISOString(),
      requestId,
      error: errorMessage
    });
  }

  hashEvent(event) {
    const content = JSON.stringify(event, Object.keys(event).sort());
    return crypto.createHash(this.config.integrity.hashAlgorithm)
      .update(content)
      .digest('hex');
  }

  calculateMerkleRoot(eventHash, prevHash) {
    return crypto.createHash('sha256')
      .update(prevHash + eventHash)
      .digest('hex');
  }

  generateCacheKey(query) {
    const keyData = {
      targetId: query.targetId,
      mode: query.mode,
      depth: query.depthLimit,
      asOf: query.asOf || 'now'
    };
    return crypto.createHash('md5')
      .update(JSON.stringify(keyData))
      .digest('hex');
  }

  generateId() {
    return `prov:${Date.now()}:${Math.random().toString(36).substr(2, 9)}`;
  }

  // Integrity check
  async verifyChainIntegrity() {
    try {
      this.state = 'COMPACTING';
      
      const chainData = await fs.readFile(this.chainFilePath, 'utf-8');
      const entries = chainData.trim().split('\n')
        .filter(Boolean)
        .map(line => JSON.parse(line));

      let prevHash = 'genesis';
      let breaks = 0;

      for (const entry of entries) {
        if (entry.prevHash !== prevHash) {
          breaks++;
          this.logger.warn(`Chain break detected at sequence ${entry.sequence}`);
        }
        prevHash = entry.merkleRoot || entry.eventHash;
      }

      this.metrics.integrityChecks++;
      this.metrics.chainBreaks = breaks;

      this.logger.info(`Chain integrity check: ${breaks} breaks in ${entries.length} entries`);
      return breaks === 0;

    } catch (error) {
      this.logger.error(`Chain integrity check failed:`, error);
      return false;
    } finally {
      this.state = 'IDLE';
    }
  }

  // Public API
  async queryProvenance(targetId, mode = 'both', options = {}) {
    const requestId = `q:${Date.now()}`;
    
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Query timeout'));
      }, this.config.query.timeoutMs);

      this.eventBus?.once('provenance.query.result', (result) => {
        if (result.requestId === requestId) {
          clearTimeout(timeout);
          resolve(result);
        }
      });

      this.eventBus?.once('provenance.query.error', (error) => {
        if (error.requestId === requestId) {
          clearTimeout(timeout);
          reject(new Error(error.error));
        }
      });

      this.eventBus?.emit('provenance.query.request', {
        event: 'provenance.query.request',
        timestamp: new Date().toISOString(),
        requestId,
        targetId,
        mode,
        ...options
      });
    });
  }

  getStatus() {
    return {
      name: this.name,
      initialized: this.isInitialized,
      state: this.state,
      lastSequence: this.lastSequence,
      merkleRoot: this.merkleRoot?.substring(0, 8),
      metrics: this.metrics,
      config: this.config
    };
  }

  async getMetrics() {
    return {
      timestamp: new Date().toISOString(),
      ...this.metrics,
      state: this.state,
      cacheSize: this.queryCache.size,
      processedHashesSize: this.processedHashes.size
    };
  }

  async shutdown() {
    try {
      this.logger.info(`${this.name} durduruluyor...`);
      
      // Save index
      const indexData = {
        lastSequence: this.lastSequence,
        merkleRoot: this.merkleRoot,
        cache: Object.fromEntries(this.queryCache),
        metrics: this.metrics,
        timestamp: new Date().toISOString()
      };
      
      await fs.writeFile(this.indexFilePath, JSON.stringify(indexData, null, 2));
      
      this.isInitialized = false;
      this.logger.info(`${this.name} başarıyla durduruldu`);
    } catch (error) {
      this.logger.error(`${this.name} durdurma hatası:`, error);
    }
  }
}

module.exports = ProvenanceChainLogger;