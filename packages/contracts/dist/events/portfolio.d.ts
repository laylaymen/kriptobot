import { z } from "zod";
export declare const PortfolioBalanceDirectiveSchema: z.ZodObject<{
    event: z.ZodLiteral<"portfolio.balance.directive">;
    timestamp: z.ZodString;
    capUsd: z.ZodNumber;
    perSymbolCapUsd: z.ZodNumber;
    rebalance: z.ZodDefault<z.ZodBoolean>;
    reason: z.ZodString;
}, "strict", z.ZodTypeAny, {
    event: "portfolio.balance.directive";
    timestamp: string;
    reason: string;
    capUsd: number;
    perSymbolCapUsd: number;
    rebalance: boolean;
}, {
    event: "portfolio.balance.directive";
    timestamp: string;
    reason: string;
    capUsd: number;
    perSymbolCapUsd: number;
    rebalance?: boolean | undefined;
}>;
export declare const PositionSizeSuggestionSchema: z.ZodObject<{
    event: z.ZodLiteral<"position.size.suggestion">;
    timestamp: z.ZodString;
    symbol: z.ZodString;
    strategy: z.ZodString;
    baseSizeUsd: z.ZodNumber;
    adjustPct: z.ZodNumber;
    reason: z.ZodString;
}, "strict", z.ZodTypeAny, {
    symbol: string;
    event: "position.size.suggestion";
    timestamp: string;
    reason: string;
    strategy: string;
    baseSizeUsd: number;
    adjustPct: number;
}, {
    symbol: string;
    event: "position.size.suggestion";
    timestamp: string;
    reason: string;
    strategy: string;
    baseSizeUsd: number;
    adjustPct: number;
}>;
export declare const ComposerIntentFilteredSchema: z.ZodObject<{
    event: z.ZodLiteral<"composer.intent.filtered">;
    timestamp: z.ZodString;
    symbol: z.ZodString;
    strategy: z.ZodString;
    variant: z.ZodEnum<["conservative", "base", "aggressive"]>;
    allowed: z.ZodBoolean;
    reasonCodes: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
}, "strict", z.ZodTypeAny, {
    symbol: string;
    event: "composer.intent.filtered";
    timestamp: string;
    strategy: string;
    variant: "conservative" | "base" | "aggressive";
    allowed: boolean;
    reasonCodes: string[];
}, {
    symbol: string;
    event: "composer.intent.filtered";
    timestamp: string;
    strategy: string;
    variant: "conservative" | "base" | "aggressive";
    allowed: boolean;
    reasonCodes?: string[] | undefined;
}>;
export type PortfolioBalanceDirective = z.infer<typeof PortfolioBalanceDirectiveSchema>;
export type PositionSizeSuggestion = z.infer<typeof PositionSizeSuggestionSchema>;
export type ComposerIntentFiltered = z.infer<typeof ComposerIntentFilteredSchema>;
//# sourceMappingURL=portfolio.d.ts.map