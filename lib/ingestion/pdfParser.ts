import fs from "fs";
import path from "path";

// ============================================================
// PDF Parser
// Uses pdf-parse (server-side only, never import in client code).
// Strips headers/footers via page-render callback.
// Returns clean plain text for the chunker.
// ============================================================

export async function parsePdfFromBuffer(buffer: Buffer): Promise<string> {
  // Dynamic import keeps this out of the client bundle
  const pdfParse = (await import("pdf-parse")).default;

  const data = await pdfParse(buffer, {
    // Suppress pdf-parse's test file check in non-test envs
    max: 0,
  });

  return cleanExtractedText(data.text);
}

export async function parsePdfFromPath(filePath: string): Promise<string> {
  const absolutePath = path.resolve(filePath);
  const buffer = fs.readFileSync(absolutePath);
  return parsePdfFromBuffer(buffer);
}

function cleanExtractedText(raw: string): string {
  return raw
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    // Remove repeated whitespace on a single line
    .replace(/[ \t]{2,}/g, " ")
    // Collapse 3+ blank lines to 2
    .replace(/\n{3,}/g, "\n\n")
    // Strip lines that are purely page numbers or header noise
    .replace(/^\s*\d+\s*$/gm, "")
    .trim();
}
