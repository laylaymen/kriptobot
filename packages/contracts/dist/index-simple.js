// Simple test export for debugging
import { z } from "zod";
export const TestSchema = z.object({
    test: z.string()
});
export const validateEvent = (data) => {
    return TestSchema.safeParse(data);
};
export const AllSchemas = {
    TestSchema
};
//# sourceMappingURL=index-simple.js.map