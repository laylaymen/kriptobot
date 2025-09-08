/**
 * Alert Correlator Runbook Helper - LT-04
 * Correlates distributed alerts/incidents into groups with root cause analysis
 * Provides runbook steps and sends unified notifications via VIVO-33
 */

import { EventEmitter } from 'events';

interface TelemetryAlert {
    level: 'info' | 'warn' | 'error';
    message: string;
    context: {
        series: string;
        kind: string;
        severity: string;
    };
    timestamp: string;
}

interface TelemetryAnomalySignal {
    series: string;
    labels: Record<string, string>;
    kind: 'spike' | 'drop' | 'drift' | 'flatline' | 'gap';
    severity: 'low' | 'medium' | 'high';
    reasonCodes: string[];
    timestamp: string;
}

interface TelemetrySLOStatus {
    service: string;
    slo: string;
    status: 'healthy' | 'degraded' | 'breached';
    burnRate: number;
    errorBudgetPct: number;
    windowSec: number;
    timestamp: string;
}

interface SentryGuardDirective {
    mode: string;
    reasonCodes: string[];
    source: string;
    timestamp: string;
}

interface StreamIntegrityAlert {
    level: 'warn' | 'error';
    source: string;
    issue: string;
    impact: string;
    timestamp: string;
}

interface RiskIncident {
    type: string;
    severity: 'low' | 'medium' | 'high' | 'critical';
    details: Record<string, any>;
    timestamp: string;
}

interface RunbookRule {
    if: {
        series?: string;
        reasonCodes?: string[];
        sentryMode?: string;
        incidentType?: string;
        windowSec?: number;
    };
    then: {
        rootCause: string;
        steps: string[];
        tags: string[];
        severityBump?: 'low' | 'medium' | 'high' | 'critical';
    };
}

interface RunbookKB {
    rules: RunbookRule[];
}

interface CorrelationEvent {
    event: any;
    ts: number;
    type: 'alert' | 'anomaly' | 'slo' | 'sentry' | 'stream' | 'risk';
    source: string;
    severity: string;
    fingerprint: string;
}

interface AlertCorrelationGrouped {
    groupId: string;
    timeline: CorrelationEvent[];
    rootCauseHypo: string;
    runbook: {
        steps: string[];
    };
    severity: 'low' | 'medium' | 'high' | 'critical';
    affected: string[];
    reasonCodes: string[];
    timestamp: string;
}

interface BridgeNotificationOutgoing {
    channel: 'telegram' | 'slack' | 'email';
    title: string;
    body: string;
    severity: 'low' | 'medium' | 'high' | 'critical';
    groupId: string;
    timestamp: string;
}

interface CorrelatorMetrics {
    eventsIn: number;
    groupsCreated: number;
    groupsMerged: number;
    notificationsSent: number;
    windowSec: number;
}

interface CorrelatorAlert {
    level: 'info' | 'warn' | 'error';
    message: string;
    context: any;
    timestamp: string;
}

interface Config {
    windowSec: number;
    minSignalsForGroup: number;
    severityEscalation: Record<string, 'critical' | 'high' | 'medium' | 'low'>;
    maxGroups: number;
    groupTtlSec: number;
    similarityThreshold: number;
    tz: string;
}

class AlertCorrelatorRunbookHelper extends EventEmitter {
    private config: Config;
    private logger: any;
    private isInitialized: boolean = false;
    
    // Runbook knowledge base
    private runbookKB: RunbookKB = { rules: [] };
    
    // Active correlation groups
    private correlationGroups: Map<string, {
        group: AlertCorrelationGrouped;
        events: CorrelationEvent[];
        lastUpdate: number;
        fingerprints: Set<string>;
    }> = new Map();
    
    // Recent events for correlation
    private recentEvents: CorrelationEvent[] = [];
    
    // Idempotency tracking
    private sentNotifications: Set<string> = new Set();
    
    // Statistics
    private stats: {
        eventsIn: number;
        groupsCreated: number;
        groupsMerged: number;
        notificationsSent: number;
        windowStart: number;
    } = {
        eventsIn: 0,
        groupsCreated: 0,
        groupsMerged: 0,
        notificationsSent: 0,
        windowStart: Date.now()
    };

    constructor(config: Partial<Config> = {}) {
        super();
        this.config = {
            windowSec: 180,
            minSignalsForGroup: 2,
            severityEscalation: {
                'sentry:streams_panic + flatline': 'critical',
                'sentry:halt_entry + risk:critical': 'critical',
                'guard:slowdown + latency:spike': 'high',
                'slo:breached + anomaly:spike': 'high'
            },
            maxGroups: 100,
            groupTtlSec: 3600, // 1 hour
            similarityThreshold: 0.7,
            tz: 'Europe/Istanbul',
            ...config
        };

        // Cleanup expired groups and events
        setInterval(() => {
            this.cleanupExpiredGroups();
            this.cleanupExpiredEvents();
        }, 60000);

        // Metrics emission
        setInterval(() => {
            this.emitMetrics();
        }, 60000);
    }

    async initialize(logger: any): Promise<boolean> {
        try {
            this.logger = logger;
            this.logger.info('AlertCorrelatorRunbookHelper initializing...');
            
            this.isInitialized = true;
            this.logger.info('AlertCorrelatorRunbookHelper initialized successfully');
            return true;
        } catch (error) {
            this.logger.error('AlertCorrelatorRunbookHelper initialization error:', error);
            return false;
        }
    }

    /**
     * Process telemetry alert
     */
    async processTelemetryAlert(data: TelemetryAlert): Promise<void> {
        if (!this.isInitialized) return;

        const event = this.createCorrelationEvent(data, 'alert', data.context.series, data.level);
        await this.processEvent(event);
    }

    /**
     * Process telemetry anomaly signal
     */
    async processTelemetryAnomalySignal(data: TelemetryAnomalySignal): Promise<void> {
        if (!this.isInitialized) return;

        const event = this.createCorrelationEvent(data, 'anomaly', data.series, data.severity);
        await this.processEvent(event);
    }

    /**
     * Process telemetry SLO status
     */
    async processTelemetrySLOStatus(data: TelemetrySLOStatus): Promise<void> {
        if (!this.isInitialized) return;

        // Only correlate degraded/breached SLOs
        if (data.status === 'healthy') return;

        const event = this.createCorrelationEvent(data, 'slo', `${data.service}:${data.slo}`, data.status);
        await this.processEvent(event);
    }

    /**
     * Process sentry guard directive
     */
    async processSentryGuardDirective(data: SentryGuardDirective): Promise<void> {
        if (!this.isInitialized) return;

        // Only correlate non-normal modes
        if (data.mode === 'normal') return;

        const event = this.createCorrelationEvent(data, 'sentry', data.source, data.mode);
        await this.processEvent(event);
    }

    /**
     * Process stream integrity alert
     */
    async processStreamIntegrityAlert(data: StreamIntegrityAlert): Promise<void> {
        if (!this.isInitialized) return;

        const event = this.createCorrelationEvent(data, 'stream', data.source, data.level);
        await this.processEvent(event);
    }

    /**
     * Process risk incident
     */
    async processRiskIncident(data: RiskIncident): Promise<void> {
        if (!this.isInitialized) return;

        const event = this.createCorrelationEvent(data, 'risk', data.type, data.severity);
        await this.processEvent(event);
    }

    /**
     * Update runbook knowledge base
     */
    async processRunbookKB(data: RunbookKB): Promise<void> {
        if (!this.isInitialized) return;

        try {
            this.runbookKB = data;
            this.logger.info(`AlertCorrelatorRunbookHelper updated with ${data.rules.length} runbook rules`);

        } catch (error) {
            this.logger.error('AlertCorrelatorRunbookHelper runbook KB update error:', error);
        }
    }

    private createCorrelationEvent(
        data: any, 
        type: 'alert' | 'anomaly' | 'slo' | 'sentry' | 'stream' | 'risk',
        source: string,
        severity: string
    ): CorrelationEvent {
        const timestamp = data.timestamp ? new Date(data.timestamp).getTime() : Date.now();
        const fingerprint = this.generateFingerprint(data, type, source);

        return {
            event: data,
            ts: timestamp,
            type,
            source,
            severity,
            fingerprint
        };
    }

    private generateFingerprint(data: any, type: string, source: string): string {
        // Create a fingerprint for deduplication
        const key = `${type}:${source}:${data.message || data.kind || data.mode || data.type || 'unknown'}`;
        return Buffer.from(key).toString('base64').substring(0, 16);
    }

    private async processEvent(event: CorrelationEvent): Promise<void> {
        this.stats.eventsIn++;
        this.recentEvents.push(event);

        // Find existing groups that this event could belong to
        const candidateGroups = this.findCandidateGroups(event);

        if (candidateGroups.length === 0) {
            // Create new group if this event is significant enough
            if (this.shouldCreateNewGroup(event)) {
                await this.createNewGroup(event);
            }
        } else if (candidateGroups.length === 1) {
            // Add to existing group
            await this.addToGroup(candidateGroups[0], event);
        } else {
            // Multiple candidates - merge groups
            await this.mergeGroups(candidateGroups, event);
        }
    }

    private findCandidateGroups(event: CorrelationEvent): string[] {
        const candidates: string[] = [];
        const now = Date.now();
        const windowMs = this.config.windowSec * 1000;

        for (const [groupId, groupData] of this.correlationGroups.entries()) {
            // Check time window
            if (now - groupData.lastUpdate > windowMs) {
                continue;
            }

            // Check similarity
            if (this.calculateSimilarity(event, groupData.events) >= this.config.similarityThreshold) {
                candidates.push(groupId);
            }
        }

        return candidates;
    }

    private calculateSimilarity(event: CorrelationEvent, groupEvents: CorrelationEvent[]): number {
        if (groupEvents.length === 0) return 0;

        let maxSimilarity = 0;

        for (const groupEvent of groupEvents) {
            let similarity = 0;

            // Same type increases similarity
            if (event.type === groupEvent.type) similarity += 0.3;

            // Same source increases similarity
            if (event.source === groupEvent.source) similarity += 0.3;

            // Similar severity increases similarity
            if (event.severity === groupEvent.severity) similarity += 0.2;

            // Same fingerprint is high similarity
            if (event.fingerprint === groupEvent.fingerprint) similarity += 0.8;

            // Check for related sources (e.g., same service)
            if (this.areSourcesRelated(event.source, groupEvent.source)) {
                similarity += 0.2;
            }

            maxSimilarity = Math.max(maxSimilarity, similarity);
        }

        return Math.min(maxSimilarity, 1.0);
    }

    private areSourcesRelated(source1: string, source2: string): boolean {
        // Simple heuristic for related sources
        const parts1 = source1.toLowerCase().split(/[._-]/);
        const parts2 = source2.toLowerCase().split(/[._-]/);

        for (const part1 of parts1) {
            for (const part2 of parts2) {
                if (part1.length > 2 && part2.length > 2 && part1 === part2) {
                    return true;
                }
            }
        }

        return false;
    }

    private shouldCreateNewGroup(event: CorrelationEvent): boolean {
        // Create groups for high severity events or specific types
        return event.severity === 'high' || 
               event.severity === 'critical' ||
               event.type === 'sentry' ||
               event.type === 'risk';
    }

    private async createNewGroup(event: CorrelationEvent): Promise<void> {
        const groupId = this.generateGroupId();
        const now = Date.now();

        // Apply runbook rules
        const runbookResult = this.applyRunbookRules([event]);

        const group: AlertCorrelationGrouped = {
            groupId,
            timeline: [event],
            rootCauseHypo: runbookResult.rootCause || 'Unknown - investigating',
            runbook: {
                steps: runbookResult.steps || ['Investigate the incident', 'Check system health', 'Apply mitigation']
            },
            severity: runbookResult.severity || event.severity as any,
            affected: [event.source],
            reasonCodes: this.extractReasonCodes([event]),
            timestamp: new Date().toISOString()
        };

        this.correlationGroups.set(groupId, {
            group,
            events: [event],
            lastUpdate: now,
            fingerprints: new Set([event.fingerprint])
        });

        this.stats.groupsCreated++;

        // Emit group and send notification
        this.emit('alert.correlation.grouped', group);
        await this.sendNotification(group);

        this.logger.info(`AlertCorrelatorRunbookHelper created group ${groupId} with root cause: ${group.rootCauseHypo}`);
    }

    private async addToGroup(groupId: string, event: CorrelationEvent): Promise<void> {
        const groupData = this.correlationGroups.get(groupId);
        if (!groupData) return;

        // Check for duplicate fingerprint
        if (groupData.fingerprints.has(event.fingerprint)) {
            return; // Skip duplicate
        }

        // Add event to group
        groupData.events.push(event);
        groupData.fingerprints.add(event.fingerprint);
        groupData.lastUpdate = Date.now();
        groupData.group.timeline.push(event);

        // Update affected services
        if (!groupData.group.affected.includes(event.source)) {
            groupData.group.affected.push(event.source);
        }

        // Re-evaluate runbook rules with updated events
        const runbookResult = this.applyRunbookRules(groupData.events);
        if (runbookResult.rootCause) {
            groupData.group.rootCauseHypo = runbookResult.rootCause;
        }
        if (runbookResult.steps) {
            groupData.group.runbook.steps = runbookResult.steps;
        }
        if (runbookResult.severity) {
            groupData.group.severity = runbookResult.severity;
        }

        // Update reason codes
        groupData.group.reasonCodes = this.extractReasonCodes(groupData.events);

        // Emit updated group
        this.emit('alert.correlation.grouped', groupData.group);

        this.logger.debug(`AlertCorrelatorRunbookHelper added event to group ${groupId}`);
    }

    private async mergeGroups(groupIds: string[], event: CorrelationEvent): Promise<void> {
        if (groupIds.length < 2) return;

        const primaryGroupId = groupIds[0];
        const primaryGroupData = this.correlationGroups.get(primaryGroupId);
        if (!primaryGroupData) return;

        // Merge all events into primary group
        const allEvents = [event, ...primaryGroupData.events];
        const allFingerprints = new Set([event.fingerprint, ...primaryGroupData.fingerprints]);
        const allAffected = new Set([event.source, ...primaryGroupData.group.affected]);

        for (let i = 1; i < groupIds.length; i++) {
            const groupData = this.correlationGroups.get(groupIds[i]);
            if (groupData) {
                allEvents.push(...groupData.events);
                groupData.fingerprints.forEach(fp => allFingerprints.add(fp));
                groupData.group.affected.forEach(svc => allAffected.add(svc));
                this.correlationGroups.delete(groupIds[i]);
            }
        }

        // Update primary group
        primaryGroupData.events = allEvents;
        primaryGroupData.fingerprints = allFingerprints;
        primaryGroupData.lastUpdate = Date.now();
        primaryGroupData.group.timeline = allEvents;
        primaryGroupData.group.affected = Array.from(allAffected);

        // Re-evaluate runbook rules
        const runbookResult = this.applyRunbookRules(allEvents);
        if (runbookResult.rootCause) {
            primaryGroupData.group.rootCauseHypo = runbookResult.rootCause;
        }
        if (runbookResult.steps) {
            primaryGroupData.group.runbook.steps = runbookResult.steps;
        }
        if (runbookResult.severity) {
            primaryGroupData.group.severity = runbookResult.severity;
        }

        primaryGroupData.group.reasonCodes = this.extractReasonCodes(allEvents);

        this.stats.groupsMerged++;

        // Emit merged group
        this.emit('alert.correlation.grouped', primaryGroupData.group);

        this.logger.info(`AlertCorrelatorRunbookHelper merged ${groupIds.length} groups into ${primaryGroupId}`);
    }

    private applyRunbookRules(events: CorrelationEvent[]): {
        rootCause?: string;
        steps?: string[];
        severity?: 'low' | 'medium' | 'high' | 'critical';
    } {
        for (const rule of this.runbookKB.rules) {
            if (this.matchesRule(events, rule.if)) {
                return {
                    rootCause: rule.then.rootCause,
                    steps: rule.then.steps,
                    severity: rule.then.severityBump
                };
            }
        }

        // Check for built-in escalation rules
        const eventSignature = this.getEventSignature(events);
        for (const [pattern, severity] of Object.entries(this.config.severityEscalation)) {
            if (eventSignature.includes(pattern.replace(/\s*\+\s*/, ' ')) || 
                this.matchesEscalationPattern(events, pattern)) {
                return { severity };
            }
        }

        return {};
    }

    private matchesRule(events: CorrelationEvent[], rule: RunbookRule['if']): boolean {
        if (rule.windowSec && events.length > 0) {
            const now = Date.now();
            const oldestEvent = Math.min(...events.map(e => e.ts));
            if ((now - oldestEvent) / 1000 > rule.windowSec) {
                return false;
            }
        }

        if (rule.series) {
            const hasMatchingSeries = events.some(e => 
                e.source.includes(rule.series!) || 
                (e.event.series && e.event.series.includes(rule.series!))
            );
            if (!hasMatchingSeries) return false;
        }

        if (rule.sentryMode) {
            const hasSentryMode = events.some(e => 
                e.type === 'sentry' && e.event.mode === rule.sentryMode
            );
            if (!hasSentryMode) return false;
        }

        if (rule.incidentType) {
            const hasIncidentType = events.some(e => 
                e.type === 'risk' && e.event.type === rule.incidentType
            );
            if (!hasIncidentType) return false;
        }

        if (rule.reasonCodes) {
            const allReasonCodes = this.extractReasonCodes(events);
            const hasRequiredCodes = rule.reasonCodes.every(code => 
                allReasonCodes.includes(code)
            );
            if (!hasRequiredCodes) return false;
        }

        return true;
    }

    private getEventSignature(events: CorrelationEvent[]): string {
        const signatures = events.map(e => {
            if (e.type === 'sentry') return `sentry:${e.event.mode}`;
            if (e.type === 'anomaly') return `anomaly:${e.event.kind}`;
            if (e.type === 'alert') return `alert:${e.severity}`;
            if (e.type === 'risk') return `risk:${e.severity}`;
            return `${e.type}:${e.severity}`;
        });

        return signatures.join(' ');
    }

    private matchesEscalationPattern(events: CorrelationEvent[], pattern: string): boolean {
        const conditions = pattern.split(/\s*\+\s*/);
        
        return conditions.every(condition => {
            return events.some(event => {
                const [type, value] = condition.split(':');
                return event.type === type && 
                       (event.event.mode === value || 
                        event.event.kind === value || 
                        event.severity === value);
            });
        });
    }

    private extractReasonCodes(events: CorrelationEvent[]): string[] {
        const codes = new Set<string>();

        for (const event of events) {
            if (event.event.reasonCodes) {
                event.event.reasonCodes.forEach((code: string) => codes.add(code));
            }
            
            // Add type-based reason codes
            codes.add(`${event.type.toUpperCase()}_${event.severity.toUpperCase()}`);
        }

        return Array.from(codes);
    }

    private async sendNotification(group: AlertCorrelationGrouped): Promise<void> {
        // Check for idempotency
        if (this.sentNotifications.has(group.groupId)) {
            return;
        }

        this.sentNotifications.add(group.groupId);

        const notification: BridgeNotificationOutgoing = {
            channel: 'telegram', // Default channel
            title: `🚨 Incident Group ${group.groupId}`,
            body: this.formatNotificationBody(group),
            severity: group.severity,
            groupId: group.groupId,
            timestamp: new Date().toISOString()
        };

        this.emit('bridge.notification.outgoing', notification);
        this.stats.notificationsSent++;
    }

    private formatNotificationBody(group: AlertCorrelationGrouped): string {
        let body = `**Root Cause:** ${group.rootCauseHypo}\n\n`;
        body += `**Affected Services:** ${group.affected.join(', ')}\n\n`;
        body += `**Timeline:**\n`;
        
        for (const event of group.timeline.slice(-5)) { // Last 5 events
            const time = new Date(event.ts).toLocaleTimeString('tr-TR');
            body += `• ${time} - ${event.type}: ${event.source} (${event.severity})\n`;
        }

        body += `\n**Runbook Steps:**\n`;
        for (let i = 0; i < group.runbook.steps.length; i++) {
            body += `${i + 1}. ${group.runbook.steps[i]}\n`;
        }

        if (group.reasonCodes.length > 0) {
            body += `\n**Reason Codes:** ${group.reasonCodes.join(', ')}`;
        }

        return body;
    }

    private generateGroupId(): string {
        const timestamp = Date.now().toString(36);
        const random = Math.random().toString(36).substring(2, 8);
        return `INC-${timestamp}-${random}`;
    }

    private cleanupExpiredGroups(): void {
        const now = Date.now();
        const ttlMs = this.config.groupTtlSec * 1000;
        
        const toDelete: string[] = [];
        for (const [groupId, groupData] of this.correlationGroups.entries()) {
            if (now - groupData.lastUpdate > ttlMs) {
                toDelete.push(groupId);
            }
        }
        
        toDelete.forEach(id => {
            this.correlationGroups.delete(id);
            this.sentNotifications.delete(id);
        });

        if (toDelete.length > 0) {
            this.logger.debug(`AlertCorrelatorRunbookHelper cleaned up ${toDelete.length} expired groups`);
        }
    }

    private cleanupExpiredEvents(): void {
        const now = Date.now();
        const windowMs = this.config.windowSec * 1000 * 2; // Keep 2x window for analysis
        
        this.recentEvents = this.recentEvents.filter(event => 
            now - event.ts < windowMs
        );
    }

    private emitMetrics(): void {
        const metrics: CorrelatorMetrics = {
            eventsIn: this.stats.eventsIn,
            groupsCreated: this.stats.groupsCreated,
            groupsMerged: this.stats.groupsMerged,
            notificationsSent: this.stats.notificationsSent,
            windowSec: 60
        };

        this.emit('correlator.metrics', metrics);

        // Reset stats
        this.stats = {
            eventsIn: 0,
            groupsCreated: 0,
            groupsMerged: 0,
            notificationsSent: 0,
            windowStart: Date.now()
        };
    }

    /**
     * Get module status
     */
    getStatus(): any {
        return {
            name: 'AlertCorrelatorRunbookHelper',
            initialized: this.isInitialized,
            activeGroups: this.correlationGroups.size,
            runbookRules: this.runbookKB.rules.length,
            recentEvents: this.recentEvents.length,
            sentNotifications: this.sentNotifications.size,
            stats: this.stats
        };
    }

    async shutdown(): Promise<void> {
        try {
            this.logger.info('AlertCorrelatorRunbookHelper shutting down...');
            this.removeAllListeners();
            this.correlationGroups.clear();
            this.recentEvents.length = 0;
            this.sentNotifications.clear();
            this.isInitialized = false;
            this.logger.info('AlertCorrelatorRunbookHelper shutdown complete');
        } catch (error) {
            this.logger.error('AlertCorrelatorRunbookHelper shutdown error:', error);
        }
    }
}

export default AlertCorrelatorRunbookHelper;
