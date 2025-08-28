/**
 * Time Sync + Clock Skew Monitor
 * 
 * Monitors system time sync with Binance servers and detects dangerous clock skew
 */

const axios = require('axios');
const EventEmitter = require('events');

class ClockSyncMonitor extends EventEmitter {
    constructor(options = {}) {
        super();
        
        this.config = {
            baseUrl: options.baseUrl || 'https://api.binance.com',
            syncIntervalMs: options.syncIntervalMs || 30000, // 30 seconds
            maxSkewMs: options.maxSkewMs || 1000, // 1 second
            warningSkewMs: options.warningSkewMs || 500, // 500ms
            maxConsecutiveFailures: options.maxConsecutiveFailures || 3,
            requestTimeoutMs: options.requestTimeoutMs || 5000,
            enableNtpFallback: options.enableNtpFallback !== false,
            ntpServers: options.ntpServers || ['pool.ntp.org', 'time.google.com'],
            ...options
        };
        
        this.state = {
            serverTime: null,
            localTime: null,
            skewMs: 0,
            lastSyncTime: 0,
            consecutiveFailures: 0,
            isHealthy: true,
            measurements: [] // Ring buffer of last N measurements
        };
        
        this.maxMeasurements = 100;
        this.syncTimer = null;
        
        console.log(`🕐 Clock sync monitor initialized (max skew: ${this.config.maxSkewMs}ms)`);
    }

    /**
     * Start monitoring
     */
    start() {
        console.log(`🟢 Starting clock sync monitor`);
        
        // Initial sync
        this.syncClock();
        
        // Start periodic sync
        this.syncTimer = setInterval(() => {
            this.syncClock();
        }, this.config.syncIntervalMs);
        
        this.emit('started');
    }

    /**
     * Stop monitoring
     */
    stop() {
        console.log(`🛑 Stopping clock sync monitor`);
        
        if (this.syncTimer) {
            clearInterval(this.syncTimer);
            this.syncTimer = null;
        }
        
        this.emit('stopped');
    }

    /**
     * Sync clock with Binance server
     */
    async syncClock() {
        try {
            const measurement = await this.measureServerTime();
            this.processMeasurement(measurement);
            this.state.consecutiveFailures = 0;
            
        } catch (error) {
            this.state.consecutiveFailures++;
            console.error(`❌ Clock sync failed (${this.state.consecutiveFailures}/${this.config.maxConsecutiveFailures}):`, error.message);
            
            if (this.state.consecutiveFailures >= this.config.maxConsecutiveFailures) {
                this.handleSyncFailure();
            }
            
            this.emit('sync_error', {
                error: error.message,
                consecutiveFailures: this.state.consecutiveFailures,
                timestamp: Date.now()
            });
        }
    }

    /**
     * Measure server time with round-trip calculation
     */
    async measureServerTime() {
        const t1 = Date.now();
        const t1_hr = process.hrtime.bigint();
        
        const response = await axios.get(`${this.config.baseUrl}/api/v3/time`, {
            timeout: this.config.requestTimeoutMs
        });
        
        const t2_hr = process.hrtime.bigint();
        const t2 = Date.now();
        
        const serverTime = response.data.serverTime;
        const roundTripMs = Number(t2_hr - t1_hr) / 1000000; // Convert nanoseconds to milliseconds
        const estimatedServerReceiveTime = t1 + (roundTripMs / 2);
        
        return {
            localTime: t2,
            serverTime,
            roundTripMs,
            estimatedServerReceiveTime,
            rawSkew: serverTime - estimatedServerReceiveTime,
            measurement_time: t2
        };
    }

    /**
     * Process time measurement and calculate skew
     */
    processMeasurement(measurement) {
        // Add to measurements ring buffer
        this.state.measurements.push(measurement);
        if (this.state.measurements.length > this.maxMeasurements) {
            this.state.measurements.shift();
        }
        
        // Update state
        this.state.serverTime = measurement.serverTime;
        this.state.localTime = measurement.localTime;
        this.state.skewMs = measurement.rawSkew;
        this.state.lastSyncTime = measurement.measurement_time;
        
        // Calculate smoothed skew from recent measurements
        const recentMeasurements = this.state.measurements.slice(-10);
        const smoothedSkew = recentMeasurements.reduce((sum, m) => sum + m.rawSkew, 0) / recentMeasurements.length;
        
        // Determine health status
        const absSkew = Math.abs(smoothedSkew);
        const wasHealthy = this.state.isHealthy;
        
        if (absSkew > this.config.maxSkewMs) {
            this.state.isHealthy = false;
            
            if (wasHealthy) {
                console.error(`🚨 CRITICAL CLOCK SKEW: ${smoothedSkew.toFixed(2)}ms (threshold: ${this.config.maxSkewMs}ms)`);
                this.emit('critical_skew', {
                    skewMs: smoothedSkew,
                    threshold: this.config.maxSkewMs,
                    measurements: recentMeasurements,
                    timestamp: measurement.measurement_time
                });
            }
            
        } else if (absSkew > this.config.warningSkewMs) {
            this.state.isHealthy = true;
            
            console.warn(`⚠️ Clock skew warning: ${smoothedSkew.toFixed(2)}ms (threshold: ${this.config.warningSkewMs}ms)`);
            this.emit('skew_warning', {
                skewMs: smoothedSkew,
                threshold: this.config.warningSkewMs,
                timestamp: measurement.measurement_time
            });
            
        } else {
            this.state.isHealthy = true;
        }
        
        // Emit sync event
        this.emit('sync', {
            serverTime: measurement.serverTime,
            localTime: measurement.localTime,
            skewMs: smoothedSkew,
            roundTripMs: measurement.roundTripMs,
            isHealthy: this.state.isHealthy,
            timestamp: measurement.measurement_time
        });
        
        // Log periodic status
        if (this.state.measurements.length % 10 === 0) {
            console.log(`🕐 Clock sync: skew=${smoothedSkew.toFixed(2)}ms, rtt=${measurement.roundTripMs.toFixed(2)}ms, healthy=${this.state.isHealthy}`);
        }
    }

    /**
     * Handle persistent sync failures
     */
    handleSyncFailure() {
        console.error(`🚨 Clock sync failure threshold reached (${this.state.consecutiveFailures} consecutive failures)`);
        
        this.state.isHealthy = false;
        
        this.emit('sync_failure', {
            consecutiveFailures: this.state.consecutiveFailures,
            threshold: this.config.maxConsecutiveFailures,
            lastSuccessfulSync: this.state.lastSyncTime,
            timestamp: Date.now()
        });
        
        // Try NTP fallback if enabled
        if (this.config.enableNtpFallback) {
            this.tryNtpSync();
        }
    }

    /**
     * Try NTP sync as fallback
     */
    async tryNtpSync() {
        console.log(`🔄 Attempting NTP fallback sync...`);
        
        // This is a basic implementation - in production you'd want a proper NTP client
        try {
            // For now, just log that we would try NTP
            console.log(`📡 Would attempt NTP sync with servers: ${this.config.ntpServers.join(', ')}`);
            
            this.emit('ntp_fallback_attempted', {
                servers: this.config.ntpServers,
                timestamp: Date.now()
            });
            
        } catch (error) {
            console.error(`❌ NTP fallback failed:`, error.message);
            
            this.emit('ntp_fallback_failed', {
                error: error.message,
                timestamp: Date.now()
            });
        }
    }

    /**
     * Get current clock status
     */
    getStatus() {
        const recentMeasurements = this.state.measurements.slice(-10);
        const avgSkew = recentMeasurements.length > 0 ? 
            recentMeasurements.reduce((sum, m) => sum + m.rawSkew, 0) / recentMeasurements.length : 0;
        
        const avgRtt = recentMeasurements.length > 0 ?
            recentMeasurements.reduce((sum, m) => sum + m.roundTripMs, 0) / recentMeasurements.length : 0;
        
        return {
            isHealthy: this.state.isHealthy,
            currentSkewMs: this.state.skewMs,
            averageSkewMs: avgSkew,
            averageRttMs: avgRtt,
            lastSyncTime: this.state.lastSyncTime,
            consecutiveFailures: this.state.consecutiveFailures,
            totalMeasurements: this.state.measurements.length,
            timeSinceLastSync: Date.now() - this.state.lastSyncTime,
            thresholds: {
                warning: this.config.warningSkewMs,
                critical: this.config.maxSkewMs
            }
        };
    }

    /**
     * Get adjusted timestamp accounting for skew
     */
    getAdjustedTimestamp(localTimestamp = Date.now()) {
        if (!this.state.isHealthy || this.state.measurements.length === 0) {
            return localTimestamp;
        }
        
        // Use smoothed skew from recent measurements
        const recentMeasurements = this.state.measurements.slice(-5);
        const avgSkew = recentMeasurements.reduce((sum, m) => sum + m.rawSkew, 0) / recentMeasurements.length;
        
        return localTimestamp + avgSkew;
    }

    /**
     * Check if timestamp adjustment is needed for HMAC signatures
     */
    shouldAdjustForHmac() {
        return this.state.isHealthy && 
               this.state.measurements.length > 0 && 
               Math.abs(this.state.skewMs) > 100; // Adjust if skew > 100ms
    }

    /**
     * Get statistics
     */
    getStats() {
        const measurements = this.state.measurements;
        
        if (measurements.length === 0) {
            return {
                totalMeasurements: 0,
                averageSkew: 0,
                skewStdDev: 0,
                averageRtt: 0,
                rttStdDev: 0,
                healthyPercentage: 0
            };
        }
        
        const skews = measurements.map(m => m.rawSkew);
        const rtts = measurements.map(m => m.roundTripMs);
        
        const avgSkew = skews.reduce((sum, skew) => sum + skew, 0) / skews.length;
        const skewVariance = skews.reduce((sum, skew) => sum + Math.pow(skew - avgSkew, 2), 0) / skews.length;
        const skewStdDev = Math.sqrt(skewVariance);
        
        const avgRtt = rtts.reduce((sum, rtt) => sum + rtt, 0) / rtts.length;
        const rttVariance = rtts.reduce((sum, rtt) => sum + Math.pow(rtt - avgRtt, 2), 0) / rtts.length;
        const rttStdDev = Math.sqrt(rttVariance);
        
        const healthyCount = measurements.filter(m => Math.abs(m.rawSkew) <= this.config.maxSkewMs).length;
        const healthyPercentage = (healthyCount / measurements.length) * 100;
        
        return {
            totalMeasurements: measurements.length,
            averageSkew: avgSkew,
            skewStdDev: skewStdDev,
            averageRtt: avgRtt,
            rttStdDev: rttStdDev,
            healthyPercentage: healthyPercentage,
            currentStatus: this.getStatus()
        };
    }
}

module.exports = { ClockSyncMonitor };
