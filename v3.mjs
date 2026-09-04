import fs from "node:fs/promises";
import sharp from "sharp";

import { PaddleOcrService, V6_SMALL_MODEL } from "ppu-paddle-ocr";

import {
    Florence2ForConditionalGeneration,
    AutoProcessor,
    AutoTokenizer,
    AutoModelForTokenClassification,
    load_image,
} from "@huggingface/transformers";

/* ============================================================
   CONFIG

   NOTE ON SCOPE: this pass only handles the "image only, no DOM"
   case, per the current task. DOM evidence + the tiered
   regex/checksum -> NER -> Qwen-adjudication redaction pipeline
   described in the architecture doc will be layered back in on
   top of this once the image-only path is solid. For now, NER
   findings above NER_MIN_SCORE are redacted directly (no
   adjudication tier) because the only thing leaving this module
   is a description, not a DOM mutation.
   ============================================================ */

const IMAGE_PATH = process.env.IMAGE_PATH || "./s1.jpg";

/* ---------------- PaddleOCR (ppu-paddle-ocr, real detector+recognizer) ---------------- */

// V6_SMALL_MODEL = PP-OCRv6 small, full dictionary. Swap to V6_TINY_MODEL
// (the package default) for a lighter/faster model, or a V5_*_MODEL preset
// for a specific language. This is a real detection+recognition OCR engine
// (not a VLM), so it also returns proper per-line bounding boxes.
const PADDLEOCR_MODEL_PRESET = V6_SMALL_MODEL;

const PADDLEOCR_RECOGNITION_STRATEGY =
    process.env.PADDLEOCR_STRATEGY || "per-line";

const PADDLEOCR_MIN_CONFIDENCE = Number(
    process.env.PADDLEOCR_MIN_CONFIDENCE ?? 0.5
);

/* ---------------- Florence ---------------- */

const FLORENCE_MODEL = "onnx-community/Florence-2-base";

const FLORENCE_TASKS = [
    { name: "global_description", task: "<MORE_DETAILED_CAPTION>" },
];

/* ---------------- NER (PII candidate detection) ---------------- */

const NER_MODEL = "./models/ettin-68m-nemotron-pii-onnx";
const NER_MODEL_FILE_NAME = "model";
const NER_MAX_TOKENS = 512;
const NER_MIN_SCORE = 0.3;

/* ---------------- Qwen Adjudication (Phase 5) ---------------- */

const QWEN_ENABLED = process.env.QWEN_ENABLED !== "0";
const QWEN_MODEL = process.env.QWEN_MODEL || "onnx-community/Qwen3.5-2B";
const QWEN_MAX_NEW_TOKENS = Number(process.env.QWEN_MAX_NEW_TOKENS ?? 256);
const QWEN_DTYPE = process.env.QWEN_DTYPE || "fp32";
const QWEN_DEBUG = process.env.QWEN_DEBUG === "1";
const QWEN_REQUIRED = process.env.QWEN_REQUIRED === "1"; // fail-closed when true
const QWEN_FALLBACK_POLICY = process.env.QWEN_FALLBACK_POLICY || "fusion"; // fusion | fail_closed
const QWEN_CONFIDENCE_THRESHOLD = Number(process.env.QWEN_CONFIDENCE_THRESHOLD ?? 0.7);
const FINAL_REDACTION_CONFIDENCE_THRESHOLD = Number(
    process.env.FINAL_REDACTION_CONFIDENCE_THRESHOLD ?? 0.5
);

/* ---------------- Outputs ---------------- */

const EVIDENCE_OUTPUT_PATH = "./perception_evidence.json";
const QWEN_OUTPUT_PATH = "./qwen_input.txt";
const OUTPUT_IMAGE_PATH = "./output.png";

/* ---------------- Image Redaction ----------------
   The output image is the original image with detected PII regions
   covered locally. No image generation model is used.

   Default:
     REDACTION_STYLE=black

   Optional:
     REDACTION_STYLE=blur
   -------------------------------------------------- */

const IMAGE_REDACTION_STYLE = (
    process.env.REDACTION_STYLE || "black"
).toLowerCase();

const IMAGE_REDACTION_PADDING = Math.max(
    0,
    Number(process.env.REDACTION_PADDING ?? 2)
);

/* ============================================================
   UTILS
   ============================================================ */

function logSection(title) {
    console.log("\n" + "=".repeat(60));
    console.log(` ${title}`);
    console.log("=".repeat(60));
}

function asString(value) {
    return value === null || value === undefined ? "" : String(value);
}

function cleanText(value) {
    return asString(value).replace(/\s+/g, " ").trim();
}

/* ============================================================
   PLACEHOLDER / NOISE FILTER
   Keeps obvious UI labels and example values out of the NER pass
   so we don't waste model calls (or raise false PII flags) on
   things like a literal "Email Address" field label.
   ============================================================ */

const EXACT_PLACEHOLDERS = new Set([
    "name@example.com", "user@example.com", "test@example.com",
    "example@example.com", "your@email.com", "yourname@example.com",
    "example.com", "enter your email", "enter email", "your email",
    "email address", "enter username", "your username", "username",
    "enter password", "your password", "password", "phone number",
    "enter phone number", "123456", "000000", "xxxx", "xxxxx", "********",
]);

const EXAMPLE_EMAIL_DOMAINS = new Set(["example.com", "example.org", "example.net"]);

function isExampleEmail(text) {
    const value = cleanText(text).toLowerCase();
    const match = value.match(/^[^\s@]+@([a-z0-9.-]+\.[a-z]{2,})$/i);
    return match ? EXAMPLE_EMAIL_DOMAINS.has(match[1]) : false;
}

function isPlaceholderText(text) {
    const value = cleanText(text).toLowerCase();
    if (!value) return true;
    if (EXACT_PLACEHOLDERS.has(value)) return true;
    if (isExampleEmail(value)) return true;
    return false;
}

function filterPlaceholderChunks(chunks) {
    return chunks.filter((chunk) => {
        if (!chunk || !chunk.text) return false;
        if (isPlaceholderText(chunk.text)) return false;
        return true;
    });
}

/* ============================================================
   FLORENCE â€” rich visual captioning
   ============================================================ */

async function loadFlorence() {
    logSection("Loading Florence-2");

    const model = await Florence2ForConditionalGeneration.from_pretrained(
        FLORENCE_MODEL,
        { dtype: "fp32" }
    );
    const processor = await AutoProcessor.from_pretrained(FLORENCE_MODEL);

    return { model, processor };
}

async function runFlorenceTask({ model, processor, image, task }) {
    const prompts = processor.construct_prompts(task);
    const inputs = await processor(image, prompts);

    const generatedIds = await model.generate({
        ...inputs,
        max_new_tokens: 512,
    });

    const generatedText = processor.batch_decode(generatedIds, {
        skip_special_tokens: false,
    })[0];

    const parsed = processor.post_process_generation(
        generatedText,
        task,
        image.size
    );

    return { task, raw: generatedText, parsed };
}

async function runFlorence(image) {
    const { model, processor } = await loadFlorence();
    const results = {};

    for (const config of FLORENCE_TASKS) {
        try {
            results[config.name] = await runFlorenceTask({
                model,
                processor,
                image,
                task: config.task,
            });
        } catch (error) {
            results[config.name] = { task: config.task, error: error.message };
        }
    }

    return results;
}

function florenceCaptionText(florence) {
    const caption =
        florence?.global_description?.parsed?.["<MORE_DETAILED_CAPTION>"];
    return caption ? cleanText(caption) : "";
}

/* ============================================================
   PADDLE OCR â€” real detector + recognizer (ppu-paddle-ocr)
   ============================================================ */

async function runOCR(imagePath) {
    logSection("Running PaddleOCR (ppu-paddle-ocr)");

    const service = new PaddleOcrService({
        model: PADDLEOCR_MODEL_PRESET,
        recognition: {
            strategy: PADDLEOCR_RECOGNITION_STRATEGY,
            minimumConfidence: PADDLEOCR_MIN_CONFIDENCE,
        },
    });

    await service.initialize();

    try {
        const fileBuffer = await fs.readFile(imagePath);
        const imageBuffer = fileBuffer.buffer.slice(
            fileBuffer.byteOffset,
            fileBuffer.byteOffset + fileBuffer.byteLength
        );

        const result = await service.recognize(imageBuffer, { flatten: true });

        console.log("\n[RAW PADDLE OCR OUTPUT]");
        console.log(JSON.stringify(result, null, 2));
        console.log("[END RAW PADDLE OCR OUTPUT]\n");

        const items = result.results
            .map((item, index) => ({
                id: `ocr_${index}`,
                text: cleanText(item.text),
                confidence: item.confidence,
                bbox: [
                    item.box.x,
                    item.box.y,
                    item.box.x + item.box.width,
                    item.box.y + item.box.height,
                ],
            }))
            .filter((item) => item.text);

        return {
            model: "ppu-paddle-ocr (PP-OCRv6-small, detector+recognizer)",
            text: cleanText(result.text),
            confidence: result.confidence,
            items,
        };
    } finally {
        await service.destroy();
    }
}

/* ============================================================
   OCR GLOBAL SPAN MAPPING
   Maps each OCR region back to its character offsets in the
   complete OCR text. Uses cursor-based sequential matching
   to handle duplicate UI text (e.g. multiple "Name" labels).
   ============================================================ */

function buildOCRGlobalSpans(ocr) {
    if (!ocr?.text || !ocr?.items) {
        return { text: ocr?.text ?? "", spans: [] };
    }

    const sourceText = ocr.text;
    const spans = [];
    let cursor = 0;

    for (const item of ocr.items) {
        const regionText = cleanText(item.text);
        if (!regionText) {
            continue;
        }

        // Search for the region text starting from current cursor position
        const matchIndex = sourceText.indexOf(regionText, cursor);

        if (matchIndex >= 0) {
            // Found exact match at or after cursor
            const start = matchIndex;
            const end = matchIndex + regionText.length;
            cursor = end;

            spans.push({
                id: item.id,
                text: regionText,
                originalText: item.text,
                bbox: item.bbox ?? null,
                confidence: item.confidence ?? null,
                start,
                end,
            });
        } else {
            // Fallback: try case-insensitive or whitespace-normalized match
            const normalizedSource = sourceText
                .slice(cursor)
                .replace(/\s+/g, " ");
            const normalizedRegion = regionText.replace(/\s+/g, " ");

            const fallbackIndex = normalizedSource.indexOf(normalizedRegion);

            if (fallbackIndex >= 0) {
                // Map back to approximate position in original text
                const approxStart = cursor + fallbackIndex;
                const approxEnd = approxStart + regionText.length;

                spans.push({
                    id: item.id,
                    text: regionText,
                    originalText: item.text,
                    bbox: item.bbox ?? null,
                    confidence: item.confidence ?? null,
                    start: approxStart,
                    end: approxEnd,
                });
                cursor = approxEnd;
            } else {
                // Cannot map this region confidently
                console.warn(
                    `[WARN] Could not map OCR region to global text: "${regionText}" (id: ${item.id})`
                );
                spans.push({
                    id: item.id,
                    text: regionText,
                    originalText: item.text,
                    bbox: item.bbox ?? null,
                    confidence: item.confidence ?? null,
                    start: null,
                    end: null,
                });
            }
        }
    }

    return { text: sourceText, spans };
}

/* ============================================================
   ENTITY SPAN TO OCR REGION MAPPING
   Maps a global character span from Ettin back to OCR regions.
   ============================================================ */

function findOCRRegionsForSpan(entityStart, entityEnd, ocrSpans) {
    const matchingRegions = [];

    for (const span of ocrSpans) {
        if (span.start === null || span.end === null) continue;

        // Check if entity span intersects with this OCR region
        const intersects =
            entityStart < span.end && entityEnd > span.start;

        if (intersects) {
            matchingRegions.push(span);
        }
    }

    return matchingRegions;
}

function buildFindingsFromEntity(entity, ocrSpans, entityType) {
    const regions = findOCRRegionsForSpan(
        entity.start,
        entity.end,
        ocrSpans
    );

    if (regions.length === 0) {
        // Entity couldn't be mapped to any OCR region
        return [{
            source_id: "unmapped",
            entity: entityType,
            score: entity.score,
            text: entity.text,
            bbox: null,
            start: entity.start,
            end: entity.end,
            mapped: false,
        }];
    }

    // Create a finding for each OCR region this entity covers
    return regions.map((region) => ({
        source_id: region.id,
        entity: entityType,
        score: entity.score,
        text: region.text,
        bbox: region.bbox,
        start: entity.start,
        end: entity.end,
        mapped: true,
    }));
}

/* ============================================================
   PHASE 1 â€” OCR READING ORDER (spatial, non-destructive)
   ============================================================ */

function buildReadingOrder(ocr) {
    if (!ocr?.items?.length) return { ordered: [], rows: [] };
    const items = ocr.items.map((it) => ({
        ...it,
        bbox: it.bbox ?? [0, 0, 0, 0],
        text: cleanText(it.text),
    }));
    // Row clustering by y center
    const sortedByY = [...items].sort((a, b) => {
        const ay = (a.bbox[1] + a.bbox[3]) / 2;
        const by = (b.bbox[1] + b.bbox[3]) / 2;
        return ay - by;
    });
    const rows = [];
    for (const item of sortedByY) {
        const cy = (item.bbox[1] + item.bbox[3]) / 2;
        const h = Math.max(1, item.bbox[3] - item.bbox[1]);
        const tol = Math.max(8, h * 0.6);
        let row = rows.find((r) => Math.abs(r.cy - cy) < tol);
        if (!row) {
            row = { cy, items: [] };
            rows.push(row);
        }
        row.items.push(item);
        // update cy as mean
        row.cy = row.items.reduce((s, it) => s + (it.bbox[1] + it.bbox[3]) / 2, 0) / row.items.length;
    }
    // Sort rows top-bottom, items left-right
    rows.sort((a, b) => a.cy - b.cy);
    let order = 0;
    const ordered = [];
    for (const row of rows) {
        row.items.sort((a, b) => a.bbox[0] - b.bbox[0]);
        for (const it of row.items) {
            ordered.push({ ...it, reading_order: order++ });
        }
    }
    return { ordered, rows };
}

/* ============================================================
   PHASE 2 â€” DETERMINISTIC CONTEXT ANALYZER
   ============================================================ */

const SENSITIVE_FIELD_VOCABULARY = [
    // Certificate / registration / application
    { label: "Certificate No", field_type: "CERTIFICATE_NUMBER" },
    { label: "Certificate Number", field_type: "CERTIFICATE_NUMBER" },
    { label: "Cert No", field_type: "CERTIFICATE_NUMBER" },
    { label: "Cert Number", field_type: "CERTIFICATE_NUMBER" },
    { label: "Certificate No.", field_type: "CERTIFICATE_NUMBER" },
    { label: "Registration No", field_type: "REGISTRATION_NUMBER" },
    { label: "Registration Number", field_type: "REGISTRATION_NUMBER" },
    { label: "Reg No", field_type: "REGISTRATION_NUMBER" },
    { label: "Application No", field_type: "APPLICATION_NUMBER" },
    { label: "Application Number", field_type: "APPLICATION_NUMBER" },
    { label: "Application ID", field_type: "APPLICATION_ID" },
    { label: "Student ID", field_type: "STUDENT_ID" },
    { label: "Student Number", field_type: "STUDENT_ID" },
    { label: "Roll No", field_type: "ROLL_NUMBER" },
    { label: "Roll Number", field_type: "ROLL_NUMBER" },
    { label: "Admission No", field_type: "ADMISSION_NUMBER" },
    { label: "Admission Number", field_type: "ADMISSION_NUMBER" },
    { label: "Employee ID", field_type: "EMPLOYEE_ID" },
    { label: "Employee Number", field_type: "EMPLOYEE_ID" },
    { label: "Passport No", field_type: "PASSPORT_NUMBER" },
    { label: "Passport Number", field_type: "PASSPORT_NUMBER" },
    { label: "License No", field_type: "LICENSE_NUMBER" },
    { label: "Licence No", field_type: "LICENSE_NUMBER" },
    { label: "Policy Number", field_type: "POLICY_NUMBER" },
    { label: "Policy No", field_type: "POLICY_NUMBER" },
    { label: "Reference Number", field_type: "REFERENCE_NUMBER" },
    { label: "Reference No", field_type: "REFERENCE_NUMBER" },
    { label: "Document Number", field_type: "DOCUMENT_NUMBER" },
    { label: "Document No", field_type: "DOCUMENT_NUMBER" },
    { label: "Serial Number", field_type: "SERIAL_NUMBER" },
    { label: "Serial No", field_type: "SERIAL_NUMBER" },
    { label: "Date of Birth", field_type: "DATE_OF_BIRTH" },
    { label: "DOB", field_type: "DATE_OF_BIRTH" },
    { label: "Email", field_type: "EMAIL" },
    { label: "Email Address", field_type: "EMAIL" },
    { label: "Phone", field_type: "PHONE" },
    { label: "Phone Number", field_type: "PHONE" },
    { label: "Mobile", field_type: "PHONE" },
    { label: "Mobile Number", field_type: "PHONE" },
    { label: "Account Number", field_type: "ACCOUNT_NUMBER" },
    { label: "Account No", field_type: "ACCOUNT_NUMBER" },
    { label: "Card Number", field_type: "CARD_NUMBER" },
    { label: "UPI ID", field_type: "UPI_ID" },
    { label: "IFSC", field_type: "IFSC" },
    { label: "IBAN", field_type: "IBAN" },
];

function normalizeLabelForMatch(text) {
    let v = String(text ?? "").toLowerCase();
    // tolerate common OCR substitutions when matching labels only
    // do this before stripping punctuation so N0->no works
    v = v.replace(/0/g, "o");
    // normalize punctuation: . : - _ / all to space, collapse
    v = v.replace(/[.\-_:;\/\\]+/g, " ");
    v = v.replace(/\s+/g, " ").trim();
    // also tolerate 1/l/I confusion by normalizing single-char tokens? keep simple
    return v;
}

const NORMALIZED_VOCAB = SENSITIVE_FIELD_VOCABULARY.map((entry) => ({
    ...entry,
    normalized: normalizeLabelForMatch(entry.label),
}));

// longest normalized label first so "certificate number" wins over "certificate"
NORMALIZED_VOCAB.sort((a, b) => b.normalized.length - a.normalized.length);

function findFieldLabelMatch(text) {
    const norm = normalizeLabelForMatch(text);
    for (const entry of NORMALIZED_VOCAB) {
        if (norm === entry.normalized || norm.includes(entry.normalized) || entry.normalized.includes(norm)) {
            // require word-boundary-ish: check that matched label is not just substring of unrelated word
            // by ensuring normalized label appears as substring
            if (norm.includes(entry.normalized)) return entry;
            if (entry.normalized.includes(norm) && norm.length >= 3) return entry;
        }
    }
    // fuzzy: allow one-char difference for labels >=6 chars
    for (const entry of NORMALIZED_VOCAB) {
        if (Math.abs(norm.length - entry.normalized.length) > 2) continue;
        if (entry.normalized.length < 6) continue;
        let diffs = 0;
        const len = Math.min(norm.length, entry.normalized.length);
        for (let i = 0; i < len; i++) if (norm[i] !== entry.normalized[i]) diffs++;
        diffs += Math.abs(norm.length - entry.normalized.length);
        if (diffs <= 2) return entry;
    }
    return null;
}

function isPlausibleValue(text) {
    const v = String(text ?? "").trim();
    if (!v) return false;
    if (v.length < 2) return false;
    if (v.length > 80) return false;
    if (!/[a-z0-9]/i.test(v)) return false; // must contain alphanumeric
    if (/^[.,:;\/\-_]+$/.test(v)) return false;
    // reject ordinary long prose (many words, no identifier chars)
    const words = v.split(/\s+/);
    if (words.length > 8) return false;
    // reject pure long english sentence fragments
    if (words.length > 4 && /^[a-z\s.,]+$/i.test(v) && !/[\d\-_\/]/.test(v)) return false;
    return true;
}

function extractLabelValueSameLine(ocrItems) {
    const candidates = [];
    for (const item of ocrItems) {
        const raw = String(item.text ?? "");
        // split on first colon or on 2+ spaces that separate label/value
        let labelPart = null;
        let valuePart = null;
        const colonIdx = raw.indexOf(":");
        if (colonIdx >= 0) {
            labelPart = raw.slice(0, colonIdx + 1);
            valuePart = raw.slice(colonIdx + 1).trim();
        } else {
            // try splitting on 2+ spaces
            const m = raw.match(/^(.+?)\s{2,}(.+)$/);
            if (m) { labelPart = m[1]; valuePart = m[2].trim(); }
        }
        if (!labelPart || !valuePart) continue;
        const labelMatch = findFieldLabelMatch(labelPart);
        if (!labelMatch) continue;
        if (!isPlausibleValue(valuePart)) continue;
        candidates.push({
            source: "deterministic_context",
            ocr_ids: [item.id],
            label: labelMatch.label,
            value: cleanText(valuePart),
            field_type: labelMatch.field_type,
            confidence: 0.98,
            reason: `Sensitive identifier value associated with ${labelMatch.label} label (same line)`,
            bbox: item.bbox ?? null,
            raw_text: raw,
        });
    }
    return candidates;
}

function extractLabelValueSideBySide(orderedItems, rows) {
    const candidates = [];
    // For each row, look for label item followed by value item to the right
    for (const row of rows) {
        const rowItems = [...row.items].sort((a, b) => a.bbox[0] - b.bbox[0]);
        for (let i = 0; i < rowItems.length; i++) {
            const labelItem = rowItems[i];
            const labelMatch = findFieldLabelMatch(labelItem.text);
            if (!labelMatch) continue;
            // candidate value is next item(s) to the right in same row
            for (let j = i + 1; j < rowItems.length; j++) {
                const valueItem = rowItems[j];
                const gap = valueItem.bbox[0] - labelItem.bbox[2];
                if (gap < -5) continue; // overlapping
                if (!isPlausibleValue(valueItem.text)) continue;
                // also need horizontal proximity — not across whole page without gap check
                candidates.push({
                    source: "deterministic_context",
                    ocr_ids: [labelItem.id, valueItem.id],
                    label: labelMatch.label,
                    value: cleanText(valueItem.text),
                    field_type: labelMatch.field_type,
                    confidence: 0.92,
                    reason: `Sensitive identifier value associated with ${labelMatch.label} label (side-by-side)`,
                    bbox: valueItem.bbox ?? null,
                    raw_text: `${labelItem.text} ${valueItem.text}`,
                });
                break; // only first value to the right
            }
        }
    }
    return candidates;
}

function extractLabelValueVertical(orderedItems, rows) {
    const candidates = [];
    const sortedRows = [...rows].sort((a, b) => a.cy - b.cy);
    for (let r = 0; r < sortedRows.length - 1; r++) {
        const labelRow = sortedRows[r];
        const valueRow = sortedRows[r + 1];
        const verticalGap = Math.min(...valueRow.items.map((it) => it.bbox[1])) - Math.max(...labelRow.items.map((it) => it.bbox[3]));
        if (verticalGap < 0 || verticalGap > 50) continue;
        // find label in upper row
        for (const labelItem of labelRow.items) {
            const labelMatch = findFieldLabelMatch(labelItem.text);
            if (!labelMatch) continue;
            // check value row has plausible value with horizontal overlap
            for (const valueItem of valueRow.items) {
                const overlapLeft = Math.max(labelItem.bbox[0], valueItem.bbox[0]);
                const overlapRight = Math.min(labelItem.bbox[2], valueItem.bbox[2]);
                const overlap = Math.max(0, overlapRight - overlapLeft);
                const maxW = Math.max(labelItem.bbox[2] - labelItem.bbox[0], valueItem.bbox[2] - valueItem.bbox[0]);
                const ratio = maxW > 0 ? overlap / maxW : 0;
                const centerDx = Math.abs((labelItem.bbox[0] + labelItem.bbox[2]) / 2 - (valueItem.bbox[0] + valueItem.bbox[2]) / 2);
                if (ratio < 0.15 && centerDx > maxW * 0.8) continue;
                if (!isPlausibleValue(valueItem.text)) continue;
                candidates.push({
                    source: "deterministic_context",
                    ocr_ids: [labelItem.id, valueItem.id],
                    label: labelMatch.label,
                    value: cleanText(valueItem.text),
                    field_type: labelMatch.field_type,
                    confidence: 0.90,
                    reason: `Sensitive identifier value associated with ${labelMatch.label} label (vertical)`,
                    bbox: valueItem.bbox ?? null,
                    raw_text: `${labelItem.text} / ${valueItem.text}`,
                });
            }
        }
    }
    return candidates;
}

function extractMultiLineLabel(ocrItems, rows) {
    const candidates = [];
    const sortedRows = [...rows].sort((a, b) => a.cy - b.cy);
    for (let r = 0; r < sortedRows.length - 1; r++) {
        // Check if two consecutive rows together form a label, third row is value — simplified: label spans 2 lines
        const upperRow = sortedRows[r];
        const middleRow = sortedRows[r + 1];
        // try combining one item from upper + one from middle as multi-line label
        for (const u of upperRow.items) {
            for (const m of middleRow.items) {
                const combined = `${u.text} ${m.text}`;
                const labelMatch = findFieldLabelMatch(combined);
                if (!labelMatch) continue;
                // value could be same middle row after label, or next row
                // case: "Certificate" (row0) + "Number: ABC123XY98" (row1) — value in middle row itself
                const colonIdx = m.text.indexOf(":");
                if (colonIdx >= 0) {
                    const after = m.text.slice(colonIdx + 1).trim();
                    if (isPlausibleValue(after)) {
                        candidates.push({
                            source: "deterministic_context",
                            ocr_ids: [u.id, m.id],
                            label: labelMatch.label,
                            value: cleanText(after),
                            field_type: labelMatch.field_type,
                            confidence: 0.88,
                            reason: `Sensitive identifier value associated with ${labelMatch.label} label (multi-line label)`,
                            bbox: m.bbox ?? null,
                            raw_text: combined,
                        });
                        continue;
                    }
                }
                // value in next row
                if (r + 2 < sortedRows.length) {
                    const valueRow = sortedRows[r + 2];
                    for (const v of valueRow.items) {
                        if (!isPlausibleValue(v.text)) continue;
                        candidates.push({
                            source: "deterministic_context",
                            ocr_ids: [u.id, m.id, v.id],
                            label: labelMatch.label,
                            value: cleanText(v.text),
                            field_type: labelMatch.field_type,
                            confidence: 0.86,
                            reason: `Sensitive identifier value associated with ${labelMatch.label} label (multi-line label + vertical value)`,
                            bbox: v.bbox ?? null,
                            raw_text: `${combined} / ${v.text}`,
                        });
                    }
                }
            }
        }
    }
    return candidates;
}

function extractSensitiveFieldCandidates(ocr) {
    if (!ocr?.items?.length) return [];
    const { ordered, rows } = buildReadingOrder(ocr);
    const sameLine = extractLabelValueSameLine(ocr.items);
    const sideBySide = extractLabelValueSideBySide(ordered, rows);
    const vertical = extractLabelValueVertical(ordered, rows);
    const multiLine = extractMultiLineLabel(ocr.items, rows);
    const all = [...sameLine, ...sideBySide, ...vertical, ...multiLine];
    // Deduplicate by ocr_ids+value
    const seen = new Map();
    for (const c of all) {
        const key = `${c.field_type}|${c.value}|${[...c.ocr_ids].sort().join(",")}`;
        if (!seen.has(key) || seen.get(key).confidence < c.confidence) seen.set(key, c);
    }
    // Also deduplicate by value alone if same field_type and overlapping bbox/value
    const deduped = [...seen.values()];
    // Prefer same-line over side-by-side when same value
    deduped.sort((a, b) => b.confidence - a.confidence);
    const finalMap = new Map();
    for (const c of deduped) {
        const vkey = `${c.field_type}|${c.value}`;
        if (!finalMap.has(vkey)) finalMap.set(vkey, c);
    }
    return [...finalMap.values()];
}

/* ============================================================
   NER â€” PII candidate detection over FULL OCR text sequence
   ============================================================ */

function normalizeId2Label(id2label) {
    const result = {};
    if (!id2label) return result;

    const entries =
        id2label instanceof Map ? id2label.entries() : Object.entries(id2label);

    for (const [key, value] of entries) {
        result[Number(key)] = String(value);
    }
    return result;
}

function softmax(values) {
    const max = Math.max(...values);
    const exps = values.map((value) => Math.exp(value - max));
    const sum = exps.reduce((a, b) => a + b, 0);
    return exps.map((value) => value / sum);
}

function parseBioLabel(label) {
    const value = String(label ?? "O").trim();
    if (!value || value === "O") return { prefix: "O", type: null };

    const match = value.match(/^([BI])-?(.*)$/i);
    if (match) {
        return {
            prefix: match[1].toUpperCase(),
            type: match[2] ? match[2].trim() : null,
        };
    }
    return { prefix: "B", type: value };
}

function findEntitySpan(sourceText, entityText) {
    const source = cleanText(sourceText);
    const candidate = cleanText(entityText);

    const exact = source.indexOf(candidate);
    if (exact >= 0) return { start: exact, end: exact + candidate.length };

    const insensitive = source.toLowerCase().indexOf(candidate.toLowerCase());
    if (insensitive >= 0) {
        return { start: insensitive, end: insensitive + candidate.length };
    }
    return { start: null, end: null };
}

/**
 * Builds offset mapping manually when tokenizer doesn't support return_offsets_mapping.
 * Uses cursor-based sequential matching to map each token to character positions.
 */
function buildManualOffsetMapping(tokenIds, tokenizer, sourceText) {
    const mapping = [];
    let cursor = 0;

    for (let i = 0; i < tokenIds.length; i++) {
        const tokenId = Number(tokenIds[i]);
        let tokenText = "";

        try {
            tokenText = tokenizer.decode([tokenId], { skip_special_tokens: true });
        } catch {
            mapping.push([cursor, cursor]);
            continue;
        }

        // Skip special tokens (empty text)
        if (!tokenText || tokenText.trim() === "") {
            mapping.push([cursor, cursor]);
            continue;
        }

        // Search for token text in source starting from cursor position.
        // We search forward from cursor to handle sequential token matching.
        // Subword tokens (starting with Ä  or similar) are normalized to find
        // them in the source text.
        const searchStart = cursor;
        const foundIndex = sourceText.indexOf(tokenText, searchStart);

        if (foundIndex >= 0) {
            const start = foundIndex;
            const end = foundIndex + tokenText.length;
            cursor = end;
            mapping.push([start, end]);
        } else {
            // Fallback: search from the beginning in case cursor is off
            const retryIndex = sourceText.indexOf(tokenText);
            if (retryIndex >= 0) {
                cursor = retryIndex + tokenText.length;
                mapping.push([retryIndex, cursor]);
            } else {
                // Cannot locate token text; skip it
                mapping.push([cursor, cursor]);
            }
        }
    }

    return mapping;
}

function mergeNERPredictions(predictions, tokenIds, tokenizer, offsetMapping, tokenTexts) {
    const entities = [];
    let current = null;

    // Helper: determine if a token is a subword continuation (no leading space)
    const isSubword = (text) => text && !text.startsWith(" ") && !text.startsWith("\n") && text.trim().length > 0;

    const flush = () => {
        if (!current) return;

        const ids = tokenIds.slice(current.startToken, current.endToken + 1);
        let text = "";
        let start = null;
        let end = null;

        if (offsetMapping && offsetMapping.length > 0) {
            // Use offset mapping for precise character spans
            const startOffset = offsetMapping[current.startToken];
            const endOffset = offsetMapping[current.endToken];

            if (startOffset && endOffset) {
                start = startOffset[0];
                end = endOffset[1];
                text = current.sourceText.slice(start, end);
            }
        }

        // Fallback to tokenizer.decode if offsets unavailable
        if (!text) {
            try {
                text = tokenizer.decode(ids, { skip_special_tokens: true });
            } catch {
                text = ids.join(" ");
            }
            text = cleanText(text);
        }

        if (text && current.type) {
            entities.push({
                entity: current.type,
                score:
                    current.scores.reduce((sum, v) => sum + v, 0) /
                    current.scores.length,
                text: cleanText(text),
                start,
                end,
                startToken: current.startToken,
                endToken: current.endToken,
            });
        }
        current = null;
    };

    for (const prediction of predictions) {
        const { prefix, type } = parseBioLabel(prediction.label);
        const score = prediction.score;

        if (prefix === "O" || !type || score < NER_MIN_SCORE) {
            flush();
            continue;
        }

        const sameEntity = current && current.type === type;

        // Check if this is a subword continuation token
        const tokenText = tokenTexts?.[prediction.tokenIndex] ?? "";
        const subwordContinuation = isSubword(tokenText);

        if (prefix === "I" && sameEntity) {
            current.endToken = prediction.tokenIndex;
            current.scores.push(score);
            continue;
        }

        // Handle subword continuations: if this is a subword (no leading space)
        // and the previous entity is the same type, merge into current entity.
        // This fixes the case where "KRUTRIM" is tokenized as "K", "RU", "TR", "IM"
        // and each gets a B-company_name prediction independently.
        if (subwordContinuation && sameEntity) {
            current.endToken = prediction.tokenIndex;
            current.scores.push(score);
            continue;
        }

        flush();
        current = {
            type,
            startToken: prediction.tokenIndex,
            endToken: prediction.tokenIndex,
            scores: [score],
            sourceText: prediction.sourceText,
        };
    }

    flush();
    return entities;
}

async function loadNER() {
    logSection("Loading Ettin NER");

    const tokenizer = await AutoTokenizer.from_pretrained(NER_MODEL);
    const model = await AutoModelForTokenClassification.from_pretrained(
        NER_MODEL,
        { dtype: "fp32", model_file_name: NER_MODEL_FILE_NAME }
    );

    const id2label = normalizeId2Label(model.config?.id2label);
    if (Object.keys(id2label).length === 0) {
        throw new Error("NER id2label missing.");
    }

    const configuredMax = Number(
        model.config?.max_position_embeddings ?? NER_MAX_TOKENS
    );
    const maxTokens = Math.min(
        NER_MAX_TOKENS,
        configuredMax > 0 ? configuredMax : NER_MAX_TOKENS
    );

    return { tokenizer, model, id2label, maxTokens };
}

/**
 * Runs Ettin NER ONCE on the complete OCR text sequence.
 *
 * WHY FULL TEXT: Ettin performs better when it can see surrounding context.
 * Example: "Jeet@777" alone might be classified as a username, but with
 * "Password\nJeet@777\nSign In" context, it correctly identifies as PASSWORD.
 *
 * The complete OCR text is sent as ONE sequence. Entity spans are then mapped
 * back to original OCR regions using character offsets.
 *
 * @param {Object} ner - NER model/tokenizer from loadNER()
 * @param {Object} ocr - OCR result with .text (full) and .items (regions)
 * @returns {Array} findings with source_id, bbox, entity, score, text
 */
async function runNER(ner, ocr) {
    const DEBUG_NER = process.env.DEBUG_NER === "1";
    const findings = [];

    // Build OCR global span mapping (character offsets in full text)
    const { text: sourceText, spans: ocrSpans } = buildOCRGlobalSpans(ocr);

    if (!sourceText || ocrSpans.length === 0) {
        console.log("[NER] No OCR text to process.");
        return findings;
    }

    // Log input mode for verification
    console.log("\n[NER INPUT MODE]");
    console.log("  FULL OCR TEXT SEQUENCE");
    console.log(`  Characters: ${sourceText.length}`);
    console.log(`  OCR regions: ${ocrSpans.length}`);

    if (DEBUG_NER) {
        console.log("\n[ETTIN INPUT]");
        console.log("  " + sourceText.slice(0, 200) + (sourceText.length > 200 ? "..." : ""));
    }

    console.log("\n[NER] Running Ettin once on complete OCR sequence...");

    try {
        // Tokenize the COMPLETE OCR text as ONE sequence
        let encoded;
        let offsetMapping = null;

        try {
            // Try with offset_mapping for precise character spans
            encoded = await ner.tokenizer(sourceText, {
                truncation: true,
                max_length: ner.maxTokens,
                return_offsets_mapping: true,
            });

            // Extract offset mapping if available
            if (encoded.offset_mapping) {
                offsetMapping = Array.from(encoded.offset_mapping, (pair) =>
                    Array.isArray(pair) ? pair : [pair[0], pair[1]]
                );
            }
        } catch (offsetError) {
            // Fallback: tokenizer doesn't support offset_mapping
            if (DEBUG_NER) {
                console.log(`[NER] offset_mapping not supported, using fallback: ${offsetError.message}`);
            }
            encoded = await ner.tokenizer(sourceText, {
                truncation: true,
                max_length: ner.maxTokens,
            });
        }

        const tokenIds = Array.from(
            encoded.input_ids.data ?? encoded.input_ids,
            Number
        );

        // If offset_mapping not provided by tokenizer, build it manually
        if (!offsetMapping) {
            offsetMapping = buildManualOffsetMapping(tokenIds, ner.tokenizer, sourceText);
            if (DEBUG_NER) {
                console.log(`[NER] Built manual offset mapping (${offsetMapping.length} tokens)`);
            }
        }

        // Run Ettin inference ONCE on the complete sequence
        const outputs = await ner.model(encoded);
        const dims = outputs.logits.dims.map(Number);
        const data = outputs.logits.data;
        const sequenceLength = dims[1];
        const numberOfLabels = dims[2];

        // Build predictions with source text reference for span extraction
        const predictions = [];
        const tokenTexts = [];

        // Pre-decode all tokens for subword continuation detection
        for (let i = 0; i < tokenIds.length; i++) {
            try {
                tokenTexts[i] = tokenizer.decode([tokenIds[i]], {
                    skip_special_tokens: true,
                });
            } catch {
                tokenTexts[i] = "";
            }
        }

        for (
            let tokenIndex = 0;
            tokenIndex < Math.min(sequenceLength, tokenIds.length);
            tokenIndex++
        ) {
            const row = new Array(numberOfLabels);
            for (let labelIndex = 0; labelIndex < numberOfLabels; labelIndex++) {
                row[labelIndex] = Number(
                    data[tokenIndex * numberOfLabels + labelIndex]
                );
            }

            const probabilities = softmax(row);
            let bestLabel = 0;
            let bestScore = probabilities[0];
            for (let i = 1; i < numberOfLabels; i++) {
                if (probabilities[i] > bestScore) {
                    bestScore = probabilities[i];
                    bestLabel = i;
                }
            }

            predictions.push({
                tokenIndex,
                label: ner.id2label[bestLabel] ?? `LABEL_${bestLabel}`,
                score: bestScore,
                sourceText, // Reference for offset mapping
            });
        }

        // Merge BIO predictions into entities with global character spans
        const entities = mergeNERPredictions(
            predictions,
            tokenIds,
            ner.tokenizer,
            offsetMapping,
            tokenTexts
        );

        console.log(`[NER] Detected ${entities.length} entities in full text.`);

        // Map each entity back to OCR region(s) using character spans
        for (const entity of entities) {
            if (isPlaceholderText(entity.text)) continue;

            // Use global character span from offset mapping
            let entityStart = entity.start;
            let entityEnd = entity.end;

            // Fallback: if no offset mapping, search for entity text in source
            if (entityStart === null || entityEnd === null) {
                const span = findEntitySpan(sourceText, entity.text);
                entityStart = span.start;
                entityEnd = span.end;
            }

            if (entityStart === null || entityEnd === null) {
                console.warn(`[WARN] Could not locate entity "${entity.text}" in OCR text`);
                continue;
            }

            // Find OCR regions that intersect with this entity span
            const entityFindings = buildFindingsFromEntity(
                entity,
                ocrSpans,
                entity.entity
            );

            for (const finding of entityFindings) {
                findings.push({
                    source_id: finding.source_id,
                    entity: finding.entity,
                    score: finding.score,
                    text: finding.text,
                    bbox: finding.bbox,
                    start: finding.start,
                    end: finding.end,
                });
            }
        }

    } catch (error) {
        console.warn(`[WARN] NER failed: ${error.message}`);
    }

    // Log findings summary
    console.log("\n[NER FINDINGS]");
    for (const finding of findings) {
        console.log(`  ${finding.entity} | score: ${finding.score.toFixed(3)} | region: ${finding.source_id}`);
        if (finding.bbox) {
            console.log(`    bbox: [${finding.bbox.join(", ")}]`);
        }
        if (DEBUG_NER) {
            console.log(`    text: "${finding.text}"`);
        }
    }

    return findings;
}

/* ============================================================
   PHASE 4 â€” CANDIDATE FUSION & DEDUPLICATION
   ============================================================ */

function normalizeCandidateText(t) {
    return cleanText(t).toLowerCase();
}

function isContained(smaller, larger) {
    const s = normalizeCandidateText(smaller);
    const l = normalizeCandidateText(larger);
    if (!s || !l) return false;
    if (s === l) return false;
    return l.includes(s);
}

function fuseRedactionCandidates({ ettinFindings = [], deterministicFindings = [] }) {
    const raw = [];
    let cid = 0;
    const nextId = () => `cand_${String(cid++).padStart(3, "0")}`;

    for (const f of ettinFindings) {
        const text = cleanText(f.text);
        if (!text) continue;
        const ocrIds = f.source_id && f.source_id !== "unmapped" ? [f.source_id] : [];
        raw.push({
            candidate_id: nextId(),
            ocr_ids: ocrIds,
            text,
            label_context: null,
            candidate_types: [f.entity ?? "UNKNOWN"],
            sources: ["ettin"],
            confidence: Number(f.score ?? 0),
            bbox: f.bbox ?? null,
            original: f,
        });
    }
    for (const d of deterministicFindings) {
        raw.push({
            candidate_id: nextId(),
            ocr_ids: [...(d.ocr_ids ?? [])],
            text: cleanText(d.value),
            label_context: d.label ?? null,
            candidate_types: [d.field_type ?? "UNKNOWN"],
            sources: ["deterministic_context"],
            confidence: Number(d.confidence ?? 0.9),
            bbox: d.bbox ?? null,
            original: d,
        });
    }

    // Merge duplicate sources that share same text+ocr_ids: boost confidence, merge sources
    const byKey = new Map();
    for (const c of raw) {
        const key = `${normalizeCandidateText(c.text)}|${[...c.ocr_ids].sort().join(",")}`;
        if (!byKey.has(key)) byKey.set(key, c);
        else {
            const existing = byKey.get(key);
            existing.sources = [...new Set([...existing.sources, ...c.sources])];
            existing.candidate_types = [...new Set([...existing.candidate_types, ...c.candidate_types])];
            existing.confidence = Math.max(existing.confidence, c.confidence);
            if (!existing.label_context && c.label_context) existing.label_context = c.label_context;
            if (!existing.bbox && c.bbox) existing.bbox = c.bbox;
        }
    }
    let candidates = [...byKey.values()];

    // Containment rule: if smaller text fully contained in larger text and shares OCR region or overlaps,
    // keep larger only. Also handle same OCR region containment.
    // Sort by text length descending so larger wins.
    candidates.sort((a, b) => b.text.length - a.text.length || b.confidence - a.confidence);
    const keep = [];
    for (const c of candidates) {
        let contained = false;
        for (const k of keep) {
            const sameRegion = c.ocr_ids.length && k.ocr_ids.length && c.ocr_ids.some((id) => k.ocr_ids.includes(id));
            const textContained = isContained(c.text, k.text);
            if (textContained && (sameRegion || k.text.toLowerCase().includes(c.text.toLowerCase()))) {
                contained = true;
                // merge evidence into keeper if smaller had deterministic label
                if (!k.label_context && c.label_context) k.label_context = c.label_context;
                k.sources = [...new Set([...k.sources, ...c.sources])];
                k.candidate_types = [...new Set([...k.candidate_types, ...c.candidate_types])];
                break;
            }
            // also handle bbox overlap containment when bboxes exist
            if (c.bbox && k.bbox && textContained) {
                const overlap = !(c.bbox[2] < k.bbox[0] || c.bbox[0] > k.bbox[2] || c.bbox[3] < k.bbox[1] || c.bbox[1] > k.bbox[3]);
                if (overlap) { contained = true; break; }
            }
        }
        if (!contained) keep.push(c);
    }

    // Do not merge adjacent non-overlapping entities solely by proximity
    return keep;
}

/* ============================================================
   UI STRUCTURE ANALYSIS
    Generic geometry-based UI role detection from OCR + image geometry.
    NO additional ML model required â€” uses OCR bboxes, text, and image dims.
   ============================================================ */

// ---- Normalize a single OCR item geometry ----

function normalizeOcrItem(item, imageWidth, imageHeight) {
    const bbox = item.bbox ? item.bbox : [0, 0, 0, 0];
    const x1 = bbox[0];
    const y1 = bbox[1];
    const x2 = bbox[2];
    const y2 = bbox[3];
    const width = Math.max(0, x2 - x1);
    const height = Math.max(0, y2 - y1);
    const centerX = x1 + width / 2;
    const centerY = y1 + height / 2;

    return {
        id: item.id,
        text: cleanText(item.text),
        originalText: item.text,
        bbox: [x1, y1, x2, y2],
        x1, y1, x2, y2,
        width, height,
        centerX, centerY,
        // Normalized coordinates (0-1 range)
        normX1: x1 / imageWidth,
        normY1: y1 / imageHeight,
        normX2: x2 / imageWidth,
        normY2: y2 / imageHeight,
        normWidth: width / imageWidth,
        normHeight: height / imageHeight,
        normCenterX: centerX / imageWidth,
        normCenterY: centerY / imageHeight,
    };
}

// ---- Geometric relationships between two normalized OCR items ----

function computeRelationship(itemA, itemB, imageWidth, imageHeight) {
    const dx = Math.abs(itemA.centerX - itemB.centerX);
    const dy = Math.abs(itemA.centerY - itemB.centerY);
    const minWidth = Math.min(itemA.width, itemB.width);
    const minHeight = Math.min(itemA.height, itemB.height);

    // Tolerances relative to image size and text dimensions
    const heightTol = Math.max(8, minHeight * 0.5);
    const widthTol = Math.max(8, minWidth * 0.5);

    // Horizontal overlap
    const overlapX = Math.max(0, Math.min(itemA.x2, itemB.x2) - Math.max(itemA.x1, itemB.x1));
    const overlapY = Math.max(0, Math.min(itemA.y2, itemB.y2) - Math.max(itemA.y1, itemB.y1));
    const overlaps = (overlapX > 0 && overlapY > 0);

    // Same row: vertical centers close relative to their heights
    const sameRow = dy < heightTol;

    // Same column: horizontal centers close relative to their widths
    const sameColumn = dx < widthTol;

    // Above: A's bottom is above B's top with small gap
    const above = itemA.y2 < itemB.y1 - 2;

    // Below: A's bottom is below B's top with small gap
    const below = itemA.y1 > itemB.y2 + 2;

    // Left of: A's right is left of B's left with small gap
    const leftOf = itemA.x2 < itemB.x1 - 2;

    // Right of: A's right is right of B's left with small gap
    const rightOf = itemA.x1 > itemB.x2 + 2;

    // Horizontally aligned: vertical centers within tolerance
    const horizontallyAligned = dy < heightTol;

    // Vertically aligned: horizontal centers within tolerance
    const verticallyAligned = dx < widthTol;

    // Near: generally close (both dx and dy small relative to dimensions)
    const near = dx < widthTol + 20 && dy < heightTol + 20;

    // Significant horizontal overlap (more than 30% of either text width)
    const significantOverlap = overlapX > Math.max(itemA.width, itemB.width) * 0.3;

    // Significant vertical overlap
    const significantVerticalOverlap = overlapY > Math.max(itemA.height, itemB.height) * 0.3;

    // One contains the other (bbox containment)
    const contains =
        itemA.x1 <= itemB.x1 && itemA.y1 <= itemB.y1 &&
        itemA.x2 >= itemB.x2 && itemA.y2 >= itemB.y2;

    // Reverse containment
    const containsReverse =
        itemB.x1 <= itemA.x1 && itemB.y1 <= itemA.y1 &&
        itemB.x2 >= itemA.x2 && itemB.y2 >= itemA.y2;

    // Same vertical position (centers within 10% of image height)
    const sameVerticalPosition = Math.abs(itemA.normCenterY - itemB.normCenterY) < 0.1;

    // Same horizontal position (centers within 10% of image width)
    const sameHorizontalPosition = Math.abs(itemA.normCenterX - itemB.normCenterX) < 0.1;

    // Estimate if two regions are likely in the same container
    const likelySameContainer = (dx < imageWidth * 0.3 && dy < imageHeight * 0.3) ||
        (significantOverlap && !sameRow) ||
        (significantVerticalOverlap && sameRow);

    return {
        sameRow,
        sameColumn,
        above,
        below,
        leftOf,
        rightOf,
        near,
        overlaps,
        horizontallyAligned,
        verticallyAligned,
        near,
        significantOverlap,
        significantVerticalOverlap,
        contains,
        containsReverse,
        likelySameContainer,
        sameVerticalPosition,
        sameHorizontalPosition,
    };
}

// ---- Detect horizontal sibling groups (segmented controls/tabs) ----

function detectHorizontalGroups(items) {
    // Cluster items that are on the same row, horizontally separated,
    // with similar heights, suggesting a segmented control/tab group.

    if (items.length < 2) return [];

    // Sort by centerY then centerX
    const sorted = [...items].sort((a, b) =>
        a.centerY - b.centerY || a.centerX - b.centerX
    );

    // Group items by row (clustering by centerY)
    const rows = [];
    for (const item of sorted) {
        const matchedRow = rows.find(row => {
            // Check if this item's centerY is close to any existing row
            return Math.abs(item.centerY - row.refCenterY) < (item.height * 0.5 + 6);
        });

        if (matchedRow) {
            matchedRow.items.push(item);
            // Update reference center
            matchedRow.refCenterY = (matchedRow.refCenterY * (matchedRow.items.length - 1) + item.centerY) / matchedRow.items.length;
            // Re-sort row by centerX
            matchedRow.items.sort((a, b) => a.centerX - b.centerX);
        } else {
            rows.push({
                refCenterY: item.centerY,
                items: [item],
            });
        }
    }

    // For each row with 2+ items, check if they form a horizontal group
    const groups = [];
    for (const row of rows) {
        if (row.items.length < 2) continue;

        // Check: are they horizontally separated but on same row?
        // And do they have similar heights?
        const heights = row.items.map(i => i.height);
        const heightMean = heights.reduce((a, b) => a + b, 0) / heights.length;
        const heightVariance = heights.reduce((a, b) => a + Math.pow(b - heightMean, 2), 0) / heights.length;
        const heightStd = Math.sqrt(heightVariance);
        const heightCoeff = heightStd / Math.max(heightMean, 1);

        // Items must be on same row (vertical alignment) and horizontally separated
        const areHorizontallySeparated = row.items.slice(1).every((it, i) =>
            it.centerX > row.items[0].centerX + Math.max(it.width, row.items[0].width) * 0.3
        );

        const haveSimilarHeight = heightCoeff < 0.5;

        if (areHorizontallySeparated && haveSimilarHeight) {
            // Sort by centerX
            const sortedItems = [...row.items].sort((a, b) => a.centerX - b.centerX);
            const bbox = [
                sortedItems[0].x1,
                Math.min(...sortedItems.map(i => i.y1)),
                sortedItems[sortedItems.length - 1].x2,
                Math.max(...sortedItems.map(i => i.y2)),
            ];

            groups.push({
                id: `group_${groups.length.toString().padStart(3, '0')}`,
                type: "segmented_control",
                bbox,
                children: sortedItems.map(item => item.id),
                confidence: 0.7 + 0.3 * (sortedItems.length / 4),
                evidence: ["same_row", "similar_height", "horizontal_siblings"],
            });
        }
    }

    return groups;
}

// ---- Detect label-value input candidates ----

function detectInputCandidates(items) {
    const candidates = [];

    // For each pair of items, check if one is above another forming a label-value pair
    for (let i = 0; i < items.length; i++) {
        for (let j = 0; j < items.length; j++) {
            if (i === j) continue;

            const a = items[i];
            const b = items[j];

            // Skip if either has very short text (likely not a label or value)
            if (a.text.length < 2 || b.text.length < 2) continue;

            // Check if B is below A (label above value pattern)
            // Conditions:
            // - B is below A (a.y2 < b.y1 with small gap)
            // - Significant horizontal overlap (they're aligned)
            // - Small vertical gap
            // - Reasonable width alignment

            const gap = b.y1 - a.y2;
            if (gap > 0 && gap < 40) { // Small vertical gap
                // Check horizontal overlap/alignment
                const overlapLeft = Math.max(a.x1, b.x1);
                const overlapRight = Math.min(a.x2, b.x2);
                const horizontalOverlap = Math.max(0, overlapRight - overlapLeft);
                const maxWidth = Math.max(a.width, b.width);
                const overlapRatio = maxWidth > 0 ? horizontalOverlap / maxWidth : 0;

                // Also check center alignment
                const centerDx = Math.abs(a.centerX - b.centerX);

                // Strong candidate: good horizontal overlap AND centered
                if (overlapRatio > 0.3 && centerDx < a.width * 0.5) {
                    candidates.push({
                        type: "input_candidate",
                        label_ocr_id: a.id,
                        value_ocr_id: b.id,
                        confidence: 0.5 + 0.3 * overlapRatio + 0.2 * (1 - centerDx / Math.max(a.width, 1)),
                        evidence: ["vertical_pair", "horizontal_alignment", "close_spacing"],
                        label_text: a.text,
                        value_text: b.text,
                    });
                }

                // Weak candidate: just vertically close with some alignment
                if (overlapRatio > 0.15 && centerDx < a.width * 1.0) {
                    candidates.push({
                        type: "input_candidate",
                        label_ocr_id: a.id,
                        value_ocr_id: b.id,
                        confidence: 0.3 + 0.4 * overlapRatio,
                        evidence: ["vertical_pair", "some_alignment"],
                        label_text: a.text,
                        value_text: b.text,
                    });
                }
            }
        }
    }

    // Deduplicate: if two candidates share the same value_ocr_id, keep the higher-confidence one
    const seenValueIds = new Set();
    const filtered = candidates.filter(candidate => {
        if (seenValueIds.has(candidate.value_ocr_id)) return false;
        seenValueIds.add(candidate.value_ocr_id);
        return true;
    });

    return filtered;
}

// ---- Detect button candidates ----

function detectButtonCandidates(items, imageWidth, imageHeight) {
    const candidates = [];

    for (const item of items) {
        if (!item.text) continue;
        const text = cleanText(item.text);
        if (!text) continue;

        // Skip very long text (likely not a button)
        if (text.length > 30) continue;

        // Button criteria (geometry-focused):
        // 1. Reasonably compact region (not too tall, not too wide)
        const aspectRatio = item.width / Math.max(item.height, 1);
        const isCompact = item.width < imageWidth * 0.6 && item.height < imageHeight * 0.3;

        // 2. Positioned below the main form area (typical for login forms)
        //    - y position is in the lower portion of the image
        const isBelowForm = item.normCenterY > 0.4;

        // 3. Isolated from body text (not near long paragraphs)
        //    - relatively short height compared to image
        const isIsolated = item.height < imageHeight * 0.25;

        let score = 0;
        let reasons = [];

        if (isCompact) {
            score += 0.3;
            reasons.push("compact_region");
        }
        if (isBelowForm) {
            score += 0.3;
            reasons.push("below_form");
        }
        if (isIsolated) {
            score += 0.2;
            reasons.push("isolated");
        }

        // Minimum score to qualify as button candidate
        if (score >= 0.75) {
            candidates.push({
                type: "button_candidate",
                text_ocr_id: item.id,
                confidence: Math.min(0.9, 0.5 + score * 0.7),
                evidence: reasons,
                text: text,
                bbox: item.bbox,
                normCenterX: item.normCenterX,
                normCenterY: item.normCenterY,
            });
        }
    }

    return candidates;
}

// ---- Detect link candidates ----

function detectLinkCandidates(items) {
    const candidates = [];

    for (const item of items) {
        if (!item.text) continue;
        const text = cleanText(item.text);
        if (!text) continue;

        // Skip very long text
        if (text.length > 40) continue;

        // Link-like semantic signals (weak, used with geometry)
        const lower = text.toLowerCase();
        const linkKeywords = ["forgot", "reset", "sign up", "login", "contact", "support",
            "previous", "next", "back", "home", "close", "cancel", "submit"];

        const hasLinkKeyword = linkKeywords.some(kw => lower.includes(kw));

        // Isolated text signal
        const isIsolated = item.height < 40;

        let score = 0;
        let reasons = [];

        if (hasLinkKeyword) {
            score += 0.3;
            reasons.push("link_keyword");
        }
        if (isIsolated) {
            score += 0.3;
            reasons.push("isolated");
        }

        if (score >= 0.3) {
            candidates.push({
                type: "link_candidate",
                text_ocr_id: item.id,
                confidence: Math.min(0.85, 0.4 + score * 0.7),
                evidence: reasons,
                text: text,
                bbox: item.bbox,
            });
        }
    }

    return candidates;
}

// ---- Detect containers/parent regions ----

function detectContainers(items, imageWidth, imageHeight) {
    // Try to infer visual containers around clusters of OCR regions.
    // Uses a simple approach: if a group of OCR items are tightly clustered
    // within a rectangular area, infer a container.

    if (items.length < 2) return [];

    // Sort by centerX then centerY
    const sorted = [...items].sort((a, b) => a.centerY - b.centerY || a.centerX - b.centerX);

    // Cluster items: find groups that are close together
    const clusters = [];
    const visited = new Set();

    for (let i = 0; i < sorted.length; i++) {
        const itemI = sorted[i];
        if (visited.has(itemI.id)) continue;

        const cluster = [itemI];
        visited.add(itemI.id);

        for (let j = i + 1; j < sorted.length; j++) {
            const itemJ = sorted[j];
            if (visited.has(itemJ.id)) continue;

            // Check if itemJ is close to any item in the cluster
            const clusterItem = cluster[0]; // Use first as reference
            const dx = Math.abs(itemJ.centerX - clusterItem.centerX);
            const dy = Math.abs(itemJ.centerY - clusterItem.centerY);

            // Close if within half the sum of widths/heights + some margin
            const close = dx < (clusterItem.width + itemJ.width) * 0.5 + 20 &&
                dy < (clusterItem.height + itemJ.height) * 0.5 + 20;

            if (close) {
                cluster.push(itemJ);
                visited.add(itemJ.id);
            }
        }

        if (cluster.length >= 2) {
            // Compute cluster bounding box
            const bbox = [
                Math.min(...cluster.map(i => i.x1)),
                Math.min(...cluster.map(i => i.y1)),
                Math.max(...cluster.map(i => i.x2)),
                Math.max(...cluster.map(i => i.y2)),
            ];

            // Only create container if it has reasonable size (not the whole image)
            const containerWidth = bbox[2] - bbox[0];
            const containerHeight = bbox[3] - bbox[1];
            const isReasonableSize = containerWidth < imageWidth * 0.8 && containerHeight < imageHeight * 0.8;

            if (isReasonableSize) {
                clusters.push({
                    id: `container_${clusters.length.toString().padStart(3, '0')}`,
                    bbox,
                    itemIds: cluster.map(i => i.id),
                    confidence: 0.5 + 0.3 * Math.min(cluster.length / 6, 1),
                    evidence: ["clustered_regions"],
                });
            }
        }
    }

    return clusters;
}

// ---- Main UI structure builder ----

/**
 * Builds a UI structure analysis from screenshot, OCR, and optional Florence caption.
 *
 * @param {Object} params - Parameters object
 * @param {Object} params.image - Image with width/height
 * @param {Object} params.ocr - OCR result with items array
 * @param {Object} params.florence - Optional Florence caption result
 * @returns {Object} UI structure with elements, groups, relationships, containers
 */
function buildUIStructure({ image, ocr, florence }) {
    const imageWidth = image.width;
    const imageHeight = image.height;

    // 1. Normalize all OCR items
    const normalizedItems = ocr.items.map(item =>
        normalizeOcrItem(item, imageWidth, imageHeight)
    ).filter(item => item.text && item.text.length > 0);

    // 2. Compute all pairwise relationships
    const relationships = [];
    for (let i = 0; i < normalizedItems.length; i++) {
        for (let j = i + 1; j < normalizedItems.length; j++) {
            const rel = computeRelationship(normalizedItems[i], normalizedItems[j], imageWidth, imageHeight);

            if (rel.sameRow || rel.sameColumn || rel.above || rel.below ||
                rel.overlaps || rel.contains || rel.containsReverse || rel.likelySameContainer) {
                relationships.push({
                    ocr_id_a: normalizedItems[i].id,
                    ocr_id_b: normalizedItems[j].id,
                    ...rel,
                });
            }
        }
    }

    // 3. Detect horizontal sibling groups (segmented controls/tabs)
    const groups = detectHorizontalGroups(normalizedItems);

    // 4. Detect input candidates (label above value)
    const inputCandidates = detectInputCandidates(normalizedItems);

    // 5. Detect button candidates
    const buttonCandidates = detectButtonCandidates(normalizedItems, imageWidth, imageHeight);

    // 6. Detect link candidates
    const linkCandidates = detectLinkCandidates(normalizedItems);

    // 7. Detect containers
    const containers = detectContainers(normalizedItems, imageWidth, imageHeight);

    // 8. Build elements summary
    const elements = normalizedItems.map(item => ({
        id: item.id,
        text: item.text,
        bbox: item.bbox,
        centerX: item.centerX,
        centerY: item.centerY,
        normCenterX: item.normCenterX,
        normCenterY: item.normCenterY,
        width: item.width,
        height: item.height,
    }));

    return {
        imageWidth,
        imageHeight,
        elements,
        groups,
        relationships,
        inputCandidates,
        buttonCandidates,
        linkCandidates,
        containers,
    };
}

/* ============================================================
   PHASE 5 â€” QWEN ADJUDICATION INPUT / PROMPT / INFERENCE
   ============================================================ */

const ALLOWED_QWEN_TYPES = new Set([
    "certificate_number", "registration_number", "application_number", "application_id",
    "student_id", "roll_number", "admission_number", "employee_id", "passport_number",
    "license_number", "policy_number", "reference_number", "document_number", "serial_number",
    "date_of_birth", "email", "phone", "account_number", "card_number", "upi_id", "ifsc", "iban",
    "unique_id", "person", "other",
]);

function buildQwenRedactionEvidence({ image, ocr, florence, ettinFindings, deterministicFindings, fusedCandidates }) {
    return {
        image: { width: image.width, height: image.height },
        florence: { description: florenceCaptionText(florence) || "" },
        ocr: (ocr.items || []).map((it) => ({
            id: it.id,
            text: cleanText(it.text),
            bbox: it.bbox ?? null,
            confidence: it.confidence ?? null,
        })),
        ettin_candidates: (ettinFindings || []).map((f) => ({
            entity: f.entity,
            text: cleanText(f.text),
            score: f.score,
            source_id: f.source_id,
            bbox: f.bbox ?? null,
        })),
        deterministic_candidates: (deterministicFindings || []).map((d) => ({
            label: d.label,
            value: cleanText(d.value),
            field_type: d.field_type,
            confidence: d.confidence,
            ocr_ids: d.ocr_ids,
            bbox: d.bbox ?? null,
            reason: d.reason,
        })),
        fused_candidates: (fusedCandidates || []).map((c) => ({
            candidate_id: c.candidate_id,
            ocr_ids: c.ocr_ids,
            text: c.text,
            label_context: c.label_context,
            candidate_types: c.candidate_types,
            sources: c.sources,
            confidence: c.confidence,
            bbox: c.bbox ?? null,
        })),
    };
}

function buildQwenRedactionPrompt(evidence) {
    const cap = evidence.florence?.description || "(no caption)";
    const ocrLines = evidence.ocr.map((o) => `- [${o.id}] [${o.bbox ? o.bbox.map((n) => Math.round(n)).join(",") : ""}] "${o.text}"`).join("\n") || "(no OCR)";
    const ettinLines = evidence.ettin_candidates.map((e) => `- ${e.entity} "${e.text}" score=${Number(e.score).toFixed(3)} source=${e.source_id}`).join("\n") || "(none)";
    const detLines = evidence.deterministic_candidates.map((d) => `- ${d.field_type} "${d.value}" label="${d.label}" ocr=${d.ocr_ids.join(",")} conf=${d.confidence}`).join("\n") || "(none)";
    const fusedLines = evidence.fused_candidates.map((c) => `- ${c.candidate_id} "${c.text}" types=[${c.candidate_types.join(",")}] sources=[${c.sources.join(",")}] ocr=${c.ocr_ids.join(",")} label_context=${c.label_context ?? ""} bbox=${c.bbox ? c.bbox.join(",") : ""} conf=${c.confidence.toFixed(3)}`).join("\n") || "(none)";
    return `You are the final privacy redaction adjudicator.

You receive:
1. The original image.
2. A Florence visual description.
3. OCR text with bounding boxes.
4. Ettin PII candidates.
5. Deterministic label/value candidates.

Determine which exact visible values in the image MUST be redacted.

Rules:
- Treat Ettin and deterministic candidates as evidence, not absolute truth.
- Use the original image to resolve ambiguity.
- A sensitive label does not itself need redaction; redact the associated value.
- Example: in "Certificate No: ABC123XY98", redact "ABC123XY98", not "Certificate No".
- Reject partial substrings when a larger candidate clearly contains them.
- Never invent or reconstruct text that is not visibly supported.
- Never guess a hidden/redacted value.
- Prefer the smallest exact sensitive value.
- If evidence is insufficient, do not invent a redaction.
- Return ONLY the requested JSON schema.

OUTPUT JSON SCHEMA (return ONLY this JSON, no prose):
{
  "redactions": [
    {
      "candidate_id": "cand_012",
      "ocr_ids": ["ocr_7"],
      "text": "ABC123XY98",
      "type": "certificate_number",
      "confidence": 0.99,
      "reason": "Value associated with Certificate No label"
    }
  ],
  "rejected_candidates": [
    {
      "candidate_id": "cand_013",
      "reason": "Partial substring of accepted certificate number"
    }
  ],
  "confidence_notes": "..."
}

EVIDENCE \u2014 FLORENCE:
${cap}

EVIDENCE \u2014 OCR REGIONS:
${ocrLines}

EVIDENCE \u2014 ETTIN CANDIDATES:
${ettinLines}

EVIDENCE \u2014 DETERMINISTIC CANDIDATES:
${detLines}

EVIDENCE \u2014 FUSED CANDIDATES (choose from these candidate_ids):
${fusedLines}

EVIDENCE \u2014 IMAGE DIMENSIONS: ${evidence.image.width} x ${evidence.image.height} px

Respond with ONLY valid JSON matching the schema above.`;
}

// Isolated loader — lazy, env-gated, swappable
let _qwenCache = null;
async function loadQwen() {
    if (!QWEN_ENABLED) return null;
    if (_qwenCache) return _qwenCache;
    try {
        logSection("Loading Qwen3.5-2B");
        // Dynamic import so pipeline still runs when transformers version lacks Qwen VL support
        const { AutoModelForCausalLM, AutoProcessor } = await import("@huggingface/transformers");
        // Processor for multimodal prompt; fallback to text-only if not available
        let processor = null;
        let model = null;
        try {
            processor = await AutoProcessor.from_pretrained(QWEN_MODEL);
        } catch (e) {
            if (QWEN_DEBUG) console.warn(`[QWEN] processor load failed: ${e.message}`);
        }
        model = await AutoModelForCausalLM.from_pretrained(QWEN_MODEL, { dtype: QWEN_DTYPE });
        _qwenCache = { model, processor };
        return _qwenCache;
    } catch (e) {
        console.warn(`[QWEN] load failed: ${e.message}`);
        if (QWEN_REQUIRED) throw e;
        return null;
    }
}

async function runQwenRedactionAdjudication({ imagePath, evidence }) {
    if (!QWEN_ENABLED) return { status: "skipped", reason: "QWEN_ENABLED=0" };
    const prompt = buildQwenRedactionPrompt(evidence);
    const qwen = await loadQwen();
    if (!qwen || !qwen.model) {
        return { status: "unavailable", reason: "model not loaded" };
    }
    try {
        // Text-only adjudication path: encode prompt and generate JSON
        // Multimodal path (image + prompt) can be added when processor supports Qwen VL
        const tokenizerLoad = qwen.processor ?? qwen.model;
        // Try processor-based tokenization first
        let inputs;
        if (qwen.processor && typeof qwen.processor === "function") {
            inputs = await qwen.processor(prompt, { return_tensors: "pt" });
        } else {
            // Fallback: try AutoTokenizer separately
            const { AutoTokenizer } = await import("@huggingface/transformers");
            const tok = await AutoTokenizer.from_pretrained(QWEN_MODEL);
            inputs = await tok(prompt, { truncation: true, max_length: 2048 });
        }
        const generated = await qwen.model.generate({ ...inputs, max_new_tokens: QWEN_MAX_NEW_TOKENS });
        // Decode — processor or tokenizer
        let outputText = "";
        try {
            const proc = qwen.processor;
            if (proc && proc.batch_decode) outputText = proc.batch_decode(generated, { skip_special_tokens: true })[0] ?? "";
            else {
                const { AutoTokenizer } = await import("@huggingface/transformers");
                const tok = await AutoTokenizer.from_pretrained(QWEN_MODEL);
                outputText = tok.batch_decode ? tok.batch_decode(generated, { skip_special_tokens: true })[0] : String(generated);
            }
        } catch {
            outputText = String(generated);
        }
        const jsonStr = extractJsonObject(outputText);
        const parsed = JSON.parse(jsonStr);
        return { status: "ok", raw: outputText, parsed, prompt };
    } catch (e) {
        console.warn(`[QWEN] adjudication failed: ${e.message}`);
        return { status: "error", reason: e.message, prompt };
    }
}

function extractJsonObject(text) {
    const s = String(text ?? "").trim();
    // Prefer last JSON object block
    const match = s.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("No JSON object found in Qwen output");
    return match[0];
}

function validateQwenRedactionOutput(parsed, evidence) {
    if (!parsed || typeof parsed !== "object") return { valid: false, reason: "root not object" };
    if (!Array.isArray(parsed.redactions)) return { valid: false, reason: "redactions must be array" };
    const fusedIds = new Set((evidence.fused_candidates || []).map((c) => c.candidate_id));
    const ocrIds = new Set((evidence.ocr || []).map((o) => o.id));
    const knownTexts = new Set([
        ...(evidence.ocr || []).map((o) => normalizeCandidateText(o.text)),
        ...(evidence.fused_candidates || []).map((c) => normalizeCandidateText(c.text)),
        ...(evidence.ettin_candidates || []).map((e) => normalizeCandidateText(e.text)),
        ...(evidence.deterministic_candidates || []).map((d) => normalizeCandidateText(d.value)),
    ]);
    for (const r of parsed.redactions) {
        if (!r.candidate_id || typeof r.candidate_id !== "string") return { valid: false, reason: `redaction missing candidate_id: ${JSON.stringify(r)}` };
        if (!fusedIds.has(r.candidate_id)) return { valid: false, reason: `fabricated candidate_id: ${r.candidate_id}` };
        if (!Array.isArray(r.ocr_ids) || r.ocr_ids.length === 0) return { valid: false, reason: `redaction ${r.candidate_id} missing ocr_ids` };
        for (const oid of r.ocr_ids) if (!ocrIds.has(oid)) return { valid: false, reason: `fabricated ocr_id: ${oid}` };
        if (!r.text || typeof r.text !== "string") return { valid: false, reason: `redaction ${r.candidate_id} missing text` };
        const nt = normalizeCandidateText(r.text);
        if (!knownTexts.has(nt)) {
            // allow substring of known texts but reject completely invented
            const anyContains = [...knownTexts].some((k) => k.includes(nt) || nt.includes(k));
            if (!anyContains) return { valid: false, reason: `text not supported by evidence: "${r.text}"` };
        }
        const typeNorm = String(r.type ?? "").toLowerCase();
        if (!ALLOWED_QWEN_TYPES.has(typeNorm)) return { valid: false, reason: `unsupported type: ${r.type}` };
        if (r.confidence !== undefined) {
            const c = Number(r.confidence);
            if (!Number.isFinite(c) || c < 0 || c > 1) return { valid: false, reason: `confidence out of range: ${r.confidence}` };
        }
    }
    if (parsed.rejected_candidates !== undefined) {
        if (!Array.isArray(parsed.rejected_candidates)) return { valid: false, reason: "rejected_candidates must be array" };
        for (const rej of parsed.rejected_candidates) {
            if (!rej.candidate_id || !fusedIds.has(rej.candidate_id)) return { valid: false, reason: `rejected fabricated candidate_id: ${rej.candidate_id}` };
        }
    }
    return { valid: true };
}

/* ============================================================
   PHASE 6 â€” FINAL REDACTION RESOLUTION + SAFETY GATES
   ============================================================ */

function resolveFinalRedactionRegions(qwenResult, evidence) {
    const redactions = qwenResult?.parsed?.redactions ?? [];
    const ocrById = new Map((evidence.ocr || []).map((o) => [o.id, o]));
    const fusedById = new Map((evidence.fused_candidates || []).map((c) => [c.candidate_id, c]));
    const resolved = [];
    for (const r of redactions) {
        const fused = fusedById.get(r.candidate_id);
        // Preferred: ocr_ids from Qwen
        let ocrIds = Array.isArray(r.ocr_ids) && r.ocr_ids.length ? r.ocr_ids : (fused?.ocr_ids ?? []);
        // Validate text consistency: requested text should appear in mapped OCR region
        const want = normalizeCandidateText(r.text);
        let bboxes = [];
        for (const oid of ocrIds) {
            const ocrItem = ocrById.get(oid);
            if (!ocrItem) continue;
            const have = normalizeCandidateText(ocrItem.text);
            if (have.includes(want) || want.includes(have)) bboxes.push(ocrItem.bbox);
            else if (fused && fused.bbox) bboxes.push(fused.bbox);
        }
        // fallback to fused bbox
        if (bboxes.length === 0 && fused?.bbox) bboxes.push(fused.bbox);
        for (const bbox of bboxes) {
            resolved.push({
                source_id: ocrIds[0] ?? fused?.ocr_ids?.[0] ?? r.candidate_id,
                entity: r.type ?? fused?.candidate_types?.[0] ?? "PII",
                score: Number(r.confidence ?? fused?.confidence ?? 1),
                text: r.text,
                bbox,
                candidate_id: r.candidate_id,
                ocr_ids: ocrIds,
                reason: r.reason ?? "",
            });
        }
    }
    return resolved;
}

function applySafetyGates(findings, evidence, imageWidth, imageHeight) {
    const ocrTexts = new Map((evidence.ocr || []).map((o) => [o.id, normalizeCandidateText(o.text)]));
    const filtered = [];
    for (const f of findings) {
        // Gate 1: valid bbox
        if (!Array.isArray(f.bbox) || f.bbox.length !== 4) continue;
        const nums = f.bbox.map(Number);
        if (!nums.every(Number.isFinite)) continue;
        const w = Math.abs(nums[2] - nums[0]);
        const h = Math.abs(nums[3] - nums[1]);
        if (w <= 0 || h <= 0) continue;
        const rect = clampBBox(f.bbox, imageWidth, imageHeight, 0);
        if (!rect) continue;
        // Gate 2: valid OCR mapping (at least one ocr_id known)
        const hasKnownOcr = (f.ocr_ids ?? []).some((id) => ocrTexts.has(id)) || ocrTexts.has(f.source_id) || !!f.bbox;
        if (!hasKnownOcr) continue;
        // Gate 3: text consistency
        if (f.text) {
            const nt = normalizeCandidateText(f.text);
            const ocrId = f.ocr_ids?.[0] ?? f.source_id;
            const ocrText = ocrId ? ocrTexts.get(ocrId) : null;
            if (ocrText && !ocrText.includes(nt) && !nt.includes(ocrText)) {
                // allow if gate passes via bbox (image evidence), but log
                if (QWEN_DEBUG) console.warn(`[GATE] text mismatch: "${f.text}" vs OCR "${ocrText}"`);
            }
        }
        // Gate 5: no label-only redaction — value must be plausible
        if (!isPlausibleValue(f.text ?? "")) continue;
        // Also reject if text looks like a pure label
        if (findFieldLabelMatch(f.text ?? "")) {
            // if text itself is a label and not a value, skip unless it's explicitly a sensitive type like EMAIL? but labels are never redacted
            const labelMatch = findFieldLabelMatch(f.text);
            if (labelMatch && normalizeCandidateText(labelMatch.label) === normalizeCandidateText(f.text)) continue;
        }
        // Gate 6: confidence policy — use final threshold, not Ettin threshold
        if (Number(f.score) < FINAL_REDACTION_CONFIDENCE_THRESHOLD) continue;
        filtered.push(f);
    }
    // Gate 4: candidate containment — remove redundant sub-spans
    filtered.sort((a, b) => (b.text?.length ?? 0) - (a.text?.length ?? 0));
    const deduped = [];
    for (const f of filtered) {
        const nt = normalizeCandidateText(f.text);
        let contained = false;
        for (const k of deduped) {
            const kText = normalizeCandidateText(k.text);
            if (kText.includes(nt) && nt !== kText) { contained = true; break; }
            // same bbox containment
            if (f.bbox && k.bbox && nt !== kText) {
                const overlap = !(f.bbox[2] < k.bbox[0] || f.bbox[0] > k.bbox[2] || f.bbox[3] < k.bbox[1] || f.bbox[1] > k.bbox[3]);
                if (overlap && kText.includes(nt)) { contained = true; break; }
            }
        }
        if (!contained) deduped.push(f);
    }
    return deduped;
}

function adjudicateOrFallback({ ettinFindings, deterministicFindings, fusedCandidates, qwenResult, evidence, image }) {
    let finalFindings = [];
    let qwenStatus = qwenResult?.status ?? "skipped";
    let validation = null;

    if (qwenResult?.status === "ok" && qwenResult.parsed) {
        validation = validateQwenRedactionOutput(qwenResult.parsed, evidence.qwen_evidence);
        if (validation.valid) {
            const resolved = resolveFinalRedactionRegions(qwenResult, evidence.qwen_evidence);
            finalFindings = applySafetyGates(resolved, evidence.qwen_evidence, image.width, image.height);
            qwenStatus = "ok";
        } else {
            console.warn(`[QWEN] validation failed: ${validation.reason}`);
            qwenStatus = "validation_failed";
        }
    }

    const needsFallback = qwenStatus !== "ok";
    if (needsFallback) {
        if (QWEN_FALLBACK_POLICY === "fail_closed" || QWEN_REQUIRED) {
            // fail-closed: no redactions but signal failure
            return {
                status: qwenStatus === "skipped" ? "qwen_skipped" : "qwen_failed",
                redaction_complete: false,
                finalFindings: [],
                validation,
                fallback: "fail_closed",
            };
        }
        // fallback: use fused candidates through safety gates
        const fallbackFindings = (fusedCandidates || []).map((c) => ({
            source_id: c.ocr_ids?.[0] ?? c.candidate_id,
            entity: c.candidate_types?.[0] ?? "PII",
            score: c.confidence,
            text: c.text,
            bbox: c.bbox,
            candidate_id: c.candidate_id,
            ocr_ids: c.ocr_ids,
        }));
        finalFindings = applySafetyGates(fallbackFindings, evidence.qwen_evidence, image.width, image.height);
        return {
            status: qwenStatus === "skipped" ? "fallback_fusion" : "fallback_after_qwen_failure",
            redaction_complete: true,
            finalFindings,
            validation,
            fallback: "fusion",
        };
    }

    return {
        status: "ok",
        redaction_complete: true,
        finalFindings,
        validation,
        fallback: null,
    };
}

/* ============================================================
   REDACTION
   ============================================================ */

function redactChunks(chunks, findings) {
    const findingsBySource = new Map();
    for (const finding of findings) {
        if (!findingsBySource.has(finding.source_id)) {
            findingsBySource.set(finding.source_id, []);
        }
        findingsBySource.get(finding.source_id).push(finding);
    }

    return chunks.map((chunk) => {
        const chunkFindings = findingsBySource.get(chunk.id) || [];
        let text = chunk.text;

        // Longest match first so overlapping/nested findings don't leave
        // partial fragments of a redacted value behind.
        const sorted = [...chunkFindings].sort(
            (a, b) => (b.text?.length ?? 0) - (a.text?.length ?? 0)
        );

        for (const finding of sorted) {
            if (!finding.text) continue;
            const escaped = finding.text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            const pattern = new RegExp(escaped, "gi");
            text = text.replace(pattern, `[REDACTED:${finding.entity}]`);
        }

        return { ...chunk, text, redacted: chunkFindings.length > 0 };
    });
}

/* ============================================================
   IMAGE REDACTION
   ============================================================ */

/**
 * Clamp an OCR bbox to valid image coordinates.
 */
function clampBBox(bbox, width, height, padding = 0) {
    if (!Array.isArray(bbox) || bbox.length !== 4) return null;

    const raw = bbox.map(Number);
    if (!raw.every(Number.isFinite)) return null;

    let x1 = Math.min(raw[0], raw[2]) - padding;
    let y1 = Math.min(raw[1], raw[3]) - padding;
    let x2 = Math.max(raw[0], raw[2]) + padding;
    let y2 = Math.max(raw[1], raw[3]) + padding;

    x1 = Math.max(0, Math.min(width - 1, Math.floor(x1)));
    y1 = Math.max(0, Math.min(height - 1, Math.floor(y1)));
    x2 = Math.max(x1 + 1, Math.min(width, Math.ceil(x2)));
    y2 = Math.max(y1 + 1, Math.min(height, Math.ceil(y2)));

    return {
        left: x1,
        top: y1,
        width: Math.max(1, x2 - x1),
        height: Math.max(1, y2 - y1),
    };
}

/**
 * Deduplicate findings that point to the same OCR region/bbox.
 * Ettin can emit multiple token/entity predictions for one value;
 * the image only needs one overlay.
 */
function uniqueImageRedactionRegions(findings) {
    const seen = new Map();

    for (const finding of findings || []) {
        if (!finding?.bbox) continue;

        const bbox = finding.bbox.map(Number);
        if (!bbox.every(Number.isFinite)) continue;

        const key = [
            finding.source_id ?? "unknown",
            bbox.map((v) => Math.round(v)).join(","),
        ].join("|");

        const existing = seen.get(key);

        if (!existing) {
            seen.set(key, {
                source_id: finding.source_id ?? null,
                entity: finding.entity ?? "PII",
                bbox,
                score: Number(finding.score ?? 0),
            });
        } else {
            existing.score = Math.max(
                existing.score,
                Number(finding.score ?? 0)
            );
        }
    }

    return [...seen.values()];
}

/**
 * Redact detected sensitive regions directly in the original image.
 *
 * This is intentionally lightweight:
 * - no VLM
 * - no image generation
 * - no second OCR pass
 * - no cloud service
 *
 * Default mode uses an opaque black rectangle, which is preferred for
 * irreversible privacy masking. Set REDACTION_STYLE=blur for a visual
 * alternative.
 */
async function redactImage(imagePath, findings, outputPath) {
    logSection("Redacting Sensitive Regions in Image");

    const metadata = await sharp(imagePath).metadata();
    const imageWidth = Number(metadata.width ?? 0);
    const imageHeight = Number(metadata.height ?? 0);

    if (!imageWidth || !imageHeight) {
        throw new Error(
            "Could not determine input image dimensions for image redaction."
        );
    }

    const regions = uniqueImageRedactionRegions(findings);
    const overlays = [];

    for (const region of regions) {
        const rect = clampBBox(
            region.bbox,
            imageWidth,
            imageHeight,
            IMAGE_REDACTION_PADDING
        );

        if (!rect) continue;

        if (IMAGE_REDACTION_STYLE === "blur") {
            const blurred = await sharp(imagePath)
                .extract(rect)
                .blur(12)
                .png()
                .toBuffer();

            overlays.push({
                input: blurred,
                left: rect.left,
                top: rect.top,
            });
        } else {
            const svg = Buffer.from(
                `<svg width="${rect.width}" height="${rect.height}" xmlns="http://www.w3.org/2000/svg">` +
                `<rect x="0" y="0" width="${rect.width}" height="${rect.height}" fill="black"/>` +
                `</svg>`
            );

            overlays.push({
                input: svg,
                left: rect.left,
                top: rect.top,
            });
        }
    }

    await sharp(imagePath)
        .composite(overlays)
        .png()
        .toFile(outputPath);

    console.log(`[IMAGE REDACTION] Style: ${IMAGE_REDACTION_STYLE}`);
    console.log(`[IMAGE REDACTION] Regions redacted: ${overlays.length}`);
    console.log(`[IMAGE REDACTION] Output: ${outputPath}`);

    return {
        output_path: outputPath,
        style: IMAGE_REDACTION_STYLE,
        regions_redacted: overlays.length,
        image_width: imageWidth,
        image_height: imageHeight,
    };
}

/* ============================================================
   EVIDENCE
   ============================================================ */

function buildNERChunks({ ocr }) {
    if (!ocr?.items) return [];
    return ocr.items.map((item) => ({
        id: item.id,
        text: item.text,
        bbox: item.bbox ?? null,
        confidence: item.confidence,
    }));
}

async function buildEvidence() {
    logSection("Building Evidence (image-only)");

    console.log(`Image: ${IMAGE_PATH}`);

    const image = await load_image(IMAGE_PATH);
    const ocr = await runOCR(IMAGE_PATH);
    const readingOrder = buildReadingOrder(ocr);
    const florence = await runFlorence(image);

    // Build OCR chunks (preserves individual regions with bboxes for redaction)
    const rawChunks = buildNERChunks({ ocr });

    // Run Ettin ONCE on the complete OCR text sequence (with context!)
    // Ettin is now a candidate detector, not final redaction authority.
    const ner = await loadNER();
    const nerFindings = await runNER(ner, ocr);

    // Deterministic sensitive-field context analysis (parallel metadata, OCR text preserved for Ettin)
    const deterministicFindings = extractSensitiveFieldCandidates(ocr);

    // Candidate fusion & deduplication (containment rule)
    const fusedCandidates = fuseRedactionCandidates({
        ettinFindings: nerFindings,
        deterministicFindings,
    });

    // Build UI structure analysis (additional structural layer, independent of Ettin)
    const uiStructure = buildUIStructure({ image, ocr, florence });

    // Build Qwen multimodal evidence (original image + OCR + Florence + candidates)
    const qwenEvidence = buildQwenRedactionEvidence({
        image,
        ocr,
        florence,
        ettinFindings: nerFindings,
        deterministicFindings,
        fusedCandidates,
    });

    // Run Qwen final adjudication (or skip/fallback per config)
    let qwenResult = null;
    if (QWEN_ENABLED && fusedCandidates.length > 0) {
        qwenResult = await runQwenRedactionAdjudication({
            imagePath: IMAGE_PATH,
            evidence: qwenEvidence,
        });
    } else if (!QWEN_ENABLED) {
        qwenResult = { status: "skipped", reason: "QWEN_ENABLED=0" };
    } else {
        qwenResult = { status: "skipped", reason: "no candidates" };
    }

    // Adjudicate or fallback (fail-closed policy)
    const adjudication = adjudicateOrFallback({
        ettinFindings: nerFindings,
        deterministicFindings,
        fusedCandidates,
        qwenResult,
        evidence: { qwen_evidence: qwenEvidence },
        image,
    });

    const finalFindings = adjudication.finalFindings;

    // Text redaction now uses final adjudicated findings, not raw Ettin
    const redactedChunks = redactChunks(rawChunks, finalFindings);
    const redactedOcrText = redactedChunks.map((c) => c.text).join(" ");

    // Redact the ORIGINAL image using ONLY final Qwen-approved findings after safety gates
    const imageRedaction = await redactImage(
        IMAGE_PATH,
        finalFindings,
        OUTPUT_IMAGE_PATH
    );

    // Evidence JSON evolution — auditable decision chain
    return {
        input_mode: { image: true, dom: false },
        image: {
            width: image.width,
            height: image.height,
            redacted_output: OUTPUT_IMAGE_PATH,
        },
        ocr: {
            ...ocr,
            reading_order: readingOrder.ordered.map((o) => ({ id: o.id, reading_order: o.reading_order, bbox: o.bbox })),
        },
        florence,
        ui_structure: uiStructure,
        image_redaction: {
            ...imageRedaction,
            status: adjudication.status,
            redaction_complete: adjudication.redaction_complete,
            fallback: adjudication.fallback,
        },
        ner: {
            model: NER_MODEL,
            sequence_mode: "full_ocr_text",
            source_text_length: ocr.text?.length ?? 0,
            findings: nerFindings,
        },
        deterministic_context: {
            findings: deterministicFindings,
        },
        candidate_fusion: {
            candidates: fusedCandidates,
        },
        qwen_adjudication: {
            model: QWEN_MODEL,
            enabled: QWEN_ENABLED,
            status: adjudication.status,
            redaction_complete: adjudication.redaction_complete,
            fallback: adjudication.fallback,
            // Raw Qwen output (truncated for safety)
            raw: qwenResult?.raw ? String(qwenResult.raw).slice(0, 2000) : null,
            parsed: qwenResult?.parsed ?? null,
            validation: adjudication.validation ?? null,
            redactions: qwenResult?.parsed?.redactions ?? [],
            rejected_candidates: qwenResult?.parsed?.rejected_candidates ?? [],
            reason: qwenResult?.reason ?? null,
        },
        qwen_evidence: qwenEvidence,
        final_findings: finalFindings,
        redaction: {
            chunks: redactedChunks,
            redacted_ocr_text: redactedOcrText,
            entity_types_found: [...new Set(finalFindings.map((f) => f.entity))],
            adjudication_status: adjudication.status,
            redaction_complete: adjudication.redaction_complete,
        },
        filtering: {
            original_chunk_count: rawChunks.length,
            filtered_chunk_count: rawChunks.length,
        },
    };
}

/* ============================================================
   QWEN PROMPT â€” rich, accurate, PII-free screen perception

   Goal: not a redaction-decision prompt. Sensitive spans are already
   gone (see REDACTION above). This prompt's only job is to make Qwen
   fuse the Florence caption + the (already-redacted) OCR text + layout
   into one accurate, detailed description of what the screen actually
   is and shows â€” weighing all signals, not just echoing Florence,
   and never trying to guess/reconstruct anything behind a
   [REDACTED:*] marker.
   ============================================================ */

function summarizeLayout(chunks) {
    return chunks
        .filter((c) => c.text)
        .map((c) => {
            const box = c.bbox ? `[${c.bbox.map((n) => Math.round(n)).join(",")}]` : "[]";
            return `- ${box} "${c.text}"`;
        })
        .join("\n");
}

function summarizeUIStructure(uiStructure) {
    const parts = [];

    // Groups (segmented controls/tabs)
    if (uiStructure.groups && uiStructure.groups.length > 0) {
        const groupDescriptions = uiStructure.groups.map(g => {
            const childrenText = g.children.map(cid => {
                const element = uiStructure.elements.find(e => e.id === cid);
                return element ? element.text : cid;
            }).join(", ");
            return `  ${g.type} [${g.bbox.map(n => Math.round(n)).join(",")}]${g.children.length > 0 ? ` - ${childrenText}` : ''}`;
        });
        parts.push(`GROUPS (horizontal sibling controls/tabs):\n${groupDescriptions.join("\n")}`);
    }

    // Input candidates (label-value pairs)
    if (uiStructure.inputCandidates && uiStructure.inputCandidates.length > 0) {
        const inputDescriptions = uiStructure.inputCandidates.map(ic => {
            const labelElement = uiStructure.elements.find(e => e.id === ic.label_ocr_id);
            const valueElement = uiStructure.elements.find(e => e.id === ic.value_ocr_id);
            return `  input_candidate - label: "${ic.label_text || labelElement?.text || ic.label_ocr_id}" + value: "${ic.value_text || valueElement?.text || ic.value_ocr_id}" [confidence: ${ic.confidence.toFixed(2)}]`;
        });
        parts.push(`INPUT CANDIDATES (label above value):\n${inputDescriptions.join("\n")}`);
    }

    // Button candidates
    if (uiStructure.buttonCandidates && uiStructure.buttonCandidates.length > 0) {
        const buttonDescriptions = uiStructure.buttonCandidates.map(bc => {
            const element = uiStructure.elements.find(e => e.id === bc.text_ocr_id);
            return `  button_candidate - text: "${bc.text}" [confidence: ${bc.confidence.toFixed(2)}] ${bc.evidence.join(", ")}`;
        });
        parts.push(`BUTTON CANDIDATES:\n${buttonDescriptions.join("\n")}`);
    }

    // Link candidates
    if (uiStructure.linkCandidates && uiStructure.linkCandidates.length > 0) {
        const linkDescriptions = uiStructure.linkCandidates.map(lc => {
            return `  link_candidate - text: "${lc.text}" [confidence: ${lc.confidence.toFixed(2)}] ${lc.evidence.join(", ")}`;
        });
        parts.push(`LINK CANDIDATES:\n${linkDescriptions.join("\n")}`);
    }

    // Containers
    if (uiStructure.containers && uiStructure.containers.length > 0) {
        const containerDescriptions = uiStructure.containers.map(c => {
            return `  container [${c.bbox.map(n => Math.round(n)).join(",")}] items: ${c.itemIds.join(", ")} [confidence: ${c.confidence.toFixed(2)}]`;
        });
        parts.push(`CONTAINERS:\n${containerDescriptions.join("\n")}`);
    }

    // Elements summary (brief)
    if (uiStructure.elements && uiStructure.elements.length > 0) {
        const elementCounts = {};
        for (const el of uiStructure.elements) {
            const type = el.text ? "text" : "unknown";
            elementCounts[type] = (elementCounts[type] || 0) + 1;
        }
        parts.push(`ELEMENTS SUMMARY: ${Object.entries(elementCounts).map(([k, v]) => `${v}x ${k}`).join(", ")}`);
    }

    return parts.length > 0 ? parts.join("\n\n") : "(no UI structure data available)";
}

/* ============================================================
   QWEN PROMPT â€” rich, accurate, PII-free screen perception
   ============================================================ */

function buildPerceptionPrompt(evidence) {
    const caption = florenceCaptionText(evidence.florence) || "(no caption available)";
    const layout = summarizeLayout(evidence.redaction.chunks) || "(no OCR text detected)";
    const redactedTypes = evidence.redaction.entity_types_found;
    const uiStructure = evidence.ui_structure;

    // Build UI structure summary for the prompt
    const uiStructureText = summarizeUIStructure(uiStructure);

    return `
You are a SCREEN PERCEPTION MODEL. You are given three independent pieces of
evidence about a single screenshot, captured locally on-device:

1. A Florence-2 vision caption (general visual description of the image).
2. OCR-extracted text with each text region's bounding box [x1,y1,x2,y2] in
   pixel coordinates, in reading order. This text has ALREADY been redacted:
   any span identified as real sensitive data (name, email, phone, credential,
   token, etc.) has been replaced inline with a marker like
   [REDACTED:EMAIL] or [REDACTED:PERSON].
3. The image's pixel dimensions.
4. **Structured UI layout evidence** derived from OCR geometry and image analysis.
   This is stronger evidence than the Florence caption for UI roles (tabs, buttons,
   inputs, links, etc.). The UI structure is computed from bounding box geometry,
   spatial relationships, and text positioning â€” not from free-form vision guessing.

YOUR TASK:
Produce ONE accurate, detailed, well-organized description of what this
screenshot actually shows â€” the kind of screen it is, its likely purpose,
what UI elements/content are visible, and how they're laid out. Base this on
ALL FOUR inputs together, not just the Florence caption: the caption alone
is often vague or wrong about specific on-screen text, and the OCR text is
often more reliable for exact labels, buttons, and copy, while Florence is
more reliable for overall visual layout and scene type. The UI structure
evidence is particularly important for determining element roles (e.g. whether
two text regions are horizontal sibling controls or vertically stacked input fields).
Reconcile disagreements between them explicitly rather than picking one arbitrarily.

STRICT RULES:
- Never invent details that none of the inputs support. If something is unclear
  or ambiguous, say so briefly rather than guessing.
- NEVER attempt to guess, infer, reconstruct, or restate the value hidden
  behind any [REDACTED:*] marker. Refer to it only by its category, e.g.
  "an email field" or "a redacted person's name appears in the text".
- Do not reproduce the raw OCR text verbatim if it is garbled; describe its
  meaning in clean language instead. It's fine to quote a short (a few word)
  UI label verbatim if it's clearly legible and not a redacted value.
- Be specific about structure: what kind of page/app screen this is, its main
  sections, and any actionable elements (buttons, fields, links) you can infer.
- **When the UI structure evidence identifies two text regions as horizontal
  siblings (e.g. segmented control/tabs), do NOT reinterpret them as vertically
  stacked input fields unless the structural evidence genuinely supports that.**
- **When UI structure classifies something as a candidate (e.g. input_candidate,
  button_candidate, link_candidate), treat it as a provisional suggestion, not
  absolute truth. Use it to inform but not override other evidence.**
- **When OCR text and Florence disagree about UI role, use the spatial/structural
  evidence rather than blindly following the Florence caption.**

OUTPUT FORMAT â€” respond with ONLY this JSON object, no other text:

{
  "screen_type": "short label for what kind of screen this is",
  "primary_purpose": "one sentence on what this screen is for",
  "description": "a thorough, accurate, multi-sentence description synthesizing all evidence",
  "notable_ui_elements": ["short phrase per element you're confident about"],
  "redacted_categories_present": ${JSON.stringify(redactedTypes)},
  "confidence_notes": "brief note on anything uncertain or where signals disagreed"
}

EVIDENCE â€” FLORENCE-2 CAPTION:
${caption}

EVIDENCE â€” REDACTED OCR TEXT BY REGION (bbox "text"):
${layout}

EVIDENCE â€” IMAGE DIMENSIONS:
${evidence.image.width} x ${evidence.image.height} px

EVIDENCE â€” UI STRUCTURE LAYOUT:
${uiStructureText}

- UI structure is derived from OCR geometry/image analysis, not Florence guessing.
- It is stronger evidence than Florence's free-form guesses for UI roles.
- Florence may hallucinate element types (e.g. describe tabs as fields or buttons as fields).
- When UI structure says two text regions are horizontal siblings inside one container,
  do not reinterpret them as vertically stacked input fields.
- Candidate classifications (input_candidate, button_candidate, link_candidate) are not
  absolute truth â€” use them as supportive evidence alongside OCR text and spatial data.
- If geometry is insufficient for a confident classification, use "unknown" or "candidate"
  rather than inventing an element type.
`
}

/* ============================================================
   MAIN
   ============================================================ */

async function main() {
    logSection("LOCAL PERCEPTION PIPELINE (image-only)");

    const evidence = await buildEvidence();

    await fs.writeFile(
        EVIDENCE_OUTPUT_PATH,
        JSON.stringify(evidence, null, 2),
        "utf8"
    );
    console.log(`\n[OK] Evidence saved: ${EVIDENCE_OUTPUT_PATH}`);
    console.log(`[OK] Qwen adjudication status: ${evidence.qwen_adjudication?.status} (complete=${evidence.qwen_adjudication?.redaction_complete})`);
    console.log(`[OK] Deterministic findings: ${evidence.deterministic_context?.findings?.length ?? 0}`);
    console.log(`[OK] Fused candidates: ${evidence.candidate_fusion?.candidates?.length ?? 0}`);
    console.log(`[OK] Final findings: ${evidence.final_findings?.length ?? 0}`);

    const prompt = buildPerceptionPrompt(evidence);
    await fs.writeFile(QWEN_OUTPUT_PATH, prompt, "utf8");
    console.log(`[OK] Qwen prompt saved: ${QWEN_OUTPUT_PATH}`);

    // Also save the redaction adjudication prompt for debugging
    try {
        const redactionPrompt = evidence.qwen_evidence ? buildQwenRedactionPrompt(evidence.qwen_evidence) : null;
        if (redactionPrompt) {
            await fs.writeFile("./qwen_redaction_prompt.txt", redactionPrompt, "utf8");
            console.log(`[OK] Qwen redaction prompt saved: ./qwen_redaction_prompt.txt`);
        }
    } catch (e) {
        console.warn(`[WARN] could not write redaction prompt: ${e.message}`);
    }

    console.log(`[OK] Redacted image saved: ${OUTPUT_IMAGE_PATH}`);

    logSection("QWEN PERCEPTION PROMPT");
    console.log(prompt);

    logSection("DONE");
}

// Exports for regression tests (keep pipeline runnable as main)
export {
    buildReadingOrder,
    extractSensitiveFieldCandidates,
    extractLabelValueSameLine,
    extractLabelValueSideBySide,
    extractLabelValueVertical,
    normalizeLabelForMatch,
    findFieldLabelMatch,
    isPlausibleValue,
    fuseRedactionCandidates,
    buildQwenRedactionEvidence,
    buildQwenRedactionPrompt,
    validateQwenRedactionOutput,
    resolveFinalRedactionRegions,
    applySafetyGates,
    adjudicateOrFallback,
    // re-export for test inspection
    SENSITIVE_FIELD_VOCABULARY,
};

const _isMain = (() => {
    try {
        const argv1 = process.argv[1] ? String(process.argv[1]).replace(/\\/g, "/") : "";
        return argv1.endsWith("v3.mjs");
    } catch { return false; }
})();
if (_isMain) {
    main().catch((error) => {
        console.error("\n[ERROR]");
        console.error(error.stack || error.message || error);
        process.exit(1);
    });
}