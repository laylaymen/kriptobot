export interface AuditContext {
    module: string;
    src?: string;
    runId?: string;
    operator?: string;
}
export declare function makeAudit(event: Record<string, unknown>, ctx: AuditContext): {
    audit: {
        module: string;
        src: string;
        runId: string;
        ts: string;
    };
};
export declare function isDuplicate(idemKey: string, ttlSec: number, persistDir?: string): boolean;
