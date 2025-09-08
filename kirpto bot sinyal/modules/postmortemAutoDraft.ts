/**
 * Postmortem Auto Draft - LT-05
 * Automatically generates postmortem drafts from closed critical incidents
 * Includes timeline, impact, root cause, SLO impact, actions, and follow-ups
 */

import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';

interface IncidentAcknowledged {
    incidentId: string;
    severity: 'low' | 'medium' | 'high' | 'critical';
    acknowledgedBy: string;
    timestamp: string;
}

interface IncidentResolvedExternal {
    incidentId: string;
    resolvedBy: string;
    resolution: string;
    timestamp: string;
}

interface BridgeMetrics {
    incidentId: string;
    metrics: Record<string, any>;
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

interface TelemetryAnomalySignal {
    series: string;
    labels: Record<string, string>;
    kind: 'spike' | 'drop' | 'drift' | 'flatline' | 'gap';
    severity: 'low' | 'medium' | 'high';
    reasonCodes: string[];
    timestamp: string;
}

interface AlertCorrelationGrouped {
    groupId: string;
    timeline: any[];
    rootCauseHypo: string;
    runbook: {
        steps: string[];
    };
    severity: 'low' | 'medium' | 'high' | 'critical';
    affected: string[];
    reasonCodes: string[];
    timestamp: string;
}

interface AuditTrailEvent {
    eventType: string;
    actor: string;
    action: string;
    target: string;
    details: Record<string, any>;
    timestamp: string;
}

interface PostmortemDraftReady {
    event: string;
    timestamp: string;
    incidentId: string;
    format: 'markdown';
    content: string;
    attachments: Array<{
        name: string;
        ref: string;
    }>;
    summary: {
        start: string;
        end: string;
        impact: {
            durationMin: number;
            services: string[];
        };
        slo: {
            burnPct: number;
        };
    };
}

interface PostmortemAlert {
    level: 'info' | 'warn' | 'error';
    message: string;
    context: any;
    timestamp: string;
}

interface PostmortemMetrics {
    draftsGenerated: number;
    avgGenerationTimeMs: number;
    autoFillPct: number;
    windowSec: number;
}

interface IncidentData {
    incidentId: string;
    acknowledged: IncidentAcknowledged | null;
    resolved: IncidentResolvedExternal | null;
    correlationGroup: AlertCorrelationGrouped | null;
    sloEvents: TelemetrySLOStatus[];
    anomalyEvents: TelemetryAnomalySignal[];
    auditEvents: AuditTrailEvent[];
    bridgeMetrics: BridgeMetrics[];
    timeline: Array<{ timestamp: string; event: any; type: string }>;
}

interface Config {
    template: {
        title: string;
        sections: string[];
        followUpsDefault: string[];
    };
    artifactDir: string;
    require: {
        minTimelineEvents: number;
        sloWindow: string;
    };
    sloWindowMs: number;
    maxIncidentAge: number;
    tz: string;
}

class PostmortemAutoDraft extends EventEmitter {
    private config: Config;
    private logger: any;
    private isInitialized: boolean = false;
    
    // Active incident tracking
    private activeIncidents: Map<string, IncidentData> = new Map();
    
    // SLO status history for burn calculation
    private sloHistory: Array<{ event: TelemetrySLOStatus; timestamp: number }> = [];
    
    // Anomaly events for timeline
    private anomalyHistory: Array<{ event: TelemetryAnomalySignal; timestamp: number }> = [];
    
    // Correlation groups for root cause
    private correlationGroups: Map<string, AlertCorrelationGrouped> = new Map();
    
    // Audit trail for actions taken
    private auditTrail: Array<{ event: AuditTrailEvent; timestamp: number }> = [];
    
    // Statistics
    private stats: {
        draftsGenerated: number;
        totalGenerationTimeMs: number;
        totalAutoFillEvents: number;
        totalEvents: number;
        windowStart: number;
    } = {
        draftsGenerated: 0,
        totalGenerationTimeMs: 0,
        totalAutoFillEvents: 0,
        totalEvents: 0,
        windowStart: Date.now()
    };

    constructor(config: Partial<Config> = {}) {
        super();
        this.config = {
            template: {
                title: '# Incident ${id}',
                sections: ['Summary', 'Timeline', 'Impact', 'Root Cause', 'Mitigations', 'Follow-ups', 'Lessons'],
                followUpsDefault: [
                    'Add regression test',
                    'Tighten SLO monitoring',
                    'Update runbook procedures',
                    'Review alerting thresholds'
                ]
            },
            artifactDir: 'data/postmortems',
            require: {
                minTimelineEvents: 5,
                sloWindow: '24h'
            },
            sloWindowMs: 24 * 60 * 60 * 1000,
            maxIncidentAge: 7 * 24 * 60 * 60 * 1000, // 7 days
            tz: 'Europe/Istanbul',
            ...config
        };

        // Ensure artifacts directory exists
        this.ensureArtifactDir();

        // Cleanup old incidents and history
        setInterval(() => {
            this.cleanupOldData();
        }, 60 * 60 * 1000); // Every hour

        // Metrics emission
        setInterval(() => {
            this.emitMetrics();
        }, 60000);
    }

    async initialize(logger: any): Promise<boolean> {
        try {
            this.logger = logger;
            this.logger.info('PostmortemAutoDraft initializing...');
            
            this.isInitialized = true;
            this.logger.info('PostmortemAutoDraft initialized successfully');
            return true;
        } catch (error) {
            this.logger.error('PostmortemAutoDraft initialization error:', error);
            return false;
        }
    }

    /**
     * Process incident acknowledged
     */
    async processIncidentAcknowledged(data: IncidentAcknowledged): Promise<void> {
        if (!this.isInitialized) return;

        try {
            let incident = this.activeIncidents.get(data.incidentId);
            if (!incident) {
                incident = this.createIncidentData(data.incidentId);
                this.activeIncidents.set(data.incidentId, incident);
            }

            incident.acknowledged = data;
            incident.timeline.push({
                timestamp: data.timestamp,
                event: data,
                type: 'acknowledged'
            });

            this.logger.info(`PostmortemAutoDraft tracking incident ${data.incidentId}`);

        } catch (error) {
            this.logger.error('PostmortemAutoDraft incident acknowledged processing error:', error);
        }
    }

    /**
     * Process incident resolved - triggers postmortem generation
     */
    async processIncidentResolvedExternal(data: IncidentResolvedExternal): Promise<void> {
        if (!this.isInitialized) return;

        try {
            const incident = this.activeIncidents.get(data.incidentId);
            if (!incident) {
                this.logger.warn(`PostmortemAutoDraft received resolution for unknown incident ${data.incidentId}`);
                return;
            }

            incident.resolved = data;
            incident.timeline.push({
                timestamp: data.timestamp,
                event: data,
                type: 'resolved'
            });

            // Generate postmortem draft
            await this.generatePostmortemDraft(incident);

            // Remove from active incidents
            this.activeIncidents.delete(data.incidentId);

        } catch (error) {
            this.logger.error('PostmortemAutoDraft incident resolved processing error:', error);
        }
    }

    /**
     * Process bridge metrics
     */
    async processBridgeMetrics(data: BridgeMetrics): Promise<void> {
        if (!this.isInitialized) return;

        try {
            const incident = this.activeIncidents.get(data.incidentId);
            if (incident) {
                incident.bridgeMetrics.push(data);
                incident.timeline.push({
                    timestamp: data.timestamp,
                    event: data,
                    type: 'metrics'
                });
            }

        } catch (error) {
            this.logger.error('PostmortemAutoDraft bridge metrics processing error:', error);
        }
    }

    /**
     * Process telemetry SLO status
     */
    async processTelemetrySLOStatus(data: TelemetrySLOStatus): Promise<void> {
        if (!this.isInitialized) return;

        try {
            const timestamp = new Date(data.timestamp).getTime();
            this.sloHistory.push({ event: data, timestamp });

            // Associate with active incidents
            for (const incident of this.activeIncidents.values()) {
                if (this.isEventRelatedToIncident(data, incident)) {
                    incident.sloEvents.push(data);
                    incident.timeline.push({
                        timestamp: data.timestamp,
                        event: data,
                        type: 'slo'
                    });
                }
            }

        } catch (error) {
            this.logger.error('PostmortemAutoDraft SLO status processing error:', error);
        }
    }

    /**
     * Process telemetry anomaly signal
     */
    async processTelemetryAnomalySignal(data: TelemetryAnomalySignal): Promise<void> {
        if (!this.isInitialized) return;

        try {
            const timestamp = new Date(data.timestamp).getTime();
            this.anomalyHistory.push({ event: data, timestamp });

            // Associate with active incidents
            for (const incident of this.activeIncidents.values()) {
                if (this.isEventRelatedToIncident(data, incident)) {
                    incident.anomalyEvents.push(data);
                    incident.timeline.push({
                        timestamp: data.timestamp,
                        event: data,
                        type: 'anomaly'
                    });
                }
            }

        } catch (error) {
            this.logger.error('PostmortemAutoDraft anomaly signal processing error:', error);
        }
    }

    /**
     * Process alert correlation grouped
     */
    async processAlertCorrelationGrouped(data: AlertCorrelationGrouped): Promise<void> {
        if (!this.isInitialized) return;

        try {
            this.correlationGroups.set(data.groupId, data);

            // Try to associate with incidents
            const incidentId = this.extractIncidentIdFromGroup(data);
            if (incidentId) {
                const incident = this.activeIncidents.get(incidentId);
                if (incident) {
                    incident.correlationGroup = data;
                    incident.timeline.push({
                        timestamp: data.timestamp,
                        event: data,
                        type: 'correlation'
                    });
                }
            }

        } catch (error) {
            this.logger.error('PostmortemAutoDraft correlation group processing error:', error);
        }
    }

    /**
     * Process audit trail event
     */
    async processAuditTrailEvent(data: AuditTrailEvent): Promise<void> {
        if (!this.isInitialized) return;

        try {
            const timestamp = new Date(data.timestamp).getTime();
            this.auditTrail.push({ event: data, timestamp });

            // Associate with active incidents if relevant
            for (const incident of this.activeIncidents.values()) {
                if (this.isAuditEventRelatedToIncident(data, incident)) {
                    incident.auditEvents.push(data);
                    incident.timeline.push({
                        timestamp: data.timestamp,
                        event: data,
                        type: 'audit'
                    });
                }
            }

        } catch (error) {
            this.logger.error('PostmortemAutoDraft audit trail processing error:', error);
        }
    }

    private createIncidentData(incidentId: string): IncidentData {
        return {
            incidentId,
            acknowledged: null,
            resolved: null,
            correlationGroup: null,
            sloEvents: [],
            anomalyEvents: [],
            auditEvents: [],
            bridgeMetrics: [],
            timeline: []
        };
    }

    private isEventRelatedToIncident(event: any, incident: IncidentData): boolean {
        // Simple heuristics to relate events to incidents
        if (!incident.correlationGroup) return false;

        // Check if event affects same services
        if (incident.correlationGroup.affected) {
            for (const service of incident.correlationGroup.affected) {
                if (event.series?.includes(service) || 
                    event.service?.includes(service) ||
                    event.source?.includes(service)) {
                    return true;
                }
            }
        }

        return false;
    }

    private isAuditEventRelatedToIncident(audit: AuditTrailEvent, incident: IncidentData): boolean {
        // Check if audit event mentions incident ID or related services
        const content = JSON.stringify(audit).toLowerCase();
        
        if (content.includes(incident.incidentId.toLowerCase())) {
            return true;
        }

        if (incident.correlationGroup?.affected) {
            for (const service of incident.correlationGroup.affected) {
                if (content.includes(service.toLowerCase())) {
                    return true;
                }
            }
        }

        return false;
    }

    private extractIncidentIdFromGroup(group: AlertCorrelationGrouped): string | null {
        // Try to extract incident ID from group ID or description
        if (group.groupId.startsWith('INC-')) {
            return group.groupId;
        }

        // Look for incident references in timeline
        for (const event of group.timeline) {
            if (event.event?.incidentId) {
                return event.event.incidentId;
            }
        }

        return null;
    }

    private async generatePostmortemDraft(incident: IncidentData): Promise<void> {
        const startTime = Date.now();

        try {
            // Validate minimum requirements
            if (incident.timeline.length < this.config.require.minTimelineEvents) {
                await this.emitAlert('warn', `Insufficient timeline events for incident ${incident.incidentId}`);
                return;
            }

            // Sort timeline by timestamp
            incident.timeline.sort((a, b) => 
                new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
            );

            // Generate markdown content
            const content = this.generateMarkdownContent(incident);

            // Calculate impact summary
            const summary = this.calculateImpactSummary(incident);

            // Save artifacts
            const attachments = await this.saveArtifacts(incident);

            // Create postmortem draft
            const draft: PostmortemDraftReady = {
                event: 'postmortem.draft.ready',
                timestamp: new Date().toISOString(),
                incidentId: incident.incidentId,
                format: 'markdown',
                content,
                attachments,
                summary
            };

            // Emit draft ready event
            this.emit('postmortem.draft.ready', draft);

            // Update stats
            const generationTime = Date.now() - startTime;
            this.stats.draftsGenerated++;
            this.stats.totalGenerationTimeMs += generationTime;
            this.stats.totalEvents += incident.timeline.length;
            this.stats.totalAutoFillEvents += this.countAutoFillableEvents(incident);

            this.logger.info(`PostmortemAutoDraft generated draft for ${incident.incidentId} in ${generationTime}ms`);

        } catch (error) {
            this.logger.error(`PostmortemAutoDraft generation error for ${incident.incidentId}:`, error);
            await this.emitAlert('error', `Failed to generate postmortem for ${incident.incidentId}: ${error.message}`);
        }
    }

    private generateMarkdownContent(incident: IncidentData): string {
        let content = this.config.template.title.replace('${id}', incident.incidentId) + '\n\n';

        // Summary section
        content += '## Summary\n\n';
        if (incident.resolved) {
            content += `**Incident ID:** ${incident.incidentId}\n`;
            content += `**Severity:** ${incident.acknowledged?.severity || 'Unknown'}\n`;
            content += `**Duration:** ${this.calculateDuration(incident)}\n`;
            content += `**Resolution:** ${incident.resolved.resolution}\n\n`;
        }

        if (incident.correlationGroup) {
            content += `**Root Cause Hypothesis:** ${incident.correlationGroup.rootCauseHypo}\n\n`;
        }

        // Timeline section
        content += '## Timeline\n\n';
        for (const event of incident.timeline) {
            const time = new Date(event.timestamp).toLocaleString('tr-TR', { timeZone: this.config.tz });
            content += `- **${time}** - ${this.formatTimelineEvent(event)}\n`;
        }
        content += '\n';

        // Impact section
        content += '## Impact\n\n';
        const summary = this.calculateImpactSummary(incident);
        content += `**Duration:** ${summary.impact.durationMin} minutes\n`;
        content += `**Affected Services:** ${summary.impact.services.join(', ')}\n`;
        if (summary.slo.burnPct > 0) {
            content += `**SLO Error Budget Burn:** ${summary.slo.burnPct}%\n`;
        }
        content += '\n';

        // Root Cause section
        content += '## Root Cause\n\n';
        if (incident.correlationGroup) {
            content += incident.correlationGroup.rootCauseHypo + '\n\n';
            if (incident.correlationGroup.reasonCodes.length > 0) {
                content += `**Reason Codes:** ${incident.correlationGroup.reasonCodes.join(', ')}\n\n`;
            }
        } else {
            content += 'Root cause analysis pending.\n\n';
        }

        // Mitigations section
        content += '## Mitigations\n\n';
        if (incident.correlationGroup?.runbook.steps) {
            for (let i = 0; i < incident.correlationGroup.runbook.steps.length; i++) {
                content += `${i + 1}. ${incident.correlationGroup.runbook.steps[i]}\n`;
            }
        } else {
            content += 'Mitigation steps to be documented.\n';
        }
        content += '\n';

        // Follow-ups section
        content += '## Follow-ups\n\n';
        for (let i = 0; i < this.config.template.followUpsDefault.length; i++) {
            content += `- [ ] ${this.config.template.followUpsDefault[i]}\n`;
        }
        content += '\n';

        // Lessons Learned section
        content += '## Lessons Learned\n\n';
        content += 'To be filled after team review.\n\n';

        return content;
    }

    private formatTimelineEvent(event: any): string {
        switch (event.type) {
            case 'acknowledged':
                return `Incident acknowledged by ${event.event.acknowledgedBy}`;
            case 'resolved':
                return `Incident resolved by ${event.event.resolvedBy}: ${event.event.resolution}`;
            case 'slo':
                return `SLO ${event.event.slo} status: ${event.event.status} (burn rate: ${event.event.burnRate})`;
            case 'anomaly':
                return `Anomaly detected: ${event.event.kind} in ${event.event.series} (${event.event.severity})`;
            case 'correlation':
                return `Alert correlation group created: ${event.event.groupId}`;
            case 'audit':
                return `${event.event.action} by ${event.event.actor} on ${event.event.target}`;
            case 'metrics':
                return `Metrics snapshot captured`;
            default:
                return `Event: ${event.type}`;
        }
    }

    private calculateDuration(incident: IncidentData): string {
        if (!incident.acknowledged || !incident.resolved) {
            return 'Unknown';
        }

        const start = new Date(incident.acknowledged.timestamp).getTime();
        const end = new Date(incident.resolved.timestamp).getTime();
        const durationMs = end - start;
        const durationMin = Math.round(durationMs / 60000);

        if (durationMin < 60) {
            return `${durationMin} minutes`;
        } else {
            const hours = Math.floor(durationMin / 60);
            const minutes = durationMin % 60;
            return `${hours}h ${minutes}m`;
        }
    }

    private calculateImpactSummary(incident: IncidentData): PostmortemDraftReady['summary'] {
        const start = incident.acknowledged?.timestamp || incident.timeline[0]?.timestamp || new Date().toISOString();
        const end = incident.resolved?.timestamp || new Date().toISOString();

        const durationMs = new Date(end).getTime() - new Date(start).getTime();
        const durationMin = Math.round(durationMs / 60000);

        const services = incident.correlationGroup?.affected || [];

        // Calculate SLO burn percentage
        let burnPct = 0;
        if (incident.sloEvents.length > 0) {
            const totalBurn = incident.sloEvents.reduce((sum, slo) => {
                return sum + (slo.burnRate > 1 ? (slo.burnRate - 1) * 100 : 0);
            }, 0);
            burnPct = Math.round(totalBurn / incident.sloEvents.length);
        }

        return {
            start,
            end,
            impact: {
                durationMin,
                services
            },
            slo: {
                burnPct
            }
        };
    }

    private async saveArtifacts(incident: IncidentData): Promise<PostmortemDraftReady['attachments']> {
        const attachments: PostmortemDraftReady['attachments'] = [];

        try {
            // Save timeline as JSON
            const timelineFile = path.join(this.config.artifactDir, `${incident.incidentId}-timeline.json`);
            await fs.promises.writeFile(timelineFile, JSON.stringify(incident.timeline, null, 2));
            attachments.push({
                name: 'timeline.json',
                ref: `file://${timelineFile}`
            });

            // Save metrics if available
            if (incident.bridgeMetrics.length > 0) {
                const metricsFile = path.join(this.config.artifactDir, `${incident.incidentId}-metrics.json`);
                await fs.promises.writeFile(metricsFile, JSON.stringify(incident.bridgeMetrics, null, 2));
                attachments.push({
                    name: 'metrics.json',
                    ref: `file://${metricsFile}`
                });
            }

        } catch (error) {
            this.logger.warn(`PostmortemAutoDraft could not save artifacts for ${incident.incidentId}:`, error);
        }

        return attachments;
    }

    private countAutoFillableEvents(incident: IncidentData): number {
        return incident.timeline.filter(event => 
            event.type === 'slo' || 
            event.type === 'anomaly' || 
            event.type === 'correlation' ||
            event.type === 'audit'
        ).length;
    }

    private async emitAlert(level: 'info' | 'warn' | 'error', message: string, context?: any): Promise<void> {
        const alert: PostmortemAlert = {
            level,
            message,
            context: context || {},
            timestamp: new Date().toISOString()
        };

        this.emit('postmortem.alert', alert);
    }

    private ensureArtifactDir(): void {
        try {
            if (!fs.existsSync(this.config.artifactDir)) {
                fs.mkdirSync(this.config.artifactDir, { recursive: true });
            }
        } catch (error) {
            // Will be created later if needed
        }
    }

    private cleanupOldData(): void {
        const now = Date.now();
        const maxAge = this.config.maxIncidentAge;

        // Clean old incidents
        const toDelete: string[] = [];
        for (const [incidentId, incident] of this.activeIncidents.entries()) {
            const lastActivity = incident.timeline.length > 0 
                ? new Date(incident.timeline[incident.timeline.length - 1].timestamp).getTime()
                : now;
            
            if (now - lastActivity > maxAge) {
                toDelete.push(incidentId);
            }
        }
        
        toDelete.forEach(id => this.activeIncidents.delete(id));

        // Clean old history
        this.sloHistory = this.sloHistory.filter(item => now - item.timestamp < this.config.sloWindowMs);
        this.anomalyHistory = this.anomalyHistory.filter(item => now - item.timestamp < this.config.sloWindowMs);
        this.auditTrail = this.auditTrail.filter(item => now - item.timestamp < this.config.sloWindowMs);

        // Clean old correlation groups
        const groupsToDelete: string[] = [];
        for (const [groupId, group] of this.correlationGroups.entries()) {
            const groupAge = now - new Date(group.timestamp).getTime();
            if (groupAge > maxAge) {
                groupsToDelete.push(groupId);
            }
        }
        
        groupsToDelete.forEach(id => this.correlationGroups.delete(id));
    }

    private emitMetrics(): void {
        const avgGenerationTime = this.stats.draftsGenerated > 0 
            ? this.stats.totalGenerationTimeMs / this.stats.draftsGenerated 
            : 0;

        const autoFillPct = this.stats.totalEvents > 0 
            ? (this.stats.totalAutoFillEvents / this.stats.totalEvents) * 100 
            : 0;

        const metrics: PostmortemMetrics = {
            draftsGenerated: this.stats.draftsGenerated,
            avgGenerationTimeMs: Math.round(avgGenerationTime),
            autoFillPct: Math.round(autoFillPct),
            windowSec: 60
        };

        this.emit('postmortem.metrics', metrics);

        // Reset stats
        this.stats = {
            draftsGenerated: 0,
            totalGenerationTimeMs: 0,
            totalAutoFillEvents: 0,
            totalEvents: 0,
            windowStart: Date.now()
        };
    }

    /**
     * Get module status
     */
    getStatus(): any {
        return {
            name: 'PostmortemAutoDraft',
            initialized: this.isInitialized,
            activeIncidents: this.activeIncidents.size,
            sloHistorySize: this.sloHistory.length,
            anomalyHistorySize: this.anomalyHistory.length,
            correlationGroups: this.correlationGroups.size,
            auditTrailSize: this.auditTrail.length,
            stats: this.stats
        };
    }

    async shutdown(): Promise<void> {
        try {
            this.logger.info('PostmortemAutoDraft shutting down...');
            this.removeAllListeners();
            this.activeIncidents.clear();
            this.sloHistory.length = 0;
            this.anomalyHistory.length = 0;
            this.correlationGroups.clear();
            this.auditTrail.length = 0;
            this.isInitialized = false;
            this.logger.info('PostmortemAutoDraft shutdown complete');
        } catch (error) {
            this.logger.error('PostmortemAutoDraft shutdown error:', error);
        }
    }
}

export default PostmortemAutoDraft;
