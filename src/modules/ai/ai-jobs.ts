/** Stable BullMQ identity for one verified document content version. */
export function documentExtractionJobId(documentId: string, sha256: string): string {
    return `document-ai-${documentId}-${sha256.toLowerCase()}`;
}

export type ExtractionRunSummary = {
    status: string;
    result: unknown;
};

/** Successful and terminally skipped extraction runs suppress automatic recovery. */
export function successfulExtractionDocumentIds(
    runs: readonly ExtractionRunSummary[],
): Set<string> {
    const ids = new Set<string>();
    for (const run of runs) {
        if (!["SUCCEEDED", "SKIPPED", "FAILED_PERMANENT"].includes(run.status) || !run.result || typeof run.result !== "object") {
            continue;
        }
        const documentId = (run.result as { document_id?: unknown }).document_id;
        if (typeof documentId === "string" && documentId.length > 0) ids.add(documentId);
    }
    return ids;
}
