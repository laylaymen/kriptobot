/**
 * VIVO-33 · incidentNotificationBridge.ts
 * Risk olayları ve kritik telemetri/SLO ihlallerini Telegram/Discord/Email/Webhook gibi kanallara akıllı şekilde köprüler.
 * Sessiz saat, soaking, dedupe, rate limiting, eskalasyon, ACK/Resolve geri akışı destekler.
 */

import { EventEmitter } from "events";

// Input Event Types
export interface RiskIncidentEvent {
  event: "risk.incident.open" | "risk.incident.update" | "risk.incident.closed";
  timestamp: string;
  incidentId: string;
  type: "series_loss" | "drawdown_breach" | "exposure_breach" | "execution_anomaly" | 
        "data_staleness" | "emergency_halt" | "limit_breach" | string;
  severity: "low" | "medium" | "high" | "critical";
  scope: {
    symbol?: string;
    timeframe?: string;
    variant?: string;
  };
  openReasonCodes: string[];
  metrics?: {
    totalRiskPctOpen?: number;
    ddFromPeakR?: number;
    slipBps?: number;
  };
  notes?: string;
}

export interface TelemetryAlert {
  event: "telemetry.alert";
  timestamp: string;
  level: "info" | "warn" | "error";
  message: string;
  context: {
    service?: string;
    slo?: string;
    reasonCodes: string[];
    symbol?: string;
  };
}

export interface SloStatus {
  event: "telemetry.slo.status";
  timestamp: string;
  service: "qa" | "sentry" | "guard" | "bandit" | "balancer" | "policy" | "universe" | "cost" | "logger";
  slo: "availability" | "latency_p99" | "decision_success_rate" | string;
  window: "1h" | "24h" | "7d";
  target: number;
  sli: number;
  status: "ok" | "breach" | "at_risk";
  errorBudgetUsedPct: number;
}

export interface OncallRoster {
  event: "oncall.roster";
  timestamp: string;
  rotation: Array<{
    team: string;
    primary: {
      name: string;
      contact: {
        telegramUserId?: number;
        email?: string;
      };
    };
    secondary: {
      name: string;
      contact: {
        telegramUserId?: number;
        email?: string;
      };
    };
    since: string;
  }>;
}

export interface BridgeChannelMap {
  event: "bridge.channel.map";
  timestamp: string;
  routes: Array<{
    match: {
      event?: string;
      severity?: string;
      service?: string;
      status?: string;
    };
    channels: string[];
    rateLimitPerMin?: number;
  }>;
}

export interface BridgePrefs {
  event: "bridge.prefs";
  timestamp: string;
  locale: "tr" | "en";
  quietHours: {
    start: string; // HH:mm
    end: string;   // HH:mm
    timezone: string;
  };
  mute: {
    symbols: string[];
    incidentTypes: string[];
  };
  digest: {
    enabled: boolean;
    periodMin: number;
  };
}

export interface InboundCommand {
  event: "bridge.inbound.command";
  timestamp: string;
  channel: "telegram" | "discord" | "email" | "webhook";
  userId: string;
  cmd: "ack" | "resolve" | "note";
  incidentId: string;
  note?: string;
  signature?: string;
}

// Output Event Types
export interface BridgeNotificationOutgoing {
  event: "bridge.notification.outgoing";
  timestamp: string;
  dedupeKey: string;
  channels: string[];
  title: string;
  body: string;
  severity: "low" | "medium" | "high" | "critical";
  threadKey: string;
  actions: Array<{ type: "ack" | "resolve"; incidentId: string; }>;
  context: {
    incidentId?: string;
    service?: string;
    symbol?: string;
  };
  ttlSec: number;
}

export interface BridgeTelegramSend {
  event: "bridge.telegram.send";
  timestamp: string;
  chat: string;
  threadKey: string;
  text: string;
  buttons: Array<{ text: string; callback: string; }>;
}

export interface BridgeDiscordSend {
  event: "bridge.discord.send";
  timestamp: string;
  channel: string;
  threadKey: string;
  embed: {
    title: string;
    description: string;
    color: number;
    fields: Array<{ name: string; value: string; inline?: boolean; }>;
  };
  components: Array<{
    type: "buttons";
    items: Array<{ label: string; customId: string; }>;
  }>;
}

export interface BridgeEmailSend {
  event: "bridge.email.send";
  timestamp: string;
  to: string[];
  subject: string;
  html: string;
  threadKey: string;
  headers: {
    "Message-Id": string;
    "In-Reply-To"?: string;
  };
}

export interface BridgeWebhookSend {
  event: "bridge.webhook.send";
  timestamp: string;
  url: string;
  method: "POST" | "PUT";
  headers: Record<string, string>;
  json: Record<string, any>;
}

export interface IncidentAcknowledged {
  event: "incident.acknowledged";
  timestamp: string;
  incidentId: string;
  by: {
    userId: string;
    channel: "telegram" | "discord" | "email" | "webhook";
  };
  note?: string;
}

export interface IncidentResolvedExternal {
  event: "incident.resolved.external";
  timestamp: string;
  incidentId: string;
  by: {
    userId: string;
    channel: "telegram" | "discord" | "email" | "webhook";
  };
  note?: string;
}

export interface BridgeMetrics {
  event: "bridge.metrics";
  timestamp: string;
  sent: {
    telegram: number;
    discord: number;
    email: number;
    webhook: number;
  };
  suppressed: {
    quiet: number;
    dedupe: number;
    rate: number;
  };
  ackMedianSec: number;
  errorRate: number;
}

export interface BridgeAlert {
  event: "bridge.alert";
  timestamp: string;
  level: "info" | "warn" | "error";
  message: string;
  context: {
    reasonCodes: string[];
    channel?: string;
  };
}

// Configuration
export interface IncidentNotificationConfig {
  quietHours: {
    start: string;
    end: string;
    timezone: string;
  };
  soak: {
    windowSec: number;
    maxBatch: number;
  };
  dedupe: {
    windowSec: number;
  };
  rate: {
    telegramPerMin: number;
    discordPerMin: number;
    emailPerMin: number;
    webhookPerMin: number;
  };
  escalation: {
    stages: Array<{
      afterSec: number;
      channels: string[];
      target: "primary" | "secondary";
    }>;
    requireAckSeverities: string[];
  };
  templates: {
    title: string;
    bodyTR: string;
    bodyEN: string;
  };
  secrets: {
    webhookHmacKey: string;
    emailFrom: string;
  };
  severityColors: Record<string, number>;
  defaultLocale: "tr" | "en";
  metricsFlushSec: number;
  tz: string;
}

// Internal state interfaces
interface DedupeEntry {
  key: string;
  expiresAt: Date;
  count: number;
}

interface SoakEntry {
  threadKey: string;
  events: any[];
  firstEventAt: Date;
  windowSec: number;
}

interface EscalationTimer {
  incidentId: string;
  stage: number;
  triggersAt: Date;
  timeout?: NodeJS.Timeout;
}

interface AckRecord {
  incidentId: string;
  ackAt: Date;
  by: {
    userId: string;
    channel: string;
  };
}

interface RateLimitCounter {
  channel: string;
  count: number;
  windowStart: Date;
}

interface BridgeState {
  prefs: BridgePrefs | null;
  routes: BridgeChannelMap | null;
  oncallRoster: OncallRoster | null;
  dedupeIndex: Map<string, DedupeEntry>;
  soakBuffer: Map<string, SoakEntry>;
  threadIndex: Map<string, string>; // incidentId|sloKey -> threadKey
  acks: Map<string, AckRecord>;
  escalations: Map<string, EscalationTimer>;
  rateLimiters: Map<string, RateLimitCounter>;
  metrics: {
    sent: { telegram: number; discord: number; email: number; webhook: number; };
    suppressed: { quiet: number; dedupe: number; rate: number; };
    ackTimes: number[];
  };
}

// Helper classes
class TemplateEngine {
  static render(template: string, context: Record<string, any>): string {
    return template.replace(/\${([^}]+)}/g, (match, key) => {
      const keys = key.split('??').map((k: string) => k.trim());
      for (const k of keys) {
        const value = this.getNestedValue(context, k);
        if (value !== undefined && value !== null) {
          return String(value);
        }
      }
      return keys[keys.length - 1] || '';
    });
  }

  private static getNestedValue(obj: any, path: string): any {
    return path.split('.').reduce((current, key) => current?.[key], obj);
  }
}

class QuietHours {
  static isQuietNow(config: IncidentNotificationConfig["quietHours"]): boolean {
    const now = new Date();
    const timeZone = config.timezone;
    
    // Convert to timezone
    const nowInTz = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      hour12: false,
      hour: '2-digit',
      minute: '2-digit'
    }).format(now);

    const [currentHour, currentMinute] = nowInTz.split(':').map(Number);
    const currentTimeMinutes = currentHour * 60 + currentMinute;

    const [startHour, startMinute] = config.start.split(':').map(Number);
    const [endHour, endMinute] = config.end.split(':').map(Number);
    
    const startTimeMinutes = startHour * 60 + startMinute;
    const endTimeMinutes = endHour * 60 + endMinute;

    if (startTimeMinutes <= endTimeMinutes) {
      // Same day quiet hours
      return currentTimeMinutes >= startTimeMinutes && currentTimeMinutes <= endTimeMinutes;
    } else {
      // Overnight quiet hours
      return currentTimeMinutes >= startTimeMinutes || currentTimeMinutes <= endTimeMinutes;
    }
  }
}

class RateLimiter {
  static check(channel: string, limit: number, counters: Map<string, RateLimitCounter>): boolean {
    const now = new Date();
    const windowStart = new Date(now.getTime() - 60000); // 1 minute window

    let counter = counters.get(channel);
    if (!counter || counter.windowStart < windowStart) {
      counter = { channel, count: 0, windowStart: now };
      counters.set(channel, counter);
    }

    if (counter.count >= limit) {
      return false; // Rate limited
    }

    counter.count++;
    return true; // Allow
  }
}

class HmacSigner {
  static sign(data: string, key: string): string {
    // Simple HMAC implementation (in real world, use crypto module)
    // This is a placeholder - implement proper HMAC-SHA256
    return Buffer.from(`${key}:${data}`).toString('base64').slice(0, 32);
  }

  static verify(data: string, signature: string, key: string): boolean {
    const expectedSignature = this.sign(data, key);
    return signature === expectedSignature;
  }
}

export interface StdError { code:string; message:string; details?:Record<string,unknown>; retriable?:boolean; }

export class IncidentNotificationBridge extends EventEmitter {
  ver="1.0.0"; src="VIVO-33";
  private config: IncidentNotificationConfig;
  private state: BridgeState;
  private metricsInterval?: NodeJS.Timeout;
  private soakTimers: Map<string, NodeJS.Timeout>;

  constructor(config?: Partial<IncidentNotificationConfig>) {
    super();
    this.config = {
      quietHours: {
        start: "23:30",
        end: "07:30",
        timezone: "Europe/Istanbul"
      },
      soak: {
        windowSec: 60,
        maxBatch: 5
      },
      dedupe: {
        windowSec: 300
      },
      rate: {
        telegramPerMin: 8,
        discordPerMin: 8,
        emailPerMin: 20,
        webhookPerMin: 30
      },
      escalation: {
        stages: [
          { afterSec: 300, channels: ["telegram:ops"], target: "primary" },
          { afterSec: 900, channels: ["telegram:ops", "email:oncall@acme.io"], target: "secondary" }
        ],
        requireAckSeverities: ["high", "critical"]
      },
      templates: {
        title: "[${severity}] ${type} ${symbol ?? ''}",
        bodyTR: "Olay: **${type}**\\nŞiddet: **${severity}**\\nSembol: ${symbol ?? '-'}\\nNot: ${notes ?? '-'}\\nMetrikler: ${metricsStr}",
        bodyEN: "Incident: **${type}**\\nSeverity: **${severity}**\\nSymbol: ${symbol ?? '-'}\\nNotes: ${notes ?? '-'}\\nMetrics: ${metricsStr}"
      },
      secrets: {
        webhookHmacKey: process.env.BRIDGE_HMAC || "default-key",
        emailFrom: "vivo@acme.io"
      },
      severityColors: {
        low: 0x2e7d32,
        medium: 0xf9a825,
        high: 0xef6c00,
        critical: 0xc62828
      },
      defaultLocale: "tr",
      metricsFlushSec: 10,
      tz: "Europe/Istanbul",
      ...config
    };

    this.state = {
      prefs: null,
      routes: null,
      oncallRoster: null,
      dedupeIndex: new Map(),
      soakBuffer: new Map(),
      threadIndex: new Map(),
      acks: new Map(),
      escalations: new Map(),
      rateLimiters: new Map(),
      metrics: {
        sent: { telegram: 0, discord: 0, email: 0, webhook: 0 },
        suppressed: { quiet: 0, dedupe: 0, rate: 0 },
        ackTimes: []
      }
    };

    this.soakTimers = new Map();
    this.setupIntervals();
  }

  attach(bus: any, logger: any) {
    // Input events
    bus.on("risk.incident.open", (data: any) => this.handleRiskIncident(data, logger));
    bus.on("risk.incident.update", (data: any) => this.handleRiskIncident(data, logger));
    bus.on("risk.incident.closed", (data: any) => this.handleRiskIncident(data, logger));
    bus.on("telemetry.alert", (data: any) => this.handleTelemetryAlert(data, logger));
    bus.on("telemetry.slo.status", (data: any) => this.handleSloStatus(data, logger));
    bus.on("oncall.roster", (data: any) => this.handleOncallRoster(data, logger));
    bus.on("bridge.channel.map", (data: any) => this.handleChannelMap(data, logger));
    bus.on("bridge.prefs", (data: any) => this.handlePrefs(data, logger));
    bus.on("bridge.inbound.command", (data: any) => this.handleInboundCommand(data, bus, logger));
  }

  private handleRiskIncident(data: any, logger: any): void {
    try {
      if (!data.event?.startsWith("risk.incident.")) return;
      
      const incident = data as RiskIncidentEvent;
      this.processEvent(incident, logger);

    } catch (error: any) {
      this.emitAlert("error", `Risk incident processing failed: ${error.message}`, ["processing_error"], logger);
    }
  }

  private handleTelemetryAlert(data: any, logger: any): void {
    try {
      if (data.event !== "telemetry.alert") return;
      
      const alert = data as TelemetryAlert;
      
      // Only process error level alerts for notifications
      if (alert.level !== "error") return;
      
      this.processEvent(alert, logger);

    } catch (error: any) {
      this.emitAlert("error", `Telemetry alert processing failed: ${error.message}`, ["processing_error"], logger);
    }
  }

  private handleSloStatus(data: any, logger: any): void {
    try {
      if (data.event !== "telemetry.slo.status") return;
      
      const slo = data as SloStatus;
      
      // Only process breaches and at-risk SLOs
      if (slo.status === "ok") return;
      
      this.processEvent(slo, logger);

    } catch (error: any) {
      this.emitAlert("error", `SLO status processing failed: ${error.message}`, ["processing_error"], logger);
    }
  }

  private handleOncallRoster(data: any, logger: any): void {
    try {
      if (data.event !== "oncall.roster") return;
      this.state.oncallRoster = data as OncallRoster;
      if (logger) logger.debug("Oncall roster updated");
    } catch (error: any) {
      this.emitAlert("error", `Oncall roster update failed: ${error.message}`, ["roster_error"], logger);
    }
  }

  private handleChannelMap(data: any, logger: any): void {
    try {
      if (data.event !== "bridge.channel.map") return;
      this.state.routes = data as BridgeChannelMap;
      if (logger) logger.debug("Channel map updated");
    } catch (error: any) {
      this.emitAlert("error", `Channel map update failed: ${error.message}`, ["route_error"], logger);
    }
  }

  private handlePrefs(data: any, logger: any): void {
    try {
      if (data.event !== "bridge.prefs") return;
      this.state.prefs = data as BridgePrefs;
      if (logger) logger.debug("Bridge preferences updated");
    } catch (error: any) {
      this.emitAlert("error", `Preferences update failed: ${error.message}`, ["prefs_error"], logger);
    }
  }

  private handleInboundCommand(data: any, bus: any, logger: any): void {
    try {
      if (data.event !== "bridge.inbound.command") return;
      
      const command = data as InboundCommand;
      
      // Verify signature if provided
      if (command.signature) {
        const payload = JSON.stringify({
          cmd: command.cmd,
          incidentId: command.incidentId,
          userId: command.userId
        });
        
        if (!HmacSigner.verify(payload, command.signature, this.config.secrets.webhookHmacKey)) {
          this.emitAlert("warn", `Invalid signature for command: ${command.cmd}`, ["invalid_signature"], logger);
          return;
        }
      }

      this.processInboundCommand(command, bus, logger);

    } catch (error: any) {
      this.emitAlert("error", `Inbound command processing failed: ${error.message}`, ["command_error"], logger);
    }
  }

  private processEvent(event: any, logger: any): void {
    // Check if muted
    if (this.isMuted(event)) {
      this.state.metrics.suppressed.quiet++;
      return;
    }

    // Generate keys
    const threadKey = this.generateThreadKey(event);
    const dedupeKey = this.generateDedupeKey(event, threadKey);

    // Check dedupe
    if (this.isDuplicate(dedupeKey)) {
      this.state.metrics.suppressed.dedupe++;
      return;
    }

    // Get channels
    const channels = this.getChannelsForEvent(event);
    if (channels.length === 0) return;

    // Check quiet hours
    if (QuietHours.isQuietNow(this.config.quietHours)) {
      this.addToSoakBuffer(threadKey, event);
      this.state.metrics.suppressed.quiet++;
      return;
    }

    // Check soak buffer (even if not in quiet hours)
    if (this.addToSoakBuffer(threadKey, event)) {
      return; // Added to buffer, will be processed later
    }

    // Process immediately
    this.sendNotification(event, channels, threadKey, dedupeKey, logger);
  }

  private isMuted(event: any): boolean {
    if (!this.state.prefs) return false;
    
    const mute = this.state.prefs.mute;
    
    // Check symbol mute
    if (event.symbol && mute.symbols.includes(event.symbol)) {
      return true;
    }
    
    // Check incident type mute
    if (event.type && mute.incidentTypes.includes(event.type)) {
      return true;
    }
    
    return false;
  }

  private generateThreadKey(event: any): string {
    if (event.incidentId) {
      return event.incidentId;
    }
    
    if (event.service && event.slo) {
      return `${event.service}:${event.slo}:${event.window || ''}`;
    }
    
    return `alert:${Date.now()}`;
  }

  private generateDedupeKey(event: any, threadKey: string): string {
    const now = new Date();
    const roundedMinute = Math.floor(now.getTime() / 60000) * 60000;
    const severity = event.severity || event.level || "unknown";
    
    return `${threadKey}:${severity}:${roundedMinute}`;
  }

  private isDuplicate(dedupeKey: string): boolean {
    const now = new Date();
    const existing = this.state.dedupeIndex.get(dedupeKey);
    
    if (existing && existing.expiresAt > now) {
      existing.count++;
      return true;
    }
    
    // Clean expired entries
    for (const [key, entry] of this.state.dedupeIndex.entries()) {
      if (entry.expiresAt <= now) {
        this.state.dedupeIndex.delete(key);
      }
    }
    
    // Add new entry
    const expiresAt = new Date(now.getTime() + this.config.dedupe.windowSec * 1000);
    this.state.dedupeIndex.set(dedupeKey, { key: dedupeKey, expiresAt, count: 1 });
    
    return false;
  }

  private getChannelsForEvent(event: any): string[] {
    if (!this.state.routes) {
      return ["telegram:ops"]; // Default fallback
    }
    
    for (const route of this.state.routes.routes) {
      if (this.matchesRoute(event, route.match)) {
        return route.channels;
      }
    }
    
    return ["telegram:ops"]; // Default fallback
  }

  private matchesRoute(event: any, match: any): boolean {
    if (match.event && !event.event?.match(new RegExp(match.event))) {
      return false;
    }
    
    if (match.severity) {
      const eventSeverity = event.severity || event.level;
      if (match.severity.startsWith(">=")) {
        const targetSeverity = match.severity.slice(2);
        const severityLevels = ["low", "medium", "high", "critical"];
        const eventLevel = severityLevels.indexOf(eventSeverity);
        const targetLevel = severityLevels.indexOf(targetSeverity);
        if (eventLevel < targetLevel) return false;
      } else if (eventSeverity !== match.severity) {
        return false;
      }
    }
    
    if (match.service && event.service !== match.service) {
      return false;
    }
    
    if (match.status && event.status !== match.status) {
      return false;
    }
    
    return true;
  }

  private addToSoakBuffer(threadKey: string, event: any): boolean {
    const existing = this.state.soakBuffer.get(threadKey);
    
    if (existing) {
      existing.events.push(event);
      return true; // Added to existing buffer
    }
    
    // Create new soak entry
    const soakEntry: SoakEntry = {
      threadKey,
      events: [event],
      firstEventAt: new Date(),
      windowSec: this.config.soak.windowSec
    };
    
    this.state.soakBuffer.set(threadKey, soakEntry);
    
    // Set timer to process buffer
    const timer = setTimeout(() => {
      this.processSoakBuffer(threadKey);
    }, this.config.soak.windowSec * 1000);
    
    this.soakTimers.set(threadKey, timer);
    
    return true; // Created new buffer
  }

  private processSoakBuffer(threadKey: string): void {
    const soakEntry = this.state.soakBuffer.get(threadKey);
    if (!soakEntry) return;
    
    // Clear timer and buffer
    this.state.soakBuffer.delete(threadKey);
    const timer = this.soakTimers.get(threadKey);
    if (timer) {
      clearTimeout(timer);
      this.soakTimers.delete(threadKey);
    }
    
    // Get channels from first event
    const firstEvent = soakEntry.events[0];
    const channels = this.getChannelsForEvent(firstEvent);
    const dedupeKey = this.generateDedupeKey(firstEvent, threadKey);
    
    // Create batched notification
    this.sendBatchedNotification(soakEntry.events, channels, threadKey, dedupeKey);
  }

  private sendNotification(event: any, channels: string[], threadKey: string, dedupeKey: string, logger: any): void {
    // Check rate limits
    const allowedChannels = channels.filter(channel => {
      const channelType = channel.split(':')[0];
      const limit = this.config.rate[`${channelType}PerMin` as keyof typeof this.config.rate] || 10;
      
      if (!RateLimiter.check(channel, limit, this.state.rateLimiters)) {
        this.state.metrics.suppressed.rate++;
        this.emitAlert("warn", `Rate limit exceeded for channel: ${channel}`, ["rate_limit"], logger);
        return false;
      }
      
      return true;
    });
    
    if (allowedChannels.length === 0) return;
    
    // Generate content
    const title = this.generateTitle(event);
    const body = this.generateBody(event);
    const severity = this.normalizeSeverity(event.severity || event.level || "medium");
    
    // Create notification
    const notification: BridgeNotificationOutgoing = {
      event: "bridge.notification.outgoing",
      timestamp: new Date().toISOString(),
      dedupeKey,
      channels: allowedChannels,
      title,
      body,
      severity,
      threadKey,
      actions: event.incidentId ? [
        { type: "ack", incidentId: event.incidentId },
        { type: "resolve", incidentId: event.incidentId }
      ] : [],
      context: {
        incidentId: event.incidentId,
        service: event.service,
        symbol: event.symbol || event.scope?.symbol
      },
      ttlSec: 900
    };
    
    this.emit("bridge.notification.outgoing", notification);
    
    // Emit channel-specific events
    this.emitChannelSpecificEvents(notification);
    
    // Update metrics
    this.updateSentMetrics(allowedChannels);
    
    // Set up escalation if needed
    if (event.incidentId && this.shouldEscalate(severity)) {
      this.setupEscalation(event.incidentId, allowedChannels);
    }
  }

  private sendBatchedNotification(events: any[], channels: string[], threadKey: string, dedupeKey: string): void {
    const firstEvent = events[0];
    const title = this.generateTitle(firstEvent) + ` (${events.length} updates)`;
    
    let body = this.generateBody(firstEvent);
    if (events.length > 1) {
      body += `\\n\\n**Özet:** ${events.length} güncelleme soğuruldu.`;
    }
    
    const severity = this.normalizeSeverity(firstEvent.severity || firstEvent.level || "medium");
    
    const notification: BridgeNotificationOutgoing = {
      event: "bridge.notification.outgoing",
      timestamp: new Date().toISOString(),
      dedupeKey,
      channels,
      title,
      body,
      severity,
      threadKey,
      actions: firstEvent.incidentId ? [
        { type: "ack", incidentId: firstEvent.incidentId },
        { type: "resolve", incidentId: firstEvent.incidentId }
      ] : [],
      context: {
        incidentId: firstEvent.incidentId,
        service: firstEvent.service,
        symbol: firstEvent.symbol || firstEvent.scope?.symbol
      },
      ttlSec: 900
    };
    
    this.emit("bridge.notification.outgoing", notification);
    this.emitChannelSpecificEvents(notification);
    this.updateSentMetrics(channels);
  }

  private generateTitle(event: any): string {
    const context = {
      severity: event.severity || event.level || "unknown",
      type: event.type || "alert",
      symbol: event.symbol || event.scope?.symbol || null
    };
    
    return TemplateEngine.render(this.config.templates.title, context);
  }

  private generateBody(event: any): string {
    const locale = this.state.prefs?.locale || this.config.defaultLocale;
    const template = locale === "tr" ? this.config.templates.bodyTR : this.config.templates.bodyEN;
    
    const metricsStr = this.formatMetrics(event.metrics);
    
    const context = {
      type: event.type || "alert",
      severity: event.severity || event.level || "unknown",
      symbol: event.symbol || event.scope?.symbol || null,
      notes: event.notes || event.message || null,
      metricsStr: metricsStr || null
    };
    
    return TemplateEngine.render(template, context);
  }

  private formatMetrics(metrics: any): string {
    if (!metrics || typeof metrics !== "object") return "";
    
    const parts: string[] = [];
    
    if (metrics.totalRiskPctOpen) {
      parts.push(`risk=${metrics.totalRiskPctOpen}%`);
    }
    if (metrics.slipBps) {
      parts.push(`slip=${metrics.slipBps}bps`);
    }
    if (metrics.ddFromPeakR) {
      parts.push(`dd=${metrics.ddFromPeakR}R`);
    }
    
    return parts.join(", ");
  }

  private normalizeSeverity(severity: string): "low" | "medium" | "high" | "critical" {
    const normalized = severity.toLowerCase();
    if (["critical", "high", "medium", "low"].includes(normalized)) {
      return normalized as any;
    }
    
    if (["error", "err"].includes(normalized)) return "high";
    if (["warn", "warning"].includes(normalized)) return "medium";
    if (["info", "information"].includes(normalized)) return "low";
    
    return "medium";
  }

  private emitChannelSpecificEvents(notification: BridgeNotificationOutgoing): void {
    for (const channel of notification.channels) {
      const [type, target] = channel.split(':', 2);
      
      switch (type) {
        case "telegram":
          this.emitTelegramEvent(notification, target);
          break;
        case "discord":
          this.emitDiscordEvent(notification, target);
          break;
        case "email":
          this.emitEmailEvent(notification, target);
          break;
        case "webhook":
          this.emitWebhookEvent(notification, target);
          break;
      }
    }
  }

  private emitTelegramEvent(notification: BridgeNotificationOutgoing, chat: string): void {
    const telegramEvent: BridgeTelegramSend = {
      event: "bridge.telegram.send",
      timestamp: notification.timestamp,
      chat,
      threadKey: notification.threadKey,
      text: `**${notification.title}**\\n\\n${notification.body}`,
      buttons: notification.actions.map(action => ({
        text: action.type === "ack" ? "ACK" : "RESOLVE",
        callback: `${action.type}:${action.incidentId}`
      }))
    };
    
    this.emit("bridge.telegram.send", telegramEvent);
  }

  private emitDiscordEvent(notification: BridgeNotificationOutgoing, channel: string): void {
    const color = this.config.severityColors[notification.severity] || 0x808080;
    
    const fields: Array<{ name: string; value: string; inline?: boolean; }> = [];
    if (notification.context.symbol) {
      fields.push({ name: "Symbol", value: notification.context.symbol, inline: true });
    }
    if (notification.context.service) {
      fields.push({ name: "Service", value: notification.context.service, inline: true });
    }
    
    const discordEvent: BridgeDiscordSend = {
      event: "bridge.discord.send",
      timestamp: notification.timestamp,
      channel,
      threadKey: notification.threadKey,
      embed: {
        title: notification.title,
        description: notification.body,
        color,
        fields
      },
      components: notification.actions.length > 0 ? [{
        type: "buttons",
        items: notification.actions.map(action => ({
          label: action.type === "ack" ? "ACK" : "RESOLVE",
          customId: `${action.type}:${action.incidentId}`
        }))
      }] : []
    };
    
    this.emit("bridge.discord.send", discordEvent);
  }

  private emitEmailEvent(notification: BridgeNotificationOutgoing, to: string): void {
    const subject = notification.title;
    const html = `
      <h2>${notification.title}</h2>
      <p>${notification.body.replace(/\\n/g, '<br>')}</p>
      ${notification.context.symbol ? `<p><strong>Symbol:</strong> ${notification.context.symbol}</p>` : ''}
      ${notification.context.service ? `<p><strong>Service:</strong> ${notification.context.service}</p>` : ''}
    `;
    
    const emailEvent: BridgeEmailSend = {
      event: "bridge.email.send",
      timestamp: notification.timestamp,
      to: [to],
      subject,
      html,
      threadKey: notification.threadKey,
      headers: {
        "Message-Id": `<${notification.threadKey}@vivo>`,
        "In-Reply-To": `<${notification.threadKey}@vivo>`
      }
    };
    
    this.emit("bridge.email.send", emailEvent);
  }

  private emitWebhookEvent(notification: BridgeNotificationOutgoing, url: string): void {
    const payload = {
      title: notification.title,
      body: notification.body,
      severity: notification.severity,
      incidentId: notification.context.incidentId,
      symbol: notification.context.symbol,
      service: notification.context.service,
      timestamp: notification.timestamp,
      threadKey: notification.threadKey
    };
    
    const payloadStr = JSON.stringify(payload);
    const signature = HmacSigner.sign(payloadStr, this.config.secrets.webhookHmacKey);
    
    const webhookEvent: BridgeWebhookSend = {
      event: "bridge.webhook.send",
      timestamp: notification.timestamp,
      url,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Signature": signature
      },
      json: payload
    };
    
    this.emit("bridge.webhook.send", webhookEvent);
  }

  private updateSentMetrics(channels: string[]): void {
    for (const channel of channels) {
      const type = channel.split(':')[0] as keyof typeof this.state.metrics.sent;
      if (this.state.metrics.sent[type] !== undefined) {
        this.state.metrics.sent[type]++;
      }
    }
  }

  private shouldEscalate(severity: string): boolean {
    return this.config.escalation.requireAckSeverities.includes(severity);
  }

  private setupEscalation(incidentId: string, channels: string[]): void {
    // Cancel existing escalations for this incident
    const existing = this.state.escalations.get(incidentId);
    if (existing?.timeout) {
      clearTimeout(existing.timeout);
    }
    
    // Set up first stage escalation
    const firstStage = this.config.escalation.stages[0];
    if (!firstStage) return;
    
    const timeout = setTimeout(() => {
      this.executeEscalation(incidentId, 0);
    }, firstStage.afterSec * 1000);
    
    const escalation: EscalationTimer = {
      incidentId,
      stage: 0,
      triggersAt: new Date(Date.now() + firstStage.afterSec * 1000),
      timeout
    };
    
    this.state.escalations.set(incidentId, escalation);
  }

  private executeEscalation(incidentId: string, stage: number): void {
    // Check if already acknowledged
    if (this.state.acks.has(incidentId)) {
      this.state.escalations.delete(incidentId);
      return;
    }
    
    const stageConfig = this.config.escalation.stages[stage];
    if (!stageConfig) return;
    
    // Send escalation notification
    const notification: BridgeNotificationOutgoing = {
      event: "bridge.notification.outgoing",
      timestamp: new Date().toISOString(),
      dedupeKey: `escalation:${incidentId}:${stage}`,
      channels: stageConfig.channels,
      title: `[ESCALATION] Incident ${incidentId} not acknowledged`,
      body: `Incident ${incidentId} has not been acknowledged after ${stageConfig.afterSec} seconds.`,
      severity: "high",
      threadKey: incidentId,
      actions: [
        { type: "ack", incidentId },
        { type: "resolve", incidentId }
      ],
      context: { incidentId },
      ttlSec: 900
    };
    
    this.emit("bridge.notification.outgoing", notification);
    this.emitChannelSpecificEvents(notification);
    
    // Set up next stage if available
    const nextStage = this.config.escalation.stages[stage + 1];
    if (nextStage) {
      const timeout = setTimeout(() => {
        this.executeEscalation(incidentId, stage + 1);
      }, (nextStage.afterSec - stageConfig.afterSec) * 1000);
      
      const escalation: EscalationTimer = {
        incidentId,
        stage: stage + 1,
        triggersAt: new Date(Date.now() + (nextStage.afterSec - stageConfig.afterSec) * 1000),
        timeout
      };
      
      this.state.escalations.set(incidentId, escalation);
    }
  }

  private processInboundCommand(command: InboundCommand, bus: any, logger: any): void {
    const now = new Date();
    
    switch (command.cmd) {
      case "ack":
        // Record acknowledgment
        this.state.acks.set(command.incidentId, {
          incidentId: command.incidentId,
          ackAt: now,
          by: {
            userId: command.userId,
            channel: command.channel
          }
        });
        
        // Cancel escalations
        const escalation = this.state.escalations.get(command.incidentId);
        if (escalation?.timeout) {
          clearTimeout(escalation.timeout);
          this.state.escalations.delete(command.incidentId);
        }
        
        // Emit acknowledgment event
        const ackEvent: IncidentAcknowledged = {
          event: "incident.acknowledged",
          timestamp: now.toISOString(),
          incidentId: command.incidentId,
          by: {
            userId: command.userId,
            channel: command.channel
          },
          note: command.note
        };
        
        this.emit("incident.acknowledged", ackEvent);
        if (bus) bus.emit("incident.acknowledged", ackEvent);
        
        // Record ACK time for metrics
        this.recordAckTime(command.incidentId, now);
        
        if (logger) logger.info({ incidentId: command.incidentId, userId: command.userId }, "Incident acknowledged");
        break;
        
      case "resolve":
        // Emit resolution event
        const resolveEvent: IncidentResolvedExternal = {
          event: "incident.resolved.external",
          timestamp: now.toISOString(),
          incidentId: command.incidentId,
          by: {
            userId: command.userId,
            channel: command.channel
          },
          note: command.note
        };
        
        this.emit("incident.resolved.external", resolveEvent);
        if (bus) bus.emit("incident.resolved.external", resolveEvent);
        
        // Clean up state
        this.state.acks.delete(command.incidentId);
        const escTimer = this.state.escalations.get(command.incidentId);
        if (escTimer?.timeout) {
          clearTimeout(escTimer.timeout);
          this.state.escalations.delete(command.incidentId);
        }
        
        if (logger) logger.info({ incidentId: command.incidentId, userId: command.userId }, "Incident resolved externally");
        break;
        
      case "note":
        // For now, just log the note
        if (logger) logger.info({ incidentId: command.incidentId, userId: command.userId, note: command.note }, "Note added to incident");
        break;
    }
  }

  private recordAckTime(incidentId: string, ackTime: Date): void {
    // For now, just record time since creation (simplified)
    // In real implementation, you'd track incident open time
    const ackTimeMs = 300; // Placeholder - calculate actual time
    
    this.state.metrics.ackTimes.push(ackTimeMs);
    
    // Keep only recent ACK times for median calculation
    if (this.state.metrics.ackTimes.length > 100) {
      this.state.metrics.ackTimes.shift();
    }
  }

  private setupIntervals(): void {
    this.metricsInterval = setInterval(() => {
      this.emitMetrics();
    }, this.config.metricsFlushSec * 1000);
  }

  private emitMetrics(): void {
    const ackMedianSec = this.calculateMedianAckTime();
    
    const metrics: BridgeMetrics = {
      event: "bridge.metrics",
      timestamp: new Date().toISOString(),
      sent: { ...this.state.metrics.sent },
      suppressed: { ...this.state.metrics.suppressed },
      ackMedianSec,
      errorRate: 0 // Placeholder
    };
    
    this.emit("bridge.metrics", metrics);
    
    // Reset counters
    this.state.metrics.sent = { telegram: 0, discord: 0, email: 0, webhook: 0 };
    this.state.metrics.suppressed = { quiet: 0, dedupe: 0, rate: 0 };
  }

  private calculateMedianAckTime(): number {
    if (this.state.metrics.ackTimes.length === 0) return 0;
    
    const sorted = [...this.state.metrics.ackTimes].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    
    if (sorted.length % 2 === 0) {
      return (sorted[mid - 1] + sorted[mid]) / 2;
    } else {
      return sorted[mid];
    }
  }

  private emitAlert(level: "info" | "warn" | "error", message: string, reasonCodes: string[], logger?: any): void {
    const alert: BridgeAlert = {
      event: "bridge.alert",
      timestamp: new Date().toISOString(),
      level,
      message,
      context: { reasonCodes }
    };
    
    this.emit("bridge.alert", alert);
    
    if (logger) {
      logger[level]({ reasonCodes }, message);
    }
  }

  // Public methods
  getStatus(): any {
    return {
      config: this.config,
      state: {
        hasPrefs: !!this.state.prefs,
        hasRoutes: !!this.state.routes,
        hasOncall: !!this.state.oncallRoster,
        dedupeCount: this.state.dedupeIndex.size,
        soakBufferCount: this.state.soakBuffer.size,
        activeEscalations: this.state.escalations.size,
        ackedIncidents: this.state.acks.size
      }
    };
  }

  updateConfig(updates: Partial<IncidentNotificationConfig>): void {
    this.config = { ...this.config, ...updates };
  }

  // Cleanup
  shutdown(): void {
    if (this.metricsInterval) {
      clearInterval(this.metricsInterval);
    }
    
    // Clear all soak timers
    for (const timer of this.soakTimers.values()) {
      clearTimeout(timer);
    }
    this.soakTimers.clear();
    
    // Clear escalation timers
    for (const escalation of this.state.escalations.values()) {
      if (escalation.timeout) {
        clearTimeout(escalation.timeout);
      }
    }
  }
}
