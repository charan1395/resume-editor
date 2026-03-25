import { z } from "zod";

export const blockInfoSchema = z.object({
  name: z.string(),
  currentText: z.string(),
  paragraphCount: z.number(),
  hasBullets: z.boolean().optional(),
});

export const uploadResponseSchema = z.object({
  sessionId: z.string(),
  fileName: z.string(),
  blocks: z.array(blockInfoSchema),
});

export const editRequestSchema = z.object({
  sessionId: z.string(),
  replacements: z.record(z.string(), z.string()),
  stripBulletsBlocks: z.array(z.string()).optional(),
});

export const blockDiffSchema = z.object({
  blockName: z.string(),
  before: z.string(),
  after: z.string(),
  diffHtml: z.string(),
});

export const previewResponseSchema = z.object({
  sessionId: z.string(),
  diffs: z.array(blockDiffSchema),
});

export const applyResponseSchema = z.object({
  sessionId: z.string(),
  downloadUrl: z.string(),
  masterDownloadUrl: z.string(),
  pdfDownloadUrl: z.string().optional(),
  updatedBlocks: z.array(z.string()),
  log: z.string(),
});

export type BlockInfo = z.infer<typeof blockInfoSchema>;
export type UploadResponse = z.infer<typeof uploadResponseSchema>;
export type EditRequest = z.infer<typeof editRequestSchema>;
export type BlockDiff = z.infer<typeof blockDiffSchema>;
export type PreviewResponse = z.infer<typeof previewResponseSchema>;
export type ApplyResponse = z.infer<typeof applyResponseSchema>;
