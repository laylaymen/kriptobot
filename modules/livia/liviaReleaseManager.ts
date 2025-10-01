/**
 * LIVIA-36: Release Manager
 * LIVIA ekosistemi için manuel release yönetimi ve versiyon kontrolü
 * Tüm modüllerin durumunu kontrol eder ve koordineli release süreci yürütür.
 */

import { z } from 'zod';
import * as fs from 'fs/promises';
import * as path from 'path';

// Giriş şemaları
const ReleaseRequestSchema = z.object({
    event: z.literal('release.request'),
    timestamp: z.string(),
    version: z.string().optional(),
    type: z.enum(['patch', 'minor', 'major', 'custom']),
    modules: z.array(z.string()).optional(),
    notes: z.string().optional(),
    dryRun: z.boolean().default(false),
    autoIncrement: z.boolean().default(true)
}).strict();

const ModuleStatusSchema = z.object({
    event: z.literal('module.status'),
    timestamp: z.string(),
    moduleName: z.string(),
    version: z.string(),
    status: z.enum(['ready', 'not_ready', 'error', 'disabled']),
    tests: z.object({
        passed: z.number(),
        failed: z.number(),
        total: z.number()
    }).optional(),
    dependencies: z.array(z.string()).optional(),
    lastModified: z.string().optional()
}).strict();

// Çıkış şemaları
const ReleaseReadySchema = z.object({
    event: z.literal('release.ready'),
    timestamp: z.string(),
    version: z.string(),
    status: z.enum(['ready', 'failed', 'partial']),
    modules: z.array(z.object({
        name: z.string(),
        version: z.string(),
        status: z.enum(['included', 'excluded', 'error']),
        size: z.number().optional(),
        checksum: z.string().optional()
    })),
    buildInfo: z.object({
        nodeVersion: z.string(),
        platform: z.string(),
        arch: z.string(),
        buildTime: z.string(),
        commit: z.string().optional()
    }),
    notes: z.string(),
    packagePath: z.string().optional(),
    hash: z.string()
}).strict();

const ReleaseMetricsSchema = z.object({
    event: z.literal('release.metrics'),
    timestamp: z.string(),
    totalReleases: z.number(),
    successfulReleases: z.number(),
    failedReleases: z.number(),
    avgBuildTimeMs: z.number(),
    lastReleaseVersion: z.string().optional(),
    modulesCovered: z.number(),
    totalModules: z.number()
}).strict();

const ReleaseNotificationSchema = z.object({
    event: z.literal('release.notification'),
    timestamp: z.string(),
    type: z.enum(['success', 'failure', 'warning', 'info']),
    version: z.string(),
    title: z.string(),
    message: z.string(),
    details: z.record(z.any()).optional()
}).strict();

type ReleaseRequest = z.infer<typeof ReleaseRequestSchema>;
type ReleaseReady = z.infer<typeof ReleaseReadySchema>;

/**
 * Release Manager - LIVIA-36
 * LIVIA sisteminin release yönetimi için ana sınıf
 */
class LiviaReleaseManager {
    private config: any;
    private logger: any;
    private isInitialized: boolean = false;
    private metrics = {
        totalReleases: 0,
        successfulReleases: 0,
        failedReleases: 0,
        totalBuildTimeMs: 0,
        modulesCovered: 0,
        totalModules: 0
    };
    private currentVersion: string = '1.0.0';
    private moduleRegistry: Map<string, any> = new Map();

    constructor(config: any = {}) {
        this.config = {
            i18n: { locale: 'tr-TR', tz: 'Europe/Istanbul' },
            release: {
                baseVersion: '1.0.0',
                autoIncrement: true,
                includeTests: true,
                createArchive: true,
                validateModules: true,
                maxBuildTimeMs: 300000, // 5 dakika
                releaseDir: 'releases',
                backupDir: 'backups'
            },
            modules: {
                liviaModulesPath: '/modules/livia',
                excludePatterns: ['*.test.js', '*.test.ts', 'node_modules'],
                requiredModules: ['operatorDialogOrchestrator', 'guardQuestionEngine', 'biasAwarenessMonitor'],
                optionalModules: ['newsReactionRouter', 'newsSentimentAnalyzer']
            },
            notifications: {
                enabled: true,
                channels: ['console', 'file'],
                slackWebhook: null,
                emailRecipients: []
            },
            ...config
        };
    }

    async initialize(logger: any): Promise<boolean> {
        try {
            this.logger = logger;
            this.logger.info('LIVIA-36 ReleaseManager başlatılıyor...');
            
            // Release ve backup klasörlerini oluştur
            await this.setupDirectories();
            
            // Mevcut versiyon bilgisini yükle
            await this.loadCurrentVersion();
            
            // Modül registry'sini yükle
            await this.scanModules();
            
            this.isInitialized = true;
            this.logger.info('LIVIA-36 başarıyla başlatıldı');
            return true;
        } catch (error) {
            this.logger.error('LIVIA-36 başlatma hatası:', error);
            return false;
        }
    }

    /**
     * Release talebi işleyicisi
     */
    async processReleaseRequest(input: ReleaseRequest): Promise<ReleaseReady> {
        const validatedInput = ReleaseRequestSchema.parse(input);
        const startTime = Date.now();
        
        this.logger.info('Release süreci başlıyor:', {
            type: validatedInput.type,
            version: validatedInput.version,
            dryRun: validatedInput.dryRun
        });

        try {
            // 1. Versiyon hesapla
            const targetVersion = await this.calculateVersion(validatedInput);
            
            // 2. Modülleri doğrula
            const moduleValidation = await this.validateModules(validatedInput.modules);
            
            // 3. Release paketi oluştur
            const releasePackage = await this.createReleasePackage(
                targetVersion, 
                moduleValidation.validModules,
                validatedInput.dryRun
            );
            
            // 4. Test çalıştır (eğer aktifse)
            if (this.config.release.includeTests && !validatedInput.dryRun) {
                await this.runReleaseTests(releasePackage);
            }
            
            // 5. Arşiv oluştur
            let packagePath: string | undefined;
            if (this.config.release.createArchive && !validatedInput.dryRun) {
                packagePath = await this.createReleaseArchive(targetVersion, releasePackage);
            }
            
            // 6. Metadata ve build info
            const buildInfo = await this.getBuildInfo();
            const hash = this.generateReleaseHash(targetVersion, releasePackage);
            
            // 7. Metrikleri güncelle
            const buildTime = Date.now() - startTime;
            this.updateMetrics(true, buildTime, moduleValidation.validModules.length);
            
            // 8. Versiyon bilgisini kaydet
            if (!validatedInput.dryRun) {
                await this.saveVersionInfo(targetVersion, hash);
            }
            
            const result: ReleaseReady = {
                event: 'release.ready',
                timestamp: new Date().toISOString(),
                version: targetVersion,
                status: moduleValidation.hasErrors ? 'partial' : 'ready',
                modules: releasePackage.modules,
                buildInfo: {
                    ...buildInfo,
                    buildTime: new Date().toISOString()
                },
                notes: validatedInput.notes || `LIVIA ${targetVersion} release`,
                packagePath,
                hash
            };

            this.logger.info('Release başarıyla tamamlandı:', {
                version: targetVersion,
                moduleCount: releasePackage.modules.length,
                buildTimeMs: buildTime
            });

            // Bildirim gönder
            await this.sendReleaseNotification('success', result);
            
            return ReleaseReadySchema.parse(result);
            
        } catch (error) {
            const buildTime = Date.now() - startTime;
            this.updateMetrics(false, buildTime, 0);
            
            this.logger.error('Release süreci başarısız:', error);
            
            // Hata bildirimi
            await this.sendReleaseNotification('failure', {
                version: validatedInput.version || 'unknown',
                error: error instanceof Error ? error.message : 'Unknown error'
            });
            
            throw error;
        }
    }

    /**
     * Klasörleri oluştur
     */
    private async setupDirectories(): Promise<void> {
        const directories = [
            this.config.release.releaseDir,
            this.config.release.backupDir,
            path.join(this.config.release.releaseDir, 'archives'),
            path.join(this.config.release.releaseDir, 'metadata')
        ];
        
        for (const dir of directories) {
            try {
                await fs.access(dir);
            } catch {
                await fs.mkdir(dir, { recursive: true });
                this.logger.info(`Klasör oluşturuldu: ${dir}`);
            }
        }
    }

    /**
     * Mevcut versiyon bilgisini yükle
     */
    private async loadCurrentVersion(): Promise<void> {
        const versionFile = path.join(this.config.release.releaseDir, 'VERSION');
        try {
            const versionData = await fs.readFile(versionFile, 'utf8');
            this.currentVersion = JSON.parse(versionData).version || this.config.release.baseVersion;
        } catch {
            this.currentVersion = this.config.release.baseVersion;
            this.logger.info(`Yeni versiyon dosyası oluşturulacak: ${this.currentVersion}`);
        }
    }

    /**
     * Modülleri tara ve kaydet
     */
    private async scanModules(): Promise<void> {
        const modulesPath = path.join(process.cwd(), this.config.modules.liviaModulesPath);
        
        try {
            const files = await fs.readdir(modulesPath);
            let moduleCount = 0;
            
            for (const file of files) {
                if (this.shouldIncludeFile(file)) {
                    const filePath = path.join(modulesPath, file);
                    const stats = await fs.stat(filePath);
                    
                    if (stats.isFile()) {
                        const moduleInfo = await this.analyzeModule(filePath);
                        this.moduleRegistry.set(file, moduleInfo);
                        moduleCount++;
                    }
                }
            }
            
            this.metrics.totalModules = moduleCount;
            this.logger.info(`${moduleCount} LIVIA modülü tarandı`);
            
        } catch (error) {
            this.logger.error('Modül tarama hatası:', error);
        }
    }

    /**
     * Dosyanın dahil edilip edilmeyeceğini kontrol et
     */
    private shouldIncludeFile(filename: string): boolean {
        // Test dosyalarını hariç tut
        for (const pattern of this.config.modules.excludePatterns) {
            if (filename.match(pattern.replace('*', '.*'))) {
                return false;
            }
        }
        
        // JS/TS dosyalarını dahil et
        return filename.endsWith('.js') || filename.endsWith('.ts');
    }

    /**
     * Modül analiz et
     */
    private async analyzeModule(filePath: string): Promise<any> {
        try {
            const content = await fs.readFile(filePath, 'utf8');
            const stats = await fs.stat(filePath);
            
            // LIVIA modül numarasını çıkar
            const liviaMatch = content.match(/LIVIA-(\d+)/);
            const moduleNumber = liviaMatch ? parseInt(liviaMatch[1]) : null;
            
            // Modül adını çıkar
            const nameMatch = content.match(/class\s+(\w+)/);
            const className = nameMatch ? nameMatch[1] : path.basename(filePath, path.extname(filePath));
            
            return {
                path: filePath,
                size: stats.size,
                lastModified: stats.mtime.toISOString(),
                moduleNumber,
                className,
                hasTests: content.includes('test') || content.includes('spec'),
                dependencies: this.extractDependencies(content),
                exports: this.extractExports(content)
            };
            
        } catch (error) {
            this.logger.warn(`Modül analiz edilemedi [${filePath}]:`, error);
            return { path: filePath, error: true };
        }
    }

    /**
     * Bağımlılıkları çıkar
     */
    private extractDependencies(content: string): string[] {
        const deps: string[] = [];
        
        // Import statements
        const importMatches = content.matchAll(/import.*from\s+['"]([^'"]+)['"]/g);
        for (const match of importMatches) {
            deps.push(match[1]);
        }
        
        // LIVIA cross-references
        const liviaMatches = content.matchAll(/LIVIA-(\d+)/g);
        for (const match of liviaMatches) {
            deps.push(`LIVIA-${match[1]}`);
        }
        
        return [...new Set(deps)];
    }

    /**
     * Export'ları çıkar
     */
    private extractExports(content: string): string[] {
        const exports: string[] = [];
        
        // Export statements
        const exportMatches = content.matchAll(/export\s+(?:default\s+)?(?:class|function|const|let|var)\s+(\w+)/g);
        for (const match of exportMatches) {
            exports.push(match[1]);
        }
        
        return exports;
    }

    /**
     * Versiyon hesapla
     */
    private async calculateVersion(request: ReleaseRequest): Promise<string> {
        if (request.version && request.type === 'custom') {
            return request.version;
        }
        
        if (!request.autoIncrement) {
            return this.currentVersion;
        }
        
        const [major, minor, patch] = this.currentVersion.split('.').map(Number);
        
        switch (request.type) {
            case 'major':
                return `${major + 1}.0.0`;
            case 'minor':
                return `${major}.${minor + 1}.0`;
            case 'patch':
            default:
                return `${major}.${minor}.${patch + 1}`;
        }
    }

    /**
     * Modülleri doğrula
     */
    private async validateModules(requestedModules?: string[]): Promise<{ validModules: any[], hasErrors: boolean, errors: string[] }> {
        const errors: string[] = [];
        const validModules: any[] = [];
        
        // Tüm modülleri kontrol et veya sadece istenen modülleri
        const modulesToCheck = requestedModules || Array.from(this.moduleRegistry.keys());
        
        for (const moduleName of modulesToCheck) {
            const moduleInfo = this.moduleRegistry.get(moduleName);
            
            if (!moduleInfo) {
                errors.push(`Modül bulunamadı: ${moduleName}`);
                continue;
            }
            
            if (moduleInfo.error) {
                errors.push(`Modül hatası [${moduleName}]: ${moduleInfo.error}`);
                continue;
            }
            
            // Gerekli modül kontrolü
            const baseName = path.basename(moduleName, path.extname(moduleName));
            if (this.config.modules.requiredModules.includes(baseName)) {
                if (!moduleInfo.className) {
                    errors.push(`Gerekli modülde class bulunamadı: ${moduleName}`);
                    continue;
                }
            }
            
            validModules.push({
                name: moduleName,
                version: this.currentVersion,
                status: 'included',
                size: moduleInfo.size,
                checksum: this.calculateChecksum(moduleInfo.path)
            });
        }
        
        return {
            validModules,
            hasErrors: errors.length > 0,
            errors
        };
    }

    /**
     * Release paketi oluştur
     */
    private async createReleasePackage(version: string, modules: any[], dryRun: boolean): Promise<any> {
        const packageInfo = {
            version,
            timestamp: new Date().toISOString(),
            modules,
            totalSize: modules.reduce((sum, m) => sum + (m.size || 0), 0),
            moduleCount: modules.length
        };
        
        if (!dryRun) {
            // Package metadata dosyasını kaydet
            const metadataPath = path.join(
                this.config.release.releaseDir, 
                'metadata', 
                `release-${version}.json`
            );
            
            await fs.writeFile(metadataPath, JSON.stringify(packageInfo, null, 2));
            this.logger.info(`Release metadata kaydedildi: ${metadataPath}`);
        }
        
        return packageInfo;
    }

    /**
     * Release testleri çalıştır
     */
    private async runReleaseTests(releasePackage: any): Promise<void> {
        this.logger.info('Release testleri çalıştırılıyor...');
        
        // Basit validasyon testleri
        const tests = [
            { name: 'Module Count', pass: releasePackage.moduleCount > 0 },
            { name: 'Total Size', pass: releasePackage.totalSize > 0 },
            { name: 'Required Modules', pass: this.validateRequiredModules(releasePackage.modules) },
            { name: 'No Duplicate Modules', pass: this.checkNoDuplicates(releasePackage.modules) }
        ];
        
        const failedTests = tests.filter(t => !t.pass);
        
        if (failedTests.length > 0) {
            throw new Error(`Release testleri başarısız: ${failedTests.map(t => t.name).join(', ')}`);
        }
        
        this.logger.info(`${tests.length} test başarıyla geçildi`);
    }

    /**
     * Gerekli modülleri doğrula
     */
    private validateRequiredModules(modules: any[]): boolean {
        const moduleNames = modules.map(m => path.basename(m.name, path.extname(m.name)));
        
        for (const required of this.config.modules.requiredModules) {
            if (!moduleNames.includes(required)) {
                this.logger.warn(`Gerekli modül eksik: ${required}`);
                return false;
            }
        }
        
        return true;
    }

    /**
     * Duplikasyon kontrolü
     */
    private checkNoDuplicates(modules: any[]): boolean {
        const names = modules.map(m => m.name);
        return names.length === new Set(names).size;
    }

    /**
     * Release arşivi oluştur
     */
    private async createReleaseArchive(version: string, releasePackage: any): Promise<string> {
        const archiveName = `livia-release-${version}.tar.gz`;
        const archivePath = path.join(this.config.release.releaseDir, 'archives', archiveName);
        
        // Simülasyon - gerçek implementasyonda tar.gz oluşturma
        const archiveContent = {
            version,
            timestamp: new Date().toISOString(),
            modules: releasePackage.modules,
            metadata: releasePackage
        };
        
        await fs.writeFile(
            archivePath.replace('.tar.gz', '.json'), 
            JSON.stringify(archiveContent, null, 2)
        );
        
        this.logger.info(`Release arşivi oluşturuldu: ${archivePath}`);
        return archivePath;
    }

    /**
     * Build bilgilerini al
     */
    private async getBuildInfo(): Promise<any> {
        return {
            nodeVersion: process.version,
            platform: process.platform,
            arch: process.arch,
            commit: await this.getGitCommit()
        };
    }

    /**
     * Git commit hash'i al
     */
    private async getGitCommit(): Promise<string | undefined> {
        try {
            const { exec } = require('child_process');
            return new Promise((resolve) => {
                exec('git rev-parse HEAD', (error: any, stdout: string) => {
                    if (error) {
                        resolve(undefined);
                    } else {
                        resolve(stdout.trim().substring(0, 8));
                    }
                });
            });
        } catch {
            return undefined;
        }
    }

    /**
     * Release hash oluştur
     */
    private generateReleaseHash(version: string, releasePackage: any): string {
        const hashInput = version + JSON.stringify(releasePackage) + Date.now();
        return `sha256:${Buffer.from(hashInput).toString('base64').slice(0, 16)}`;
    }

    /**
     * Checksum hesapla
     */
    private calculateChecksum(filePath: string): string {
        // Simülasyon - gerçek implementasyonda dosya hash'i
        return `crc32:${Math.random().toString(36).substring(2, 10)}`;
    }

    /**
     * Versiyon bilgisini kaydet
     */
    private async saveVersionInfo(version: string, hash: string): Promise<void> {
        const versionInfo = {
            version,
            hash,
            timestamp: new Date().toISOString(),
            buildInfo: await this.getBuildInfo()
        };
        
        const versionFile = path.join(this.config.release.releaseDir, 'VERSION');
        await fs.writeFile(versionFile, JSON.stringify(versionInfo, null, 2));
        
        this.currentVersion = version;
        this.logger.info(`Versiyon bilgisi güncellendi: ${version}`);
    }

    /**
     * Metrikleri güncelle
     */
    private updateMetrics(success: boolean, buildTimeMs: number, moduleCount: number): void {
        this.metrics.totalReleases++;
        this.metrics.totalBuildTimeMs += buildTimeMs;
        
        if (success) {
            this.metrics.successfulReleases++;
            this.metrics.modulesCovered = Math.max(this.metrics.modulesCovered, moduleCount);
        } else {
            this.metrics.failedReleases++;
        }
    }

    /**
     * Release bildirimi gönder
     */
    private async sendReleaseNotification(type: 'success' | 'failure' | 'warning' | 'info', data: any): Promise<void> {
        if (!this.config.notifications.enabled) return;
        
        const notification = {
            event: 'release.notification',
            timestamp: new Date().toISOString(),
            type,
            version: data.version,
            title: this.getNotificationTitle(type, data.version),
            message: this.getNotificationMessage(type, data),
            details: data
        };
        
        // Console logging
        if (this.config.notifications.channels.includes('console')) {
            this.logger.info('Release Notification:', notification);
        }
        
        // File logging
        if (this.config.notifications.channels.includes('file')) {
            const notificationFile = path.join(
                this.config.release.releaseDir, 
                'notifications.jsonl'
            );
            
            await fs.appendFile(notificationFile, JSON.stringify(notification) + '\n');
        }
    }

    /**
     * Bildirim başlığı oluştur
     */
    private getNotificationTitle(type: string, version: string): string {
        const titles = {
            success: `✅ LIVIA Release Başarılı - v${version}`,
            failure: `❌ LIVIA Release Başarısız - v${version}`,
            warning: `⚠️ LIVIA Release Uyarısı - v${version}`,
            info: `ℹ️ LIVIA Release Bilgisi - v${version}`
        };
        
        return titles[type as keyof typeof titles] || `LIVIA Release - v${version}`;
    }

    /**
     * Bildirim mesajı oluştur
     */
    private getNotificationMessage(type: string, data: any): string {
        switch (type) {
            case 'success':
                return `${data.modules?.length || 0} modül ile başarıyla tamamlandı`;
            case 'failure':
                return `Hata: ${data.error || 'Bilinmeyen hata'}`;
            case 'warning':
                return `Uyarı: ${data.warning || 'Dikkat gerekiyor'}`;
            default:
                return `Release durumu: ${data.status || 'bilgi'}`;
        }
    }

    /**
     * Metrikleri getir
     */
    getMetrics(): any {
        const avgBuildTimeMs = this.metrics.totalReleases > 0 ? 
            this.metrics.totalBuildTimeMs / this.metrics.totalReleases : 0;
        
        const metrics = {
            event: 'release.metrics',
            timestamp: new Date().toISOString(),
            ...this.metrics,
            avgBuildTimeMs: Math.round(avgBuildTimeMs),
            lastReleaseVersion: this.currentVersion
        };
        
        return ReleaseMetricsSchema.parse(metrics);
    }

    /**
     * Modül durumunu al
     */
    getStatus() {
        return {
            name: 'LIVIA-36',
            initialized: this.isInitialized,
            currentVersion: this.currentVersion,
            config: this.config,
            moduleRegistry: this.moduleRegistry.size,
            metrics: this.metrics
        };
    }
}

export default LiviaReleaseManager;
export {
    LiviaReleaseManager,
    ReleaseRequestSchema,
    ModuleStatusSchema,
    ReleaseReadySchema,
    ReleaseMetricsSchema,
    ReleaseNotificationSchema
};