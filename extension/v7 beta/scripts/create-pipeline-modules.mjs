import fs from "node:fs";

const v7 = fs.readFileSync("v7.mjs", "utf8");
const lines = v7.split(/\r?\n/);

fs.mkdirSync("src/pipeline", { recursive: true });

// 1. heuristics.js (lines 254 to 528, 582 to 1101, 1603 to 2242)
const utils = lines.slice(254, 528).join("\n");
const ocrHeuristics = lines.slice(582, 1101).join("\n");
const uiStructure = lines.slice(1603, 2242).join("\n");

const heuristicsContent = `// Pure heuristic and structural analysis functions ported 1:1 from v7.mjs

${utils}

${ocrHeuristics}

${uiStructure}

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
    isPlausibleValue,
    extractLabelValueSameLine,
    extractLabelValueSideBySide,
    extractLabelValueVertical,
    extractMultiLineLabel,
    extractSensitiveFieldCandidates,
    resolveSensitiveValueBBox,
    normalizeCandidateText,
    isContained,
    fuseRedactionCandidates,
    normalizeOcrItem,
    computeRelationship,
    detectHorizontalGroups,
    detectInputCandidates,
    detectButtonCandidates,
    detectLinkCandidates,
    detectContainers,
    buildUIStructure
};
`;
fs.writeFileSync("src/pipeline/heuristics.js", heuristicsContent, "utf8");
console.log("src/pipeline/heuristics.js written (" + heuristicsContent.length + " bytes)");

// 2. ner-utils.js (lines 1105 to 1304)
const nerUtils = lines.slice(1105, 1304).join("\n");
const nerUtilsContent = `// NER token offset and BIO label helpers ported 1:1 from v7.mjs

${nerUtils}

export {
    normalizeId2Label,
    softmax,
    parseBioLabel,
    findEntitySpan,
    buildManualOffsetMapping
};
`;
fs.writeFileSync("src/pipeline/ner-utils.js", nerUtilsContent, "utf8");
console.log("src/pipeline/ner-utils.js written (" + nerUtilsContent.length + " bytes)");

// 3. prompts.js (lines 2246 to 2474)
const promptLines = lines.slice(2246, 2474).join("\n");
const promptsContent = `// FastVLM prompts and evidence formatting ported 1:1 from v7.mjs
import { cleanText } from "./heuristics.js";

${promptLines}

export {
    ALLOWED_FASTVLM_TYPES,
    buildFastVLMRedactionEvidence,
    buildFastVLMRedactionPrompt,
    buildPerceptionPrompt
};
`;
fs.writeFileSync("src/pipeline/prompts.js", promptsContent, "utf8");
console.log("src/pipeline/prompts.js written (" + promptsContent.length + " bytes)");

// 4. safety.js (lines 2928 to 3655)
const safetyLines = lines.slice(2928, 3655).join("\n");
const safetyContent = `// Safety gating, JSON validation, and candidate adjudication ported 1:1 from v7.mjs
import { isContained } from "./heuristics.js";
import { ALLOWED_FASTVLM_TYPES } from "./prompts.js";

${safetyLines}

export {
    extractJsonObject,
    validateFastVLMRedactionOutput,
    buildFastVLMFinalCandidates,
    resolveFinalRedactionRegions,
    applySafetyGates,
    adjudicateOrFallback,
    redactChunks
};
`;
fs.writeFileSync("src/pipeline/safety.js", safetyContent, "utf8");
console.log("src/pipeline/safety.js written (" + safetyContent.length + " bytes)");
