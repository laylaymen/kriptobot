// GELİŞMİŞ News Mode Controller - Ek modüller.txt prompt'una göre geliştirildi
// Günün saatine göre sistemi "yoğun" veya "hafif" moda alır
// Haber riski yüksek saatlerde agresif, düşük saatlerde pasif tarama yapar

/**
 * Enhanced News Mode Controller Module
 * Günün saatine göre haber tarama modunu kontrol eder
 * Ek modüller.txt prompt'una göre implementasyon
 */
class NewsModeController {
    constructor() {
        this.moduleName = 'newsModeController';
        
        // Mode definitions
        this.modes = {
            passive: {
                description: 'Düşük yoğunluklu tarama',
                fetchInterval: 60 * 60 * 1000, // 60 dakika
                keywordDepth: 'basic',
                alertLevel: 'low',
                systemImpact: 'minimal'
            },
            active: {
                description: 'Orta yoğunluklu tarama',
                fetchInterval: 30 * 60 * 1000, // 30 dakika
                keywordDepth: 'extended',
                alertLevel: 'medium',
                systemImpact: 'moderate'
            },
            aggressive: {
                description: 'Yüksek yoğunluklu tarama',
                fetchInterval: 10 * 60 * 1000, // 10 dakika
                keywordDepth: 'comprehensive',
                alertLevel: 'high',
                systemImpact: 'maximum'
            }
        };
        
        // Time-based schedule (24 hour format)
        this.timeSchedule = {
            // Gece saatleri - passive mode
            '00:00-08:00': 'passive',
            
            // Sabah açılış - active mode
            '08:00-12:00': 'active',
            
            // Öğlen saatleri - passive mode
            '12:00-15:00': 'passive',
            
            // ABD verileri ve açılış - aggressive mode
            '15:30-16:30': 'aggressive',
            
            // Akşam saatleri - active mode
            '16:30-21:00': 'active',
            
            // FED konuşmaları ve kapanış - aggressive mode
            '21:00-22:00': 'aggressive',
            
            // Gece saatleri - passive mode
            '22:00-24:00': 'passive'
        };
        
        // Special event schedule (overrides time schedule)
        this.specialEvents = {
            // FED events
            'fed_meeting': 'aggressive',
            'fed_speech': 'aggressive',
            'fomc_minutes': 'aggressive',
            
            // Economic data
            'inflation_data': 'aggressive',
            'employment_data': 'aggressive',
            'gdp_data': 'active',
            
            // Crypto events
            'btc_etf_decision': 'aggressive',
            'regulation_announcement': 'aggressive',
            'major_listing': 'active',
            
            // Market events
            'black_swan': 'aggressive',
            'major_hack': 'aggressive',
            'exchange_issues': 'active'
        };
        
        // Current state
        this.currentMode = 'passive';
        this.lastModeChange = Date.now();
        this.modeHistory = [];
        this.maxHistorySize = 100;
        
        // Mode change listeners
        this.listeners = [];
        
        // Performance metrics
        this.performanceMetrics = {
            totalModeChanges: 0,
            timeInPassive: 0,
            timeInActive: 0,
            timeInAggressive: 0,
            specialEventTriggers: 0,
            manualOverrides: 0
        };
        
        // Auto mode controller
        this.autoModeEnabled = true;
        this.modeCheckInterval = null;
        
        // Override settings
        this.manualOverride = null;
        this.overrideExpiresAt = null;
    }

    /**
     * Mode controller'ı başlat
     */
    start() {
        try {
            // Başlangıç modunu belirle
            this.currentMode = this.calculateCurrentMode();
            
            // Auto mode check timer'ını başlat
            if (this.autoModeEnabled) {
                this.startAutoModeCheck();
            }
            
            console.log(`📊 News Mode Controller started - Current mode: ${this.currentMode}`);
            this.logModeChange('system_start', this.currentMode);
            
        } catch (error) {
            console.error('Failed to start news mode controller:', error.message);
        }
    }

    /**
     * Mode controller'ı durdur
     */
    stop() {
        try {
            if (this.modeCheckInterval) {
                clearInterval(this.modeCheckInterval);
                this.modeCheckInterval = null;
            }
            
            console.log('📊 News Mode Controller stopped');
            
        } catch (error) {
            console.error('Failed to stop news mode controller:', error.message);
        }
    }

    /**
     * Auto mode check timer başlat
     */
    startAutoModeCheck() {
        // Her 5 dakikada bir mode kontrolü yap
        this.modeCheckInterval = setInterval(() => {
            this.checkAndUpdateMode();
        }, 5 * 60 * 1000);
        
        console.log('📊 Auto mode check started (every 5 minutes)');
    }

    /**
     * Mode kontrolü ve güncelleme
     */
    checkAndUpdateMode() {
        try {
            // Manual override kontrolü
            if (this.manualOverride && this.overrideExpiresAt) {
                if (Date.now() > this.overrideExpiresAt) {
                    this.clearManualOverride();
                } else {
                    // Manual override hala aktif
                    return;
                }
            }
            
            // Yeni modu hesapla
            const newMode = this.calculateCurrentMode();
            
            // Mode değiştiyse güncelle
            if (newMode !== this.currentMode) {
                this.setMode(newMode, 'auto_schedule');
            }
            
        } catch (error) {
            console.error('Mode check error:', error.message);
        }
    }

    /**
     * Mevcut zamana göre mode hesapla
     */
    calculateCurrentMode() {
        const now = new Date();
        const timeString = this.formatTime(now);
        
        // Time schedule'dan mode bul
        for (const [timeRange, mode] of Object.entries(this.timeSchedule)) {
            if (this.isTimeInRange(timeString, timeRange)) {
                return mode;
            }
        }
        
        // Default passive mode
        return 'passive';
    }

    /**
     * Zamanı HH:MM formatında döndür
     */
    formatTime(date) {
        const hours = date.getHours().toString().padStart(2, '0');
        const minutes = date.getMinutes().toString().padStart(2, '0');
        return `${hours}:${minutes}`;
    }

    /**
     * Zamanın belirli range içinde olup olmadığını kontrol et
     */
    isTimeInRange(currentTime, timeRange) {
        const [startTime, endTime] = timeRange.split('-');
        
        // 24:00 kontrolü
        const normalizedEndTime = endTime === '24:00' ? '23:59' : endTime;
        
        return currentTime >= startTime && currentTime <= normalizedEndTime;
    }

    /**
     * Mode değiştir
     */
    setMode(newMode, reason = 'manual') {
        try {
            if (!this.modes[newMode]) {
                throw new Error(`Invalid mode: ${newMode}`);
            }
            
            const oldMode = this.currentMode;
            const now = Date.now();
            
            // Mode değişikliğini uygula
            this.currentMode = newMode;
            
            // Performance metrics güncelle
            this.updatePerformanceMetrics(oldMode, now - this.lastModeChange);
            this.lastModeChange = now;
            this.performanceMetrics.totalModeChanges++;
            
            if (reason === 'manual') {
                this.performanceMetrics.manualOverrides++;
            } else if (reason.includes('event')) {
                this.performanceMetrics.specialEventTriggers++;
            }
            
            // History'e ekle
            this.logModeChange(reason, newMode, oldMode);
            
            // Listeners'a bildir
            this.notifyListeners(newMode, oldMode, reason);
            
            console.log(`📊 Mode changed: ${oldMode} → ${newMode} (${reason})`);
            
        } catch (error) {
            console.error('Failed to set mode:', error.message);
        }
    }

    /**
     * Special event tetikleme
     */
    triggerSpecialEvent(eventType, duration = 60) {
        try {
            if (!this.specialEvents[eventType]) {
                console.warn(`Unknown special event: ${eventType}`);
                return;
            }
            
            const eventMode = this.specialEvents[eventType];
            const durationMs = duration * 60 * 1000; // minutes to milliseconds
            
            // Manual override olarak special event mode'u set et
            this.setManualOverride(eventMode, durationMs, `special_event_${eventType}`);
            
            console.log(`🚨 Special event triggered: ${eventType} → ${eventMode} mode for ${duration} minutes`);
            
        } catch (error) {
            console.error('Failed to trigger special event:', error.message);
        }
    }

    /**
     * Manual override set et
     */
    setManualOverride(mode, durationMs, reason = 'manual_override') {
        try {
            this.manualOverride = mode;
            this.overrideExpiresAt = Date.now() + durationMs;
            
            this.setMode(mode, reason);
            
            console.log(`🔧 Manual override set: ${mode} for ${durationMs / 1000 / 60} minutes`);
            
        } catch (error) {
            console.error('Failed to set manual override:', error.message);
        }
    }

    /**
     * Manual override'ı temizle
     */
    clearManualOverride() {
        this.manualOverride = null;
        this.overrideExpiresAt = null;
        
        // Normal schedule'a geri dön
        const normalMode = this.calculateCurrentMode();
        this.setMode(normalMode, 'override_expired');
        
        console.log('🔧 Manual override cleared, returning to normal schedule');
    }

    /**
     * Performance metrics güncelle
     */
    updatePerformanceMetrics(oldMode, timeSpent) {
        switch (oldMode) {
            case 'passive':
                this.performanceMetrics.timeInPassive += timeSpent;
                break;
            case 'active':
                this.performanceMetrics.timeInActive += timeSpent;
                break;
            case 'aggressive':
                this.performanceMetrics.timeInAggressive += timeSpent;
                break;
        }
    }

    /**
     * Mode değişikliğini logla
     */
    logModeChange(reason, newMode, oldMode = null) {
        const logEntry = {
            timestamp: Date.now(),
            reason: reason,
            newMode: newMode,
            oldMode: oldMode,
            modeConfig: this.modes[newMode]
        };
        
        this.modeHistory.push(logEntry);
        
        if (this.modeHistory.length > this.maxHistorySize) {
            this.modeHistory = this.modeHistory.slice(-this.maxHistorySize);
        }
    }

    /**
     * Listeners'a mode değişikliğini bildir
     */
    notifyListeners(newMode, oldMode, reason) {
        this.listeners.forEach(listener => {
            try {
                listener(newMode, oldMode, reason, this.modes[newMode]);
            } catch (error) {
                console.error('Listener notification error:', error.message);
            }
        });
    }

    /**
     * Mode değişikliği listener ekle
     */
    addModeChangeListener(callback) {
        if (typeof callback === 'function') {
            this.listeners.push(callback);
            console.log('📊 Mode change listener added');
        }
    }

    /**
     * Mode değişikliği listener kaldır
     */
    removeModeChangeListener(callback) {
        const index = this.listeners.indexOf(callback);
        if (index > -1) {
            this.listeners.splice(index, 1);
            console.log('📊 Mode change listener removed');
        }
    }

    /**
     * Market hours kontrolü
     */
    isMarketHours() {
        const now = new Date();
        const timeString = this.formatTime(now);
        
        // US market hours: 15:30-22:00 (CET)
        return timeString >= '15:30' && timeString <= '22:00';
    }

    /**
     * High activity period kontrolü
     */
    isHighActivityPeriod() {
        return this.currentMode === 'aggressive';
    }

    /**
     * Mode recommendation al
     */
    getRecommendedMode(factors = {}) {
        let recommendedMode = this.calculateCurrentMode();
        
        // Market volatility faktörü
        if (factors.volatilityLevel === 'high') {
            recommendedMode = 'aggressive';
        } else if (factors.volatilityLevel === 'low') {
            recommendedMode = 'passive';
        }
        
        // News impact faktörü
        if (factors.newsImpactLevel === 'critical') {
            recommendedMode = 'aggressive';
        } else if (factors.newsImpactLevel === 'low') {
            recommendedMode = 'passive';
        }
        
        // System load faktörü
        if (factors.systemLoad === 'high') {
            // System yüklü ise mode'u düşür
            if (recommendedMode === 'aggressive') recommendedMode = 'active';
            else if (recommendedMode === 'active') recommendedMode = 'passive';
        }
        
        return recommendedMode;
    }

    // Getter methods
    getCurrentMode() {
        return this.currentMode;
    }

    getCurrentModeConfig() {
        return this.modes[this.currentMode];
    }

    getModeHistory(limit = 20) {
        return this.modeHistory.slice(-limit);
    }

    getPerformanceMetrics() {
        const now = Date.now();
        const totalUptime = now - (this.performanceMetrics.uptime || now);
        
        return {
            ...this.performanceMetrics,
            totalUptime: totalUptime,
            currentMode: this.currentMode,
            hasManualOverride: this.manualOverride !== null,
            overrideExpiresIn: this.overrideExpiresAt ? Math.max(0, this.overrideExpiresAt - now) : 0
        };
    }

    getScheduleInfo() {
        const now = new Date();
        const timeString = this.formatTime(now);
        
        return {
            currentTime: timeString,
            currentMode: this.currentMode,
            timeSchedule: this.timeSchedule,
            specialEvents: this.specialEvents,
            nextModeChange: this.getNextModeChange(),
            isMarketHours: this.isMarketHours(),
            isHighActivity: this.isHighActivityPeriod()
        };
    }

    getNextModeChange() {
        const now = new Date();
        const currentTimeString = this.formatTime(now);
        
        // Bir sonraki mode değişikliğini bul
        const sortedTimes = Object.keys(this.timeSchedule).sort();
        
        for (const timeRange of sortedTimes) {
            const [startTime] = timeRange.split('-');
            if (startTime > currentTimeString) {
                return {
                    time: startTime,
                    mode: this.timeSchedule[timeRange]
                };
            }
        }
        
        // Ertesi gün ilk mode değişikliği
        const firstTimeRange = sortedTimes[0];
        const [firstTime] = firstTimeRange.split('-');
        return {
            time: firstTime,
            mode: this.timeSchedule[firstTimeRange],
            nextDay: true
        };
    }

    getModuleInfo() {
        return {
            name: 'NewsModeController',
            version: '2.0.0',
            description: 'GELİŞMİŞ haber mode controller - Ek modüller.txt prompt\'una göre geliştirildi',
            availableModes: Object.keys(this.modes),
            currentMode: this.currentMode,
            autoModeEnabled: this.autoModeEnabled,
            hasManualOverride: this.manualOverride !== null,
            performanceMetrics: this.getPerformanceMetrics()
        };
    }
}

// Singleton instance oluşturma
const newsModeController = new NewsModeController();

// Legacy function compatibility
function getCurrentNewsMode() {
    return newsModeController.getCurrentMode();
}

function setNewsMode(mode, duration) {
    if (duration) {
        newsModeController.setManualOverride(mode, duration * 60 * 1000);
    } else {
        newsModeController.setMode(mode, 'manual');
    }
}

module.exports = {
    NewsModeController,
    newsModeController,
    getCurrentNewsMode,
    setNewsMode
};
