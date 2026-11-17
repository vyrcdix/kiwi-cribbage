/** ISO-8601 UTC timestamp. The single canonical format we round-trip with the client. */
export const nowIso = (): string => new Date().toISOString();
