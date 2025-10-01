/**
 * LIVIA-13 · telemetryDailyDigest.js
 * Akıllı günlük özet sistemi - 24 saatlik operasyon verisini Markdown raporu olarak üretir
 */

const { z } = require('zod');
const fs = require('fs').promises;
const path = require('path');
const { eventBus } = require('../../kirpto bot sinyal/modules/modularEventStream');
const { logInfo, logError } = require('../../kirpto bot sinyal/logs/logger');

// 🎯 Smart Schemas - Sadece gerekli olanlar
const TelemetryEventSchema = z.object({
    event: z.string(),
    timestamp: z.string(),
    data: z.any()
});

const DigestRequestSchema = z.object({
    event: z.literal('digest.generate'),
    date: z.string().optional(), // YYYY-MM-DD, default: today
    force: z.boolean().default(false)
});

/**
 * 🚀 Smart Data Collector
 */
class SmartDataCollector {
    constructor() {
        this.data = {
            slo: [],
            guards: [],
            decisions: [],
            incidents: [],
            approvals: [],
            pnl: [],
            policy: [],
            ui: [],
            anomalies: []
        };
    }

    collect(events, windowStart, windowEnd) {
        this.data = {
            slo: [],
            guards: [],
            decisions: [],
            incidents: [],
            approvals: [],
            pnl: [],
            policy: [],
            ui: [],
            anomalies: []
        };

        events.forEach(event => {
            const eventTime = new Date(event.timestamp);
            if (eventTime >= windowStart && eventTime <= windowEnd) {
                this.categorizeEvent(event);
            }
        });

        return this.data;
    }

    categorizeEvent(event) {
        const type = event.event.split('.')[0];
        
        switch (type) {
            case 'telemetry':
                if (event.event.includes('slo')) {
                    this.data.slo.push(event);
                }
                break;
            case 'guard':
            case 'latency_slip':
                this.data.guards.push(event);
                break;
            case 'decision':
                this.data.decisions.push(event);
                break;
            case 'incident':
                this.data.incidents.push(event);
                break;
            case 'approval':
            case 'action':
                this.data.approvals.push(event);
                break;
            case 'pnl':
                this.data.pnl.push(event);
                break;
            case 'policy':
                this.data.policy.push(event);
                break;
            case 'uiBridge':
                this.data.ui.push(event);
                break;
            case 'anomaly':
                this.data.anomalies.push(event);
                break;
        }
    }
}

/**
 * 📊 Smart Report Generator
 */
class SmartReportGenerator {
    constructor(config) {
        this.config = config;
    }

    generateReport(data, date) {
        const sections = [];
        
        // Başlık
        sections.push(`# Günlük Özet — ${date} (Europe/Istanbul)\n`);
        
        // Öne çıkanlar
        const highlights = this.generateHighlights(data);
        sections.push('## Öne Çıkanlar');
        highlights.forEach(highlight => {
            sections.push(`- ${highlight}`);
        });
        sections.push('');
        
        // SLO & Guard
        sections.push('## SLO & Guard');
        sections.push(this.generateSloSection(data.slo, data.guards));
        sections.push('');
        
        // Kararlar & Onaylar
        sections.push('## Karar & Onay');
        sections.push(this.generateDecisionSection(data.decisions, data.approvals));
        sections.push('');
        
        // Olaylar
        if (data.incidents.length > 0) {
            sections.push('## Olaylar & Anomaliler');
            sections.push(this.generateIncidentSection(data.incidents, data.anomalies));
            sections.push('');
        }
        
        // PnL
        sections.push('## PnL Özeti');
        sections.push(this.generatePnlSection(data.pnl));
        sections.push('');
        
        // Politika
        if (data.policy.length > 0) {
            sections.push('## Politika Dağıtımı');
            sections.push(this.generatePolicySection(data.policy));
            sections.push('');
        }
        
        // UI Köprüsü
        if (data.ui.length > 0) {
            sections.push('## UI Köprüsü');
            sections.push(this.generateUiSection(data.ui));
            sections.push('');
        }
        
        return sections.join('\n');
    }

    generateHighlights(data) {
        const highlights = [];
        
        // SLO durumu
        const sloStatus = this.getSloStatus(data.slo);
        highlights.push(`SLO: ${sloStatus.overall} (${sloStatus.details})`);
        
        // Guard durumu
        const guardSummary = this.getGuardSummary(data.guards);
        if (guardSummary) {
            highlights.push(`Guard: ${guardSummary}`);
        }
        
        // PnL
        const pnlSummary = this.getPnlSummary(data.pnl);
        if (pnlSummary) {
            highlights.push(`PnL: ${pnlSummary}`);
        }
        
        // Kararlar
        const decisionSummary = this.getDecisionSummary(data.decisions);
        if (decisionSummary) {
            highlights.push(`Kararlar: ${decisionSummary}`);
        }
        
        // İncidentlar
        if (data.incidents.length > 0) {
            highlights.push(`Incidents: ${data.incidents.length} (toplam ${this.getTotalIncidentDuration(data.incidents)} dk)`);
        }
        
        return highlights;
    }

    getSloStatus(sloEvents) {
        if (sloEvents.length === 0) {
            return { overall: 'Veri yok', details: 'SLO verisi bulunamadı' };
        }
        
        const latest = sloEvents[sloEvents.length - 1];
        const state = latest.state || 'unknown';
        const burnPct = latest.burnPct ? `burn ${latest.burnPct}%` : '';
        
        return {
            overall: state === 'ok' ? '✅ OK' : state === 'at_risk' ? '⚠️ Risk' : '❌ İhlal',
            details: burnPct
        };
    }

    getGuardSummary(guardEvents) {
        const modes = {};
        guardEvents.forEach(event => {
            const mode = event.mode || 'normal';
            modes[mode] = (modes[mode] || 0) + 1;
        });
        
        const parts = [];
        if (modes.slowdown) parts.push(`slowdown ×${modes.slowdown}`);
        if (modes.block_aggressive) parts.push(`block ×${modes.block_aggressive}`);
        if (modes.halt_entry) parts.push(`halt ×${modes.halt_entry}`);
        
        return parts.length > 0 ? parts.join(', ') : null;
    }

    getPnlSummary(pnlEvents) {
        if (pnlEvents.length === 0) return null;
        
        const latest = pnlEvents[pnlEvents.length - 1];
        const netUSD = latest.netUSD || 0;
        const topSymbol = latest.bySymbol ? latest.bySymbol[0] : null;
        
        let summary = `Net $${netUSD.toFixed(1)}`;
        if (topSymbol) {
            summary += ` (En iyi: ${topSymbol.symbol} $${topSymbol.netUSD.toFixed(1)})`;
        }
        
        return summary;
    }

    getDecisionSummary(decisionEvents) {
        if (decisionEvents.length === 0) return null;
        
        const accepted = decisionEvents.filter(e => e.accepted === true).length;
        const rejected = decisionEvents.filter(e => e.accepted === false).length;
        
        return `${accepted} kabul / ${rejected} red`;
    }

    getTotalIncidentDuration(incidentEvents) {
        let totalMinutes = 0;
        incidentEvents.forEach(event => {
            if (event.event === 'incident.closed' && event.durationMin) {
                totalMinutes += event.durationMin;
            }
        });
        return totalMinutes;
    }

    generateSloSection(sloEvents, guardEvents) {
        const lines = [];
        
        if (sloEvents.length > 0) {
            const latest = sloEvents[sloEvents.length - 1];
            lines.push(`- ${latest.slo}: ${latest.state} | burn: ${latest.burnPct || 0}%`);
        } else {
            lines.push('- SLO verisi mevcut değil');
        }
        
        if (guardEvents.length > 0) {
            const guardCount = guardEvents.length;
            lines.push(`- Guard aktivasyonu: ${guardCount} kez`);
        }
        
        return lines.join('\n');
    }

    generateDecisionSection(decisionEvents, approvalEvents) {
        const lines = [];
        
        const accepted = decisionEvents.filter(e => e.accepted === true).length;
        const rejected = decisionEvents.filter(e => e.accepted === false).length;
        lines.push(`- Kararlar: ${accepted} kabul, ${rejected} red`);
        
        const pending = approvalEvents.filter(e => e.event === 'approval.pending').length;
        const approved = approvalEvents.filter(e => e.event === 'action.approved').length;
        lines.push(`- Onaylar: ${approved} onaylandı, ${pending} beklemede`);
        
        // En çok işlem gören sembol
        const symbols = {};
        decisionEvents.forEach(event => {
            if (event.details && event.details.finalPlan && event.details.finalPlan.symbol) {
                const symbol = event.details.finalPlan.symbol;
                symbols[symbol] = (symbols[symbol] || 0) + 1;
            }
        });
        
        const topSymbol = Object.entries(symbols).sort((a, b) => b[1] - a[1])[0];
        if (topSymbol) {
            lines.push(`- En aktif: ${topSymbol[0]} (${topSymbol[1]} karar)`);
        }
        
        return lines.join('\n');
    }

    generateIncidentSection(incidentEvents, anomalyEvents) {
        const lines = [];
        
        const openIncidents = incidentEvents.filter(e => e.event === 'incident.started');
        const closedIncidents = incidentEvents.filter(e => e.event === 'incident.closed');
        
        lines.push(`- Incidents: ${openIncidents.length} başladı, ${closedIncidents.length} kapandı`);
        
        const totalDuration = this.getTotalIncidentDuration(incidentEvents);
        if (totalDuration > 0) {
            lines.push(`- Toplam süre: ${totalDuration} dakika`);
        }
        
        if (anomalyEvents.length > 0) {
            lines.push(`- Anomaliler: ${anomalyEvents.length} tespit`);
            anomalyEvents.slice(0, 3).forEach(anomaly => {
                lines.push(`  - ${anomaly.title || 'Bilinmeyen anomali'}`);
            });
        }
        
        return lines.join('\n');
    }

    generatePnlSection(pnlEvents) {
        if (pnlEvents.length === 0) {
            return '- PnL verisi mevcut değil';
        }
        
        const lines = [];
        const latest = pnlEvents[pnlEvents.length - 1];
        
        lines.push(`- Net: $${(latest.netUSD || 0).toFixed(2)}`);
        lines.push(`- Gross: $${(latest.grossUSD || 0).toFixed(2)}`);
        lines.push(`- Fees: $${(latest.feesUSD || 0).toFixed(2)}`);
        
        if (latest.bySymbol && latest.bySymbol.length > 0) {
            lines.push('- En iyi 3:');
            latest.bySymbol.slice(0, 3).forEach(item => {
                lines.push(`  - ${item.symbol}: $${item.netUSD.toFixed(2)}`);
            });
        }
        
        return lines.join('\n');
    }

    generatePolicySection(policyEvents) {
        const lines = [];
        
        if (policyEvents.length > 0) {
            const latest = policyEvents[policyEvents.length - 1];
            lines.push(`- Aktif: ${latest.activeVersion} (${latest.stage} ${latest.percent}%)`);
            
            const updates = policyEvents.filter(e => e.updates).reduce((sum, e) => sum + e.updates, 0);
            const rollbacks = policyEvents.filter(e => e.rollbacks).reduce((sum, e) => sum + e.rollbacks, 0);
            
            if (updates > 0) lines.push(`- Güncellemeler: ${updates}`);
            if (rollbacks > 0) lines.push(`- Rollback'ler: ${rollbacks}`);
        }
        
        return lines.join('\n');
    }

    generateUiSection(uiEvents) {
        const lines = [];
        
        if (uiEvents.length > 0) {
            const latest = uiEvents[uiEvents.length - 1];
            const dropRate = latest.dropped / (latest.delivered || 1);
            
            lines.push(`- Bağlantılar: ${latest.connections || 0}`);
            lines.push(`- Mesajlar: ${latest.delivered || 0} iletildi, ${latest.acked || 0} onaylandı`);
            lines.push(`- Drop oranı: ${(dropRate * 100).toFixed(1)}%`);
            lines.push(`- Ortalama gecikme: ${latest.avgLatencyMs || 0}ms`);
        }
        
        return lines.join('\n');
    }
}

/**
 * 🎯 LIVIA-13 Smart Daily Digest
 */
class TelemetryDailyDigest {
    constructor(config = {}) {
        this.name = 'TelemetryDailyDigest';
        this.config = {
            schedule: { runAt: '18:00', graceMin: 10 },
            outputDir: 'data/digest',
            lookbackHours: 24,
            timezone: 'Europe/Istanbul',
            idempotencyTtlSec: 86400,
            ...config
        };
        
        this.eventStore = []; // Son 48 saatlik eventi tutar
        this.processedDates = new Set(); // İdempotency için
        this.collector = new SmartDataCollector();
        this.generator = new SmartReportGenerator(this.config);
        this.stats = { runs: 0, avgComposeMs: 0, errors: 0 };
        
        this.isInitialized = false;
        this.logger = null;
    }

    async initialize(logger) {
        try {
            this.logger = logger;
            this.logger.info(`${this.name} başlatılıyor...`);
            
            await this.ensureDirectories();
            this.setupEventListeners();
            this.startScheduler();
            
            this.isInitialized = true;
            this.logger.info(`${this.name} başarıyla başlatıldı`);
            return true;
        } catch (error) {
            this.logger.error(`${this.name} hatası:`, error);
            return false;
        }
    }

    async ensureDirectories() {
        try {
            await fs.mkdir(this.config.outputDir, { recursive: true });
        } catch (error) {
            if (error.code !== 'EEXIST') {
                throw error;
            }
        }
    }

    setupEventListeners() {
        // Manuel özet isteği
        eventBus.subscribeToEvent('digest.generate', (event) => {
            this.handleDigestRequest(event.data);
        }, 'telemetryDailyDigest');
        
        // Tüm telemetri eventlerini dinle
        const relevantEvents = [
            'telemetry.', 'guard.', 'decision.', 'incident.', 'approval.', 
            'action.', 'pnl.', 'policy.', 'uiBridge.', 'anomaly.'
        ];
        
        relevantEvents.forEach(prefix => {
            eventBus.subscribeToEvent(prefix, (event) => {
                this.storeEvent(event);
            }, 'telemetryDailyDigest');
        });
    }

    storeEvent(event) {
        this.eventStore.push({
            ...event.data,
            storedAt: Date.now()
        });
        
        // 48 saatlik sınır
        const cutoff = Date.now() - (48 * 60 * 60 * 1000);
        this.eventStore = this.eventStore.filter(e => e.storedAt > cutoff);
    }

    startScheduler() {
        // Her 10 dakikada bir kontrol et (gerçek uygulamada cron kullanılır)
        setInterval(() => {
            this.checkSchedule();
        }, 600000);
    }

    checkSchedule() {
        const now = new Date();
        const istanbulTime = new Intl.DateTimeFormat('tr-TR', {
            timeZone: 'Europe/Istanbul',
            hour: '2-digit',
            minute: '2-digit'
        }).format(now);
        
        // 18:00 - 18:10 arası otomatik çalıştır
        if (istanbulTime >= '18:00' && istanbulTime <= '18:10') {
            const today = now.toISOString().split('T')[0];
            if (!this.processedDates.has(today)) {
                this.generateDigest(today, false);
            }
        }
    }

    async handleDigestRequest(data) {
        try {
            const request = DigestRequestSchema.parse(data);
            const date = request.date || new Date().toISOString().split('T')[0];
            
            await this.generateDigest(date, request.force);
            
        } catch (error) {
            this.logger.error('Digest request error:', error);
            this.emit('digest.error', { error: error.message });
        }
    }

    async generateDigest(date, force = false) {
        const startTime = Date.now();
        
        try {
            // İdempotency kontrol
            if (!force && this.processedDates.has(date)) {
                this.emit('digest.alert', { 
                    level: 'info', 
                    message: 'idem_duplicate',
                    context: { date }
                });
                return;
            }
            
            // Zaman penceresi
            const windowStart = new Date(`${date}T00:00:00.000Z`);
            const windowEnd = new Date(`${date}T23:59:59.999Z`);
            
            // Veri toplama
            const collectedData = this.collector.collect(this.eventStore, windowStart, windowEnd);
            
            // Rapor üretme
            const report = this.generator.generateReport(collectedData, date);
            
            // Dosyaya yazma
            await this.writeReport(date, report);
            
            // İdempotency işaretleme
            this.processedDates.add(date);
            
            // Event yayınlama
            const composeTime = Date.now() - startTime;
            await this.emitSuccess(date, report, composeTime);
            
            // Stats güncelleme
            this.stats.runs++;
            this.stats.avgComposeMs = (this.stats.avgComposeMs + composeTime) / 2;
            
        } catch (error) {
            this.logger.error('Digest generation error:', error);
            this.stats.errors++;
            this.emit('digest.error', { error: error.message, date });
        }
    }

    async writeReport(date, report) {
        const dateDir = path.join(this.config.outputDir, date);
        await fs.mkdir(dateDir, { recursive: true });
        
        const filePath = path.join(dateDir, 'Daily.md');
        await fs.writeFile(filePath, report, 'utf8');
        
        return filePath;
    }

    async emitSuccess(date, report, composeTime) {
        const highlights = this.extractHighlights(report);
        
        this.emit('digest.daily.ready', {
            digestKey: date,
            format: 'md',
            path: path.join(this.config.outputDir, date, 'Daily.md'),
            highlights,
            composeMs: composeTime,
            audit: {
                eventId: `digest-${Date.now()}`,
                producedBy: 'livia-13',
                producedAt: new Date().toISOString()
            }
        });
        
        // Kısa kart
        this.emit('digest.card', {
            title: `Günlük Özet Hazır (${date})`,
            body: highlights.slice(0, 3).join(' | '),
            severity: 'info',
            ttlSec: 600,
            links: [{ label: 'Aç', href: `app://digest/${date}` }]
        });
    }

    extractHighlights(report) {
        const lines = report.split('\n');
        const highlightSection = lines.findIndex(line => line.includes('## Öne Çıkanlar'));
        
        if (highlightSection === -1) return [];
        
        const highlights = [];
        for (let i = highlightSection + 1; i < lines.length; i++) {
            const line = lines[i].trim();
            if (line.startsWith('- ')) {
                highlights.push(line.substring(2));
            } else if (line.startsWith('##')) {
                break;
            }
        }
        
        return highlights;
    }

    emit(eventType, data) {
        eventBus.publishEvent(eventType, {
            timestamp: new Date().toISOString(),
            source: this.name,
            ...data
        }, 'telemetryDailyDigest');
    }

    getStatus() {
        return {
            name: this.name,
            initialized: this.isInitialized,
            eventStoreSize: this.eventStore.length,
            processedDates: this.processedDates.size,
            stats: this.stats
        };
    }

    async shutdown() {
        this.eventStore = [];
        this.processedDates.clear();
        this.isInitialized = false;
        this.logger?.info(`${this.name} kapatıldı`);
    }
}

module.exports = {
    TelemetryDailyDigest,
    telemetryDailyDigest: new TelemetryDailyDigest()
};