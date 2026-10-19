import { describe, expect, it } from "vitest";
import { documentExtractionJobId, successfulExtractionDocumentIds } from "../src/modules/ai/ai-jobs.js";

describe("AI extraction recovery helpers", () => {
  it("creates a stable ID for the same document content", () => {
    const id = "document-uuid";
    const hash = "A".repeat(64);
    expect(documentExtractionJobId(id, hash)).toBe(documentExtractionJobId(id, hash.toLowerCase()));
    expect(documentExtractionJobId(id, hash)).toBe(`document-ai-${id}-${hash.toLowerCase()}`);
  });

  it("changes the job ID when document content changes", () => {
    expect(documentExtractionJobId("doc-1", "a".repeat(64)))
      .not.toBe(documentExtractionJobId("doc-1", "b".repeat(64)));
  });

  it("only suppresses recovery for successful extraction runs with a document ID", () => {
    const ids = successfulExtractionDocumentIds([
      { status: "SUCCEEDED", result: { document_id: "done-doc" } },
      { status: "FAILED", result: { document_id: "failed-doc" } },
      { status: "SUCCEEDED", result: { other_id: "no-doc" } },
      { status: "SUCCEEDED", result: null },
    ]);
    expect([...ids]).toEqual(["done-doc"]);
  });
});
