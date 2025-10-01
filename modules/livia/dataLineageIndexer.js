/**
 * LIVIA-39 · dataLineageIndexer.js
 * Kriptobot Modüler Sistem - Data Lineage Indexer
 * 
 * Amaç: Veri soy kütüğünü (data lineage) kur ve güncel tut, blast radius/impact analizi
 * Event-driven, WORM benzeri append log, time travel, OpenTelemetry
 */

const { z } = require('zod');
const crypto = require('crypto');
const fs = require('fs').promises;
const path = require('path');

// Zod şemaları
const DatasetEventSchema = z.object({
  event: z.enum([
    'dataset.registered', 'dataset.schema.updated', 'feature.registered',
    'model.trained', 'job.run', 'policy.change.applied', 'decision.emitted',
    'artifact.ready', 'provenance.appended'
  ]),
  timestamp: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?([+-]\d{2}:\d{2}|Z)$/),
  id: z.string().min(1),
  source: z.object({}).passthrough().optional(),
  inputs: z.array(z.object({
    refType: z.enum(['feature', 'dataset', 'model', 'policy', 'decision', 'artifact', 'event']),
    id: z.string()
  })).optional(),
  outputs: z.array(z.object({
    refType: z.enum(['feature', 'dataset', 'model', 'policy', 'decision', 'artifact']),
    path: z.string().optional(),
    id: z.string().optional()
  })).optional(),
  tags: z.object({}).passthrough().optional()
}).strict();

const LineageQuerySchema = z.object({
  event: z.literal('lineage.query.request'),
  timestamp: z.string(),
  requestId: z.string(),
  mode: z.enum(['downstream', 'upstream', 'both', 'why']),
  from: z.object({
    refType: z.enum(['node', 'artifact', 'dataset', 'feature', 'model', 'policy', 'decision']),
    idOrPath: z.string()
  }),
  asOf: z.string().optional(),
  depthMax: z.number().int().min(1).max(10).default(6),
  filters: z.object({
    nodeTypes: z.array(z.string()).optional(),
    edgeTypes: z.array(z.string()).optional()
  }).optional(),
  format: z.enum(['json', 'dot', 'md']).default('json'),
  includeAttrs: z.boolean().default(true)
}).strict();

const ConfigSchema = z.object({
  storage: z.object({
    wormDir: z.string().default('state/lineage/worm'),
    appendFile: z.string().default('graph.log'),
    snapshotDir: z.string().default('state/lineage/index'),
    compactEvery: z.string().default('1h')
  }),
  graph: z.object({
    nodeTypes: z.array(z.string()).default(['dataset', 'feature', 'model', 'job', 'policy', 'decision', 'artifact', 'event', 'flag', 'experiment', 'guard']),
    edgeTypes: z.array(z.string()).default(['derives_from', 'consumes', 'produces', 'governs', 'emits', 'links_to', 'depends_on', 'explains']),
    maxInMemNodes: z.number().default(200000)
  }),
  sdc: z.object({
    trackVersions: z.boolean().default(true),
    mode: z.literal('type2').default('type2'),
    asOfQueries: z.boolean().default(true)
  }),
  quality: z.object({
    onSchemaDrift: z.enum(['warn_and_impact', 'error', 'ignore']).default('warn_and_impact'),
    onDanglingEdge: z.enum(['repair_orphan', 'warn', 'ignore']).default('repair_orphan'),
    onCycle: z.enum(['break_with_virtual_node', 'error', 'warn']).default('break_with_virtual_node')
  }),
  indexing: z.object({
    buildReverseEdges: z.boolean().default(true),
    keepAdjacencyLists: z.boolean().default(true),
    hashGraph: z.boolean().default(true)
  }),
  query: z.object({
    defaultMode: z.enum(['upstream', 'downstream', 'both']).default('both'),
    limitNodes: z.number().default(5000),
    allowWhyAnswer: z.boolean().default(true)
  }),
  retention: z.object({
    hotDays: z.number().default(14),
    warmDays: z.number().default(90),
    coldDays: z.number().default(365),
    keepForever: z.boolean().default(false)
  }),
  idempotencyTtlSec: z.number().default(86400)
}).strict();

class DataLineageIndexer {
  constructor(config = {}) {
    this.name = 'DataLineageIndexer';
    this.config = ConfigSchema.parse({
      storage: {},
      graph: {},
      sdc: {},
      quality: {},
      indexing: {},
      query: {},
      retention: {},
      ...config
    });
    
    this.isInitialized = false;
    this.logger = null;
    this.eventBus = null;
    
    // İş durumu
    this.state = 'IDLE'; // IDLE, INGEST, INDEX, QUERY, COMPACT
    this.graph = {
      nodes: new Map(), // id -> node
      edges: new Map(), // edgeId -> edge
      reverseEdges: new Map(), // toId -> [fromIds]
      adjacencyList: new Map() // fromId -> [toIds]
    };
    
    // Metrics ve cache
    this.metrics = {
      ingested: 0,
      nodes: 0,
      edges: 0,
      p95IngestMs: 0,
      p95QueryMs: 0,
      cycles: 0,
      dangling: 0,
      schemaDrifts: 0
    };
    
    this.processedEvents = new Set();
    this.queryCache = new Map();
    this.currentGraphSig = null;
    this.lastCompact = null;
  }

  async initialize(logger, eventBus) {
    try {
      this.logger = logger;
      this.eventBus = eventBus;
      this.logger.info(`${this.name} başlatılıyor...`);
      
      await this.setupStorage();
      await this.loadGraphState();
      this.setupEventHandlers();
      
      this.isInitialized = true;
      this.logger.info(`${this.name} başarıyla başlatıldı - nodes: ${this.metrics.nodes}, edges: ${this.metrics.edges}`);
      return true;
    } catch (error) {
      this.logger.error(`${this.name} başlatma hatası:`, error);
      return false;
    }
  }

  async setupStorage() {
    const today = new Date().toISOString().split('T')[0];
    this.wormPath = path.resolve(this.config.storage.wormDir.replace('{YYYY-MM-DD}', today));
    this.snapshotPath = path.resolve(this.config.storage.snapshotDir.replace('{YYYY-MM-DD}', today));
    
    await fs.mkdir(this.wormPath, { recursive: true });
    await fs.mkdir(this.snapshotPath, { recursive: true });
    
    this.appendFilePath = path.join(this.wormPath, this.config.storage.appendFile);
    this.snapshotFilePath = path.join(this.snapshotPath, 'graph_snapshot.json');
  }

  async loadGraphState() {
    try {
      // Snapshot'tan yükle
      const snapshotExists = await fs.access(this.snapshotFilePath).then(() => true).catch(() => false);
      if (snapshotExists) {
        const snapshotData = await fs.readFile(this.snapshotFilePath, 'utf-8');
        const snapshot = JSON.parse(snapshotData);
        
        this.graph.nodes = new Map(Object.entries(snapshot.nodes || {}));
        this.graph.edges = new Map(Object.entries(snapshot.edges || {}));
        this.buildIndices();
        
        this.metrics = { ...this.metrics, ...snapshot.metrics };
        this.currentGraphSig = snapshot.graphSig;
      }
      
      // Append log'dan yeni olayları oku
      const appendExists = await fs.access(this.appendFilePath).then(() => true).catch(() => false);
      if (appendExists) {
        await this.replayAppendLog();
      }
      
      this.logger.info(`Lineage graph yüklendi - nodes: ${this.graph.nodes.size}, edges: ${this.graph.edges.size}`);
    } catch (error) {
      this.logger.warn(`Graph state yüklenirken hata (devam ediliyor):`, error);
    }
  }

  async replayAppendLog() {
    const logData = await fs.readFile(this.appendFilePath, 'utf-8');
    const lines = logData.trim().split('\n').filter(Boolean);
    
    for (const line of lines) {
      try {
        const logEntry = JSON.parse(line);
        if (!this.processedEvents.has(logEntry.eventHash)) {
          await this.processLineageEvent(logEntry.event, false); // no append during replay
          this.processedEvents.add(logEntry.eventHash);
        }
      } catch (error) {
        this.logger.warn(`Append log replay hatası:`, error);
      }
    }
  }

  buildIndices() {
    this.graph.reverseEdges.clear();
    this.graph.adjacencyList.clear();
    
    if (this.config.indexing.buildReverseEdges || this.config.indexing.keepAdjacencyLists) {
      for (const [edgeId, edge] of this.graph.edges) {
        if (this.config.indexing.buildReverseEdges) {
          if (!this.graph.reverseEdges.has(edge.toId)) {
            this.graph.reverseEdges.set(edge.toId, []);
          }
          this.graph.reverseEdges.get(edge.toId).push(edge.fromId);
        }
        
        if (this.config.indexing.keepAdjacencyLists) {
          if (!this.graph.adjacencyList.has(edge.fromId)) {
            this.graph.adjacencyList.set(edge.fromId, []);
          }
          this.graph.adjacencyList.get(edge.fromId).push(edge.toId);
        }
      }
    }
  }

  setupEventHandlers() {
    if (!this.eventBus) return;

    // Lineage olaylarını dinle
    const lineageEvents = [
      'dataset.registered', 'dataset.schema.updated', 'feature.registered',
      'model.trained', 'job.run', 'policy.change.applied', 'decision.emitted',
      'artifact.ready', 'provenance.appended'
    ];

    lineageEvents.forEach(eventType => {
      this.eventBus.on(eventType, async (data) => {
        await this.handleLineageEvent(eventType, data);
      });
    });

    // Query isteklerini dinle
    this.eventBus.on('lineage.query.request', async (data) => {
      await this.handleQueryRequest(data);
    });
  }

  async handleLineageEvent(eventType, data) {
    if (!this.isInitialized) return;

    try {
      this.state = 'INGEST';
      const startTime = Date.now();
      
      // Event'i normalize et
      const normalizedEvent = {
        event: eventType,
        timestamp: data.timestamp || new Date().toISOString(),
        id: data.id || this.generateId(),
        source: data.source || {},
        inputs: data.inputs || [],
        outputs: data.outputs || [],
        tags: data.tags || {}
      };

      // Validate
      const validatedEvent = DatasetEventSchema.parse(normalizedEvent);
      
      // İdempotency check
      const eventHash = this.hashEvent(validatedEvent);
      if (this.processedEvents.has(eventHash)) {
        this.logger.debug(`Lineage event zaten işlenmiş: ${eventHash.substring(0, 8)}`);
        return;
      }

      // Process and append
      await this.processLineageEvent(validatedEvent, true);
      this.processedEvents.add(eventHash);
      
      const duration = Date.now() - startTime;
      this.updateMetrics('ingest', duration);
      
      // Emit confirmation
      this.eventBus?.emit('lineage.index.ready', {
        event: 'lineage.index.ready',
        timestamp: new Date().toISOString(),
        asOf: new Date().toISOString(),
        nodes: this.graph.nodes.size,
        edges: this.graph.edges.size,
        graphSig: this.currentGraphSig,
        indexPath: this.snapshotFilePath
      });

    } catch (error) {
      this.logger.error(`Lineage event işleme hatası:`, error);
      this.emitAlert('error', 'ingest_failed', { event: eventType, id: data.id });
    } finally {
      this.state = 'IDLE';
    }
  }

  async processLineageEvent(event, shouldAppend = true) {
    // Node'u ekle/güncelle
    const node = {
      id: event.id,
      type: event.event.split('.')[0], // dataset, feature, model, etc.
      version: event.version || event.newVersion || 'v1',
      asOf: event.timestamp,
      attrs: {
        ...event.source,
        ...event.tags,
        originalEvent: event.event
      }
    };

    this.graph.nodes.set(event.id, node);

    // Edges oluştur
    if (event.inputs) {
      for (const input of event.inputs) {
        const edgeId = `${input.id}->${event.id}`;
        const edge = {
          fromId: input.id,
          toId: event.id,
          type: this.inferEdgeType(input.refType, node.type),
          atISO: event.timestamp,
          attrs: { inputType: input.refType }
        };
        this.graph.edges.set(edgeId, edge);
      }
    }

    if (event.outputs) {
      for (const output of event.outputs) {
        const outputId = output.id || output.path || `${event.id}_out_${Date.now()}`;
        const edgeId = `${event.id}->${outputId}`;
        const edge = {
          fromId: event.id,
          toId: outputId,
          type: 'produces',
          atISO: event.timestamp,
          attrs: { outputType: output.refType, path: output.path }
        };
        this.graph.edges.set(edgeId, edge);
      }
    }

    // Special handling for schema updates
    if (event.event === 'dataset.schema.updated') {
      this.handleSchemaDrift(event);
    }

    // Append to WORM log
    if (shouldAppend) {
      await this.appendToWormLog(event);
    }

    // Update metrics
    this.metrics.nodes = this.graph.nodes.size;
    this.metrics.edges = this.graph.edges.size;
    this.metrics.ingested++;

    // Rebuild indices
    this.buildIndices();

    // Update graph signature
    if (this.config.indexing.hashGraph) {
      this.currentGraphSig = this.calculateGraphSignature();
    }
  }

  inferEdgeType(inputType, outputType) {
    const edgeMapping = {
      'dataset-feature': 'derives_from',
      'feature-model': 'consumes',
      'model-decision': 'emits',
      'policy-guard': 'governs',
      'artifact-provenance': 'links_to',
      'default': 'depends_on'
    };

    const key = `${inputType}-${outputType}`;
    return edgeMapping[key] || edgeMapping['default'];
  }

  async appendToWormLog(event) {
    const eventHash = this.hashEvent(event);
    const logEntry = {
      timestamp: new Date().toISOString(),
      eventHash,
      event
    };

    const logLine = JSON.stringify(logEntry) + '\n';
    await fs.appendFile(this.appendFilePath, logLine, 'utf-8');
  }

  handleSchemaDrift(event) {
    this.metrics.schemaDrifts++;
    
    if (this.config.quality.onSchemaDrift === 'warn_and_impact') {
      // Impact analysis için downstream'i bul
      const downstream = this.findDownstream(event.id, 3);
      
      const blastRadius = {
        downstreamArtifacts: downstream.artifacts?.length || 0,
        affectedModels: downstream.models || [],
        guards: downstream.guards || []
      };

      this.eventBus?.emit('lineage.impact.ready', {
        event: 'lineage.impact.ready',
        timestamp: new Date().toISOString(),
        source: `${event.event}#${event.id}@${event.newVersion}`,
        blastRadius,
        recommendations: ['notify:ops', 'run:tests:compat'],
        pathSample: this.samplePaths(event.id, 2)
      });
    }
  }

  findDownstream(nodeId, maxDepth) {
    const result = { artifacts: [], models: [], guards: [] };
    const visited = new Set();
    const queue = [{ id: nodeId, depth: 0 }];

    while (queue.length > 0) {
      const { id, depth } = queue.shift();
      
      if (depth >= maxDepth || visited.has(id)) continue;
      visited.add(id);

      const adjacentNodes = this.graph.adjacencyList.get(id) || [];
      for (const nextId of adjacentNodes) {
        const node = this.graph.nodes.get(nextId);
        if (node) {
          if (node.type === 'artifact') result.artifacts.push(nextId);
          if (node.type === 'model') result.models.push(nextId);
          if (node.attrs?.guard) result.guards.push(nextId);
          
          queue.push({ id: nextId, depth: depth + 1 });
        }
      }
    }

    return result;
  }

  samplePaths(startId, maxPaths) {
    const paths = [];
    const visited = new Set();
    
    const dfs = (currentId, path) => {
      if (paths.length >= maxPaths || visited.has(currentId)) return;
      visited.add(currentId);
      
      const adjacentNodes = this.graph.adjacencyList.get(currentId) || [];
      if (adjacentNodes.length === 0) {
        paths.push([...path, currentId]);
        return;
      }
      
      for (const nextId of adjacentNodes.slice(0, 2)) { // Limit branches
        dfs(nextId, [...path, currentId]);
      }
    };
    
    dfs(startId, []);
    return paths;
  }

  async handleQueryRequest(data) {
    if (!this.isInitialized) return;

    try {
      this.state = 'QUERY';
      const startTime = Date.now();
      
      const query = LineageQuerySchema.parse(data);
      
      // Cache check
      const cacheKey = this.generateCacheKey(query);
      if (this.queryCache.has(cacheKey)) {
        const cached = this.queryCache.get(cacheKey);
        this.emitQueryResult(query, cached, true);
        return;
      }

      // Execute query
      const result = await this.executeLineageQuery(query);
      
      // Cache result
      this.queryCache.set(cacheKey, result);
      
      const duration = Date.now() - startTime;
      this.updateMetrics('query', duration);

      this.emitQueryResult(query, result, false);

    } catch (error) {
      this.logger.error(`Lineage query hatası:`, error);
      this.emitQueryError(data.requestId, error.message);
    } finally {
      this.state = 'IDLE';
    }
  }

  async executeLineageQuery(query) {
    const startNodeId = query.from.idOrPath;
    
    // Time travel filter
    let validNodes = new Map(this.graph.nodes);
    let validEdges = new Map(this.graph.edges);
    
    if (query.asOf) {
      const asOfTime = new Date(query.asOf);
      validNodes = new Map([...this.graph.nodes].filter(([_, node]) => 
        new Date(node.asOf) <= asOfTime
      ));
      validEdges = new Map([...this.graph.edges].filter(([_, edge]) => 
        new Date(edge.atISO) <= asOfTime
      ));
    }

    // Traverse graph
    const result = await this.traverseLineage(
      startNodeId,
      validNodes,
      validEdges,
      query.mode,
      query.depthMax,
      query.filters
    );

    return {
      nodes: result.nodes.slice(0, this.config.query.limitNodes),
      edges: result.edges,
      traversalMode: query.mode,
      asOf: query.asOf,
      generatedAt: new Date().toISOString()
    };
  }

  async traverseLineage(startNodeId, validNodes, validEdges, mode, maxDepth, filters = {}) {
    const resultNodes = new Map();
    const resultEdges = [];
    const visited = new Set();
    const queue = [{ nodeId: startNodeId, depth: 0 }];

    while (queue.length > 0) {
      const { nodeId, depth } = queue.shift();
      
      if (depth >= maxDepth || visited.has(nodeId)) continue;
      visited.add(nodeId);

      const node = validNodes.get(nodeId);
      if (!node) continue;

      // Apply node type filter
      if (filters.nodeTypes && !filters.nodeTypes.includes(node.type)) {
        continue;
      }

      resultNodes.set(nodeId, node);

      // Find connected edges
      const connectedEdges = [...validEdges.values()].filter(edge => {
        const isConnected = (mode === 'upstream' && edge.toId === nodeId) ||
                          (mode === 'downstream' && edge.fromId === nodeId) ||
                          (mode === 'both' && (edge.fromId === nodeId || edge.toId === nodeId)) ||
                          (mode === 'why' && edge.type === 'explains');

        // Apply edge type filter
        if (filters.edgeTypes && !filters.edgeTypes.includes(edge.type)) {
          return false;
        }

        return isConnected;
      });

      for (const edge of connectedEdges) {
        resultEdges.push(edge);
        
        const nextNodeId = edge.fromId === nodeId ? edge.toId : edge.fromId;
        if (validNodes.has(nextNodeId)) {
          queue.push({ nodeId: nextNodeId, depth: depth + 1 });
        }
      }
    }

    return {
      nodes: Array.from(resultNodes.values()),
      edges: resultEdges
    };
  }

  emitQueryResult(query, result, fromCache) {
    this.eventBus?.emit('lineage.query.result', {
      event: 'lineage.query.result',
      timestamp: new Date().toISOString(),
      requestId: query.requestId,
      mode: query.mode,
      from: query.from,
      asOf: query.asOf,
      result,
      cached: fromCache
    });
  }

  emitQueryError(requestId, errorMessage) {
    this.eventBus?.emit('lineage.query.error', {
      event: 'lineage.query.error',
      timestamp: new Date().toISOString(),
      requestId,
      error: errorMessage
    });
  }

  emitAlert(level, message, context = {}) {
    this.eventBus?.emit('lineage.alert', {
      event: 'lineage.alert',
      timestamp: new Date().toISOString(),
      level,
      message,
      context
    });
  }

  updateMetrics(operation, duration) {
    if (operation === 'ingest') {
      this.metrics.p95IngestMs = this.updateP95(this.metrics.p95IngestMs, duration);
    } else if (operation === 'query') {
      this.metrics.p95QueryMs = this.updateP95(this.metrics.p95QueryMs, duration);
    }
  }

  updateP95(currentP95, newValue) {
    // Simple exponential moving average approximation
    const alpha = 0.1;
    return currentP95 * (1 - alpha) + newValue * alpha;
  }

  hashEvent(event) {
    const content = JSON.stringify(event, Object.keys(event).sort());
    return crypto.createHash('sha256').update(content).digest('hex');
  }

  calculateGraphSignature() {
    const graphData = {
      nodeCount: this.graph.nodes.size,
      edgeCount: this.graph.edges.size,
      nodeHashes: [...this.graph.nodes.keys()].sort(),
      edgeHashes: [...this.graph.edges.keys()].sort()
    };
    
    return crypto.createHash('sha256')
      .update(JSON.stringify(graphData))
      .digest('hex');
  }

  generateCacheKey(query) {
    const keyData = {
      from: query.from,
      mode: query.mode,
      depth: query.depthMax,
      asOf: query.asOf || 'now',
      filters: query.filters || {}
    };
    return crypto.createHash('md5')
      .update(JSON.stringify(keyData))
      .digest('hex');
  }

  generateId() {
    return `lineage:${Date.now()}:${Math.random().toString(36).substr(2, 9)}`;
  }

  // Public API methods
  async queryLineage(from, mode = 'both', options = {}) {
    const requestId = `q:${Date.now()}`;
    
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Query timeout'));
      }, 10000);

      this.eventBus?.once('lineage.query.result', (result) => {
        if (result.requestId === requestId) {
          clearTimeout(timeout);
          resolve(result);
        }
      });

      this.eventBus?.once('lineage.query.error', (error) => {
        if (error.requestId === requestId) {
          clearTimeout(timeout);
          reject(new Error(error.error));
        }
      });

      this.eventBus?.emit('lineage.query.request', {
        event: 'lineage.query.request',
        timestamp: new Date().toISOString(),
        requestId,
        mode,
        from,
        ...options
      });
    });
  }

  async createSnapshot() {
    this.state = 'COMPACT';
    
    try {
      const snapshot = {
        timestamp: new Date().toISOString(),
        nodes: Object.fromEntries(this.graph.nodes),
        edges: Object.fromEntries(this.graph.edges),
        metrics: this.metrics,
        graphSig: this.currentGraphSig
      };

      await fs.writeFile(this.snapshotFilePath, JSON.stringify(snapshot, null, 2));
      this.lastCompact = new Date();
      
      this.logger.info(`Lineage snapshot oluşturuldu: ${this.snapshotFilePath}`);
    } catch (error) {
      this.logger.error(`Snapshot oluşturma hatası:`, error);
    } finally {
      this.state = 'IDLE';
    }
  }

  getStatus() {
    return {
      name: this.name,
      initialized: this.isInitialized,
      state: this.state,
      graph: {
        nodes: this.graph.nodes.size,
        edges: this.graph.edges.size,
        signature: this.currentGraphSig?.substring(0, 8)
      },
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
      processedEventsSize: this.processedEvents.size
    };
  }

  async shutdown() {
    try {
      this.logger.info(`${this.name} durduruluyor...`);
      
      // Create final snapshot
      await this.createSnapshot();
      
      this.isInitialized = false;
      this.logger.info(`${this.name} başarıyla durduruldu`);
    } catch (error) {
      this.logger.error(`${this.name} durdurma hatası:`, error);
    }
  }
}

module.exports = DataLineageIndexer;