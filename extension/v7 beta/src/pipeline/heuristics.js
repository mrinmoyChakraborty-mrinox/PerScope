// Pure heuristic and structural analysis functions ported 1:1 from v7.mjs

const FASTVLM_DEBUG = false;

function asString(value) {
    return value === null || value === undefined ? "" : String(value);
}

function cleanText(value) {
    return asString(value).replace(/\s+/g, " ").trim();
}

/* ============================================================
   VALUE SUB-BBOX ESTIMATION
   Returns bbox covering only targetText inside OCR item.
   Uses proportional character positioning (character-based
   horizontal proportion per spec Â§2).
   Signature: estimateTextSubBBox(item, targetText) where
   item = { text, bbox }. Never throws, returns null if
   localization not possible.
   ============================================================ */
function estimateTextSubBBox(item, targetText) {
    try {
        if (!item?.bbox || !Array.isArray(item.bbox) || item.bbox.length !== 4) return null;
        const rawFull = String(item.text ?? "");
        const rawTarget = String(targetText ?? "").trim();
        if (!rawFull || !rawTarget) return null;
        const fullText = cleanText(rawFull);
        const target = cleanText(rawTarget);
        if (!fullText || !target) return null;
        const lowerFull = fullText.toLowerCase();
        const lowerTarget = target.toLowerCase();
        // zero-width bbox guard
        const nums = item.bbox.map(Number);
        if (!nums.every(Number.isFinite)) return null;
        const x1 = Math.min(nums[0], nums[2]);
        const y1 = Math.min(nums[1], nums[3]);
        const x2 = Math.max(nums[0], nums[2]);
        const y2 = Math.max(nums[1], nums[3]);
        const width = x2 - x1;
        if (width <= 0) return null;
        // Normalized whitespace matching: cleanText already collapses,
        // so "Certificate   No:   ABC123XY98" -> "Certificate No: ABC123XY98"
        let startIndex = lowerFull.indexOf(lowerTarget);
        // Spacing-split values: item "W BSC0LM 1234" vs canonical target
        // "WBSC0LM1234" (live IFSC miss 2026-09-28 — normalizeValue outputs
        // spaceless values individual OCR boxes never contain contiguously).
        // Collapse both, locate exactly, map collapsed span back to original
        // offsets for a precise proportional box (not the lossy approx below).
        if (startIndex < 0) {
            const flatFull = lowerFull.replace(/\s+/g, "");
            const flatTarget = lowerTarget.replace(/\s+/g, "");
            const flatIdx = flatTarget ? flatFull.indexOf(flatTarget) : -1;
            if (flatIdx >= 0) {
                let origStart = -1, origEnd = -1, ci = 0;
                for (let oi = 0; oi < fullText.length; oi++) {
                    if (/\s/.test(fullText[oi])) continue;
                    if (ci === flatIdx) origStart = oi;
                    if (ci === flatIdx + flatTarget.length - 1) { origEnd = oi + 1; break; }
                    ci++;
                }
                if (origStart >= 0 && origEnd > origStart) {
                    return _proportionalBBox([x1, y1, x2, y2], origStart / fullText.length, origEnd / fullText.length);
                }
            }
        }
        // If not found with cleanText, try whitespace-normalized raw fallback
        if (startIndex < 0) {
            const wsFull = rawFull.replace(/\s+/g, " ").trim().toLowerCase();
            const wsTarget = rawTarget.replace(/\s+/g, " ").trim().toLowerCase();
            // map via cleaned versions lengths proportionally (approx)
            const wsIdx = wsFull.indexOf(wsTarget);
            if (wsIdx < 0) return null;
            // approximate ratio via whitespace-normalized lengths
            const ratioStart = wsIdx / Math.max(1, wsFull.length);
            const ratioEnd = (wsIdx + wsTarget.length) / Math.max(1, wsFull.length);
            return _proportionalBBox([x1, y1, x2, y2], ratioStart, ratioEnd);
        }
        const startRatio = startIndex / fullText.length;
        const endRatio = (startIndex + target.length) / fullText.length;
        if (endRatio <= startRatio) return null;
        // guard degenerate tiny ratio (e.g., 1 char in long line)
        if (endRatio - startRatio < 0.015) {
            // still return sub-bbox but ensure minimal width 4px
            const est = _proportionalBBox([x1, y1, x2, y2], startRatio, endRatio);
            if (est && (est[2] - est[0]) < 2) return null;
            return est;
        }
        if (endRatio - startRatio > 0.98) {
            // target is essentially the whole line -> value is line
            return [x1, y1, x2, y2];
        }
        return _proportionalBBox([x1, y1, x2, y2], startRatio, endRatio);
    } catch {
        return null;
    }
}
function _proportionalBBox(bbox, ratioStart, ratioEnd) {
    try {
        const nums = bbox.map(Number);
        if (!nums.every(Number.isFinite)) return null;
        const x1 = Math.min(nums[0], nums[2]);
        const y1 = Math.min(nums[1], nums[3]);
        const x2 = Math.max(nums[0], nums[2]);
        const y2 = Math.max(nums[1], nums[3]);
        const width = Math.max(1, x2 - x1);
        const rs = Math.max(0, Math.min(1, ratioStart));
        const re = Math.max(0, Math.min(1, ratioEnd));
        if (re <= rs) return null;
        if (width <= 0) return null;
        return [
            x1 + width * rs,
            y1,
            x1 + width * re,
            y2
        ];
    } catch {
        return null;
    }
}
/* ------------------------------------------------------------
   GEOMETRY VALIDATION (Â§12)
   Reject bbox that is clearly the entire mixed label+value line
   when target is only a substring. Prefer tighter sub-bbox.
   ------------------------------------------------------------ */
function isLikelyValueOnlyBBox({ bbox, item, targetText }) {
    try {
        if (!bbox || !item?.bbox || !targetText) return false;
        const b = bbox.map(Number);
        const ib = item.bbox.map(Number);
        if (!b.every(Number.isFinite) || !ib.every(Number.isFinite)) return false;
        const bw = Math.abs(b[2] - b[0]);
        const iw = Math.abs(ib[2] - ib[0]);
        if (iw <= 0 || bw <= 0) return false;
        // If bbox equals whole item bbox while OCR text is much longer than target,
        // it's a whole-line bbox â€” not value-only.
        const exactMatch = b[0] === ib[0] && b[1] === ib[1] && b[2] === ib[2] && b[3] === ib[3];
        if (exactMatch) {
            const ocrText = cleanText(item.text);
            const target = cleanText(targetText);
            if (!ocrText || !target) return false;
            if (ocrText.toLowerCase().includes(target.toLowerCase()) && ocrText.length > target.length + 3) {
                return false; // whole line masquerading as value
            }
            return true;
        }
        // If bbox width is close to full width but target is substring -> unsafe
        const target = cleanText(targetText);
        const ocrText = cleanText(item.text);
        if (ocrText.toLowerCase().includes(target.toLowerCase()) && ocrText.length > target.length + 3) {
            const ratio = bw / iw;
            if (ratio > 0.92) return false;
        }
        return true;
    } catch {
        return false;
    }
}
/* Central value-bbox resolver â€” strict value-only geometry (Â§13)
   ONLY function to determine final redaction geometry. Prevents
   future paths from accidentally using whole OCR boxes.
   Algorithm Â§8:
    1. Find OCR item by OCR ID
    2. Check OCR text
    3. If exact equals sensitive value -> use OCR bbox
    4. Else if contains -> calculate value sub-bbox
    5. Else DO NOT use that OCR bbox
    6. Continue searching other supplied OCR IDs
    7. If no valid OCR value bbox: optionally use fused bbox ONLY if value-specific
    8. Otherwise reject/skip
   Forbidden: else if (ocrItem.bbox) push(whole bbox)
*/
function resolveSensitiveValueBBox({ text, ocrIds, evidence, fusedCandidate = null }) {
    try {
        const want = cleanText(text);
        if (!want) return null;
        const ocrById = new Map((evidence.ocr || []).map((o) => [o.id, o]));
        // Iterate only supplied OCR IDs â€” never invent bbox
        for (const oid of ocrIds || []) {
            const ocrItem = ocrById.get(oid);
            if (!ocrItem?.bbox) continue;
            const ocrText = cleanText(ocrItem.text);
            if (!ocrText) continue;
            const lowerOcr = ocrText.toLowerCase();
            const lowerWant = want.toLowerCase();
            // Exact equality -> use full OCR bbox (value is line)
            if (lowerOcr === lowerWant) {
                if (FASTVLM_DEBUG) console.log(`[GEOMETRY] resolved: candidate exact ocr_ids=${oid} bbox=[${ocrItem.bbox.map(n=>Math.round(n)).join(",")}]`);
                return [...ocrItem.bbox.map(Number)];
            }
            // Contains -> calculate value sub-bbox
            if (lowerOcr.includes(lowerWant)) {
                const sub = estimateTextSubBBox(ocrItem, want);
                if (sub) {
                    // Validate not whole line
                    if (!isLikelyValueOnlyBBox({ bbox: sub, item: ocrItem, targetText: want })) {
                        if (FASTVLM_DEBUG) console.log(`[SECURITY] rejecting non-value-specific bbox for "${want}" at ${oid}`);
                        continue;
                    }
                    if (FASTVLM_DEBUG) console.log(`[GEOMETRY] resolved: candidate sub-bbox ocr_ids=${oid} bbox=[${sub.map(n=>Math.round(n)).join(",")}]`);
                    return sub;
                }
                // If substring exists but sub-bbox failed, only allow fallback if OCR is essentially the value
                if (ocrText.length <= want.length + 2) {
                    return [...ocrItem.bbox.map(Number)];
                }
                continue;
            }
            // OCR does not contain value â€” ignore this OCR ID entirely (Â§9)
            if (FASTVLM_DEBUG) console.log(`[GEOMETRY] Skip OCR ${oid} does not contain value`);
        }
        // Â§11: fused fallback â€” only when no explicit value bbox found
        // Prefer OCR-derived sub-bbox from fused text, not blind fused.bbox
        if (fusedCandidate?.bbox) {
            const fusedText = cleanText(fusedCandidate.text);
            if (fusedText && fusedText.toLowerCase() === want.toLowerCase()) {
                // Try to locate fused text inside any OCR item that contains it for a value-specific bbox
                for (const oi of evidence.ocr || []) {
                    const ot = cleanText(oi.text);
                    if (!ot) continue;
                    if (ot.toLowerCase() === fusedText.toLowerCase()) {
                        return [...oi.bbox.map(Number)];
                    }
                    if (ot.toLowerCase().includes(fusedText.toLowerCase())) {
                        const sub = estimateTextSubBBox(oi, fusedText);
                        if (sub && isLikelyValueOnlyBBox({ bbox: sub, item: oi, targetText: fusedText })) return sub;
                    }
                }
                // For additional candidates (no fusedCandidate), allow direct fallback only if ocrIds empty
                if (!ocrIds || ocrIds.length === 0) {
                    // Validate fused bbox is value-specific before trusting
                    // Check if any OCR item's bbox equals fused bbox and that item is mixed -> reject
                    let isMixedWholeLine = false;
                    for (const oi of evidence.ocr || []) {
                        if (!oi.bbox) continue;
                        const same = oi.bbox[0]===fusedCandidate.bbox[0] && oi.bbox[1]===fusedCandidate.bbox[1] && oi.bbox[2]===fusedCandidate.bbox[2] && oi.bbox[3]===fusedCandidate.bbox[3];
                        if (same) {
                            const ot = cleanText(oi.text);
                            if (ot.toLowerCase().includes(fusedText.toLowerCase()) && ot.length > fusedText.length + 3) {
                                isMixedWholeLine = true;
                                break;
                            }
                        }
                    }
                    if (!isMixedWholeLine) {
                        if (FASTVLM_DEBUG) console.log(`[GEOMETRY] Fallback to fused bbox for value-only`);
                        return [...fusedCandidate.bbox.map(Number)];
                    } else {
                        if (FASTVLM_DEBUG) console.log(`[SECURITY] rejecting non-value-specific fused bbox`);
                    }
                }
                // Fragment-union trust (IFSC-split fix 2026-09-28): the
                // canonical value spans fragments ("W BSC0LM 1234") so no
                // single OCR item contains it and per-id resolution above
                // always skips. Trust the fused (union/estimated) box ONLY
                // when the collapsed value is fragmented across the ids —
                // prose lines contain themselves spaced, so they can never
                // take this path — and only when the box is not a whole-line
                // box holding much more text (same doctrine as above).
                if (ocrIds && ocrIds.length > 0) {
                    const flatWant = want.toLowerCase().replace(/\s+/g, "");
                    const flats = ocrIds.map((oid) => cleanText(ocrById.get(oid)?.text ?? "").toLowerCase().replace(/\s+/g, ""));
                    const singleHasSpaced = ocrIds.some((oid) => cleanText(ocrById.get(oid)?.text ?? "").toLowerCase().includes(want.toLowerCase()));
                    if (flatWant && flats.join("").includes(flatWant) && !singleHasSpaced) {
                        const fb = fusedCandidate.bbox.map(Number);
                        if (fb.every(Number.isFinite)) {
                            let wholeLine = false;
                            for (const oid of ocrIds) {
                                const oi = ocrById.get(oid);
                                if (!oi?.bbox) continue;
                                const ob = oi.bbox.map(Number);
                                if (!ob.every(Number.isFinite)) continue;
                                const same = ob.every((v, i) => Math.abs(v - fb[i]) < 2);
                                if (same && cleanText(oi.text).length > want.length + 10) { wholeLine = true; break; }
                            }
                            if (!wholeLine) {
                                if (FASTVLM_DEBUG) console.log(`[GEOMETRY] Fallback to fragment-union fused bbox`);
                                return [...fb];
                            }
                        }
                    }
                }
            }
        }
        return null;
    } catch {
        return null;
    }
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
   PHASE 1 Ã¢â‚¬" OCR READING ORDER (spatial, non-destructive)
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
   PHASE 2 Ã¢â‚¬" DETERMINISTIC CONTEXT ANALYZER
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
    { label: "Password", field_type: "PASSWORD" },
    { label: "Gate Pass", field_type: "PASSWORD" },
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
        if (norm === entry.normalized) return entry;
        if (norm.includes(entry.normalized)) {
            if (entry.normalized.length / norm.length >= 0.4) return entry;
            continue;
        }
        if (entry.normalized.includes(norm) && norm.length >= 3) {
            if (norm.length / entry.normalized.length >= 0.4) return entry;
            continue;
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

/* Lead-or-validate doctrine, second half (M3): a low-coverage prose label
   ("gate pass" inside "Temporary gate pass for the contractor") may still
   anchor when the VALUE validates strongly for the field type. This is the
   weak-match companion to findFieldLabelMatch: longest low-coverage hit or
   null. Callers combine: strong match proceeds; weak match proceeds only
   when fieldValuePasses(field_type, valuePart) holds. */
function findFieldLabelMatchWeak(text) {
    const norm = normalizeLabelForMatch(text);
    let best = null;
    for (const entry of NORMALIZED_VOCAB) {
        if (norm === entry.normalized) return { entry, weak: false };
        if (norm.includes(entry.normalized) && entry.normalized.length / norm.length < 0.4) {
            if (!best || entry.normalized.length > best.entry.normalized.length) best = { entry, weak: true };
        }
    }
    return best;
}

/* Value-side validation per field type: the "validate" in lead-or-validate.
   Short, structural, no ML. Returns true when the value is shaped like the
   field claims (EMAIL has @, PHONE/CARD carry digit runs, DATE has date
   structure, IFSC matches its format, PASSWORD is credential-shaped).
   Unknown types return null (no opinion — coverage rule alone decides). */
function fieldValuePasses(fieldType, value) {
    const v = String(value ?? "");
    switch (fieldType) {
        case "EMAIL": return /@/.test(v);
        case "PHONE": return (v.replace(/\D/g, "").length >= 7);
        case "CARD_NUMBER": return /\d{4}/.test(v);
        case "DATE_OF_BIRTH":
        case "DATE":
            return /\d{1,4}[\/-]\d{1,2}[\/-]\d{2,4}/.test(v);
        case "IFSC": return /^[A-Z]{4}0[A-Z0-9]{6}$/i.test(v.trim().replace(/[.,;:]+$/, ""));
        case "PASSWORD": return /@/.test(v) || (/(?=.*[a-zA-Z])(?=.*\d).{6,}/.test(v));
        default: return null;
    }
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
    // FIX: strip leading ordinal like "13." / "14a." / "3)" before prose check so
    // "13. Do you have permanent U.S. Resident status?" is correctly classified
    // as prose/question, not a value, regardless of the leading number.
    const strippedForProse = v.replace(/^\s*\d+[a-z]?[.)]\s*/i, "");
    const proseWords = strippedForProse.split(/\s+/).filter(Boolean);
    if (proseWords.length > 4 && /^[a-z\s.,?()]+$/i.test(strippedForProse) && !/[\d\-_\/]/.test(strippedForProse)) return false;
    // Also reject if stripped form is long prose even with trailing punctuation (covers "?" / ")" cases)
    if (proseWords.length > 4 && !/[\d\-_\/]/.test(strippedForProse) && /^[a-z\s.,?()'"]+$/i.test(strippedForProse)) return false;
    // FIX: numbered field labels/questions like "9. Current Address", "2. Grades", "10. Phone Numbers"
    // are never plausible values â€” they are headers. If original starts with ordinal and stripped
    // contains no digits/@ (no PII-like chars), reject regardless of word count.
    if (/^\s*\d+[a-z]?[.)]\s+/i.test(v)) {
        const stripped = v.replace(/^\s*\d+[a-z]?[.)]\s*/i, "").trim();
        if (stripped && !/[\d@]/.test(stripped)) {
            // stripped is all letters/punct, no digits/email â€” it's a label, not a value
            // covers "9. Current Address" (2 words), "2. Grades" (1 word), "8. Place of Birth" etc.
            if (/^[a-z\s.,'()\/\-]+$/i.test(stripped)) return false;
        }
    }
    return true;
}

function extractLabelValueSameLine(ocrItems) {
    const candidates = [];
    // Ordered separator patterns â€” colon first (most specific), then hyphen/dash variants,
    // then 2+ spaces. Hyphen branch only accepted if label side is a known vocabulary entry,
    // so plain hyphenated prose does not create false positives.
    const SEPARATOR_PATTERNS = [
        /^(.+?):\s*(.+)$/,                 // "Label: value"
        /^(.+?[.:]?\s*[-â€“â€”]+)\s+(.+)$/,    // "Label.- value" / "Label- value" / "Label:- value" / "Reg. No.- value" (requires space after hyphen)
        /^(.+?)\s{2,}(.+)$/,               // "Label    value"
    ];
    for (const item of ocrItems) {
        const raw = String(item.text ?? "");
        let labelPart = null;
        let valuePart = null;
        let labelMatch = null;
        let weakLabel = false;
        // Try each separator in order; keep first that BOTH matches regex AND is a known label
        for (const re of SEPARATOR_PATTERNS) {
            const m = raw.match(re);
            if (!m) continue;
            const candLabel = m[1];
            const candValue = m[2] ? m[2].trim() : "";
            if (!candLabel || !candValue) continue;
            const lm = findFieldLabelMatch(candLabel);
            if (lm) {
                labelPart = candLabel;
                valuePart = candValue;
                labelMatch = lm;
                weakLabel = false;
                break;
            }
            // Weak prose label: proceed ONLY when the value validates
            // strongly for the type (lead-or-validate, second half).
            const wm = findFieldLabelMatchWeak(candLabel);
            if (wm && fieldValuePasses(wm.entry.field_type, candValue) === true) {
                labelPart = candLabel;
                valuePart = candValue;
                labelMatch = wm.entry;
                weakLabel = true;
                break;
            }
            continue; // hyphen split on non-label text — try next pattern (or skip)
        }
        if (!labelPart || !valuePart || !labelMatch) continue;
        if (!isPlausibleValue(valuePart)) continue;
        const valueBBox = estimateTextSubBBox(item, valuePart);
        // If value bbox cannot be confidently estimated, leave null (do NOT use full label+value bbox per Â§4)
        candidates.push({
            source: "deterministic_context",
            ocr_ids: [item.id],
            label: labelMatch.label,
            value: cleanText(valuePart),
            field_type: labelMatch.field_type,
            confidence: weakLabel ? 0.9 : 0.98,
            reason: `Sensitive identifier value associated with ${labelMatch.label} label (same line${weakLabel ? ", prose label + validated value" : ""})`,
            bbox: valueBBox ?? null,
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
                // Strict-type guard (live FP fix 2026-09-28): plausibility
                // alone let "IFSC looks like ..." emit IFSC="looks" at 0.92.
                // fieldValuePasses returning explicit false (IFSC shape,
                // phone digits, @-email, date shape) vetoes; null (unknown
                // types) preserves old behavior. Spoken emails stay covered
                // by the unlabeled sub-pass (no label needed).
                if (fieldValuePasses(labelMatch.field_type, valueItem.text) === false) continue;
                // also need horizontal proximity â€” not across whole page without gap check
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
                // Same strict-type guard as side-by-side (IFSC="looks" class).
                if (fieldValuePasses(labelMatch.field_type, valueItem.text) === false) continue;
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
        // Check if two consecutive rows together form a label, third row is value â€” simplified: label spans 2 lines
        const upperRow = sortedRows[r];
        const middleRow = sortedRows[r + 1];
        // try combining one item from upper + one from middle as multi-line label
        for (const u of upperRow.items) {
            for (const m of middleRow.items) {
                const combined = `${u.text} ${m.text}`;
                const labelMatch = findFieldLabelMatch(combined);
                if (!labelMatch) continue;
                // value could be same middle row after label, or next row
                // case: "Certificate" (row0) + "Number: ABC123XY98" (row1) â€” value in middle row itself
                const colonIdx = m.text.indexOf(":");
                if (colonIdx >= 0) {
                    const after = m.text.slice(colonIdx + 1).trim();
                    if (isPlausibleValue(after)) {
                        const afterBBox = estimateTextSubBBox(m, after);
                        candidates.push({
                            source: "deterministic_context",
                            ocr_ids: [u.id, m.id],
                            label: labelMatch.label,
                            value: cleanText(after),
                            field_type: labelMatch.field_type,
                            confidence: 0.88,
                            reason: `Sensitive identifier value associated with ${labelMatch.label} label (multi-line label)`,
                            bbox: afterBBox ?? null,
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

/* ============================================================
   PHASE 2b — UNLABELED-FORMAT SUB-PASS (Phase 2 optimization)
   Bare format detection over OCR text for PII with no adjacent known
   label. Runs PER OCR ITEM so ocr_ids/geometry resolve through the
   existing estimateTextSubBBox path — no second geometry system.
   Scope is the approved variant list (Phase 2 proposal 2026-09-27):
   EMAIL / PHONE / DATE / CARD_LAST4 (label-anchored only) /
   TRACKING / VAT_ID. Names/addresses stay NER's job; IN-locale IDs
   stay piidetector's job. Placeholder/example-domain exclusions apply
   before any match counts.
   Overlap note (verified, not assumed): DATE always requires date
   separators (slash/dash with month/day/year structure) so it cannot
   match TRACKING digit-runs or CARD_LAST4 4-digit values; PHONE
   requires 3-3-4 digit groups or a leading + so it cannot match
   dates/amounts/refs; CARD_LAST4 requires its label anchor. Residual
   same-span collisions resolve longest-span, then higher confidence,
   then fixed type order below.
   ============================================================ */

const UNLABELED_FORMAT_TYPES = [
    {
        field_type: "EMAIL",
        confidence: 0.95,
        // piidetector EMAIL_ID shape + run-on guards: the greedy domain eats
        // sentence continuations ("billing@example.org. Authorized" ->
        // "...org.Authorizedsignatory"). Two guards: TLD capped at 8
        // (real-world TLDs; exotic longer ones stay NER's job — Ettin tags
        // emails robustly) and (?!\.[A-Za-z]) blocking dot-letter
        // continuations. Legit trailing punctuation ("user@example.com.
        // Next") still matches.
        regexes: [/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,8}(?!\.[A-Za-z])\b/gi],
        skipValue: (v) => isExampleEmail(v) || isPlaceholderText(v),
    },
    {
        field_type: "PHONE",
        confidence: 0.9,
        regexes: [
            // US NANP, lenient exchange (fictional ranges like 555-01xx must hit):
            // +1-555-014-2288, (555) 014-2288, 555-014-2288, dotted/spaced.
            /(?<!\d)(?:\+?1[\s.\-]?)?(?:\(?[2-9]\d{2}\)?[\s.\-]?)\d{3}[\s.\-]\d{4}(?!\d)/g,
            // Generic E.164 fallback for non-NANP internationals.
            /(?<!\d)\+\d[\d\s.\-()]{7,16}(?!\d)/g,
        ],
        validateValue: (v) => {
            const digits = String(v).replace(/\D/g, "");
            return digits.length >= 10 && digits.length <= 15;
        },
    },
    {
        field_type: "DATE",
        confidence: 0.85,
        regexes: [
            // MM/DD/YYYY (also matches DD/MM — accepted, marked DATE, no locale split).
            /(?<!\d)(0?[1-9]|1[0-2])\/(0?[1-9]|[12]\d|3[01])\/(\d{2}|\d{4})(?!\d)/g,
            // MM-DD-YYYY / DD-MM-YYYY (dash form; same acceptance rule).
            /(?<!\d)(0?[1-9]|[12]\d|3[01])-(0?[1-9]|1[0-2])-(\d{2}|\d{4})(?!\d)/g,
            // ISO YYYY-MM-DD.
            /(?<!\d)(\d{4})-(0?[1-9]|1[0-2])-(0?[1-9]|[12]\d|3[01])(?!\d)/g,
        ],
    },
    {
        field_type: "CARD_NUMBER",
        confidence: 0.9,
        // Label-anchored ONLY — freestanding 4-digit runs (gate codes,
        // amounts, years) are explicitly out of scope. Anchors cover
        // "ending 3524" and "ends 8810" (bare "ends" without "in" included
        // per M3); the (?<![a-z]) guard keeps "weekends 2024" out.
        regexes: [/(?<![a-z])(?:ending|ends?)(?:\s+in)?\D{0,10}(\d{4})(?!\d)/gi],
        valueGroup: 1,
    },
    {
        field_type: "EMAIL",
        confidence: 0.85,
        // Spoken/obfuscated form: "jeet dot routh at gmail". The VALUE is
        // the original span (geometry resolves on it). Dot-chain required
        // on at least one side keeps "meet me at noon" out. Intra-word OCR
        // splits ("em ail") are NOT covered here (no word boundaries exist
        // in collapsed text to anchor the local part — attempted, gobbled);
        // that case stays with NER, which tags email entities on spaced
        // text robustly (verified live).
        regexes: [/\b[a-z0-9._-]+(?:\s+dot\s+[a-z0-9._-]+)+\s+at\s+[a-z0-9-]+(?:\s+dot\s+[a-z0-9-]+)*\b/gi],
    },
    {
        field_type: "PASSWORD",
        confidence: 0.85,
        // Pure shape rule (M3): credential-shaped tokens need no label and
        // no NER confidence. No spaces, >=8 chars, letters + @ with a digit
        // or symbol ("Tamluk@2019"). Real addresses lose the overlap to the
        // EMAIL type (0.95 wins ties after longer-span); letter-only
        // "name@host" forms stay NER's job (validateValue rejects them).
        regexes: [/\b(?=[A-Za-z0-9._-]*@)(?=[A-Za-z0-9._-]*[A-Za-z])[A-Za-z0-9._-]+@[A-Za-z0-9.-]+\b/gi],
        validateValue: (v) => v.length >= 8 && (/\d/.test(v) || /[#$%&*!?_]/.test(v)),
    },
    {
        field_type: "IFSC",
        confidence: 0.95,
        // Exact format port (piidetector IFSC_CODE shape): 4 letters + 0 +
        // 6 alphanumerics. Catches WBSC0LM1234 with no label needed.
        // Spaced variant (live miss 2026-09-28: OCR split "W BSC0LM 1234"
        // across fragments at 959px width — condensed-row glues words and
        // kills the \b the exact pattern needs, per-item can't span
        // fragments). The 4-letter bank is UPPERCASE-only and space-splittable
        // ([A-Z](?:\s*[A-Z]){3}): this is what keeps "Call 0123456" (lowercase
        // prose) out while "W BSC" assembles. All-caps prose + 0 + 6 alnum
        // remains a stated residual. Runs on spaced text everywhere;
        // normalizeValue collapses to canonical, validateValue enforces
        // the strict shape on the collapsed form.
        regexes: [/\b[A-Z]{4}0[A-Z0-9]{6}\b/gi, /\b[A-Z](?:\s*[A-Z]){3}\s*0(?:\s*[A-Za-z0-9]){6}\b/g],
        normalizeValue: (v) => v.replace(/\s+/g, ""),
        validateValue: (v) => /^[A-Z]{4}0[A-Z0-9]{6}$/i.test(v.replace(/\s+/g, "")),
    },
    {
        field_type: "TRACKING_NUMBER",
        confidence: 0.9,
        regexes: [
            // UPS 1Z + 16 alphanumerics, spaced or solid.
            /\b1Z(?:\s?[A-Z0-9]){16}\b/gi,
            // FedEx 12 / 15 digit, USPS 20-22 digit.
            /(?<!\d)\d{12}(?!\d)/g,
            /(?<!\d)\d{15}(?!\d)/g,
            /(?<!\d)\d{20,22}(?!\d)/g,
        ],
    },
    {
        field_type: "VAT_ID",
        confidence: 0.85,
        regexes: [
            // GB VAT: GB 123 4567 89, spaced or solid.
            /\bGB\s?\d{3}\s?\d{4}\s?\d{2}\b/gi,
            // Small EU set, format-only (no checksum — stated limitation).
            // Digit-led is LOAD-BEARING: bare 2-letter prefixes match English
            // word starts under /i ("FI"+"ctitious", "DE"+"partment" both
            // matched the looser form live 2026-09-28 — title and
            // "department" false positives). Real VATs are near-universally
            // digit-led after the prefix; letter-led forms (some FR/IE)
            // are knowingly out of scope.
            /\b(?:DE|FR|IT|ES|NL|BE|IE|AT|DK|SE|FI|PT|GR|PL|CZ|HU)\s?\d[A-Z0-9]{7,11}\b/gi,
        ],
    },
];

// Fixed order for same-span different-type ties (longest span and higher
// confidence are compared first; this order only breaks exact ties).
const UNLABELED_TYPE_ORDER = ["EMAIL", "PHONE", "TRACKING_NUMBER", "VAT_ID", "DATE", "CARD_NUMBER"];

function _stripEdgePunct(t) {
    return cleanText(t).replace(/^[.,:;]+/, "").replace(/[.,:;]+$/, "");
}

function extractUnlabeledFormatCandidates(ocrItems) {
    const candidates = [];
    for (const item of ocrItems || []) {
        const text = String(item?.text ?? "");
        if (!text || isPlaceholderText(text)) continue;
        // Collect all raw matches with spans on this item for overlap resolution.
        const raw = [];
        for (const type of UNLABELED_FORMAT_TYPES) {
            for (const re of type.regexes) {
                re.lastIndex = 0;
                let m;
                while ((m = re.exec(text)) !== null) {
                    const full = m[0];
                    let value = full;
                    let spanStart = m.index;
                    if (type.valueGroup != null && m[type.valueGroup] != null) {
                        value = m[type.valueGroup];
                        spanStart = m.index + full.indexOf(value);
                    }
                    value = cleanText(value);
                    if (!value) continue;
                    // Canonicalize glue-sensitive values (IFSC "W BSC0LM 1234"
                    // -> "WBSC0LM1234") before validation so spaced matches
                    // face the strict shape, not the spaced accident.
                    if (type.normalizeValue) value = type.normalizeValue(value);
                    if (!value) continue;
                    if (type.skipValue && type.skipValue(value)) continue;
                    if (type.validateValue && !type.validateValue(value)) continue;
                    // EMAIL carries its own shape guarantee (@ or dot/at
                    // spoken structure from the pattern itself); the generic
                    // prose guard would reject 5-word spoken addresses as
                    // sentences, so it gets a lighter length/alnum check.
                    if (type.field_type === "EMAIL") {
                        if (!/[a-z0-9]/i.test(value) || value.length < 6 || value.length > 80) continue;
                    } else if (!isPlausibleValue(value)) continue;
                    raw.push({
                        field_type: type.field_type,
                        confidence: type.confidence,
                        value,
                        start: spanStart,
                        end: spanStart + value.length,
                        item,
                    });
                    // Guard against zero-length-match infinite loops.
                    if (full.length === 0) re.lastIndex++;
                }
            }
        }
        // Same-item overlap resolution: longest span wins, then higher
        // confidence, then fixed type order. Suppress (don't merge) losers.
        raw.sort((a, b) => (b.end - b.start) - (a.end - a.start) || b.confidence - a.confidence ||
            UNLABELED_TYPE_ORDER.indexOf(a.field_type) - UNLABELED_TYPE_ORDER.indexOf(b.field_type));
        const kept = [];
        for (const r of raw) {
            if (kept.some((k) => r.start < k.end && r.end > k.start)) continue;
            kept.push(r);
        }
        for (const k of kept) {
            const valueBBox = estimateTextSubBBox(k.item, k.value);
            candidates.push({
                source: "deterministic_format",
                ocr_ids: [k.item.id],
                label: null,
                value: k.value,
                field_type: k.field_type,
                confidence: k.confidence,
                reason: `Bare ${k.field_type} format match without adjacent label (unlabeled-format sub-pass)`,
                bbox: valueBBox ?? null,
                raw_text: text,
            });
        }
    }
    return candidates;
}

/* Cross-item anchor pass (M3): the unlabeled CARD pattern needs its anchor
   ("ending 3524") in ONE OCR item, but PaddleOCR may split label and digits
   into adjacent boxes ("ending" | "3524"). For a bare 4-digit item whose
   LEFT neighbor in the same row TRAILS with an anchor word (ending/ends/
   card/account + optional period), emit the digits as CARD_NUMBER. The
   trailing-anchor rule is the FP guard: "gate code 4410" does not end with
   an anchor word, so gate codes/years/amounts stay out. */
function extractCrossItemAnchored(orderedItems, rows) {
    const candidates = [];
    for (const row of rows || []) {
        const rowItems = [...row.items].sort((a, b) => a.bbox[0] - b.bbox[0]);
        for (let i = 1; i < rowItems.length; i++) {
            const digitItem = rowItems[i];
            const anchorItem = rowItems[i - 1];
            const digits = cleanText(digitItem.text);
            if (!/^\d{4}$/.test(digits)) continue;
            const anchorText = cleanText(anchorItem.text);
            if (!/\b(ending|ends|last\s*4|card|account)\.?$/i.test(anchorText)) continue;
            const gap = digitItem.bbox[0] - anchorItem.bbox[2];
            if (gap < -5 || gap > 120) continue;
            candidates.push({
                source: "deterministic_format",
                ocr_ids: [digitItem.id],
                label: cleanText(anchorItem.text),
                value: digits,
                field_type: "CARD_NUMBER",
                confidence: 0.88,
                reason: "Bare last-4 digits anchored by trailing label in neighboring OCR box (cross-item anchor)",
                bbox: digitItem.bbox ?? null,
                raw_text: `${anchorItem.text} ${digitItem.text}`,
            });
        }
    }
    return candidates;
}

/* Row-joined spaceless matching (live-OCR fix): PaddleOCR inserts spaces
   inside tokens ("Tamluk @ 2019", "W BSC0LM 1234") and splits them across
   boxes, so per-item contiguous patterns miss everything the audit catches
   on clean text. This pass concatenates each row's items with whitespace
   REMOVED, matches all unlabeled formats against that, and maps each hit
   back to its contributing boxes (union bbox). Candidates flow through the
   same cross-source suppression/dedup as per-item hits below. */
function extractRowJoinedFormats(rows) {
    const candidates = [];
    for (const row of rows || []) {
        const rowItems = [...row.items].sort((a, b) => a.bbox[0] - b.bbox[0]);
        // nospace string + per-char provenance (item + original offset, so
        // condensed-pattern values rebuild to the TRUE original span, not
        // whole boxes).
        let condensed = "";
        const prov = [];
        // Spaced mirror of the visual line (single-space item joins +
        // original intra-item spaces) with per-char mapping into condensed
        // coords. Space-tolerant patterns match here; condensed-only
        // matching glues words ("likeWBSC...") and kills the \b exact
        // patterns need (IFSC live miss 2026-09-28).
        let spaced = "";
        const spMap = [];
        let firstItem = true;
        for (const it of rowItems) {
            if (!firstItem) { spaced += " "; spMap.push(-1); }
            firstItem = false;
            const t = String(it.text ?? "");
            for (let oi = 0; oi < t.length; oi++) {
                const ch = t[oi];
                if (/\s/.test(ch)) { spaced += ch; spMap.push(-1); continue; }
                spaced += ch;
                spMap.push(condensed.length);
                condensed += ch;
                prov.push({ it, off: oi });
            }
        }
        if (!condensed) continue;
        const raw = [];
        for (const type of UNLABELED_FORMAT_TYPES) {
            for (const re of type.regexes) {
                re.lastIndex = 0;
                let m;
                while ((m = re.exec(condensed)) !== null) {
                    const full = m[0];
                    let value = full;
                    let spanStart = m.index;
                    if (type.valueGroup != null && m[type.valueGroup] != null) {
                        value = m[type.valueGroup];
                        spanStart = m.index + full.indexOf(value);
                    }
                    value = cleanText(value);
                    if (!value) continue;
                    if (type.normalizeValue) value = type.normalizeValue(value);
                    if (!value) continue;
                    if (type.skipValue && type.skipValue(value)) continue;
                    if (type.validateValue && !type.validateValue(value)) continue;
                    if (type.field_type === "EMAIL") {
                        if (!/[a-z0-9]/i.test(value) || value.length < 6 || value.length > 80) continue;
                    } else if (!isPlausibleValue(value)) continue;
                    raw.push({ field_type: type.field_type, confidence: type.confidence, value, start: spanStart, end: spanStart + value.length });
                    if (full.length === 0) re.lastIndex++;
                }
            }
        }
        // Spaced-row pass: same patterns against the visual line with real
        // spaces ("IFSC looks like W BSC0LM 1234 verify"). Match spans map
        // back to condensed coords via spMap so boxes, ids and the overlap
        // dedup below stay unified; values come from the condensed slice
        // (canonical, spaceless). Duplicates of condensed matches collapse
        // in kept-overlap; validators + gates still apply.
        for (const type of UNLABELED_FORMAT_TYPES) {
            for (const re of type.regexes) {
                re.lastIndex = 0;
                let m;
                while ((m = re.exec(spaced)) !== null) {
                    const full = m[0];
                    if (full.length === 0) { re.lastIndex++; continue; }
                    let vStart = m.index;
                    if (type.valueGroup != null && m[type.valueGroup] != null) {
                        vStart = m.index + full.indexOf(m[type.valueGroup]);
                    }
                    const vLen = (type.valueGroup != null && m[type.valueGroup] != null ? m[type.valueGroup] : full).length;
                    let cs = -1, ce = -1;
                    for (let si = vStart; si < vStart + vLen && si < spMap.length; si++) {
                        const ci = spMap[si];
                        if (ci < 0) continue;
                        if (cs < 0) cs = ci;
                        ce = ci + 1;
                    }
                    if (cs < 0 || ce <= cs) continue;
                    // True-span value: the spaced slice preserves original
                    // spacing ("jeet dot routh at gmail", not the glued
                    // condensed form); boxes still come from condensed coords
                    // above. normalizeValue canonicalizes glue-sensitive
                    // types (IFSC) back to spaceless afterwards.
                    let value = cleanText(spaced.slice(vStart, vStart + vLen));
                    if (!value) continue;
                    if (type.normalizeValue) value = type.normalizeValue(value);
                    if (!value) continue;
                    if (type.skipValue && type.skipValue(value)) continue;
                    if (type.validateValue && !type.validateValue(value)) continue;
                    if (type.field_type === "EMAIL") {
                        if (!/[a-z0-9]/i.test(value) || value.length < 6 || value.length > 80) continue;
                    } else if (!isPlausibleValue(value)) continue;
                    raw.push({ field_type: type.field_type, confidence: type.confidence, value, start: cs, end: ce });
                }
            }
        }
        raw.sort((a, b) => (b.end - b.start) - (a.end - a.start) || b.confidence - a.confidence ||
            UNLABELED_TYPE_ORDER.indexOf(a.field_type) - UNLABELED_TYPE_ORDER.indexOf(b.field_type));
        const kept = [];
        for (const r of raw) {
            if (kept.some((k) => r.start < k.end && r.end > k.start)) continue;
            kept.push(r);
        }
        for (const k of kept) {
            const boxes = [];
            const ids = [];
            for (let i = k.start; i < k.end && i < prov.length; i++) {
                const pr = prov[i];
                const it = pr && pr.it ? pr.it : null;
                if (it && !ids.includes(it.id)) {
                    ids.push(it.id);
                    if (it.bbox) boxes.push(it.bbox);
                }
            }
            if (!ids.length) continue;
            const finalValue = k.value;
            const nums = boxes.flat().map(Number).filter(Number.isFinite);
            const union = nums.length >= 4
                ? [Math.min(...nums.filter((_, i) => i % 4 === 0)), Math.min(...nums.filter((_, i) => i % 4 === 1)),
                   Math.max(...nums.filter((_, i) => i % 4 === 2)), Math.max(...nums.filter((_, i) => i % 4 === 3))]
                : null;
            candidates.push({
                source: "deterministic_format",
                ocr_ids: ids,
                label: null,
                value: finalValue,
                field_type: k.field_type,
                confidence: k.confidence,
                reason: "Bare format match on whitespace-collapsed row text (OCR spacing-tolerant)",
                bbox: union,
                raw_text: rowItems.map((it) => it.text).join(" "),
            });
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
    const labeled = [...sameLine, ...sideBySide, ...vertical, ...multiLine];
    const formatBased = extractUnlabeledFormatCandidates(ocr.items);
    const rowJoined = extractRowJoinedFormats(rows);
    const crossItem = extractCrossItemAnchored(ordered, rows);
    // Cross-source preference: when a label-anchored candidate already covers
    // the same value text on shared OCR ids, keep the labeled (more specific)
    // hit and drop the bare-format duplicate. Trailing-punct-insensitive so
    // "09/27/1981," (labeled) suppresses "09/27/1981" (bare).
    const labeledKeys = new Set();
    for (const c of labeled) {
        const v = _stripEdgePunct(c.value).toLowerCase();
        for (const id of c.ocr_ids || []) labeledKeys.add(`${v}|${id}`);
    }
    const filteredFormat = [...formatBased, ...rowJoined, ...crossItem].filter((c) => {
        const v = _stripEdgePunct(c.value).toLowerCase();
        return !(c.ocr_ids || []).some((id) => {
            if (labeledKeys.has(`${v}|${id}`)) return true;
            // Containment either way on the same item: labeled wins.
            for (const key of labeledKeys) {
                const [lv, lid] = key.split("|");
                if (lid !== String(id)) continue;
                if (lv && v && (lv.includes(v) || v.includes(lv))) return true;
            }
            return false;
        });
    });
    const all = [...labeled, ...filteredFormat];
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


function normalizeCandidateText(t) {
    return cleanText(t).toLowerCase();
}

function isContained(smaller, larger) {
    const s = normalizeCandidateText(smaller);
    const l = normalizeCandidateText(larger);
    if (!s || !l) return false;
    if (s === l) return false;
    if (l.includes(s)) return true;
    // Spacing-insensitive: OCR inserts spaces inside tokens ("Tamluk @ 2019"
    // vs "Tamluk@2019") — without this, spaced and canonical forms of the
    // same value survive as duplicate findings on overlapping regions.
    const ns = s.replace(/\s+/g, "");
    const nl = l.replace(/\s+/g, "");
    if (!ns || !nl) return false;
    if (ns === nl) return true;
    return nl.includes(ns);
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
    // keep larger only — EXCEPT the value-rescue below. Also handle same OCR region containment.
    // Sort by text length descending so larger wins.
    candidates.sort((a, b) => b.text.length - a.text.length || b.confidence - a.confidence);
    const keep = [];
    for (const c of candidates) {
        let contained = false;
        for (let ki = 0; ki < keep.length; ki++) {
            const k = keep[ki];
            const sameRegion = c.ocr_ids.length && k.ocr_ids.length && c.ocr_ids.some((id) => k.ocr_ids.includes(id));
            const textContained = isContained(c.text, k.text);
            if (textContained && sameRegion) {
                contained = true;
                // Value-rescue (live-OCR fix 2026-09-28, proven by [TRACE]:
                // NER line-spans gobbled deterministic values — "Old account
                // ending 3524 ... WBSC0LM1234" (85 chars) ate 3524/8810/IFSC,
                // then Gate 5 dropped the sentence as prose. When the smaller
                // span is a deterministic format, the larger is ettin-only
                // prose, and the larger dwarfs it (>2x), the VALUE wins: it
                // becomes the keeper with merged evidence (dual sources, max
                // confidence, value-specific bbox). Near-equal duplicates
                // ("Tamluk @ 2019" vs "Tamluk@2019") still keep the larger.
                const cIsDeterministic = (c.sources || []).includes("deterministic_context");
                const kIsEttinOnly = (k.sources || []).length > 0 && (k.sources || []).every((s) => s === "ettin");
                if (cIsDeterministic && kIsEttinOnly && k.text.length > c.text.length * 2) {
                    c.sources = [...new Set([...(c.sources || []), ...(k.sources || [])])];
                    c.candidate_types = [...new Set([...(c.candidate_types || []), ...(k.candidate_types || [])])];
                    c.confidence = Math.max(Number(c.confidence ?? 0), Number(k.confidence ?? 0));
                    if (!c.label_context && k.label_context) c.label_context = k.label_context;
                    if (!c.bbox && k.bbox) c.bbox = k.bbox;
                    keep[ki] = c;
                    break;
                }
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
   T2 GATE — HIGH / LOW split for gated crop adjudication.
   T2 (FastVLM) fires IFF low-confidence entities exist; clean pages
   never pay a millisecond, and every avoided T2 is one fewer chance
   to wedge transformers.js's global webInferenceChain. Thresholds are
   locked by the 2026-09-28 replan (H=0.90, F=0.50, N=6, margin 25%):
   - HIGH: dual-source (ettin + deterministic agree) OR single-source
     confidence >= H. Redacted synchronously, no T2. Deterministic
     formats land at 0.85-0.95, so most land here by precision.
   - LOW: single-source, F <= score < H. This is NER's
     password-fragment / degraded-type population (observed 0.58-0.94
     on ambiguous) — routed to per-candidate crop checks.
   - Below F: dropped (existing Gate 6 floor drops them anyway).
   Dual-source def mirrors Gate 6 in safety.js (sources must include
   both "ettin" and "deterministic_context" — all deterministic
   sub-passes share the latter tag, see fuseRedactionCandidates).
   ============================================================ */

const T2_HIGH_CONFIDENCE = 0.90;
const T2_FLOOR = 0.50;
const T2_CANDIDATE_CAP = 6;

function isDualSourceCandidate(c) {
    const s = c?.sources;
    return Array.isArray(s) && s.length >= 2 && s.includes("ettin") && s.includes("deterministic_context");
}

function selectT2ReviewCandidates(fusedCandidates) {
    const high = [];
    const low = [];
    for (const c of fusedCandidates || []) {
        const conf = Number(c?.confidence ?? 0);
        if (isDualSourceCandidate(c) || conf >= T2_HIGH_CONFIDENCE) {
            high.push(c);
            continue;
        }
        if (conf >= T2_FLOOR) low.push(c);
        // Below floor: dropped (Gate 6 floor handles the stragglers).
    }
    // Lowest-confidence-first: the most uncertain gets reviewed; the cap
    // bounds serialized iGPU burn (N x ~15s worst case).
    low.sort((a, b) => Number(a.confidence ?? 0) - Number(b.confidence ?? 0));
    return { high, low: low.slice(0, T2_CANDIDATE_CAP), droppedLow: Math.max(0, low.length - T2_CANDIDATE_CAP) };
}

/* ============================================================
   UI STRUCTURE ANALYSIS
    Generic geometry-based UI role detection from OCR + image geometry.
    NO additional ML model required Ã¢â‚¬" uses OCR bboxes, text, and image dims.
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
 * Builds a UI structure analysis from screenshot, OCR, and optional FastVLM caption.
 *
 * @param {Object} params - Parameters object
 * @param {Object} params.image - Image with width/height
 * @param {Object} params.ocr - OCR result with items array
 * @param {Object} params.fastvlm - Optional FastVLM caption result
 * @returns {Object} UI structure with elements, groups, relationships, containers
 */
function buildUIStructure({ image, ocr, fastvlm }) {
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


export {
    asString,
    cleanText,
    estimateTextSubBBox,
    _proportionalBBox,
    isLikelyValueOnlyBBox,
    isExampleEmail,
    isPlaceholderText,
    filterPlaceholderChunks,
    buildOCRGlobalSpans,
    findOCRRegionsForSpan,
    buildFindingsFromEntity,
    buildReadingOrder,
    SENSITIVE_FIELD_VOCABULARY,
    normalizeLabelForMatch,
    findFieldLabelMatch,
    findFieldLabelMatchWeak,
    fieldValuePasses,
    isPlausibleValue,
    extractLabelValueSameLine,
    extractLabelValueSideBySide,
    extractLabelValueVertical,
    extractMultiLineLabel,
    extractUnlabeledFormatCandidates,
    extractRowJoinedFormats,
    extractCrossItemAnchored,
    UNLABELED_FORMAT_TYPES,
    extractSensitiveFieldCandidates,
    resolveSensitiveValueBBox,
    normalizeCandidateText,
    isContained,
    fuseRedactionCandidates,
    isDualSourceCandidate,
    selectT2ReviewCandidates,
    T2_HIGH_CONFIDENCE,
    T2_FLOOR,
    T2_CANDIDATE_CAP,
    normalizeOcrItem,
    computeRelationship,
    detectHorizontalGroups,
    detectInputCandidates,
    detectButtonCandidates,
    detectLinkCandidates,
    detectContainers,
    buildUIStructure
};
