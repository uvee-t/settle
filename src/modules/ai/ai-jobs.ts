/** Stable BullMQ identity for one verified document content version. */
export function documentExtractionJobId(documentId: string, sha256: string): string {
    return `document-ai-${documentId}-${sha256.toLowerCase()}`;
}

export type ExtractionRunSummary = {
    status: string;
    result: unknown;
};

/** Only successful extraction runs suppress recovery scheduling. */
export function successfulExtractionDocumentIds(
    runs: readonly ExtractionRunSummary[],
): Set<string> {
    const ids = new Set<string>();
    for (const run of runs) {
        if (run.status !== "SUCCEEDED" || !run.result || typeof run.result !== "object") {
            continue;
        }
        const documentId = (run.result as { document_id?: unknown }).document_id;
        if (typeof documentId === "string" && documentId.length > 0) ids.add(documentId);
    }
    return ids;
}
