/**
 * LIVIA-57: Evidence Attribution Verifier
 * Kanıt doğrulama ve atıf teyit sistemi
 * Amaç: Üretilen yanıtların tüm iddialarının atıf verilen kanıtlarla desteklendiğini doğrulama
 */

const crypto = require('crypto');
const { EventEmitter } = require('events');
const { trace, context, SpanStatusCode } = require('@opentelemetry/api');

class EvidenceAttributionVerifier extends EventEmitter {
    constructor(config = {}) {
        super();
        
        this.name = 'EvidenceAttributionVerifier';
        this.config = {
            enabled: true,
            locale: 'tr-TR',
            timezone: 'Europe/Istanbul',
            claims: {
                segmenter: { mode: 'sentence+clause', maxLen: 280 },
                types: ['numeric', 'temporal', 'comparative', 'categorical', 'quote'],
                minConfidence: 0.65
            },
            alignment: {
                search: 'bm25+vec',
                topK: 8,
                windowChars: 180,
                fuzzy: { charWindow: 6, allowSynonym: true, trAccentAware: true },
                multiDocCombine: 'best_first_then_merge'
            },
            nli: {
                model: 'entail-mini-v2',
                thresholds: { entailed: 0.7, contradict: 0.6 },
                contradictionWins: true
            },
            numeric: {
                method: 'digit_by_digit',
                tolerance: { pctAbs: 0.2, pctRel: 2.0, moneyAbs: 0.01 },
                thousandSepAware: true,
                percentSymbols: ['%', 'pct'],
                dateNorm: 'YYYY-MM-DD'
            },
            coverage: {
                minPct: 70,
                targetPct: 85,
                requireFor: ['stats', 'dates', 'medical', 'legal', 'finance']
            },
            freshness: {
                preferRecent: true,
                stalenessWarnDays: 30
            },
            patch: {
                autoApplyWhen: { coverageBelow: 70, contradictionNone: true },
                addHovercards: true,
                footnoteStyle: '[^n]'
            },
            dq: {
                minQuality: 'medium',
                allowStaleIfNoAlternative: false
            },
            idempotencyTtlSec: 1800,
            ...config
        };
        
        // State management
        this.state = 'IDLE';
        this.activeVerifications = new Map(); // Active verification sessions
        this.documentCache = new Map(); // Cached document chunks
        this.claimsExtractor = null;
        this.metrics = {
            answers: 0,
            avgCoveragePct: 0,
            contradictions: 0,
            avgNLI: { entailed: 0, neutral: 0, contradict: 0 },
            numericOkPct: 100,
            patchesSuggested: 0,
            patchesAutoApplied: 0,
            avgVerifyMs: 0,
            p95VerifyMs: 0
        };
        
        this.isInitialized = false;
        this.logger = null;
        this.tracer = trace.getTracer('livia-evidence-attribution-verifier');
        
        // FSM states
        this.states = ['IDLE', 'EXTRACT', 'ALIGN', 'NLI', 'NUMERIC', 'COVERAGE', 'PATCH', 'REPORT', 'DONE', 'ALERT'];
    }

    async initialize(eventBus, logger) {
        try {
            this.eventBus = eventBus;
            this.logger = logger;
            this.logger.info(`${this.name} başlatılıyor...`);
            
            // Event listeners
            this.setupEventListeners();
            
            // Initialize claims extractor
            this.initializeClaimsExtractor();
            
            this.isInitialized = true;
            this.logger.info(`${this.name} başarıyla başlatıldı`);
            return true;
        } catch (error) {
            this.logger.error(`${this.name} başlatma hatası:`, error);
            return false;
        }
    }

    setupEventListeners() {
        // Query result verification
        this.eventBus.on('query.result.ready', this.handleQueryResult.bind(this));
        
        // Supporting data
        this.eventBus.on('qo.trace.ready', this.handleTraceReady.bind(this));
        this.eventBus.on('retrieval.docs.snapshot', this.handleDocsSnapshot.bind(this));
        this.eventBus.on('qo.claims.extracted', this.handlePreExtractedClaims.bind(this));
        this.eventBus.on('dq.snapshot', this.handleDataQualitySnapshot.bind(this));
        
        // Configuration updates
        this.eventBus.on('pii.lexicon.updated', this.handlePIILexiconUpdate.bind(this));
    }

    initializeClaimsExtractor() {
        // Initialize internal claims extraction capabilities
        this.claimsExtractor = {
            patterns: {
                numeric: /\b\d+([,.]\d+)?%?\b/g,
                temporal: /\b\d{1,2}\/\d{1,2}\/\d{4}\b|\b\d{4}-\d{2}-\d{2}\b/g,
                comparative: /\b(artış|düşüş|yükseliş|azalış|fazla|az|büyük|küçük)\b/gi
            }
        };
    }

    async handleQueryResult(event) {
        const span = this.tracer.startSpan('evidence.verification');
        const startTime = Date.now();
        
        try {
            const { id: queryId, answerMd, citations, hash } = event;
            
            // Generate idempotency key
            const evKey = this.generateEvidenceKey(event);
            
            // Idempotency check
            if (this.activeVerifications.has(evKey)) {
                const cachedResult = this.activeVerifications.get(evKey);
                span.setStatus({ code: SpanStatusCode.OK });
                span.end();
                return cachedResult;
            }
            
            // Initialize verification context
            const verificationContext = {
                queryId,
                evKey,
                answerMd,
                citations,
                hash,
                startTime,
                state: 'EXTRACT',
                claims: [],
                documents: [],
                alignments: [],
                nliResults: [],
                numericChecks: [],
                contradictions: [],
                patchSuggestions: []
            };
            
            this.activeVerifications.set(evKey, verificationContext);
            
            // Start verification pipeline
            const result = await this.runVerificationPipeline(verificationContext, span);
            
            // Cache result
            this.scheduleCache(evKey, this.config.idempotencyTtlSec);
            
            // Update metrics
            this.updateMetrics(verificationContext, startTime);
            
            span.setStatus({ code: SpanStatusCode.OK });
            span.end();
            
            return result;
            
        } catch (error) {
            span.recordException(error);
            span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
            span.end();
            
            this.emit('evidence.alert', {
                event: 'evidence.alert',
                timestamp: new Date().toISOString(),
                level: 'error',
                message: error.message,
                queryId: event.id
            });
            
            throw error;
        }
    }

    async runVerificationPipeline(context, span) {
        const { queryId } = context;
        
        try {
            // Extract claims
            await this.extractClaims(context, span);
            
            // Align claims with documents
            await this.alignClaims(context, span);
            
            // Run NLI verification
            await this.runNLIVerification(context, span);
            
            // Verify numeric claims
            await this.verifyNumericClaims(context, span);
            
            // Calculate coverage
            await this.calculateCoverage(context, span);
            
            // Generate patches
            await this.generatePatches(context, span);
            
            // Generate report and emit results
            const result = await this.generateReport(context, span);
            
            return result;
            
        } catch (error) {
            this.logger.error(`Verification pipeline error for ${queryId}:`, error);
            throw error;
        } finally {
            this.activeVerifications.delete(context.evKey);
        }
    }

    async extractClaims(context, span) {
        const extractSpan = this.tracer.startSpan('evidence.claims.extract', { parent: span });
        
        try {
            const { answerMd } = context;
            context.state = 'EXTRACT';
            
            // Extract claims from answer
            const claims = await this.performClaimsExtraction(answerMd);
            context.claims = claims;
            
            this.logger.debug(`Extracted ${claims.length} claims from answer`);
            
            extractSpan.setStatus({ code: SpanStatusCode.OK });
            
        } catch (error) {
            extractSpan.recordException(error);
            extractSpan.setStatus({ code: SpanStatusCode.ERROR });
            throw error;
        } finally {
            extractSpan.end();
        }
    }

    async performClaimsExtraction(answerMd) {
        const claims = [];
        let claimIdx = 0;
        
        // Split into sentences
        const sentences = answerMd.split(/[.!?]+/).filter(s => s.trim().length > 10);
        
        for (const sentence of sentences) {
            const trimmedSentence = sentence.trim();
            
            // Check for different claim types
            const claimTypes = this.classifyClaimType(trimmedSentence);
            
            for (const type of claimTypes) {
                claims.push({
                    idx: claimIdx++,
                    text: trimmedSentence,
                    type: type.type,
                    unit: type.unit,
                    value: type.value,
                    answerSpan: { start: answerMd.indexOf(trimmedSentence), end: answerMd.indexOf(trimmedSentence) + trimmedSentence.length },
                    confidence: type.confidence || 0.8
                });
                
                if (type.type === 'numeric') break; // One numeric claim per sentence
            }
        }
        
        return claims;
    }

    classifyClaimType(sentence) {
        const types = [];
        const lowerSentence = sentence.toLowerCase();
        
        // Numeric claims
        const numericMatches = sentence.match(this.claimsExtractor.patterns.numeric);
        if (numericMatches) {
            for (const match of numericMatches) {
                const isPercent = match.includes('%') || sentence.includes('yüzde');
                types.push({
                    type: 'numeric',
                    unit: isPercent ? 'pct' : 'number',
                    value: parseFloat(match.replace(/[,%]/g, '.')),
                    confidence: 0.9
                });
            }
        }
        
        // Temporal claims
        if (this.claimsExtractor.patterns.temporal.test(sentence)) {
            types.push({ type: 'temporal', confidence: 0.8 });
        }
        
        // Comparative claims
        if (this.claimsExtractor.patterns.comparative.test(sentence)) {
            types.push({ type: 'comparative', confidence: 0.7 });
        }
        
        // Default to categorical if no specific type found
        if (types.length === 0) {
            types.push({ type: 'categorical', confidence: 0.6 });
        }
        
        return types;
    }

    async alignClaims(context, span) {
        const alignSpan = this.tracer.startSpan('evidence.claims.align', { parent: span });
        
        try {
            context.state = 'ALIGN';
            
            const { claims, citations } = context;
            const alignments = [];
            
            // Get document chunks from citations
            const documents = await this.getDocumentsFromCitations(citations);
            context.documents = documents;
            
            // Align each claim with document spans
            for (const claim of claims) {
                const claimAlignments = await this.alignClaimWithDocuments(claim, documents);
                alignments.push(...claimAlignments);
            }
            
            context.alignments = alignments;
            
            alignSpan.setStatus({ code: SpanStatusCode.OK });
            
        } catch (error) {
            alignSpan.recordException(error);
            alignSpan.setStatus({ code: SpanStatusCode.ERROR });
            throw error;
        } finally {
            alignSpan.end();
        }
    }

    async getDocumentsFromCitations(citations) {
        const documents = [];
        
        for (const citation of citations) {
            // Parse citation format: "doc#1#p3:45-88"
            const parts = citation.split('#');
            if (parts.length >= 3) {
                const docId = `${parts[0]}#${parts[1]}`;
                const pageSpan = parts[2];
                
                // Mock document retrieval
                const doc = {
                    id: docId,
                    title: `Document ${parts[1]}`,
                    chunk: {
                        start: 0,
                        end: 200,
                        text: `Mock document content for ${docId} with relevant information about the topic.`,
                        hash: crypto.createHash('sha256').update(`${docId}-content`).digest('hex')
                    }
                };
                
                documents.push(doc);
            }
        }
        
        return documents;
    }

    async alignClaimWithDocuments(claim, documents) {
        const alignments = [];
        
        for (const doc of documents) {
            // Simple keyword-based alignment (in production, would use vector similarity)
            const alignmentScore = this.calculateAlignmentScore(claim.text, doc.chunk.text);
            
            if (alignmentScore > 0.3) {
                alignments.push({
                    claimIdx: claim.idx,
                    docId: doc.id,
                    docHash: doc.chunk.hash,
                    supportSpan: {
                        start: 0,
                        end: Math.min(100, doc.chunk.text.length)
                    },
                    score: alignmentScore
                });
            }
        }
        
        return alignments;
    }

    calculateAlignmentScore(claimText, docText) {
        // Simple word overlap scoring
        const claimWords = claimText.toLowerCase().split(/\s+/);
        const docWords = docText.toLowerCase().split(/\s+/);
        
        const overlap = claimWords.filter(word => docWords.includes(word)).length;
        return overlap / Math.max(claimWords.length, 1);
    }

    async runNLIVerification(context, span) {
        const nliSpan = this.tracer.startSpan('evidence.nli.verify', { parent: span });
        
        try {
            context.state = 'NLI';
            
            const { claims, alignments } = context;
            const nliResults = [];
            
            // Run NLI for each claim-document alignment
            for (const alignment of alignments) {
                const claim = claims.find(c => c.idx === alignment.claimIdx);
                if (claim) {
                    const nliResult = await this.performNLI(claim, alignment);
                    nliResults.push(nliResult);
                }
            }
            
            context.nliResults = nliResults;
            
            // Check for contradictions
            context.contradictions = this.findContradictions(nliResults);
            
            nliSpan.setStatus({ code: SpanStatusCode.OK });
            
        } catch (error) {
            nliSpan.recordException(error);
            nliSpan.setStatus({ code: SpanStatusCode.ERROR });
            throw error;
        } finally {
            nliSpan.end();
        }
    }

    async performNLI(claim, alignment) {
        // Mock NLI implementation
        const score = Math.random(); // In production, would call NLI model
        
        let status;
        if (score >= this.config.nli.thresholds.entailed) {
            status = 'entailed';
        } else if (score >= this.config.nli.thresholds.contradict) {
            status = 'contradict';
        } else {
            status = 'neutral';
        }
        
        return {
            claimIdx: claim.idx,
            docId: alignment.docId,
            supportSpan: alignment.supportSpan,
            status,
            score
        };
    }

    findContradictions(nliResults) {
        const contradictions = [];
        
        for (const result of nliResults) {
            if (result.status === 'contradict') {
                contradictions.push({
                    claimIdx: result.claimIdx,
                    doc: result.docId,
                    note: `Document ${result.docId} contradicts claim ${result.claimIdx}`
                });
            }
        }
        
        return contradictions;
    }

    async verifyNumericClaims(context, span) {
        const numericSpan = this.tracer.startSpan('evidence.numeric.verify', { parent: span });
        
        try {
            context.state = 'NUMERIC';
            
            const { claims } = context;
            const numericChecks = [];
            
            // Verify numeric claims
            for (const claim of claims) {
                if (claim.type === 'numeric' && claim.value !== undefined) {
                    const check = await this.verifyNumericClaim(claim);
                    numericChecks.push(check);
                }
            }
            
            context.numericChecks = numericChecks;
            
            numericSpan.setStatus({ code: SpanStatusCode.OK });
            
        } catch (error) {
            numericSpan.recordException(error);
            numericSpan.setStatus({ code: SpanStatusCode.ERROR });
            throw error;
        } finally {
            numericSpan.end();
        }
    }

    async verifyNumericClaim(claim) {
        // Mock numeric verification
        const tolerance = this.config.numeric.tolerance;
        
        // Simulate finding the value in documents
        const documentValue = claim.value + (Math.random() - 0.5) * 0.2; // Small variation
        
        let ok = false;
        if (claim.unit === 'pct') {
            ok = Math.abs(claim.value - documentValue) <= tolerance.pctAbs;
        } else {
            const relativeError = Math.abs((claim.value - documentValue) / claim.value);
            ok = relativeError <= (tolerance.pctRel / 100);
        }
        
        return {
            claimIdx: claim.idx,
            ok,
            method: this.config.numeric.method,
            tolerance: tolerance.pctAbs || tolerance.pctRel,
            claimValue: claim.value,
            documentValue
        };
    }

    async calculateCoverage(context, span) {
        const coverageSpan = this.tracer.startSpan('evidence.coverage.calculate', { parent: span });
        
        try {
            context.state = 'COVERAGE';
            
            const { claims, nliResults } = context;
            
            // Calculate coverage percentage
            const entailedClaims = nliResults.filter(r => r.status === 'entailed').length;
            const coveragePct = claims.length > 0 ? (entailedClaims / claims.length) * 100 : 0;
            
            // Determine status
            let status;
            if (coveragePct >= this.config.coverage.targetPct) {
                status = 'grounded';
            } else if (coveragePct >= this.config.coverage.minPct) {
                status = 'at_risk';
            } else {
                status = 'ungrounded';
            }
            
            context.coveragePct = coveragePct;
            context.status = status;
            
            coverageSpan.setStatus({ code: SpanStatusCode.OK });
            
        } catch (error) {
            coverageSpan.recordException(error);
            coverageSpan.setStatus({ code: SpanStatusCode.ERROR });
            throw error;
        } finally {
            coverageSpan.end();
        }
    }

    async generatePatches(context, span) {
        const patchSpan = this.tracer.startSpan('evidence.patches.generate', { parent: span });
        
        try {
            context.state = 'PATCH';
            
            const patches = [];
            
            // Generate patch suggestions based on coverage and contradictions
            if (context.coveragePct < this.config.coverage.minPct) {
                patches.push({
                    type: 'add_citation',
                    reason: 'kapsam artır',
                    claimIdx: 0, // Would be more specific in production
                    doc: 'doc#suggested',
                    priority: 'high'
                });
            }
            
            if (context.contradictions.length > 0) {
                patches.push({
                    type: 'hedge_language',
                    reason: 'çelişki azalt',
                    claimIdx: context.contradictions[0].claimIdx,
                    suggestion: 'Bazı kaynaklara göre',
                    priority: 'medium'
                });
            }
            
            context.patchSuggestions = patches;
            
            patchSpan.setStatus({ code: SpanStatusCode.OK });
            
        } catch (error) {
            patchSpan.recordException(error);
            patchSpan.setStatus({ code: SpanStatusCode.ERROR });
            throw error;
        } finally {
            patchSpan.end();
        }
    }

    async generateReport(context, span) {
        const reportSpan = this.tracer.startSpan('evidence.report.generate', { parent: span });
        
        try {
            context.state = 'REPORT';
            
            const { queryId, claims, nliResults, numericChecks, contradictions, patchSuggestions, coveragePct, status } = context;
            
            // Create validation result
            const validationResult = {
                id: queryId,
                coveragePct: Math.round(coveragePct),
                claims: nliResults,
                contradictions,
                numericChecks,
                risk: {
                    hallucination: Math.max(0, (100 - coveragePct) / 100 * 0.8),
                    contradiction: contradictions.length * 0.1,
                    staleness: 0.2 // Mock staleness
                },
                status
            };
            
            // Emit validation ready
            this.emit('evidence.validation.ready', {
                event: 'evidence.validation.ready',
                timestamp: new Date().toISOString(),
                ...validationResult
            });
            
            // Emit patch suggestions if any
            if (patchSuggestions.length > 0) {
                this.emit('evidence.patch.suggestion', {
                    event: 'evidence.patch.suggestion',
                    timestamp: new Date().toISOString(),
                    id: queryId,
                    actions: patchSuggestions
                });
            }
            
            // Generate highlight map
            this.emit('evidence.highlight.map', {
                event: 'evidence.highlight.map',
                timestamp: new Date().toISOString(),
                id: queryId,
                answerSpans: claims.map((claim, idx) => ({
                    idx,
                    answer: claim.answerSpan,
                    doc: `doc#${idx + 1}`,
                    docSpan: { start: 0, end: 50 }
                })),
                style: 'inline_footnote'
            });
            
            // Generate report
            const reportPath = `data/evidence/${new Date().toISOString().split('T')[0]}/${queryId}/report.md`;
            const summary = `${Math.round(coveragePct)}% kapsam, ${numericChecks.filter(c => c.ok).length} sayısal iddia doğrulandı, ${contradictions.length} çelişki; ${patchSuggestions.length} güncelleme önerildi.`;
            
            this.emit('evidence.report.ready', {
                event: 'evidence.report.ready',
                timestamp: new Date().toISOString(),
                path: reportPath,
                summary,
                hash: crypto.createHash('sha256').update(JSON.stringify(validationResult)).digest('hex')
            });
            
            // Emit card and metrics
            this.emitCard(queryId, coveragePct, status, patchSuggestions.length);
            this.emitMetrics();
            
            reportSpan.setStatus({ code: SpanStatusCode.OK });
            return validationResult;
            
        } catch (error) {
            reportSpan.recordException(error);
            reportSpan.setStatus({ code: SpanStatusCode.ERROR });
            throw error;
        } finally {
            reportSpan.end();
        }
    }

    // Event handlers
    handleTraceReady(event) {
        // Store trace information for verification context
        this.logger.debug(`Trace ready for ${event.id}: ${event.spans?.length} spans`);
    }

    handleDocsSnapshot(event) {
        // Cache document snapshots
        const { docs } = event;
        for (const doc of docs) {
            this.documentCache.set(doc.id, doc);
        }
    }

    handlePreExtractedClaims(event) {
        // Use pre-extracted claims if available
        this.logger.debug(`Pre-extracted claims available for ${event.id}: ${event.claims?.length} claims`);
    }

    handleDataQualitySnapshot(event) {
        // Consider data quality in verification
        const { sources } = event;
        this.logger.debug(`DQ snapshot: ${sources?.length} sources evaluated`);
    }

    handlePIILexiconUpdate(event) {
        // Update PII patterns for document processing
        this.logger.info('PII lexicon updated, refreshing document processing rules');
    }

    // Utility methods
    generateEvidenceKey(event) {
        const keyData = {
            answerHash: event.hash,
            citationsHash: crypto.createHash('md5').update(JSON.stringify(event.citations)).digest('hex'),
            timestamp: Math.floor(Date.now() / (this.config.idempotencyTtlSec * 1000))
        };
        return crypto.createHash('sha256').update(JSON.stringify(keyData)).digest('hex').substring(0, 16);
    }

    scheduleCache(key, ttlSec) {
        setTimeout(() => {
            this.activeVerifications.delete(key);
        }, ttlSec * 1000);
    }

    updateMetrics(context, startTime) {
        const duration = Date.now() - startTime;
        
        this.metrics.answers++;
        this.metrics.avgCoveragePct = (this.metrics.avgCoveragePct * (this.metrics.answers - 1) + context.coveragePct) / this.metrics.answers;
        this.metrics.contradictions += context.contradictions.length;
        this.metrics.patchesSuggested += context.patchSuggestions.length;
        this.metrics.avgVerifyMs = (this.metrics.avgVerifyMs * (this.metrics.answers - 1) + duration) / this.metrics.answers;
        this.metrics.p95VerifyMs = Math.max(this.metrics.p95VerifyMs, duration);
        
        // Update NLI metrics
        const totalNLI = context.nliResults.length;
        if (totalNLI > 0) {
            const entailed = context.nliResults.filter(r => r.status === 'entailed').length / totalNLI;
            const neutral = context.nliResults.filter(r => r.status === 'neutral').length / totalNLI;
            const contradict = context.nliResults.filter(r => r.status === 'contradict').length / totalNLI;
            
            this.metrics.avgNLI = {
                entailed: (this.metrics.avgNLI.entailed * (this.metrics.answers - 1) + entailed) / this.metrics.answers,
                neutral: (this.metrics.avgNLI.neutral * (this.metrics.answers - 1) + neutral) / this.metrics.answers,
                contradict: (this.metrics.avgNLI.contradict * (this.metrics.answers - 1) + contradict) / this.metrics.answers
            };
        }
        
        // Update numeric accuracy
        const numericTotal = context.numericChecks.length;
        if (numericTotal > 0) {
            const numericOk = context.numericChecks.filter(c => c.ok).length;
            this.metrics.numericOkPct = (numericOk / numericTotal) * 100;
        }
    }

    emitCard(queryId, coveragePct, status, patchCount) {
        let severity = 'info';
        if (status === 'ungrounded') severity = 'error';
        else if (status === 'at_risk') severity = 'warn';
        
        this.emit('evidence.card', {
            event: 'evidence.card',
            timestamp: new Date().toISOString(),
            title: `Atıf Doğrulama — %${Math.round(coveragePct)} kapsam (${status})`,
            body: `${this.metrics.answers} iddia değerlendirildi • ${this.metrics.contradictions} çelişki • ${patchCount} güncelleme önerisi.`,
            severity,
            ttlSec: 600
        });
    }

    emitMetrics() {
        this.emit('evidence.metrics', {
            event: 'evidence.metrics',
            timestamp: new Date().toISOString(),
            ...this.metrics
        });
    }

    getStatus() {
        return {
            name: this.name,
            initialized: this.isInitialized,
            state: this.state,
            activeVerifications: this.activeVerifications.size,
            documentCache: this.documentCache.size,
            metrics: this.metrics,
            config: {
                enabled: this.config.enabled,
                locale: this.config.locale,
                timezone: this.config.timezone,
                coverageTarget: this.config.coverage.targetPct,
                nliModel: this.config.nli.model
            }
        };
    }

    async shutdown() {
        try {
            this.logger.info(`${this.name} durduruluyor...`);
            
            // Wait for active verifications to complete
            const activePromises = Array.from(this.activeVerifications.keys()).map(key => 
                new Promise(resolve => setTimeout(resolve, 5000)) // 5s timeout
            );
            
            await Promise.allSettled(activePromises);
            
            // Clear caches
            this.activeVerifications.clear();
            this.documentCache.clear();
            
            this.isInitialized = false;
            this.logger.info(`${this.name} başarıyla durduruldu`);
        } catch (error) {
            this.logger.error(`${this.name} durdurma hatası:`, error);
        }
    }
}

module.exports = EvidenceAttributionVerifier;
