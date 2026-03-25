# Resume Text-Only DOCX Editor

## Overview
A web app that edits ONLY the text in specific sections of a user-uploaded resume DOCX while preserving ALL formatting (alignment, bullets/numbering, indentation, spacing, fonts, sizes, styles).

## Architecture
- **Frontend**: React + Vite + Tailwind CSS + shadcn/ui components
- **Backend**: Express.js with multer for file uploads
- **DOCX Processing**: jszip + @xmldom/xmldom for XML-level paragraph cloning
- **PDF Conversion**: LibreOffice headless (`soffice --headless --convert-to pdf`)
- **No database** - uses temporary file storage in /tmp/docx-sessions

## Key Files
- `shared/schema.ts` - TypeScript types for API contracts
- `server/docx-utils.ts` - DOCX parsing, block detection, XML paragraph cloning
- `server/instruction-parser.ts` - Parses "Update X with:" instruction format
- `server/diff-utils.ts` - Generates HTML diff for preview
- `server/routes.ts` - API endpoints: upload, preview, apply, download
- `client/src/pages/home.tsx` - Upload page with drag-and-drop
- `client/src/pages/blocks.tsx` - Shows detected blocks
- `client/src/pages/edit.tsx` - Structured and instruction edit modes
- `client/src/pages/preview.tsx` - Before/after diff preview
- `client/src/pages/download.tsx` - Download result

## API Endpoints
- `POST /api/upload` - Upload DOCX, returns session + detected blocks
- `POST /api/preview` - Generate text diff preview
- `POST /api/apply` - Apply changes, accepts `removeMarkers` (default true), returns `downloadUrl` (FINAL) + `masterDownloadUrl` (MASTER) + `pdfDownloadUrl` (PDF)
- `GET /api/download/:sessionId/:fileName` - Download modified DOCX or PDF

## Option B: MASTER + FINAL + PDF Output
When applying changes, up to three versions are generated:
- **FINAL PDF** (primary download): PDF converted from FINAL DOCX via LibreOffice headless
- **FINAL DOCX**: Markers removed, submit-ready for job applications
- **MASTER DOCX**: Markers preserved for future editing
The preview page has a checkbox (default ON) to control FINAL generation. Download page shows all available download buttons.

`stripMarkers()` in `docx-utils.ts` uses recursive `collectAllParagraphs()` to find and remove marker paragraphs even inside tables.

## Formatting Preservation
- `cloneParagraphWithNewText()` creates separate runs for bold/non-bold segments when `**bold**` markdown syntax is used in replacement text
- Without `**` markers, all replacement text inherits the exemplar paragraph's first run formatting (font, size, etc.)
- Auto-detects "bold heading: non-bold content" pattern from exemplar paragraph (e.g., `Programming Languages: Python, SQL`) and automatically splits replacement text at the colon, making the heading bold and content normal - no `**` markers needed
- `normalizeBulletFonts()` remaps Symbol/Wingdings font references AND any private-use-area characters (U+E000-U+F8FF) in numbering.xml to Noto Sans with standard Unicode bullet (•) before PDF conversion
- Also normalizes standard bullet (U+2022) font references from Times New Roman to Noto Sans for consistent rendering
- Per-block "Remove bullet points" checkbox: strips `w:numPr` from cloned paragraphs via `stripBulletsBlocks` API param; if user checks the box without editing text, the block's current text is auto-submitted to enable bullet-only stripping
- System fonts installed: liberation_ttf, dejavu_fonts, freefont_ttf, noto-fonts (for proper LibreOffice PDF rendering)

## How Block Markers Work
DOCX must contain plain text paragraphs:
```
[[BLOCK:BLOCK_NAME]]
... content to replace ...
[[END:BLOCK_NAME]]
```

## User Flow
1. Upload .docx with block markers
2. Review detected blocks
3. Edit via structured mode (per-block textareas) or instruction mode
4. Preview before/after diff (checkbox to generate submit-ready FINAL)
5. Apply & download (PDF + FINAL DOCX for submissions, MASTER for future edits)
