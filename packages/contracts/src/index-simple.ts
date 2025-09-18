// Simple test export for debugging
import { z } from "zod";

export const TestSchema = z.object({
  test: z.string()
});

export const validateEvent = (data: unknown) => {
  return TestSchema.safeParse(data);
};

export const AllSchemas = {
  TestSchema
};