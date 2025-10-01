/**
 * LIVIA-18 · incidentPostmortemWriter.js
 * Incident postmortem yazıcısı - otomatik incident analizi, timeline ve CAPA önerileri
 */

const { z } = require('zod');
const fs = require('fs').promises;
const path = require('path');
const { eventBus } = require('../../kirpto bot sinyal/modules/modularEventStream');
const { logInfo, logError } = require('../../kirpto bot sinyal/logs/logger');

// 🎯 Smart Schemas
const PostmortemConfigSchema = z.object({
    output: z.object({
        dir: z.string().default('data/postmortems/{YYYY-MM}'),
        html: z.object({
            enable: z.boolean().default(true),
            cssPreset: z.string().default('pm-minimal')
        }).default({}),
        atomicWrite: z.boolean().default(true)
    }).default({}),
    compose: z.object({
        timelineWindowHours: z.number().positive().default(6),
        maxOpenQuestions: z.number().positive().default(6),
        includeCitations: z.boolean().default(true)
    }).default({}),
    heuristics: z.object({
        rcaBuckets: z.array(z.string()).default(['System', 'Data', 'Process', 'Human', 'External']),
        rcaRules: z.array(z.object({
            ifTags: z.array(z.string()).optional(),
            ifReasons: z.array(z.string()).optional(),
            ifKind: z.string().optional(),
            bucket: z.string(),
            hint: z.string()
        })).default([])
    }).default({})
});

const IncidentStartedSchema = z.object({
    event: z.literal('incident.started'),
    timestamp: z.string(),
    id: z.string(),
    severity: z.enum(['low', 'medium', 'high', 'critical']),
    title: z.string(),
    tags: z.array(z.string()).default([]),
    detectedBy: z.enum(['anomaly', 'operator', 'monitor']).default('monitor')
});

const IncidentClosedSchema = z.object({
    event: z.literal('incident.closed'),
    timestamp: z.string(),
    id: z.string(),
    resolution: z.string(),
    durationMin: z.number().positive(),
    notes: z.string().optional(),
    impact: z.object({
        ordersAffected: z.number().default(0),
        usersAffected: z.number().default(0),
        pnlImpactUSD: z.number().default(0)
    }).optional()
});

/**
 * 📅 Smart Timeline Builder
 */
class SmartTimelineBuilder {
    constructor(config) {
        this.config = config;
        this.timelineEvents = [];
    }

    addEvent(event, type, description) {
        this.timelineEvents.push({
            timestamp: event.timestamp,
            type: type,
            description: description,
            source: event.event || 'unknown',
            data: event
        });
    }

    buildTimeline(incidentStart, incidentEnd, relatedEvents) {
        this.timelineEvents = [];
        
        // Incident başlangıcı
        this.addEvent(incidentStart, 'incident', `**Başlangıç**: ${incidentStart.title}`);
        
        // İlgili olayları timeline'a ekle
        relatedEvents.forEach(event => {
            this.processRelatedEvent(event);
        });
        
        // Incident bitişi
        this.addEvent(incidentEnd, 'incident', `**Çözüm**: ${incidentEnd.resolution}`);
        
        // Zaman sırasına göre sırala
        this.timelineEvents.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
        
        return this.generateTimelineMarkdown();
    }

    processRelatedEvent(event) {
        const eventType = event.event || 'unknown';
        
        if (eventType.startsWith('telemetry.anomaly')) {
            this.addEvent(event, 'anomaly', 
                `**Anomali**: ${event.series} ${event.kind} (severity: ${event.severity})`);
        } else if (eventType.includes('guard.directive')) {
            this.addEvent(event, 'guard', 
                `**Guard**: ${event.mode} (sebep: ${event.reasonCodes?.join(', ') || 'unknown'})`);
        } else if (eventType.startsWith('policy.')) {
            this.addEvent(event, 'policy', 
                `**Policy**: ${event.kind || 'change'} - ${event.bullets?.join('; ') || 'update'}`);
        } else if (eventType.startsWith('decision.')) {
            this.addEvent(event, 'decision', 
                `**Karar**: ${event.summary || 'decision made'}`);
        } else if (eventType.startsWith('approval.')) {
            this.addEvent(event, 'approval', 
                `**Onay**: ${event.pending || 0} bekleyen, ${event.approved || 0} onaylı`);
        } else if (eventType.startsWith('operator.notes')) {
            this.addEvent(event, 'note', 
                `**Not**: ${event.lines?.[0]?.text || 'operator note'}`);
        }
    }

    generateTimelineMarkdown() {
        return this.timelineEvents.map(event => {
            const localTime = new Date(event.timestamp).toLocaleString('tr-TR', {
                timeZone: 'Europe/Istanbul',
                day: '2-digit',
                month: '2-digit',
                hour: '2-digit',
                minute: '2-digit'
            });
            
            return `- ${localTime} — ${event.description}`;
        }).join('\n');
    }
}

/**
 * 🔍 Smart RCA Composer
 */
class SmartRCAComposer {
    constructor(config) {
        this.config = config;
        this.defaultRules = [
            { ifTags: ['slip', 'latency'], bucket: 'System', hint: 'Execution path latency & slippage' },
            { ifReasons: ['feed_stale>5s', 'packet_gap>2s'], bucket: 'Data', hint: 'Market data freshness/gaps' },
            { ifKind: 'policy_change', bucket: 'Process', hint: 'Change management / rollout' }
        ];
    }

    composeRCA(incident, relatedEvents) {
        const rcaHypotheses = [];
        
        // Tag-based RCA
        const tagBasedRCA = this.analyzeByTags(incident.tags);
        if (tagBasedRCA) rcaHypotheses.push(tagBasedRCA);
        
        // Event-based RCA
        const eventBasedRCA = this.analyzeByEvents(relatedEvents);
        rcaHypotheses.push(...eventBasedRCA);
        
        // Guard-based RCA
        const guardBasedRCA = this.analyzeByGuardEvents(relatedEvents);
        if (guardBasedRCA) rcaHypotheses.push(guardBasedRCA);
        
        return this.deduplicateAndRank(rcaHypotheses);
    }

    analyzeByTags(tags) {
        const rules = [...(this.config.heuristics.rcaRules || []), ...this.defaultRules];
        
        for (const rule of rules) {
            if (rule.ifTags && rule.ifTags.some(tag => tags.includes(tag))) {
                return {
                    bucket: rule.bucket,
                    hypothesis: rule.hint,
                    evidence: `Tags: ${tags.join(', ')}`,
                    confidence: 0.7
                };
            }
        }
        
        return null;
    }

    analyzeByEvents(relatedEvents) {
        const hypotheses = [];
        const rules = [...(this.config.heuristics.rcaRules || []), ...this.defaultRules];
        
        relatedEvents.forEach(event => {
            // Reason codes kontrolü
            if (event.reasonCodes) {
                for (const rule of rules) {
                    if (rule.ifReasons && rule.ifReasons.some(reason => 
                        event.reasonCodes.some(rc => rc.includes(reason.split('>')[0])))) {
                        hypotheses.push({
                            bucket: rule.bucket,
                            hypothesis: rule.hint,
                            evidence: `Reason: ${event.reasonCodes.join(', ')}`,
                            confidence: 0.8
                        });
                    }
                }
            }
            
            // Event kind kontrolü
            if (event.kind) {
                for (const rule of rules) {
                    if (rule.ifKind === event.kind) {
                        hypotheses.push({
                            bucket: rule.bucket,
                            hypothesis: rule.hint,
                            evidence: `Event kind: ${event.kind}`,
                            confidence: 0.6
                        });
                    }
                }
            }
        });
        
        return hypotheses;
    }

    analyzeByGuardEvents(relatedEvents) {
        const guardEvents = relatedEvents.filter(e => 
            e.event && e.event.includes('guard.directive'));
        
        if (guardEvents.length > 0) {
            const modes = guardEvents.map(e => e.mode).filter(Boolean);
            const reasons = guardEvents.flatMap(e => e.reasonCodes || []);
            
            return {
                bucket: 'System',
                hypothesis: 'Guard system intervention due to operational limits',
                evidence: `Guard modes: ${modes.join(', ')}, Reasons: ${reasons.join(', ')}`,
                confidence: 0.9
            };
        }
        
        return null;
    }

    deduplicateAndRank(hypotheses) {
        // Bucket'lara göre grupla ve en yüksek confidence'lıyı al
        const bucketMap = new Map();
        
        hypotheses.forEach(hyp => {
            const existing = bucketMap.get(hyp.bucket);
            if (!existing || hyp.confidence > existing.confidence) {
                bucketMap.set(hyp.bucket, hyp);
            }
        });
        
        // Confidence'a göre sırala
        return Array.from(bucketMap.values())
            .sort((a, b) => b.confidence - a.confidence);
    }
}

/**
 * 📋 Smart CAPA Planner
 */
class SmartCAPAPlanner {
    constructor(config) {
        this.config = config;
        this.defaultTemplates = [
            { when: 'System', action: 'Order path latency budgets tighten; add p95 guard at 800ms', owner: 'ops', dueHours: 24 },
            { when: 'Data', action: 'Market feed watchdog, auto-failover playbook update', owner: 'ops', dueHours: 24 },
            { when: 'Process', action: 'Policy rollout checklist + canary %, rollback gates', owner: 'policy-team', dueHours: 48 }
        ];
    }

    planCAPAs(rcaHypotheses) {
        const capas = [];
        
        rcaHypotheses.forEach(rca => {
            const template = this.findTemplate(rca.bucket);
            if (template) {
                const dueDate = new Date();
                dueDate.setHours(dueDate.getHours() + template.dueHours);
                
                capas.push({
                    action: template.action,
                    owner: template.owner,
                    due: dueDate.toISOString().split('T')[0] + ' 18:00',
                    bucket: rca.bucket,
                    priority: this.calculatePriority(rca.confidence)
                });
            }
        });
        
        // Generic open questions ekle
        capas.push({
            action: 'Incident response time değerlendirmesi ve improvement planı',
            owner: 'ops',
            due: this.getNextBusinessDay() + ' 18:00',
            bucket: 'Process',
            priority: 'medium'
        });
        
        return capas;
    }

    findTemplate(bucket) {
        return this.defaultTemplates.find(template => template.when === bucket);
    }

    calculatePriority(confidence) {
        if (confidence >= 0.8) return 'high';
        if (confidence >= 0.6) return 'medium';
        return 'low';
    }

    getNextBusinessDay() {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        
        // Hafta sonu ise pazartesiye kaydır
        const dayOfWeek = tomorrow.getDay();
        if (dayOfWeek === 0) { // Pazar
            tomorrow.setDate(tomorrow.getDate() + 1);
        } else if (dayOfWeek === 6) { // Cumartesi
            tomorrow.setDate(tomorrow.getDate() + 2);
        }
        
        return tomorrow.toISOString().split('T')[0];
    }
}

/**
 * 🎯 LIVIA-18 Smart Incident Postmortem Writer
 */
class IncidentPostmortemWriter {
    constructor(config = {}) {
        this.name = 'IncidentPostmortemWriter';
        this.config = PostmortemConfigSchema.parse(config);
        
        this.timelineBuilder = new SmartTimelineBuilder(this.config);
        this.rcaComposer = new SmartRCAComposer(this.config);
        this.capaPlanner = new SmartCAPAPlanner(this.config);
        
        this.eventBuffer = new Map(); // incidentId -> events
        this.processedIncidents = new Set();
        this.stats = {
            draftsGenerated: 0,
            avgComposeMs: 0,
            avgTimelineItems: 0,
            withCitationsRate: 0
        };
        
        this.isInitialized = false;
        this.logger = null;
    }

    async initialize(logger) {
        try {
            this.logger = logger;
            this.logger.info(`${this.name} başlatılıyor...`);
            
            this.setupEventListeners();
            
            this.isInitialized = true;
            this.logger.info(`${this.name} başarıyla başlatıldı`);
            return true;
        } catch (error) {
            this.logger.error(`${this.name} hatası:`, error);
            return false;
        }
    }

    setupEventListeners() {
        // Incident başlangıcı
        eventBus.subscribeToEvent('incident.started', (event) => {
            this.handleIncidentStarted(event.data);
        }, 'incidentPostmortemWriter');
        
        // Incident kapanışı
        eventBus.subscribeToEvent('incident.closed', (event) => {
            this.handleIncidentClosed(event.data);
        }, 'incidentPostmortemWriter');
        
        // Manual postmortem isteği
        eventBus.subscribeToEvent('postmortem.manual.request', (event) => {
            this.handleManualRequest(event.data);
        }, 'incidentPostmortemWriter');
        
        // İlgili olayları buffer'a topla
        const relevantEvents = [
            'telemetry.anomaly.', 'guard.directive', 'policy.', 'decision.', 
            'approval.', 'operator.notes.', 'digest.daily.'
        ];
        
        relevantEvents.forEach(prefix => {
            eventBus.subscribeToEvent(prefix, (event) => {
                this.bufferRelatedEvent(event);
            }, 'incidentPostmortemWriter');
        });
    }

    handleIncidentStarted(data) {
        try {
            const incident = IncidentStartedSchema.parse(data);
            
            // Event buffer'ını başlat
            if (!this.eventBuffer.has(incident.id)) {
                this.eventBuffer.set(incident.id, {
                    startEvent: incident,
                    relatedEvents: [],
                    windowStart: new Date(incident.timestamp),
                    windowEnd: null
                });
            }
            
            this.logger.info(`Incident tracking started: ${incident.id}`);
            
        } catch (error) {
            this.logger.error('Incident started handle error:', error);
        }
    }

    handleIncidentClosed(data) {
        try {
            const incident = IncidentClosedSchema.parse(data);
            
            // Buffer'dan incident verisini al
            const incidentData = this.eventBuffer.get(incident.id);
            if (!incidentData) {
                this.emit('postmortem.alert', {
                    level: 'warn',
                    message: 'missing_incident',
                    context: { incidentId: incident.id }
                });
                return;
            }
            
            // Window'u kapat
            incidentData.closeEvent = incident;
            incidentData.windowEnd = new Date(incident.timestamp);
            
            // Postmortem üret
            this.generatePostmortem(incident.id, incidentData);
            
        } catch (error) {
            this.logger.error('Incident closed handle error:', error);
        }
    }

    handleManualRequest(data) {
        try {
            const { incidentId, draftVersion = 'v1' } = data;
            
            const incidentData = this.eventBuffer.get(incidentId);
            if (!incidentData || !incidentData.closeEvent) {
                this.emit('postmortem.alert', {
                    level: 'warn',
                    message: 'missing_incident',
                    context: { incidentId }
                });
                return;
            }
            
            // Manual version ile postmortem üret
            this.generatePostmortem(incidentId, incidentData, draftVersion);
            
        } catch (error) {
            this.logger.error('Manual postmortem request error:', error);
        }
    }

    bufferRelatedEvent(event) {
        const eventTime = new Date(event.data.timestamp);
        const windowHours = this.config.compose.timelineWindowHours;
        
        // Aktif incident'lar için relevantlık kontrolü
        for (const [incidentId, incidentData] of this.eventBuffer.entries()) {
            const windowStart = new Date(incidentData.windowStart.getTime() - (windowHours * 60 * 60 * 1000));
            const windowEnd = incidentData.windowEnd || 
                              new Date(incidentData.windowStart.getTime() + (windowHours * 60 * 60 * 1000));
            
            if (eventTime >= windowStart && eventTime <= windowEnd) {
                incidentData.relatedEvents.push(event.data);
            }
        }
    }

    async generatePostmortem(incidentId, incidentData, draftVersion = 'v1') {
        const startTime = Date.now();
        
        try {
            // İdempotency kontrolü
            const pmKey = `${incidentId}#${draftVersion}`;
            if (this.processedIncidents.has(pmKey)) {
                this.emit('postmortem.alert', {
                    level: 'info',
                    message: 'idem_duplicate',
                    context: { incidentId }
                });
                return;
            }
            
            // Timeline oluştur
            const timeline = this.timelineBuilder.buildTimeline(
                incidentData.startEvent,
                incidentData.closeEvent,
                incidentData.relatedEvents
            );
            
            // RCA analizi
            const rcaHypotheses = this.rcaComposer.composeRCA(
                incidentData.startEvent,
                incidentData.relatedEvents
            );
            
            // CAPA planı
            const capas = this.capaPlanner.planCAPAs(rcaHypotheses);
            
            // Markdown üret
            const markdown = this.generateMarkdown({
                incident: incidentData.startEvent,
                closure: incidentData.closeEvent,
                timeline,
                rcaHypotheses,
                capas,
                draftVersion
            });
            
            // Dosyaya yaz
            const outputPath = await this.writePostmortem(incidentId, markdown, draftVersion);
            
            // İdempotency işaretle
            this.processedIncidents.add(pmKey);
            
            // Events yayınla
            const composeTime = Date.now() - startTime;
            await this.emitPostmortemReady(incidentId, outputPath, markdown, composeTime, draftVersion);
            
            // Stats güncelle
            this.updateStats(composeTime, timeline.split('\n').length);
            
            // Buffer temizle (completed incident)
            this.eventBuffer.delete(incidentId);
            
        } catch (error) {
            this.logger.error('Postmortem generation error:', error);
            this.emit('postmortem.alert', {
                level: 'error',
                message: 'write_failed',
                context: { incidentId, error: error.message }
            });
        }
    }

    generateMarkdown(data) {
        const { incident, closure, timeline, rcaHypotheses, capas, draftVersion } = data;
        
        const localDate = new Date(incident.timestamp).toLocaleDateString('tr-TR');
        const startLocal = new Date(incident.timestamp).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' });
        const endLocal = new Date(closure.timestamp).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' });
        
        const sections = [];
        
        // Başlık
        sections.push(`# Postmortem — ${incident.id} (${incident.severity}) — ${localDate}`);
        sections.push('');
        sections.push(`**Başlık:** ${incident.title}`);
        sections.push(`**Özet:** ${this.generateSummary(incident, closure)}`);
        sections.push('');
        
        // Etki
        sections.push('## Etki');
        sections.push(`- Süre: ${closure.durationMin} dk (${startLocal} → ${endLocal})`);
        if (closure.impact) {
            sections.push(`- Etkilenen emir: ${closure.impact.ordersAffected}, kullanıcı: ${closure.impact.usersAffected}`);
            sections.push(`- PnL etkisi: $${closure.impact.pnlImpactUSD}`);
        }
        sections.push(`- Tespit: ${incident.detectedBy}`);
        sections.push('');
        
        // Timeline
        sections.push('## Zaman Çizelgesi');
        sections.push(timeline);
        sections.push('');
        
        // RCA
        sections.push('## Kök Neden Hipotezleri (RCA)');
        rcaHypotheses.forEach(rca => {
            sections.push(`- **${rca.bucket}** — ${rca.hypothesis} (kanıt: ${rca.evidence})`);
        });
        sections.push('');
        
        // CAPA
        sections.push('## Düzeltici/Önleyici Aksiyonlar (CAPA)');
        capas.forEach(capa => {
            sections.push(`- [ ] ${capa.action} — **Sorumlu:** ${capa.owner}, **Son tarih:** ${capa.due}`);
        });
        sections.push('');
        
        // Açık sorular
        sections.push('## Açık Sorular');
        sections.push('- Incident response time yeterli miydi?');
        sections.push('- Benzer durumları önleyecek ek guard'lar gerekli mi?');
        sections.push('- Monitoring coverage eksiklikleri var mı?');
        sections.push('');
        
        // Atıflar
        if (this.config.compose.includeCitations) {
            sections.push('## Atıflar');
            sections.push(`- Incident ID: ${incident.id}`);
            sections.push(`- Günlük Özet: data/digest/${localDate.split('.').reverse().join('-')}/Daily.md`);
            sections.push('');
        }
        
        return sections.join('\n');
    }

    generateSummary(incident, closure) {
        return `${incident.title}. ${closure.resolution}. Süre: ${closure.durationMin} dakika.` +
               (closure.impact ? ` Etki: ${closure.impact.ordersAffected} emir, ~$${closure.impact.pnlImpactUSD}.` : '');
    }

    async writePostmortem(incidentId, markdown, draftVersion) {
        const now = new Date();
        const yearMonth = now.toISOString().substring(0, 7); // YYYY-MM
        
        const dirPath = this.config.output.dir.replace('{YYYY-MM}', yearMonth);
        await this.ensureDirectory(dirPath);
        
        const fileName = `${incidentId}_${draftVersion}.md`;
        const filePath = path.join(dirPath, fileName);
        
        if (this.config.output.atomicWrite) {
            const tempPath = filePath + '.tmp';
            await fs.writeFile(tempPath, markdown, 'utf8');
            await fs.rename(tempPath, filePath);
        } else {
            await fs.writeFile(filePath, markdown, 'utf8');
        }
        
        return filePath;
    }

    async ensureDirectory(dirPath) {
        try {
            await fs.mkdir(dirPath, { recursive: true });
        } catch (error) {
            if (error.code !== 'EEXIST') {
                throw error;
            }
        }
    }

    async emitPostmortemReady(incidentId, pathMd, markdown, composeTime, draftVersion) {
        const summary = this.extractSummary(markdown);
        
        this.emit('postmortem.draft.ready', {
            incidentId,
            draftVersion,
            pathMd,
            pathHtml: pathMd.replace('.md', '.html'),
            summary,
            composeMs: composeTime,
            audit: {
                eventId: `pm-${Date.now()}`,
                producedBy: 'livia-18',
                producedAt: new Date().toISOString()
            }
        });
        
        // Assignment önerisi
        this.emit('postmortem.assign', {
            incidentId,
            assignee: 'ops',
            due: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
        });
    }

    extractSummary(markdown) {
        const lines = markdown.split('\n');
        const summaryLine = lines.find(line => line.startsWith('**Özet:**'));
        
        if (summaryLine) {
            return summaryLine.replace('**Özet:**', '').trim();
        }
        
        // Fallback: İlk paragrafın ilk cümlesi
        const firstParagraph = lines.find(line => line.trim() && !line.startsWith('#'));
        return firstParagraph?.substring(0, 200) + '...' || 'Postmortem hazır';
    }

    updateStats(composeTime, timelineItems) {
        this.stats.draftsGenerated++;
        this.stats.avgComposeMs = (this.stats.avgComposeMs + composeTime) / 2;
        this.stats.avgTimelineItems = (this.stats.avgTimelineItems + timelineItems) / 2;
        this.stats.withCitationsRate = this.config.compose.includeCitations ? 1.0 : 0.0;
    }

    emit(eventType, data) {
        eventBus.publishEvent(eventType, {
            timestamp: new Date().toISOString(),
            source: this.name,
            ...data
        }, 'incidentPostmortemWriter');
    }

    getStatus() {
        return {
            name: this.name,
            initialized: this.isInitialized,
            activeIncidents: this.eventBuffer.size,
            processedIncidents: this.processedIncidents.size,
            stats: this.stats
        };
    }

    async shutdown() {
        this.eventBuffer.clear();
        this.processedIncidents.clear();
        this.isInitialized = false;
        this.logger?.info(`${this.name} kapatıldı`);
    }
}

module.exports = {
    IncidentPostmortemWriter,
    incidentPostmortemWriter: new IncidentPostmortemWriter()
};