// NER token offset and BIO label helpers ported 1:1 from v7.mjs
import { cleanText } from "./heuristics.js";

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
        const searchStart = cursor;
        const foundIndex = sourceText.indexOf(tokenText, searchStart);

        if (foundIndex >= 0) {
            const start = foundIndex;
            const end = foundIndex + tokenText.length;
            cursor = end;
            mapping.push([start, end]);
        } else {
            // Try trimmed token match from cursor forward
            const trimmed = tokenText.trim();
            const trimmedIndex = trimmed ? sourceText.indexOf(trimmed, cursor) : -1;
            if (trimmedIndex >= 0) {
                cursor = trimmedIndex + trimmed.length;
                mapping.push([trimmedIndex, cursor]);
            } else {
                // Keep cursor monotonically increasing — avoid jumping backward
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
        const tokenText = tokenTexts?.[prediction.tokenIndex] ?? "";
        const subwordContinuation = isSubword(tokenText);

        // Subword continuations (no leading space, part of same word):
        // belong to the active entity even if individual subword score dipped
        if (current && subwordContinuation) {
            current.endToken = prediction.tokenIndex;
            current.scores.push(score);
            continue;
        }

        if (prefix === "O" || !type || score < NER_MIN_SCORE) {
            flush();
            continue;
        }

        const sameEntity = current && current.type === type;

        if (prefix === "I" && sameEntity) {
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


const NER_MIN_SCORE = 0.3;

export {
    normalizeId2Label,
    softmax,
    parseBioLabel,
    findEntitySpan,
    buildManualOffsetMapping,
    mergeNERPredictions,
    NER_MIN_SCORE,
};
