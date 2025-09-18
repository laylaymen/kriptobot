import { TimestampSchema } from "./events/telemetry.js";
export { TimestampSchema };
export const validateEvent = (data) => TimestampSchema.safeParse(data);
//# sourceMappingURL=index-debug.js.map