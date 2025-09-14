import { z } from 'zod';
export interface LoadOptions {
    moduleName: string;
    cfgDir?: string;
}
export declare const BaseModuleConfigSchema: z.ZodObject<{
    enabled: z.ZodDefault<z.ZodBoolean>;
    logLevel: z.ZodDefault<z.ZodEnum<["debug", "info", "warn", "error"]>>;
}, "strict", z.ZodTypeAny, {
    enabled: boolean;
    logLevel: "debug" | "info" | "warn" | "error";
}, {
    enabled?: boolean | undefined;
    logLevel?: "debug" | "info" | "warn" | "error" | undefined;
}>;
export type BaseModuleConfig = z.infer<typeof BaseModuleConfigSchema>;
export declare function loadConfig<T extends z.ZodTypeAny>(opts: LoadOptions, schema: T): z.infer<T>;
