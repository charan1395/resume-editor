import type { Express } from "express";
import { createServer, type Server } from "http";
import multer from "multer";
import path from "path";
import fs from "fs";
import { randomUUID } from "crypto";
import { execSync } from "child_process";
import { z } from "zod";
import { parseDocx, getBlockInfoList, applyReplacement, serializeDocx, extractBlockText, stripMarkers, normalizeBulletFonts } from "./docx-utils";
import { parseInstructions } from "./instruction-parser";
import { generateDiffHtml } from "./diff-utils";
import { log } from "./index";

const UPLOAD_DIR = path.join("/tmp", "docx-sessions");
const LOCKED_BLOCKS: string[] = [];

if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (
      file.mimetype === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
      file.originalname.endsWith(".docx")
    ) {
      cb(null, true);
    } else {
      cb(new Error("Only .docx files are allowed"));
    }
  },
});

const sessionCache = new Map<string, { filePath: string; fileName: string }>();

const editBodySchema = z.object({
  sessionId: z.string().min(1, "sessionId is required"),
  replacements: z.record(z.string(), z.string()).refine(
    (obj) => Object.keys(obj).length > 0,
    "At least one replacement is required"
  ),
  removeMarkers: z.boolean().optional().default(true),
  stripBulletsBlocks: z.array(z.string()).optional().default([]),
});

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  app.post("/api/upload", upload.single("file"), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: "No file uploaded" });
      }

      const sessionId = randomUUID();
      const sessionDir = path.join(UPLOAD_DIR, sessionId);
      fs.mkdirSync(sessionDir, { recursive: true });

      const filePath = path.join(sessionDir, "original.docx");
      fs.writeFileSync(filePath, req.file.buffer);

      const parsed = await parseDocx(req.file.buffer);
      const blocks = getBlockInfoList(parsed);

      sessionCache.set(sessionId, {
        filePath,
        fileName: req.file.originalname,
      });

      log(`Upload: session=${sessionId}, file=${req.file.originalname}, blocks=${blocks.length}`);

      res.json({
        sessionId,
        fileName: req.file.originalname,
        blocks,
      });
    } catch (err: any) {
      log(`Upload error: ${err.message}`);
      res.status(500).json({ message: err.message || "Failed to parse document" });
    }
  });

  app.post("/api/preview", async (req, res) => {
    try {
      const parseResult = editBodySchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({
          message: parseResult.error.errors.map((e) => e.message).join(", "),
        });
      }

      const { sessionId, replacements } = parseResult.data;

      const session = sessionCache.get(sessionId);
      if (!session) {
        return res.status(404).json({ message: "Session not found. Please re-upload." });
      }

      const buffer = fs.readFileSync(session.filePath);
      const parsed = await parseDocx(buffer);

      let finalReplacements: Record<string, string>;
      if (replacements.__instruction__) {
        finalReplacements = parseInstructions(replacements.__instruction__);
        if (Object.keys(finalReplacements).length === 0) {
          return res.status(400).json({
            message: "Could not parse any valid instructions. Use format: 'Update BLOCK_NAME with:' followed by content.",
          });
        }
      } else {
        finalReplacements = replacements;
      }

      for (const blockName of Object.keys(finalReplacements)) {
        if (LOCKED_BLOCKS.includes(blockName.toUpperCase())) {
          return res.status(403).json({
            message: `Block "${blockName}" is locked and cannot be edited.`,
          });
        }
      }

      const diffs = [];
      for (const [blockName, newContent] of Object.entries(finalReplacements)) {
        const block = parsed.blocks.find((b) => b.name === blockName.toUpperCase());
        if (!block) {
          const availableBlocks = parsed.blocks.map((b) => b.name).join(", ");
          return res.status(400).json({
            message: `Block "${blockName}" not found in document. Available blocks: ${availableBlocks}`,
          });
        }

        const before = extractBlockText(block);
        const lines = newContent.split("\n").map((l: string) => l.trim()).filter((l: string) => l.length > 0);
        const after = lines.join("\n");

        diffs.push({
          blockName: block.name,
          before,
          after,
          diffHtml: generateDiffHtml(before, after),
        });
      }

      log(`Preview: session=${sessionId}, blocks=${diffs.length}`);

      res.json({ sessionId, diffs });
    } catch (err: any) {
      log(`Preview error: ${err.message}`);
      res.status(500).json({ message: err.message || "Preview generation failed" });
    }
  });

  app.post("/api/apply", async (req, res) => {
    try {
      const parseResult = editBodySchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({
          message: parseResult.error.errors.map((e) => e.message).join(", "),
        });
      }

      const { sessionId, replacements, stripBulletsBlocks } = parseResult.data;

      const session = sessionCache.get(sessionId);
      if (!session) {
        return res.status(404).json({ message: "Session not found. Please re-upload." });
      }

      const buffer = fs.readFileSync(session.filePath);
      const parsed = await parseDocx(buffer);

      let finalReplacements: Record<string, string>;
      if (replacements.__instruction__) {
        finalReplacements = parseInstructions(replacements.__instruction__);
      } else {
        finalReplacements = replacements;
      }

      for (const blockName of Object.keys(finalReplacements)) {
        if (LOCKED_BLOCKS.includes(blockName.toUpperCase())) {
          return res.status(403).json({
            message: `Block "${blockName}" is locked and cannot be edited.`,
          });
        }
      }

      const stripSet = new Set((stripBulletsBlocks || []).map((n: string) => n.toUpperCase()));

      const logLines: string[] = [];
      const updatedBlocks: string[] = [];

      for (const [blockName, newContent] of Object.entries(finalReplacements)) {
        const upperName = blockName.toUpperCase();
        const result = applyReplacement(parsed, upperName, newContent, {
          stripBullets: stripSet.has(upperName),
        });
        if (!result.success) {
          return res.status(400).json({ message: result.error });
        }
        const lines = newContent.split("\n").map((l: string) => l.trim()).filter((l: string) => l.length > 0);
        updatedBlocks.push(upperName);
        logLines.push(`Updated ${upperName}: ${lines.length} line(s)`);
      }

      const masterBuffer = await serializeDocx(parsed);
      const baseName = session.fileName.replace(/\.docx$/i, "");
      const masterFileName = `${baseName}_MASTER.docx`;
      const masterPath = path.join(UPLOAD_DIR, sessionId, masterFileName);
      fs.writeFileSync(masterPath, masterBuffer);

      const masterDownloadUrl = `/api/download/${sessionId}/${encodeURIComponent(masterFileName)}`;
      let downloadUrl = masterDownloadUrl;

      const removeMarkers = req.body.removeMarkers !== false;

      let pdfDownloadUrl: string | undefined;

      if (removeMarkers) {
        const finalBuffer = await stripMarkers(masterBuffer);
        const finalFileName = `${baseName}_FINAL.docx`;
        const finalPath = path.join(UPLOAD_DIR, sessionId, finalFileName);
        fs.writeFileSync(finalPath, finalBuffer);
        downloadUrl = `/api/download/${sessionId}/${encodeURIComponent(finalFileName)}`;
        logLines.push("Generated submit-ready FINAL (markers removed)");
        logLines.push("Generated MASTER (markers preserved)");

        try {
          const sessionDir = path.join(UPLOAD_DIR, sessionId);
          const normalizedBuffer = await normalizeBulletFonts(finalBuffer);
          const wasNormalized = normalizedBuffer !== finalBuffer;
          if (wasNormalized) {
            log(`Bullet fonts normalized for PDF conversion`);
          }
          const pdfSourcePath = path.join(sessionDir, `${baseName}_PDF_SOURCE.docx`);
          fs.writeFileSync(pdfSourcePath, normalizedBuffer);
          execSync(`soffice --headless --convert-to pdf --outdir "${sessionDir}" "${pdfSourcePath}"`, {
            timeout: 30000,
            env: { ...process.env, HOME: "/tmp" },
          });
          try { fs.unlinkSync(pdfSourcePath); } catch (_) {}
          const sofficeOutputPdf = path.join(sessionDir, `${baseName}_PDF_SOURCE.pdf`);
          const pdfFileName = `Sricharan_DS_Resume.pdf`;
          const pdfPath = path.join(sessionDir, pdfFileName);
          if (fs.existsSync(sofficeOutputPdf) && sofficeOutputPdf !== pdfPath) {
            fs.renameSync(sofficeOutputPdf, pdfPath);
          }
          if (fs.existsSync(pdfPath)) {
            pdfDownloadUrl = `/api/download/${sessionId}/${encodeURIComponent(pdfFileName)}`;
            logLines.push("Generated PDF from FINAL");
          }
        } catch (pdfErr: any) {
          log(`PDF conversion warning: ${pdfErr.message}`);
          logLines.push("PDF generation skipped (conversion unavailable)");
        }
      } else {
        logLines.push("Generated MASTER only (markers preserved)");
      }

      log(`Apply: session=${sessionId}, updated=${updatedBlocks.join(",")}, removeMarkers=${removeMarkers}`);

      res.json({
        sessionId,
        downloadUrl,
        masterDownloadUrl,
        pdfDownloadUrl,
        updatedBlocks,
        log: logLines.join("\n"),
      });
    } catch (err: any) {
      log(`Apply error: ${err.message}`);
      res.status(500).json({ message: err.message || "Failed to apply changes" });
    }
  });

  app.get("/api/download/:sessionId/:fileName", (req, res) => {
    try {
      const { sessionId, fileName } = req.params;
      const filePath = path.join(UPLOAD_DIR, sessionId, decodeURIComponent(fileName));

      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ message: "File not found" });
      }

      const decodedName = decodeURIComponent(fileName);
      res.setHeader("Content-Disposition", `attachment; filename="${decodedName}"`);
      if (decodedName.endsWith(".pdf")) {
        res.setHeader("Content-Type", "application/pdf");
      } else {
        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
      }
      res.sendFile(filePath);
    } catch (err: any) {
      res.status(500).json({ message: "Download failed" });
    }
  });

  app.get("/api/download-source", (_req, res) => {
    try {
      const archivePath = path.join("/tmp", "resume-docx-editor.tar.gz");
      execSync(
        `tar czf ${archivePath} -C /home/runner/workspace --exclude='.git' --exclude='node_modules' --exclude='.cache' --exclude='.local' --exclude='.config' --exclude='.upm' --exclude='.replit' --exclude='replit.nix' --exclude='.breakpoints' --exclude='attached_assets' .`,
        { timeout: 15000 }
      );
      res.setHeader("Content-Disposition", 'attachment; filename="resume-docx-editor.tar.gz"');
      res.setHeader("Content-Type", "application/gzip");
      res.sendFile(archivePath);
    } catch (err: any) {
      log(`Source download error: ${err.message}`);
      res.status(500).json({ message: "Failed to create archive" });
    }
  });

  // ============================================================
  // ONE-SHOT GENERATE API — Claude Code calls this directly
  // POST /api/generate
  // Body: { replacements: { TECHNICAL_SKILLS: "...", WELLS_FARGO_POINTS: "...", ... } }
  // Uses the stored master template on the server
  // Returns: { pdfDownloadUrl, docxDownloadUrl, updatedBlocks, log }
  // ============================================================

  const MASTER_TEMPLATE_PATH = path.join(UPLOAD_DIR, "master_template.docx");

  // Upload/update the master template (one-time setup)
  app.post("/api/set-template", upload.single("file"), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: "No file uploaded" });
      }
      fs.writeFileSync(MASTER_TEMPLATE_PATH, req.file.buffer);
      const parsed = await parseDocx(req.file.buffer);
      const blocks = getBlockInfoList(parsed);
      log(`Template set: ${req.file.originalname}, blocks=${blocks.length}`);
      res.json({ success: true, blocks: blocks.map(b => b.name) });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // One-shot generate: accepts replacements, returns PDF download link
  app.post("/api/generate", async (req, res) => {
    try {
      const { replacements, jobTitle, company } = req.body;

      if (!replacements || typeof replacements !== "object" || Object.keys(replacements).length === 0) {
        return res.status(400).json({
          message: "replacements object is required with at least one block. Example: { \"TECHNICAL_SKILLS\": \"...\", \"WELLS_FARGO_POINTS\": \"...\" }"
        });
      }

      // Check for master template
      if (!fs.existsSync(MASTER_TEMPLATE_PATH)) {
        return res.status(400).json({
          message: "No master template found. Upload one first via POST /api/set-template"
        });
      }

      // Create a session
      const sessionId = randomUUID();
      const sessionDir = path.join(UPLOAD_DIR, sessionId);
      fs.mkdirSync(sessionDir, { recursive: true });

      const filePath = path.join(sessionDir, "original.docx");
      fs.copyFileSync(MASTER_TEMPLATE_PATH, filePath);

      const buffer = fs.readFileSync(filePath);
      const parsed = await parseDocx(buffer);

      const logLines: string[] = [];
      const updatedBlocks: string[] = [];

      // Apply all replacements
      for (const [blockName, newContent] of Object.entries(replacements)) {
        const upperName = blockName.toUpperCase();

        if (LOCKED_BLOCKS.includes(upperName)) {
          return res.status(403).json({ message: `Block "${blockName}" is locked.` });
        }

        const result = applyReplacement(parsed, upperName, newContent as string);
        if (!result.success) {
          return res.status(400).json({ message: result.error });
        }
        const lines = (newContent as string).split("\n").map((l: string) => l.trim()).filter((l: string) => l.length > 0);
        updatedBlocks.push(upperName);
        logLines.push(`Updated ${upperName}: ${lines.length} line(s)`);
      }

      // Generate MASTER (with markers)
      const masterBuffer = await serializeDocx(parsed);
      const safeName = company
        ? `${company.replace(/[^a-zA-Z0-9]/g, "_")}_${(jobTitle || "Resume").replace(/[^a-zA-Z0-9]/g, "_")}`
        : "SriCharan_Resume";

      // Generate FINAL (markers stripped)
      const finalBuffer = await stripMarkers(masterBuffer);
      const finalFileName = `${safeName}_FINAL.docx`;
      const finalPath = path.join(sessionDir, finalFileName);
      fs.writeFileSync(finalPath, finalBuffer);
      logLines.push("Generated submit-ready FINAL (markers removed)");

      const docxDownloadUrl = `/api/download/${sessionId}/${encodeURIComponent(finalFileName)}`;
      let pdfDownloadUrl: string | undefined;

      // Generate PDF
      try {
        const normalizedBuffer = await normalizeBulletFonts(finalBuffer);
        const pdfSourcePath = path.join(sessionDir, `${safeName}_PDF_SOURCE.docx`);
        fs.writeFileSync(pdfSourcePath, normalizedBuffer);
        execSync(`soffice --headless --convert-to pdf --outdir "${sessionDir}" "${pdfSourcePath}"`, {
          timeout: 30000,
          env: { ...process.env, HOME: "/tmp" },
        });
        try { fs.unlinkSync(pdfSourcePath); } catch (_) {}

        const sofficeOutputPdf = path.join(sessionDir, `${safeName}_PDF_SOURCE.pdf`);
        const pdfFileName = `${safeName}_SriCharan.pdf`;
        const pdfPath = path.join(sessionDir, pdfFileName);
        if (fs.existsSync(sofficeOutputPdf)) {
          fs.renameSync(sofficeOutputPdf, pdfPath);
        }
        if (fs.existsSync(pdfPath)) {
          pdfDownloadUrl = `/api/download/${sessionId}/${encodeURIComponent(pdfFileName)}`;
          logLines.push("Generated PDF");
        }
      } catch (pdfErr: any) {
        log(`PDF conversion warning: ${pdfErr.message}`);
        logLines.push("PDF generation skipped (conversion unavailable)");
      }

      // Build full download URLs
      const baseUrl = `${req.protocol}://${req.get("host")}`;

      log(`Generate: session=${sessionId}, company=${company}, blocks=${updatedBlocks.join(",")}`);

      res.json({
        success: true,
        sessionId,
        company: company || "Unknown",
        jobTitle: jobTitle || "Unknown",
        updatedBlocks,
        pdfDownloadUrl: pdfDownloadUrl ? `${baseUrl}${pdfDownloadUrl}` : undefined,
        docxDownloadUrl: `${baseUrl}${docxDownloadUrl}`,
        log: logLines.join("\n"),
      });
    } catch (err: any) {
      log(`Generate error: ${err.message}`);
      res.status(500).json({ message: err.message || "Generation failed" });
    }
  });

  // Health check for Claude Code to verify the API is up
  app.get("/api/health", (_req, res) => {
    const hasTemplate = fs.existsSync(MASTER_TEMPLATE_PATH);
    res.json({ status: "ok", hasTemplate });
  });

  return httpServer;
}
