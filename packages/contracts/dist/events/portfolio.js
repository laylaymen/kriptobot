import { z } from "zod";
const Timestamp = z.string().datetime();
export const PortfolioBalanceDirectiveSchema = z.object({
    event: z.literal("portfolio.balance.directive"),
    timestamp: Timestamp,
    capUsd: z.number().finite().min(0),
    perSymbolCapUsd: z.number().finite().min(0),
    rebalance: z.boolean().default(false),
    reason: z.string().min(1)
}).strict();
export const PositionSizeSuggestionSchema = z.object({
    event: z.literal("position.size.suggestion"),
    timestamp: Timestamp,
    symbol: z.string().min(1),
    strategy: z.string().min(1),
    baseSizeUsd: z.number().finite().min(0),
    adjustPct: z.number().finite(),
    reason: z.string().min(1)
}).strict();
export const ComposerIntentFilteredSchema = z.object({
    event: z.literal("composer.intent.filtered"),
    timestamp: Timestamp,
    symbol: z.string().min(1),
    strategy: z.string().min(1),
    variant: z.enum(["conservative", "base", "aggressive"]),
    allowed: z.boolean(),
    reasonCodes: z.array(z.string()).default([])
}).strict();
//# sourceMappingURL=portfolio.js.map