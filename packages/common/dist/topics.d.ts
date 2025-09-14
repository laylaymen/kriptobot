import { z } from 'zod';
declare const TopicSchema: z.ZodObject<{
    name: z.ZodString;
    direction: z.ZodEnum<["in", "out", "both"]>;
    pii: z.ZodEnum<["none", "low", "basic", "strict"]>;
    retention: z.ZodObject<{
        memorySec: z.ZodNumber;
        persistDays: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        memorySec: number;
        persistDays: number;
    }, {
        memorySec: number;
        persistDays: number;
    }>;
    owners: z.ZodArray<z.ZodString, "many">;
    notes: z.ZodOptional<z.ZodString>;
}, "strict", z.ZodTypeAny, {
    name: string;
    direction: "in" | "out" | "both";
    pii: "none" | "low" | "basic" | "strict";
    retention: {
        memorySec: number;
        persistDays: number;
    };
    owners: string[];
    notes?: string | undefined;
}, {
    name: string;
    direction: "in" | "out" | "both";
    pii: "none" | "low" | "basic" | "strict";
    retention: {
        memorySec: number;
        persistDays: number;
    };
    owners: string[];
    notes?: string | undefined;
}>;
export type Topic = z.infer<typeof TopicSchema>;
export declare function loadTopics(topicsFilePath: string): Topic[];
export {};
