import { z } from "zod";
export declare const TestSchema: z.ZodObject<{
    test: z.ZodString;
}, "strip", z.ZodTypeAny, {
    test: string;
}, {
    test: string;
}>;
export declare const validateEvent: (data: unknown) => z.SafeParseReturnType<{
    test: string;
}, {
    test: string;
}>;
export declare const AllSchemas: {
    TestSchema: z.ZodObject<{
        test: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        test: string;
    }, {
        test: string;
    }>;
};
//# sourceMappingURL=index-simple.d.ts.map