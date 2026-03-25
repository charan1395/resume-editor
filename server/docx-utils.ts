import JSZip from "jszip";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";

const BLOCK_START_RE = /^\[\[BLOCK:(.+?)\]\]$/;
const BLOCK_END_RE = /^\[\[END:(.+?)\]\]$/;
const BULLET_GLYPH_RE = /^[\u2022\u2023\u2043\u25AA\u25AB\u25B8\u25B9\u25CF\u25CB\u25A0\u25A1\u25E6\u2219\u2013\u2014\u27A2\u2192]\s*/;

export interface BlockLocation {
  name: string;
  startMarker: Element;
  endMarker: Element;
  contentParagraphs: Element[];
}

export interface ParsedDocx {
  zip: JSZip;
  xmlDoc: Document;
  body: Element;
  blocks: BlockLocation[];
}

function getParagraphText(p: Element): string {
  const runs = p.getElementsByTagName("w:r");
  let text = "";
  for (let i = 0; i < runs.length; i++) {
    const tNodes = runs[i].getElementsByTagName("w:t");
    for (let j = 0; j < tNodes.length; j++) {
      text += tNodes[j].textContent || "";
    }
  }
  return text;
}

export function extractBlockText(block: BlockLocation): string {
  return block.contentParagraphs.map((p) => getParagraphText(p)).join("\n");
}

export async function parseDocx(buffer: Buffer): Promise<ParsedDocx> {
  const zip = await JSZip.loadAsync(buffer);
  const docXmlFile = zip.file("word/document.xml");
  if (!docXmlFile) throw new Error("Invalid DOCX: missing word/document.xml");
  const docXml = await docXmlFile.async("string");
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(docXml, "application/xml");

  const body = xmlDoc.getElementsByTagName("w:body")[0];
  if (!body) throw new Error("Invalid DOCX: no w:body element found");

  const paragraphs: Element[] = [];
  const allChildren = body.childNodes;
  for (let i = 0; i < allChildren.length; i++) {
    const node = allChildren[i];
    if (node.nodeType === 1 && (node as Element).tagName === "w:p") {
      paragraphs.push(node as Element);
    }
  }

  const blocks: BlockLocation[] = [];
  const openBlocks: Map<string, { startMarker: Element; startIdx: number }> = new Map();

  for (let i = 0; i < paragraphs.length; i++) {
    const text = getParagraphText(paragraphs[i]).trim();
    const startMatch = text.match(BLOCK_START_RE);
    const endMatch = text.match(BLOCK_END_RE);

    if (startMatch) {
      openBlocks.set(startMatch[1], { startMarker: paragraphs[i], startIdx: i });
    } else if (endMatch) {
      const name = endMatch[1];
      const open = openBlocks.get(name);
      if (open) {
        const contentParagraphs: Element[] = [];
        for (let j = open.startIdx + 1; j < i; j++) {
          contentParagraphs.push(paragraphs[j]);
        }
        blocks.push({
          name,
          startMarker: open.startMarker,
          endMarker: paragraphs[i],
          contentParagraphs,
        });
        openBlocks.delete(name);
      }
    }
  }

  return { zip, xmlDoc, body, blocks };
}

interface TextSegment {
  text: string;
  bold: boolean;
}

function parseBoldSegments(line: string): TextSegment[] {
  const segments: TextSegment[] = [];
  const regex = /\*\*(.+?)\*\*/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(line)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ text: line.slice(lastIndex, match.index), bold: false });
    }
    segments.push({ text: match[1], bold: true });
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < line.length) {
    segments.push({ text: line.slice(lastIndex), bold: false });
  }

  if (segments.length === 0) {
    segments.push({ text: line, bold: false });
  }

  return segments;
}

function hasBoldMarkers(line: string): boolean {
  return /\*\*.+?\*\*/.test(line);
}

function cloneRunProperties(sourceRun: Element, doc: Document): Element | null {
  const rPr = sourceRun.getElementsByTagName("w:rPr");
  if (rPr.length > 0) {
    return rPr[0].cloneNode(true) as Element;
  }
  return null;
}

function ensureBold(rPr: Element, doc: Document): void {
  const bNodes = rPr.getElementsByTagName("w:b");
  if (bNodes.length === 0) {
    const b = doc.createElement("w:b");
    rPr.insertBefore(b, rPr.firstChild);
  }
  const bCsNodes = rPr.getElementsByTagName("w:bCs");
  if (bCsNodes.length === 0) {
    const bCs = doc.createElement("w:bCs");
    const bNode = rPr.getElementsByTagName("w:b")[0];
    if (bNode && bNode.nextSibling) {
      rPr.insertBefore(bCs, bNode.nextSibling);
    } else {
      rPr.appendChild(bCs);
    }
  }
}

function removeBold(rPr: Element): void {
  const bNodes = rPr.getElementsByTagName("w:b");
  for (let i = bNodes.length - 1; i >= 0; i--) {
    rPr.removeChild(bNodes[i]);
  }
  const bCsNodes = rPr.getElementsByTagName("w:bCs");
  for (let i = bCsNodes.length - 1; i >= 0; i--) {
    rPr.removeChild(bCsNodes[i]);
  }
}

interface ExemplarRunInfo {
  rPr: Element | null;
  isBold: boolean;
  text: string;
}

function analyzeExemplarRuns(exemplar: Element): ExemplarRunInfo[] {
  const runs = exemplar.getElementsByTagName("w:r");
  const infos: ExemplarRunInfo[] = [];
  for (let i = 0; i < runs.length; i++) {
    const tNodes = runs[i].getElementsByTagName("w:t");
    let text = "";
    for (let j = 0; j < tNodes.length; j++) {
      text += tNodes[j].textContent || "";
    }
    if (text.length === 0) continue;
    const rPrNodes = runs[i].getElementsByTagName("w:rPr");
    const rPr = rPrNodes.length > 0 ? rPrNodes[0] : null;
    const isBold = rPr ? rPr.getElementsByTagName("w:b").length > 0 : false;
    infos.push({ rPr, isBold, text });
  }
  return infos;
}

function detectSplitSeparator(exemplarRuns: ExemplarRunInfo[]): string | null {
  if (exemplarRuns.length < 2) return null;
  if (!exemplarRuns[0].isBold || exemplarRuns[1].isBold) return null;

  const boldText = exemplarRuns[0].text;
  const colonMatch = boldText.match(/:\s*$/);
  if (colonMatch) return ":";
  const dashMatch = boldText.match(/[–—-]\s*$/);
  if (dashMatch) return dashMatch[0].trim();
  return null;
}

function cloneParagraphWithNewText(exemplar: Element, newText: string, doc: Document): Element {
  const cloned = exemplar.cloneNode(true) as Element;
  const runs = cloned.getElementsByTagName("w:r");

  const exemplarRuns = analyzeExemplarRuns(exemplar);
  const useBoldParsing = hasBoldMarkers(newText);
  const splitSep = !useBoldParsing ? detectSplitSeparator(exemplarRuns) : null;

  let segments: TextSegment[];
  if (useBoldParsing) {
    segments = parseBoldSegments(newText);
  } else if (splitSep && newText.includes(splitSep)) {
    const sepIdx = newText.indexOf(splitSep);
    const boldPart = newText.slice(0, sepIdx + splitSep.length) + " ";
    const normalPart = newText.slice(sepIdx + splitSep.length).trimStart();
    segments = [
      { text: boldPart, bold: true },
      { text: normalPart, bold: false },
    ];
  } else {
    segments = [{ text: newText, bold: false }];
  }

  const boldTemplateRun = exemplarRuns.find(r => r.isBold) || exemplarRuns[0] || null;
  const normalTemplateRun = exemplarRuns.find(r => !r.isBold) || exemplarRuns[0] || null;

  const runsToRemove: Element[] = [];
  for (let i = 0; i < runs.length; i++) {
    runsToRemove.push(runs[i]);
  }

  let insertBefore: Node | null = null;
  if (runsToRemove.length > 0) {
    insertBefore = runsToRemove[runsToRemove.length - 1].nextSibling;
  }

  for (const r of runsToRemove) {
    cloned.removeChild(r);
  }

  for (const segment of segments) {
    const newRun = doc.createElement("w:r");

    const templateInfo = (useBoldParsing || splitSep)
      ? (segment.bold ? boldTemplateRun : normalTemplateRun)
      : (exemplarRuns[0] || null);

    if (templateInfo && templateInfo.rPr) {
      const rPrClone = templateInfo.rPr.cloneNode(true) as Element;
      if (useBoldParsing) {
        if (segment.bold) {
          ensureBold(rPrClone, doc);
        } else {
          removeBold(rPrClone);
        }
      }
      newRun.appendChild(rPrClone);
    } else if ((useBoldParsing || splitSep) && segment.bold) {
      const rPr = doc.createElement("w:rPr");
      ensureBold(rPr, doc);
      newRun.appendChild(rPr);
    }

    const t = doc.createElement("w:t");
    t.setAttribute("xml:space", "preserve");
    t.textContent = segment.text;
    newRun.appendChild(t);

    if (insertBefore) {
      cloned.insertBefore(newRun, insertBefore);
    } else {
      cloned.appendChild(newRun);
    }
  }

  return cloned;
}

function stripBulletGlyph(line: string): string {
  return line.replace(BULLET_GLYPH_RE, "");
}

export function applyReplacement(
  parsed: ParsedDocx,
  blockName: string,
  newContent: string,
  options?: { stripBullets?: boolean }
): { success: boolean; error?: string } {
  const block = parsed.blocks.find((b) => b.name === blockName);
  if (!block) {
    return { success: false, error: `Block "${blockName}" not found in document` };
  }

  const lines = newContent
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length === 0) {
    return { success: false, error: `No replacement lines provided for block "${blockName}"` };
  }

  if (block.contentParagraphs.length === 0) {
    return {
      success: false,
      error: `Block "${blockName}" is empty - no exemplar paragraph to clone. Add at least one formatted line in the block.`,
    };
  }

  const exemplar = block.contentParagraphs[0];
  const hasBullet = exemplar.getElementsByTagName("w:numPr").length > 0;

  for (const contentP of block.contentParagraphs) {
    parsed.body.removeChild(contentP);
  }

  const newParagraphs: Element[] = [];
  for (const line of lines) {
    const lineText = hasBullet ? stripBulletGlyph(line) : line;
    const newP = cloneParagraphWithNewText(exemplar, lineText, parsed.xmlDoc);

    if (options?.stripBullets) {
      const pPr = newP.getElementsByTagName("w:pPr");
      if (pPr.length > 0) {
        const numPrs = pPr[0].getElementsByTagName("w:numPr");
        while (numPrs.length > 0) {
          pPr[0].removeChild(numPrs[0]);
        }
      }
    }

    parsed.body.insertBefore(newP, block.endMarker);
    newParagraphs.push(newP);
  }

  block.contentParagraphs = newParagraphs;

  return { success: true };
}

export async function serializeDocx(parsed: ParsedDocx): Promise<Buffer> {
  const serializer = new XMLSerializer();
  const newXml = serializer.serializeToString(parsed.xmlDoc);
  parsed.zip.file("word/document.xml", newXml);
  const outputBuffer = await parsed.zip.generateAsync({ type: "nodebuffer" });
  return outputBuffer;
}

export function getBlockInfoList(parsed: ParsedDocx) {
  return parsed.blocks.map((block) => {
    const hasBullets = block.contentParagraphs.length > 0 &&
      block.contentParagraphs[0].getElementsByTagName("w:numPr").length > 0;
    return {
      name: block.name,
      currentText: extractBlockText(block),
      paragraphCount: block.contentParagraphs.length,
      hasBullets,
    };
  });
}

const MARKER_BLOCK_RE = /^\s*\[\[BLOCK:[A-Z0-9_]+\]\]\s*$/;
const MARKER_END_RE = /^\s*\[\[END:[A-Z0-9_]+\]\]\s*$/;

function collectAllParagraphs(parent: Element): Element[] {
  const result: Element[] = [];
  const children = parent.childNodes;
  for (let i = 0; i < children.length; i++) {
    const node = children[i];
    if (node.nodeType !== 1) continue;
    const el = node as Element;
    if (el.tagName === "w:p") {
      result.push(el);
    } else if (el.tagName === "w:tbl") {
      const rows = el.getElementsByTagName("w:tr");
      for (let r = 0; r < rows.length; r++) {
        const cells = rows[r].getElementsByTagName("w:tc");
        for (let c = 0; c < cells.length; c++) {
          result.push(...collectAllParagraphs(cells[c]));
        }
      }
    }
  }
  return result;
}

const SYMBOL_FONTS = ["symbol", "wingdings", "wingdings 2", "wingdings 3", "webdings", "zapf dingbats"];

function isPrivateUseChar(ch: string): boolean {
  const code = ch.charCodeAt(0);
  return (code >= 0xE000 && code <= 0xF8FF) || (code >= 0xF000 && code <= 0xF0FF);
}

function hasPrivateUseChars(str: string): boolean {
  for (let i = 0; i < str.length; i++) {
    if (isPrivateUseChar(str[i])) return true;
  }
  return false;
}

function cleanBulletRunProps(lvl: Element, xmlDoc: Document): void {
  const rPrs = lvl.getElementsByTagName("w:rPr");
  if (rPrs.length > 0) {
    lvl.removeChild(rPrs[0]);
  }
  const newRPr = xmlDoc.createElement("w:rPr");
  const newRFonts = xmlDoc.createElement("w:rFonts");
  newRFonts.setAttribute("w:ascii", "Noto Sans");
  newRFonts.setAttribute("w:hAnsi", "Noto Sans");
  newRFonts.setAttribute("w:cs", "Noto Sans");
  newRFonts.setAttribute("w:hint", "default");
  newRPr.appendChild(newRFonts);
  const bOff = xmlDoc.createElement("w:b");
  bOff.setAttribute("w:val", "0");
  newRPr.appendChild(bOff);
  const bCsOff = xmlDoc.createElement("w:bCs");
  bCsOff.setAttribute("w:val", "0");
  newRPr.appendChild(bCsOff);
  const iOff = xmlDoc.createElement("w:i");
  iOff.setAttribute("w:val", "0");
  newRPr.appendChild(iOff);
  const iCsOff = xmlDoc.createElement("w:iCs");
  iCsOff.setAttribute("w:val", "0");
  newRPr.appendChild(iCsOff);
  const sz = xmlDoc.createElement("w:sz");
  sz.setAttribute("w:val", "20");
  newRPr.appendChild(sz);
  const szCs = xmlDoc.createElement("w:szCs");
  szCs.setAttribute("w:val", "20");
  newRPr.appendChild(szCs);
  lvl.appendChild(newRPr);
}

export async function normalizeBulletFonts(buffer: Buffer): Promise<Buffer> {
  const zip = await JSZip.loadAsync(buffer);
  const numberingFile = zip.file("word/numbering.xml");
  if (!numberingFile) return buffer;

  const numberingXml = await numberingFile.async("string");
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(numberingXml, "application/xml");

  const levels = xmlDoc.getElementsByTagName("w:lvl");
  let modified = false;

  for (let i = 0; i < levels.length; i++) {
    const lvl = levels[i];
    const numFmt = lvl.getElementsByTagName("w:numFmt");
    if (numFmt.length === 0) continue;
    const fmtVal = numFmt[0].getAttribute("w:val");
    if (fmtVal !== "bullet") continue;

    const lvlText = lvl.getElementsByTagName("w:lvlText");
    if (lvlText.length === 0) continue;

    const val = lvlText[0].getAttribute("w:val") || "";

    const rFonts = lvl.getElementsByTagName("w:rFonts");
    const fontName = rFonts.length > 0 ? (rFonts[0].getAttribute("w:ascii") || "").toLowerCase() : "";
    const isSymbolFont = SYMBOL_FONTS.includes(fontName);
    const hasPUA = hasPrivateUseChars(val);

    if (isSymbolFont || hasPUA) {
      lvlText[0].setAttribute("w:val", "\u2022");
      cleanBulletRunProps(lvl, xmlDoc);
      modified = true;
    } else if (val === "\u2022") {
      const currentFont = fontName;
      if (currentFont !== "noto sans") {
        cleanBulletRunProps(lvl, xmlDoc);
        modified = true;
      }
    }
  }

  if (!modified) return buffer;

  const serializer = new XMLSerializer();
  const newXml = serializer.serializeToString(xmlDoc);
  zip.file("word/numbering.xml", newXml);
  return await zip.generateAsync({ type: "nodebuffer" });
}

export async function stripMarkers(buffer: Buffer): Promise<Buffer> {
  const zip = await JSZip.loadAsync(buffer);
  const docXmlFile = zip.file("word/document.xml");
  if (!docXmlFile) throw new Error("Invalid DOCX: missing word/document.xml");
  const docXml = await docXmlFile.async("string");
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(docXml, "application/xml");

  const body = xmlDoc.getElementsByTagName("w:body")[0];
  if (!body) throw new Error("Invalid DOCX: no w:body element found");

  const allParagraphs = collectAllParagraphs(body);
  const toDelete: Element[] = [];

  for (const p of allParagraphs) {
    const text = getParagraphText(p).trim();
    if (MARKER_BLOCK_RE.test(text) || MARKER_END_RE.test(text)) {
      toDelete.push(p);
    }
  }

  for (const p of toDelete) {
    const parent = p.parentNode;
    if (parent) {
      parent.removeChild(p);
    }
  }

  const serializer = new XMLSerializer();
  const newXml = serializer.serializeToString(xmlDoc);
  zip.file("word/document.xml", newXml);
  return await zip.generateAsync({ type: "nodebuffer" });
}
