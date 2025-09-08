/**
 * Operator Dialog - VIVO-03
 * Kullanıcıyla plan seçimi konusunda etkileşime geçer (menu/switch sistemi)
 * Telegram, Discord, WebSocket aracılığıyla plan özeti sunarak operatörün kararını bekler
 */

import { EventEmitter } from 'events';

export interface DialogChannel {
    type: "telegram" | "discord" | "websocket" | "console";
    endpoint: string;     // telegram chat_id, discord channel_id, ws_url, "stdout"
    enabled: boolean;
    timeoutMs: number;    // kullanıcı yanıtını beklemede max süre
}

export interface DialogUser {
    id: string;           // telegram user_id, discord user_id vs
    displayName: string;
    permissions: string[]; // ["plan_approve", "emergency_halt", "risk_override"]
    preferredChannel: string; // "telegram", "discord" gibi
}

export interface PlanSummaryCard {
    id: "A" | "B" | "C";
    title: string;
    symbols: string[];    // ["BTCUSDT", "ETHUSDT"]
    totalNotionalUsd: number;
    entryType: "MARKET" | "LIMIT" | "IOC" | "POST_ONLY";
    offsetBps: number;
    twapMs: number;
    sentiment: string;    // "NORMAL", "SLOWDOWN" vs.
    riskLevel: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
    expectedPnlPct?: number;
    notes?: string[];
    timestamp: string;
}

export interface DialogInput {
    sessionId: string;
    plans: PlanSummaryCard[];     // A, B, C planları
    channels: DialogChannel[];
    users: DialogUser[];
    defaultTimeoutMs: number;     // 30000 (30 saniye)
    autoFallback?: "A" | "B" | "C" | null; // timeout durumunda seçilecek plan
    emergencyHalt?: boolean;      // acil durdurma modu
}

export interface UserResponse {
    userId: string;
    planId: "A" | "B" | "C" | "HALT" | "POSTPONE";
    confirmationCode?: string;    // risk seviyesi yüksekse ek onay kodu
    timestamp: string;
    channel: string;
    responseTime: number;         // ms cinsinden yanıt süresi
}

export interface DialogResult {
    sessionId: string;
    selectedPlan: "A" | "B" | "C" | "HALT" | "POSTPONE" | "TIMEOUT";
    userResponse?: UserResponse;
    fallbackReason?: string;      // timeout, no_users, channel_failure
    totalDurationMs: number;
    timestamp: string;
    metadata?: Record<string, any>;
}

export interface DialogError { 
    code: string; 
    message: string; 
    details?: Record<string, unknown>; 
    retriable?: boolean; 
}

class OperatorDialog extends EventEmitter {
    private ver = "1.0.0";
    private src = "VIVO-03";
    private logger: any;
    private isInitialized: boolean = false;
    private activeSessions = new Map<string, any>();
    private telegramBot: any = null;
    private discordClient: any = null;
    private wsServer: any = null;

    constructor() {
        super();
    }

    async initialize(logger: any): Promise<boolean> {
        try {
            this.logger = logger;
            this.logger.info('OperatorDialog initializing...');
            
            // Initialize communication channels (mock implementations)
            this.initializeTelegram();
            this.initializeDiscord();
            this.initializeWebSocket();
            
            this.isInitialized = true;
            this.logger.info('OperatorDialog initialized successfully');
            return true;
        } catch (error) {
            this.logger.error('OperatorDialog initialization error:', error);
            return false;
        }
    }

    private initializeTelegram(): void {
        // Mock Telegram bot initialization
        this.telegramBot = {
            sendMessage: async (chatId: string, message: string, options?: any) => {
                this.logger.info(`[TELEGRAM] Send to ${chatId}: ${message}`);
                return { message_id: Date.now() };
            },
            setCallbackQuery: (handler: Function) => {
                this.logger.info('[TELEGRAM] Callback query handler set');
            }
        };
    }

    private initializeDiscord(): void {
        // Mock Discord client initialization
        this.discordClient = {
            sendMessage: async (channelId: string, message: string, components?: any) => {
                this.logger.info(`[DISCORD] Send to ${channelId}: ${message}`);
                return { id: Date.now().toString() };
            },
            setInteractionHandler: (handler: Function) => {
                this.logger.info('[DISCORD] Interaction handler set');
            }
        };
    }

    private initializeWebSocket(): void {
        // Mock WebSocket server initialization
        this.wsServer = {
            broadcast: (message: any) => {
                this.logger.info(`[WEBSOCKET] Broadcast: ${JSON.stringify(message)}`);
            },
            setMessageHandler: (handler: Function) => {
                this.logger.info('[WEBSOCKET] Message handler set');
            }
        };
    }

    async run(x: DialogInput): Promise<DialogResult | { error: DialogError }> {
        if (!this.isInitialized) {
            return this.err("NOT_INITIALIZED", "Module not initialized");
        }

        try {
            const v = this.validate(x); 
            if (v) return this.err("VALIDATION_ERROR", v);

            const startTime = Date.now();
            this.logger.info({ sessionId: x.sessionId }, "Starting operator dialog session");

            // Acil durdurma modu kontrolü
            if (x.emergencyHalt) {
                this.logger.warn({ sessionId: x.sessionId }, "Emergency halt mode active");
                return {
                    sessionId: x.sessionId,
                    selectedPlan: "HALT",
                    fallbackReason: "emergency_halt",
                    totalDurationMs: Date.now() - startTime,
                    timestamp: new Date().toISOString()
                };
            }

            // Plan özetlerini formatla
            const planMessages = this.formatPlanSummaries(x.plans);
            
            // Kullanıcılara mesaj gönder
            const responses = await this.sendToChannels(x, planMessages);
            
            // Kullanıcı yanıtını bekle
            const result = await this.waitForUserResponse(x, startTime);
            
            this.emit('ops.dialog_complete', result);
            return result;

        } catch (e: any) {
            return this.err("DIALOG_FAILED", e?.message || "unknown", { stack: e?.stack });
        }
    }

    private validate(x: DialogInput): string | null {
        if (!x.sessionId) return "missing sessionId";
        if (!Array.isArray(x.plans) || x.plans.length === 0) return "empty plans";
        if (!Array.isArray(x.channels) || x.channels.length === 0) return "empty channels";
        if (!Array.isArray(x.users) || x.users.length === 0) return "empty users";
        if ((x.defaultTimeoutMs ?? 0) < 1000) return "timeout too short (min 1000ms)";
        return null;
    }

    private formatPlanSummaries(plans: PlanSummaryCard[]): string {
        let message = "🤖 **KRIPTOBOT PLAN SEÇİMİ**\n\n";
        
        plans.forEach(plan => {
            const riskEmoji = this.getRiskEmoji(plan.riskLevel);
            const symbolList = plan.symbols.slice(0, 3).join(", ") + (plan.symbols.length > 3 ? "..." : "");
            
            message += `**${riskEmoji} Plan ${plan.id}: ${plan.title}**\n`;
            message += `• Semboller: ${symbolList}\n`;
            message += `• Toplam: $${plan.totalNotionalUsd.toLocaleString()}\n`;
            message += `• Tip: ${plan.entryType} (${plan.offsetBps}bps)\n`;
            message += `• Risk: ${plan.riskLevel}\n`;
            message += `• TWAP: ${plan.twapMs}ms\n`;
            if (plan.expectedPnlPct) {
                message += `• Beklenen P&L: ${plan.expectedPnlPct.toFixed(2)}%\n`;
            }
            if (plan.notes && plan.notes.length > 0) {
                message += `• Not: ${plan.notes[0]}\n`;
            }
            message += "\n";
        });

        message += "⚡ **Lütfen bir plan seçin:**\n";
        message += "• A - Plan A'yı uygula\n";
        message += "• B - Plan B'yi uygula\n";
        message += "• C - Plan C'yi uygula\n";
        message += "• HALT - Tüm işlemleri durdur\n";
        message += "• POSTPONE - Daha sonra karar ver\n";

        return message;
    }

    private getRiskEmoji(riskLevel: string): string {
        switch (riskLevel) {
            case "LOW": return "🟢";
            case "MEDIUM": return "🟡";
            case "HIGH": return "🟠";
            case "CRITICAL": return "🔴";
            default: return "⚪";
        }
    }

    private async sendToChannels(x: DialogInput, message: string): Promise<boolean> {
        const enabledChannels = x.channels.filter(ch => ch.enabled);
        
        for (const channel of enabledChannels) {
            try {
                switch (channel.type) {
                    case "telegram":
                        await this.sendTelegramMessage(channel.endpoint, message);
                        break;
                    case "discord":
                        await this.sendDiscordMessage(channel.endpoint, message);
                        break;
                    case "websocket":
                        await this.sendWebSocketMessage(message);
                        break;
                    case "console":
                        this.sendConsoleMessage(message);
                        break;
                }
            } catch (error) {
                this.logger.error({ channel: channel.type, endpoint: channel.endpoint }, 
                    `Failed to send message: ${error}`);
            }
        }

        return true;
    }

    private async sendTelegramMessage(chatId: string, message: string): Promise<void> {
        const keyboard = {
            inline_keyboard: [
                [
                    { text: "Plan A", callback_data: "PLAN_A" },
                    { text: "Plan B", callback_data: "PLAN_B" },
                    { text: "Plan C", callback_data: "PLAN_C" }
                ],
                [
                    { text: "🛑 HALT", callback_data: "HALT" },
                    { text: "⏸️ POSTPONE", callback_data: "POSTPONE" }
                ]
            ]
        };

        await this.telegramBot.sendMessage(chatId, message, {
            parse_mode: 'Markdown',
            reply_markup: keyboard
        });
    }

    private async sendDiscordMessage(channelId: string, message: string): Promise<void> {
        const components = {
            type: 1,
            components: [
                {
                    type: 2,
                    style: 1,
                    label: "Plan A",
                    custom_id: "PLAN_A"
                },
                {
                    type: 2,
                    style: 1,
                    label: "Plan B",
                    custom_id: "PLAN_B"
                },
                {
                    type: 2,
                    style: 1,
                    label: "Plan C",
                    custom_id: "PLAN_C"
                }
            ]
        };

        await this.discordClient.sendMessage(channelId, message, components);
    }

    private async sendWebSocketMessage(message: string): Promise<void> {
        const wsMessage = {
            type: "PLAN_SELECTION",
            message,
            timestamp: new Date().toISOString(),
            options: ["A", "B", "C", "HALT", "POSTPONE"]
        };

        this.wsServer.broadcast(wsMessage);
    }

    private sendConsoleMessage(message: string): void {
        console.log("\n" + "=".repeat(60));
        console.log(message);
        console.log("=".repeat(60) + "\n");
    }

    private async waitForUserResponse(x: DialogInput, startTime: number): Promise<DialogResult> {
        return new Promise((resolve) => {
            const timeout = setTimeout(() => {
                this.logger.warn({ sessionId: x.sessionId }, "Dialog timeout reached");
                resolve({
                    sessionId: x.sessionId,
                    selectedPlan: x.autoFallback || "TIMEOUT",
                    fallbackReason: "timeout",
                    totalDurationMs: Date.now() - startTime,
                    timestamp: new Date().toISOString()
                });
            }, x.defaultTimeoutMs);

            // Mock user response simulation (for demo purposes)
            setTimeout(() => {
                clearTimeout(timeout);
                const mockResponse: UserResponse = {
                    userId: x.users[0]?.id || "mock_user",
                    planId: x.plans[0]?.id || "A",
                    timestamp: new Date().toISOString(),
                    channel: x.users[0]?.preferredChannel || "telegram",
                    responseTime: Date.now() - startTime
                };

                resolve({
                    sessionId: x.sessionId,
                    selectedPlan: mockResponse.planId,
                    userResponse: mockResponse,
                    totalDurationMs: Date.now() - startTime,
                    timestamp: new Date().toISOString(),
                    metadata: { 
                        mockResponse: true,
                        availablePlans: x.plans.length 
                    }
                });
            }, Math.min(2000, x.defaultTimeoutMs / 2)); // Mock response after 2 seconds or half timeout
        });
    }

    // --- Hata ---
    private err(code: string, message: string, details?: any): { error: DialogError } {
        const e = { code, message, details, retriable: false };
        this.logger?.error({ code, details }, message);
        this.emit('audit.log', { 
            asOf: new Date().toISOString(), 
            ver: this.ver, 
            src: this.src, 
            payload: { error: e } 
        });
        return { error: e };
    }

    /**
     * Get module status
     */
    getStatus(): any {
        return {
            name: 'OperatorDialog',
            version: this.ver,
            initialized: this.isInitialized,
            activeSessions: this.activeSessions.size,
            channels: {
                telegram: !!this.telegramBot,
                discord: !!this.discordClient,
                websocket: !!this.wsServer
            }
        };
    }

    async shutdown(): Promise<void> {
        try {
            this.logger?.info('OperatorDialog shutting down...');
            this.activeSessions.clear();
            this.removeAllListeners();
            this.isInitialized = false;
            this.logger?.info('OperatorDialog shutdown complete');
        } catch (error) {
            this.logger?.error('OperatorDialog shutdown error:', error);
        }
    }
}

export default OperatorDialog;
