import { TimestampSchema } from "./events/telemetry.js";

export { TimestampSchema };
export const validateEvent = (data: unknown) => TimestampSchema.safeParse(data);