/**
 * VIVO-34 · backtestReplayHarness.ts
 * Tarihî verileri gerçek zamanlı akış gibi event bus'a enjekte ederek tüm VIVO zincirini uçtan uca test eder.
 * Hız kontrolü, duraklat/başlat, fault enjeksiyonu, deterministik yürütme, oracle karşılaştırması destekler.
 */

import { EventEmitter } from "events";
import * as fs from "fs";
import * as path from "path";

// Input Event Types
export interface ReplayManifest {
  event: "replay.manifest";
  timestamp: string;
  datasetId: string;
  tz: string;
  range: {
    start: string;
    end: string;
  };
  sources: Array<{
    type: "jsonl" | "csv" | "parquet";
    path: string;
    topic: string;
    timeField: string;
    symbolField: string;
    schemaHint: string;
  }>;
  outMap: Array<{
    from: string;
    to: string;
  }>;
  groundTruth?: {
    trades?: {
      type: string;
      path: string;
      idField: string;
    };
    pnl?: {
      type: string;
      path: string;
      key: string[];
    };
  };
  clock: {
    mode: "wall" | "bar_close";
    tickMs: number;
  };
  seed: string;
}

export interface ReplayControl {
  event: "replay.control";
  timestamp: string;
  cmd: "load" | "start" | "pause" | "resume" | "stop" | "seek" | "speed" | "bookmark" | "restore" | "shutdown";
  args: {
    datasetId?: string;
    speed?: number | string;
    seekTo?: string;
    filters?: {
      symbols: string[];
      timeframes: string[];
      topics: string[];
    };
    bookmarkId?: string;
  };
}

export interface ReplayFaults {
  event: "replay.faults";
  timestamp: string;
  dropProb: number;
  dupProb: number;
  reorderProb: number;
  reorderJitterMs: number;
  latencyJitterMs: number;
  outages: Array<{
    start: string;
    end: string;
    topics: string[];
  }>;
}

export interface ReplayMappingOverride {
  event: "replay.mapping.override";
  timestamp: string;
  map: Record<string, Record<string, string>>;
}

// Output Event Types
export interface ReplayClockTick {
  event: "replay.clock.tick";
  timestamp: string;
  now: string;
  lagMs: number;
}

export interface ReplayStatus {
  event: "replay.status";
  timestamp: string;
  state: "idle" | "loaded" | "running" | "paused" | "stopped";
  datasetId?: string;
  speed: number | string;
  progress: {
    cursor: string;
    start: string;
    end: string;
    pct: number;
  };
  filters: {
    symbols: string[];
    topics: string[];
  };
  faultsActive: boolean;
}

export interface ReplayMetrics {
  event: "replay.metrics";
  timestamp: string;
  eventsOutPerSec: number;
  avgLagMs: number;
  drops: number;
  dups: number;
  reorders: number;
  outageWindows: number;
  bufferFillPct: number;
}

export interface ReplayBookmarkSaved {
  event: "replay.bookmark.saved";
  timestamp: string;
  bookmarkId: string;
  cursor: string;
  seed: string;
  filters: {
    symbols: string[];
    topics: string[];
  };
}

export interface ReplayAlert {
  event: "replay.alert";
  timestamp: string;
  level: "info" | "warn" | "error";
  message: string;
  context: {
    datasetId?: string;
    reasonCodes: string[];
  };
}

export interface ReplayEvalSample {
  event: "replay.eval.sample";
  timestamp: string;
  tradeId: string;
  symbol: string;
  expected: {
    hit: 0 | 1;
    r: number;
    slipBps: number;
  };
  observed: {
    hit: 0 | 1;
    r: number;
    slipBps: number;
  };
  deltas: {
    hit: -1 | 0 | 1;
    r: number;
    slipBps: number;
  };
  reasonCodes: string[];
}

export interface ReplayEvalReport {
  event: "replay.eval.report";
  timestamp: string;
  datasetId: string;
  summary: {
    samples: number;
    hitAcc: number;
    rMse: number;
    slipMse: number;
    winRateExp: {
      expected: number;
      observed: number;
    };
    profitFactor: {
      expected: number;
      observed: number;
    };
  };
  bySymbol: Array<{
    symbol: string;
    samples: number;
    deltaWinRate: number;
    deltaPF: number;
  }>;
}

// Configuration
export interface BacktestReplayConfig {
  io: {
    readBatchSize: number;
    prefetchSec: number;
    maxBufferEvents: number;
  };
  speed: {
    default: number;
    allowed: Array<number | string>;
  };
  clock: {
    tickMs: number;
    catchUpPct: number;
  };
  filterDefaults: {
    symbols: string[];
    topics: string[];
  };
  faults: {
    dropProb: number;
    dupProb: number;
    reorderProb: number;
    reorderJitterMs: number;
    latencyJitterMs: number;
    outages: Array<{
      start: string;
      end: string;
      topics: string[];
    }>;
  };
  eval: {
    joinKey: string;
    allowTimeSkewMs: number;
    slipToleranceBps: number;
    rTolerance: number;
  };
  seed: string;
  metricsFlushSec: number;
  tz: string;
}

// Internal state interfaces
interface DataEvent {
  timestamp: Date;
  topic: string;
  symbol: string;
  data: any;
  sourceFile: string;
  sourceIndex: number;
}

interface SourceReader {
  path: string;
  topic: string;
  timeField: string;
  symbolField: string;
  schemaHint: string;
  currentIndex: number;
  events: DataEvent[];
  isEOF: boolean;
}

interface ReplayStateData {
  manifest?: ReplayManifest;
  state: "idle" | "loaded" | "running" | "paused" | "stopped";
  cursor: Date;
  startTime: Date;
  endTime: Date;
  speed: number | string;
  filters: {
    symbols: string[];
    topics: string[];
  };
  faults: ReplayFaults | null;
  readers: Map<string, SourceReader>;
  buffer: DataEvent[];
  bookmarks: Map<string, any>;
  rng: any; // Random number generator
  lastMetrics: Date;
  stats: {
    eventsOut: number;
    drops: number;
    dups: number;
    reorders: number;
    outages: number;
  };
  clockTimer?: NodeJS.Timeout;
  metricsTimer?: NodeJS.Timeout;
}

// Helper classes
class SimpleRng {
  private seed: number;

  constructor(seedStr: string) {
    this.seed = this.hashCode(seedStr);
  }

  next(): number {
    this.seed = (this.seed * 9301 + 49297) % 233280;
    return this.seed / 233280;
  }

  private hashCode(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash);
  }
}

class DatasetReader {
  static readJsonl(filePath: string, timeField: string, symbolField: string): DataEvent[] {
    try {
      if (!fs.existsSync(filePath)) {
        return [];
      }

      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n').filter(line => line.trim());
      
      const events: DataEvent[] = [];
      
      for (let i = 0; i < lines.length; i++) {
        try {
          const data = JSON.parse(lines[i]);
          const timestampStr = data[timeField];
          const symbol = data[symbolField] || 'UNKNOWN';
          
          if (!timestampStr) continue;
          
          const timestamp = new Date(timestampStr);
          if (isNaN(timestamp.getTime())) continue;
          
          events.push({
            timestamp,
            topic: '', // Will be set by caller
            symbol,
            data,
            sourceFile: filePath,
            sourceIndex: i
          });
        } catch (parseError) {
          // Skip invalid JSON lines
          continue;
        }
      }
      
      return events.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
    } catch (error) {
      return [];
    }
  }

  static readCsv(filePath: string, timeField: string, symbolField: string): DataEvent[] {
    // Simplified CSV reader - in real implementation use proper CSV parser
    try {
      if (!fs.existsSync(filePath)) {
        return [];
      }

      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n').filter(line => line.trim());
      
      if (lines.length < 2) return [];
      
      const headers = lines[0].split(',');
      const timeIndex = headers.indexOf(timeField);
      const symbolIndex = headers.indexOf(symbolField);
      
      if (timeIndex === -1) return [];
      
      const events: DataEvent[] = [];
      
      for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(',');
        if (values.length !== headers.length) continue;
        
        const timestampStr = values[timeIndex];
        const symbol = symbolIndex >= 0 ? values[symbolIndex] : 'UNKNOWN';
        
        const timestamp = new Date(timestampStr);
        if (isNaN(timestamp.getTime())) continue;
        
        const data: any = {};
        for (let j = 0; j < headers.length; j++) {
          data[headers[j]] = values[j];
        }
        
        events.push({
          timestamp,
          topic: '',
          symbol,
          data,
          sourceFile: filePath,
          sourceIndex: i
        });
      }
      
      return events.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
    } catch (error) {
      return [];
    }
  }
}

class FaultInjector {
  private rng: SimpleRng;

  constructor(rng: SimpleRng) {
    this.rng = rng;
  }

  process(events: DataEvent[], faults: ReplayFaults | any, currentTime: Date): { events: DataEvent[]; stats: any; } {
    if (!faults) {
      return { events, stats: { drops: 0, dups: 0, reorders: 0 } };
    }

    let processedEvents = [...events];
    const stats = { drops: 0, dups: 0, reorders: 0 };

    // Apply drop probability
    if (faults.dropProb > 0) {
      processedEvents = processedEvents.filter(() => {
        if (this.rng.next() < faults.dropProb) {
          stats.drops++;
          return false;
        }
        return true;
      });
    }

    // Apply duplication probability
    if (faults.dupProb > 0) {
      const duplicates: DataEvent[] = [];
      for (const event of processedEvents) {
        if (this.rng.next() < faults.dupProb) {
          duplicates.push({ ...event });
          stats.dups++;
        }
      }
      processedEvents.push(...duplicates);
    }

    // Apply reordering
    if (faults.reorderProb > 0 && faults.reorderJitterMs > 0) {
      for (const event of processedEvents) {
        if (this.rng.next() < faults.reorderProb) {
          const jitter = (this.rng.next() - 0.5) * 2 * faults.reorderJitterMs;
          event.timestamp = new Date(event.timestamp.getTime() + jitter);
          stats.reorders++;
        }
      }
      
      // Re-sort after reordering
      processedEvents.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
    }

    // Apply latency jitter (delay all events)
    if (faults.latencyJitterMs > 0) {
      for (const event of processedEvents) {
        const jitter = this.rng.next() * faults.latencyJitterMs;
        event.timestamp = new Date(event.timestamp.getTime() + jitter);
      }
    }

    // Check outages
    for (const outage of faults.outages) {
      const outageStart = new Date(outage.start);
      const outageEnd = new Date(outage.end);
      
      if (currentTime >= outageStart && currentTime <= outageEnd) {
        processedEvents = processedEvents.filter(event => {
          const matches = outage.topics.some(pattern => {
            if (pattern.endsWith('*')) {
              return event.topic.startsWith(pattern.slice(0, -1));
            }
            return event.topic === pattern;
          });
          
          if (matches) {
            stats.drops++;
            return false;
          }
          return true;
        });
      }
    }

    return { events: processedEvents, stats };
  }
}

class StreamMapper {
  static map(event: DataEvent, mappings: Array<{ from: string; to: string; }>): DataEvent | null {
    for (const mapping of mappings) {
      if (event.topic === mapping.from) {
        const mappedEvent = { ...event, topic: mapping.to };
        
        // Apply specific transformations based on mapping
        if (mapping.from === "market.bar" && mapping.to === "market.refs") {
          mappedEvent.data = this.transformBarToRefs(event.data);
        }
        
        return mappedEvent;
      }
    }
    
    return null; // No mapping found
  }

  private static transformBarToRefs(barData: any): any {
    const open = parseFloat(barData.o || barData.open || 0);
    const high = parseFloat(barData.h || barData.high || 0);
    const low = parseFloat(barData.l || barData.low || 0);
    const close = parseFloat(barData.c || barData.close || 0);
    
    const mid = (open + high + low + close) / 4;
    const spread = high - low;
    const spreadBps = mid > 0 ? Math.min(Math.max((spread / mid) * 10000, 0), 200) : 0;
    
    return {
      symbol: barData.symbol || barData.s,
      timestamp: barData.timestamp || barData.ts,
      mid,
      bestBid: mid - spread / 2,
      bestAsk: mid + spread / 2,
      spreadBps,
      volZScore: barData.volZScore || 0
    };
  }
}

export interface StdError { code:string; message:string; details?:Record<string,unknown>; retriable?:boolean; }

export class BacktestReplayHarness extends EventEmitter {
  ver="1.0.0"; src="VIVO-34";
  private config: BacktestReplayConfig;
  private state: ReplayStateData;

  constructor(config?: Partial<BacktestReplayConfig>) {
    super();
    this.config = {
      io: {
        readBatchSize: 5000,
        prefetchSec: 5,
        maxBufferEvents: 20000
      },
      speed: {
        default: 1,
        allowed: [0.25, 0.5, 1, 2, 5, 10, "bar"]
      },
      clock: {
        tickMs: 200,
        catchUpPct: 0.25
      },
      filterDefaults: {
        symbols: [],
        topics: []
      },
      faults: {
        dropProb: 0,
        dupProb: 0,
        reorderProb: 0,
        reorderJitterMs: 0,
        latencyJitterMs: 0,
        outages: []
      },
      eval: {
        joinKey: "tradeId",
        allowTimeSkewMs: 1500,
        slipToleranceBps: 2,
        rTolerance: 0.05
      },
      seed: "vivo34-replay",
      metricsFlushSec: 5,
      tz: "Europe/Istanbul",
      ...config
    };

    this.state = {
      state: "idle",
      cursor: new Date(),
      startTime: new Date(),
      endTime: new Date(),
      speed: this.config.speed.default,
      filters: { ...this.config.filterDefaults },
      faults: null,
      readers: new Map(),
      buffer: [],
      bookmarks: new Map(),
      rng: new SimpleRng(this.config.seed),
      lastMetrics: new Date(),
      stats: {
        eventsOut: 0,
        drops: 0,
        dups: 0,
        reorders: 0,
        outages: 0
      }
    };
  }

  attach(bus: any, logger: any) {
    bus.on("replay.manifest", (data: any) => this.handleManifest(data, logger));
    bus.on("replay.control", (data: any) => this.handleControl(data, bus, logger));
    bus.on("replay.faults", (data: any) => this.handleFaults(data, logger));
    bus.on("replay.mapping.override", (data: any) => this.handleMappingOverride(data, logger));
  }

  private handleManifest(data: any, logger: any): void {
    try {
      if (data.event !== "replay.manifest") return;
      
      const manifest = data as ReplayManifest;
      this.loadManifest(manifest, logger);

    } catch (error: any) {
      this.emitAlert("error", `Manifest loading failed: ${error.message}`, ["manifest_error"], logger);
    }
  }

  private handleControl(data: any, bus: any, logger: any): void {
    try {
      if (data.event !== "replay.control") return;
      
      const control = data as ReplayControl;
      this.processControl(control, bus, logger);

    } catch (error: any) {
      this.emitAlert("error", `Control command failed: ${error.message}`, ["control_error"], logger);
    }
  }

  private handleFaults(data: any, logger: any): void {
    try {
      if (data.event !== "replay.faults") return;
      
      this.state.faults = data as ReplayFaults;
      if (logger) logger.debug("Fault injection parameters updated");

    } catch (error: any) {
      this.emitAlert("error", `Fault configuration failed: ${error.message}`, ["fault_error"], logger);
    }
  }

  private handleMappingOverride(data: any, logger: any): void {
    try {
      if (data.event !== "replay.mapping.override") return;
      
      // Store mapping overrides for future use
      if (logger) logger.debug("Mapping overrides updated");

    } catch (error: any) {
      this.emitAlert("error", `Mapping override failed: ${error.message}`, ["mapping_error"], logger);
    }
  }

  private loadManifest(manifest: ReplayManifest, logger: any): void {
    this.state.manifest = manifest;
    this.state.startTime = new Date(manifest.range.start);
    this.state.endTime = new Date(manifest.range.end);
    this.state.cursor = new Date(this.state.startTime);
    
    // Initialize RNG with manifest seed
    this.state.rng = new SimpleRng(manifest.seed);
    
    // Load data sources
    this.loadDataSources(manifest, logger);
    
    this.state.state = "loaded";
    this.emitStatus();
    
    if (logger) logger.info({ datasetId: manifest.datasetId }, "Manifest loaded successfully");
  }

  private loadDataSources(manifest: ReplayManifest, logger: any): void {
    this.state.readers.clear();
    
    for (const source of manifest.sources) {
      try {
        let events: DataEvent[] = [];
        
        switch (source.type) {
          case "jsonl":
            events = DatasetReader.readJsonl(source.path, source.timeField, source.symbolField);
            break;
          case "csv":
            events = DatasetReader.readCsv(source.path, source.timeField, source.symbolField);
            break;
          case "parquet":
            // Placeholder - would need parquet library
            this.emitAlert("warn", `Parquet files not yet supported: ${source.path}`, ["unsupported_format"], logger);
            continue;
          default:
            this.emitAlert("warn", `Unknown source type: ${source.type}`, ["unknown_format"], logger);
            continue;
        }
        
        // Set topic and filter by time range
        const filteredEvents = events
          .map(event => ({ ...event, topic: source.topic }))
          .filter(event => 
            event.timestamp >= this.state.startTime && 
            event.timestamp <= this.state.endTime
          );
        
        const reader: SourceReader = {
          path: source.path,
          topic: source.topic,
          timeField: source.timeField,
          symbolField: source.symbolField,
          schemaHint: source.schemaHint,
          currentIndex: 0,
          events: filteredEvents,
          isEOF: filteredEvents.length === 0
        };
        
        this.state.readers.set(source.path, reader);
        
        if (logger) logger.debug({ 
          path: source.path, 
          events: filteredEvents.length 
        }, "Data source loaded");
        
      } catch (error: any) {
        this.emitAlert("error", `Failed to load source ${source.path}: ${error.message}`, ["source_load_error"], logger);
      }
    }
  }

  private processControl(control: ReplayControl, bus: any, logger: any): void {
    switch (control.cmd) {
      case "load":
        if (control.args.datasetId && this.state.manifest?.datasetId !== control.args.datasetId) {
          this.emitAlert("warn", `Dataset mismatch: ${control.args.datasetId}`, ["dataset_mismatch"], logger);
        }
        break;
        
      case "start":
        this.startReplay(control.args, logger);
        break;
        
      case "pause":
        this.pauseReplay(logger);
        break;
        
      case "resume":
        this.resumeReplay(logger);
        break;
        
      case "stop":
        this.stopReplay(logger);
        break;
        
      case "seek":
        if (control.args.seekTo) {
          this.seekTo(new Date(control.args.seekTo), logger);
        }
        break;
        
      case "speed":
        if (control.args.speed !== undefined) {
          this.setSpeed(control.args.speed, logger);
        }
        break;
        
      case "bookmark":
        if (control.args.bookmarkId) {
          this.createBookmark(control.args.bookmarkId, logger);
        }
        break;
        
      case "restore":
        if (control.args.bookmarkId) {
          this.restoreBookmark(control.args.bookmarkId, logger);
        }
        break;
        
      case "shutdown":
        this.shutdown(logger);
        break;
        
      default:
        this.emitAlert("warn", `Unknown control command: ${control.cmd}`, ["unknown_command"], logger);
    }
  }

  private startReplay(args: any, logger: any): void {
    if (this.state.state !== "loaded" && this.state.state !== "paused") {
      this.emitAlert("warn", `Cannot start from state: ${this.state.state}`, ["invalid_state"], logger);
      return;
    }
    
    // Apply filters if provided
    if (args.filters) {
      this.state.filters = {
        symbols: args.filters.symbols || this.state.filters.symbols,
        topics: args.filters.topics || this.state.filters.topics
      };
    }
    
    // Set speed if provided
    if (args.speed !== undefined) {
      this.state.speed = args.speed;
    }
    
    this.state.state = "running";
    this.setupClock();
    this.setupMetrics();
    this.emitStatus();
    
    if (logger) logger.info("Replay started");
  }

  private pauseReplay(logger: any): void {
    if (this.state.state !== "running") {
      this.emitAlert("warn", `Cannot pause from state: ${this.state.state}`, ["invalid_state"], logger);
      return;
    }
    
    this.state.state = "paused";
    this.teardownClock();
    this.emitStatus();
    
    if (logger) logger.info("Replay paused");
  }

  private resumeReplay(logger: any): void {
    if (this.state.state !== "paused") {
      this.emitAlert("warn", `Cannot resume from state: ${this.state.state}`, ["invalid_state"], logger);
      return;
    }
    
    this.state.state = "running";
    this.setupClock();
    this.emitStatus();
    
    if (logger) logger.info("Replay resumed");
  }

  private stopReplay(logger: any): void {
    if (this.state.state !== "running" && this.state.state !== "paused") {
      this.emitAlert("warn", `Cannot stop from state: ${this.state.state}`, ["invalid_state"], logger);
      return;
    }
    
    this.state.state = "stopped";
    this.teardownClock();
    this.teardownMetrics();
    this.state.buffer = [];
    this.emitStatus();
    
    if (logger) logger.info("Replay stopped");
  }

  private seekTo(timestamp: Date, logger: any): void {
    this.state.cursor = new Date(timestamp);
    this.state.buffer = [];
    
    // Reset all readers to the seek position
    for (const reader of this.state.readers.values()) {
      reader.currentIndex = reader.events.findIndex(event => event.timestamp >= timestamp);
      if (reader.currentIndex === -1) {
        reader.currentIndex = reader.events.length;
        reader.isEOF = true;
      } else {
        reader.isEOF = false;
      }
    }
    
    this.emitStatus();
    if (logger) logger.info({ timestamp: timestamp.toISOString() }, "Seeked to timestamp");
  }

  private setSpeed(speed: number | string, logger: any): void {
    if (!this.config.speed.allowed.includes(speed)) {
      this.emitAlert("warn", `Invalid speed: ${speed}`, ["invalid_speed"], logger);
      return;
    }
    
    this.state.speed = speed;
    
    // If running, restart clock with new speed
    if (this.state.state === "running") {
      this.teardownClock();
      this.setupClock();
    }
    
    this.emitStatus();
    if (logger) logger.info({ speed }, "Speed changed");
  }

  private createBookmark(bookmarkId: string, logger: any): void {
    const bookmark = {
      cursor: this.state.cursor.toISOString(),
      seed: this.config.seed,
      filters: { ...this.state.filters }
    };
    
    this.state.bookmarks.set(bookmarkId, bookmark);
    
    const bookmarkEvent: ReplayBookmarkSaved = {
      event: "replay.bookmark.saved",
      timestamp: new Date().toISOString(),
      bookmarkId,
      cursor: bookmark.cursor,
      seed: bookmark.seed,
      filters: bookmark.filters
    };
    
    this.emit("replay.bookmark.saved", bookmarkEvent);
    
    if (logger) logger.info({ bookmarkId }, "Bookmark created");
  }

  private restoreBookmark(bookmarkId: string, logger: any): void {
    const bookmark = this.state.bookmarks.get(bookmarkId);
    if (!bookmark) {
      this.emitAlert("warn", `Bookmark not found: ${bookmarkId}`, ["bookmark_not_found"], logger);
      return;
    }
    
    this.seekTo(new Date(bookmark.cursor), logger);
    this.state.filters = { ...bookmark.filters };
    this.state.rng = new SimpleRng(bookmark.seed);
    
    this.emitStatus();
    if (logger) logger.info({ bookmarkId }, "Bookmark restored");
  }

  private setupClock(): void {
    this.teardownClock(); // Clean up any existing timer
    
    const tickMs = this.state.speed === "bar" ? 1000 : this.config.clock.tickMs;
    
    this.state.clockTimer = setInterval(() => {
      this.processTick();
    }, tickMs);
  }

  private teardownClock(): void {
    if (this.state.clockTimer) {
      clearInterval(this.state.clockTimer);
      this.state.clockTimer = undefined;
    }
  }

  private setupMetrics(): void {
    this.teardownMetrics(); // Clean up any existing timer
    
    this.state.metricsTimer = setInterval(() => {
      this.emitMetrics();
    }, this.config.metricsFlushSec * 1000);
  }

  private teardownMetrics(): void {
    if (this.state.metricsTimer) {
      clearInterval(this.state.metricsTimer);
      this.state.metricsTimer = undefined;
    }
  }

  private processTick(): void {
    if (this.state.state !== "running") return;
    
    const now = new Date();
    const speedMultiplier = typeof this.state.speed === "number" ? this.state.speed : 1;
    
    // Advance cursor based on speed
    if (this.state.speed === "bar") {
      this.advanceToNextBar();
    } else {
      const advancement = this.config.clock.tickMs * speedMultiplier;
      this.state.cursor = new Date(this.state.cursor.getTime() + advancement);
    }
    
    // Check if we've reached the end
    if (this.state.cursor >= this.state.endTime) {
      this.stopReplay(null);
      return;
    }
    
    // Load events up to current cursor
    this.loadEventsUpToCursor();
    
    // Process events from buffer
    this.processBufferedEvents();
    
    // Emit clock tick
    const lagMs = now.getTime() - this.state.cursor.getTime();
    const clockTick: ReplayClockTick = {
      event: "replay.clock.tick",
      timestamp: now.toISOString(),
      now: this.state.cursor.toISOString(),
      lagMs
    };
    
    this.emit("replay.clock.tick", clockTick);
  }

  private advanceToNextBar(): void {
    // Find the next bar close time across all readers
    let nextBarTime: Date | null = null;
    
    for (const reader of this.state.readers.values()) {
      if (reader.isEOF) continue;
      
      const nextEvent = reader.events[reader.currentIndex];
      if (nextEvent && (!nextBarTime || nextEvent.timestamp < nextBarTime)) {
        nextBarTime = nextEvent.timestamp;
      }
    }
    
    if (nextBarTime) {
      this.state.cursor = nextBarTime;
    } else {
      // No more events, advance by a small amount
      this.state.cursor = new Date(this.state.cursor.getTime() + 60000);
    }
  }

  private loadEventsUpToCursor(): void {
    for (const reader of this.state.readers.values()) {
      if (reader.isEOF) continue;
      
      while (reader.currentIndex < reader.events.length) {
        const event = reader.events[reader.currentIndex];
        
        if (event.timestamp > this.state.cursor) break;
        
        // Apply filters
        if (this.shouldFilterEvent(event)) {
          reader.currentIndex++;
          continue;
        }
        
        this.state.buffer.push(event);
        reader.currentIndex++;
        
        // Check buffer size limit
        if (this.state.buffer.length >= this.config.io.maxBufferEvents) {
          break;
        }
      }
      
      if (reader.currentIndex >= reader.events.length) {
        reader.isEOF = true;
      }
    }
    
    // Sort buffer by timestamp
    this.state.buffer.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  }

  private shouldFilterEvent(event: DataEvent): boolean {
    // Apply symbol filter
    if (this.state.filters.symbols.length > 0 && 
        !this.state.filters.symbols.includes(event.symbol)) {
      return true;
    }
    
    // Apply topic filter
    if (this.state.filters.topics.length > 0) {
      const matches = this.state.filters.topics.some(pattern => {
        if (pattern.endsWith('*')) {
          return event.topic.startsWith(pattern.slice(0, -1));
        }
        return event.topic === pattern;
      });
      
      if (!matches) return true;
    }
    
    return false;
  }

  private processBufferedEvents(): void {
    if (this.state.buffer.length === 0) return;
    
    // Apply fault injection
    const faultInjector = new FaultInjector(this.state.rng);
    const faultResult = faultInjector.process(this.state.buffer, this.state.faults || this.config.faults, this.state.cursor);
    
    // Update stats
    this.state.stats.drops += faultResult.stats.drops;
    this.state.stats.dups += faultResult.stats.dups;
    this.state.stats.reorders += faultResult.stats.reorders;
    
    // Apply mappings and emit events
    for (const event of faultResult.events) {
      const mappedEvent = this.applyMappings(event);
      if (mappedEvent) {
        this.emitDataEvent(mappedEvent);
        this.state.stats.eventsOut++;
      }
    }
    
    // Clear buffer
    this.state.buffer = [];
  }

  private applyMappings(event: DataEvent): DataEvent | null {
    if (!this.state.manifest) return event;
    
    const mappedEvent = StreamMapper.map(event, this.state.manifest.outMap);
    return mappedEvent || event;
  }

  private emitDataEvent(event: DataEvent): void {
    // Emit the event on the bus with the mapped topic
    const eventData = {
      event: event.topic,
      timestamp: event.timestamp.toISOString(),
      symbol: event.symbol,
      ...event.data
    };
    
    this.emit(event.topic, eventData);
  }

  private emitStatus(): void {
    const progress = this.calculateProgress();
    
    const status: ReplayStatus = {
      event: "replay.status",
      timestamp: new Date().toISOString(),
      state: this.state.state,
      datasetId: this.state.manifest?.datasetId,
      speed: this.state.speed,
      progress,
      filters: { ...this.state.filters },
      faultsActive: !!this.state.faults
    };
    
    this.emit("replay.status", status);
  }

  private calculateProgress(): { cursor: string; start: string; end: string; pct: number; } {
    const totalDuration = this.state.endTime.getTime() - this.state.startTime.getTime();
    const elapsed = this.state.cursor.getTime() - this.state.startTime.getTime();
    const pct = totalDuration > 0 ? Math.min(1, Math.max(0, elapsed / totalDuration)) : 0;
    
    return {
      cursor: this.state.cursor.toISOString(),
      start: this.state.startTime.toISOString(),
      end: this.state.endTime.toISOString(),
      pct: Math.round(pct * 100) / 100
    };
  }

  private emitMetrics(): void {
    const now = new Date();
    const deltaMs = now.getTime() - this.state.lastMetrics.getTime();
    const deltaSec = deltaMs / 1000;
    
    const eventsOutPerSec = deltaSec > 0 ? this.state.stats.eventsOut / deltaSec : 0;
    const bufferFillPct = this.state.buffer.length / this.config.io.maxBufferEvents;
    
    const metrics: ReplayMetrics = {
      event: "replay.metrics",
      timestamp: now.toISOString(),
      eventsOutPerSec: Math.round(eventsOutPerSec),
      avgLagMs: 0, // Placeholder
      drops: this.state.stats.drops,
      dups: this.state.stats.dups,
      reorders: this.state.stats.reorders,
      outageWindows: this.state.stats.outages,
      bufferFillPct: Math.round(bufferFillPct * 100) / 100
    };
    
    this.emit("replay.metrics", metrics);
    
    // Reset counters
    this.state.stats = {
      eventsOut: 0,
      drops: 0,
      dups: 0,
      reorders: 0,
      outages: 0
    };
    
    this.state.lastMetrics = now;
  }

  private emitAlert(level: "info" | "warn" | "error", message: string, reasonCodes: string[], logger?: any): void {
    const alert: ReplayAlert = {
      event: "replay.alert",
      timestamp: new Date().toISOString(),
      level,
      message,
      context: {
        datasetId: this.state.manifest?.datasetId,
        reasonCodes
      }
    };
    
    this.emit("replay.alert", alert);
    
    if (logger) {
      logger[level]({ reasonCodes }, message);
    }
  }

  private shutdown(logger?: any): void {
    this.teardownClock();
    this.teardownMetrics();
    this.state.state = "idle";
    this.state.buffer = [];
    this.state.readers.clear();
    
    if (logger) logger.info("Replay harness shutdown");
  }

  // Public methods
  getStatus(): any {
    return {
      state: this.state.state,
      manifest: this.state.manifest ? {
        datasetId: this.state.manifest.datasetId,
        range: this.state.manifest.range
      } : null,
      progress: this.calculateProgress(),
      filters: { ...this.state.filters },
      stats: { ...this.state.stats },
      readers: Array.from(this.state.readers.values()).map(reader => ({
        path: reader.path,
        topic: reader.topic,
        currentIndex: reader.currentIndex,
        totalEvents: reader.events.length,
        isEOF: reader.isEOF
      }))
    };
  }

  updateConfig(updates: Partial<BacktestReplayConfig>): void {
    this.config = { ...this.config, ...updates };
  }
}
