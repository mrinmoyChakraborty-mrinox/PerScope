import { z } from "zod";

export const name = "capture_tab";
export const description =
  "Trigger the extension's image pipeline (OCR/NER/heuristics/FastVLM/redaction) on a tab. Returns the redacted image plus evidence. Omit tabId for the active tab.";
export const inputSchema = z.object({
  tabId: z.number().int().positive().optional().describe("Target tab id; omit for the active tab."),
});
