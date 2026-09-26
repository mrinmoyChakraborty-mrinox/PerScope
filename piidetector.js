"use strict";

// Debug logging for PII-bearing internals. OFF by default and safe to import
// in browser/extension bundles: `process` does not exist there, so the flag
// can never be on outside Node. Never log raw text/detections unconditionally.
const PII_DEBUG =
    typeof process !== "undefined" &&
    !!process.env &&
    process.env.PII_DEBUG === "1";

function debugLog(...args) {
    if (PII_DEBUG) {
        console.log(...args);
    }
}

const NER_MODEL_FILE_NAME = "model";
const NER_MAX_TOKENS = 512;
const NER_MIN_SCORE = 0.3;

let nerCache = null;
async function loadNER() {
    if (nerCache) {
        return nerCache;
    }

    // Node/CPU instance of the Ettin session, loaded lazily so this module
    // stays import-safe in bundled browser/extension contexts (no top-level
    // Node builtins). Distinct from the v7 image pipeline's WebGPU Ettin
    // session — which integration is canonical for DOM work is still an OPEN
    // decision (reference: piidetector-extension-readiness). Do not merge,
    // delete, or redirect either session without an explicit instruction.
    const path = require("path");
    const fs = require("fs");

    const NER_MODEL = path.resolve(
        __dirname,
        "models/ettin-68m-nemotron-pii-onnx"
    );

    const {
        AutoTokenizer,
        AutoModelForTokenClassification
    } = await import("@huggingface/transformers");

    let modelId = NER_MODEL;

    try {
        await fs.promises.access(modelId);
    } catch {
        modelId = "rulesentry-io/ettin-68m-nemotron-pii-onnx";
    }

    const tokenizer =
        await AutoTokenizer.from_pretrained(modelId);

    const model =
        await AutoModelForTokenClassification.from_pretrained(
            modelId,
            {
                dtype: "fp32",
                model_file_name: NER_MODEL_FILE_NAME,
                // The upstream repo keeps model.onnx at ROOT (no onnx/
                // subfolder); transformers.js defaults subfolder to "onnx",
                // which 404s. Empty string targets the root file.
                subfolder: "",
                device: "cpu"
            }
        );

    const id2label =
        model.config?.id2label ?? {};

    if (Object.keys(id2label).length === 0) {
        throw new Error("Ettin NER id2label is missing.");
    }

    const configuredMax =
        Number(
            model.config?.max_position_embeddings ??
            NER_MAX_TOKENS
        );

    const maxTokens = Math.min(
        NER_MAX_TOKENS,
        configuredMax > 0
            ? configuredMax
            : NER_MAX_TOKENS
    );

    nerCache = {
        tokenizer,
        model,
        id2label,
        maxTokens
    };

    return nerCache;
}

/**
 * ============================================================================
 * PII DETECTOR + REDACTOR
 * ============================================================================
 *
 * PURPOSE
 * -------
 * This module is intended for a pipeline such as:
 *
 *      Browser DOM
 *          ↓
 *      Extract visible / relevant text
 *          ↓
 *      detectPII(text)
 *          ↓
 *      redactPII(text)
 *          ↓
 *      Safe text / structured result
 *
 * The original Python implementation used:
 *
 *   - Regular expressions for PII detection
 *   - Luhn validation for card numbers
 *   - IBAN checksum validation
 *   - Overlap resolution
 *   - Placeholder replacement
 *
 * This JavaScript implementation keeps that architecture, but adds several
 * production-oriented safeguards.
 *
 *
 * ============================================================================
 * IMPORTANT SECURITY DESIGN NOTES
 * ============================================================================
 *
 * 1. REGEX ALONE IS NOT ENOUGH
 * ----------------------------
 * A regex can detect something that LOOKS like PII, but that does not mean
 * it actually is PII.
 *
 * Example:
 *
 *     4111111111111111
 *
 * might look like a card number.
 *
 * A validation algorithm such as Luhn reduces false positives.
 *
 * The same principle should be applied to every high-risk identifier where
 * a checksum / country-specific validation rule exists.
 *
 *
 * 2. CONTEXT MATTERS
 * ------------------
 * A value such as:
 *
 *     12345678
 *
 * can mean many things:
 *
 *     order number
 *     employee ID
 *     account number
 *     random number
 *     ZIP/postal code
 *
 * Therefore, a strong production detector should combine:
 *
 *     PATTERN
 *       +
 *     CONTEXT
 *       +
 *     VALIDATION
 *       +
 *     CONFIDENCE
 *
 *
 * 3. DO NOT BLINDLY REDACT THE ENTIRE DOM
 * ---------------------------------------
 * A DOM contains many things that are NOT user-visible text:
 *
 *     - script contents
 *     - CSS
 *     - hidden elements
 *     - accessibility attributes
 *     - metadata
 *     - IDs
 *     - URLs
 *     - class names
 *     - framework internals
 *
 * If your goal is visual/privacy redaction, you should ideally extract:
 *
 *     visible text
 *
 * and separately inspect:
 *
 *     input values
 *     placeholders
 *     aria-label
 *     alt
 *     title
 *     relevant attributes
 *
 * rather than doing one giant regex pass over outerHTML.
 *
 *
 * 4. REDACT BEFORE LOGGING
 * ------------------------
 * NEVER:
 *
 *     console.log(originalDOMText)
 *
 * before the PII detector runs.
 *
 * Otherwise the protection layer itself can leak the sensitive information
 * it is supposed to protect.
 *
 *
 * 5. KEEP ORIGINAL AND REDACTED OFFSETS CORRECT
 * ---------------------------------------------
 * If you replace text from left to right, indexes shift.
 *
 * Example:
 *
 *     "hello secret@example.com world"
 *
 * Once "secret@example.com" becomes "<EMAIL_ID>", every character after it
 * moves.
 *
 * Therefore this implementation replaces matches from RIGHT → LEFT.
 *
 *
 * 6. OVERLAPPING MATCHES
 * ----------------------
 * Multiple detectors may recognize the same portion of text.
 *
 * Example:
 *
 *     "Username: john123"
 *
 * could potentially be matched as:
 *
 *     USERNAME
 *     generic identifier
 *     etc.
 *
 * We therefore resolve overlaps deterministically.
 *
 *
 * 7. SECURITY VS USABILITY
 * ------------------------
 * Over-redaction is safer for privacy but can destroy useful information.
 *
 * Under-redaction preserves usability but can leak sensitive information.
 *
 * For a privacy/security system, it is generally better to:
 *
 *     - have high confidence rules first
 *     - use context to increase confidence
 *     - use conservative defaults
 *     - keep an audit trail WITHOUT storing the sensitive value
 *
 *
 * 8. FUTURE HARDENING
 * -------------------
 * A production detector should eventually support:
 *
 *     - Unicode-aware detection
 *     - international phone numbers
 *     - country-specific IDs
 *     - bank/account validation
 *     - URL/email normalization
 *     - contextual scoring
 *     - DOM-aware detection
 *     - OCR-aware normalization
 *     - visual bounding boxes
 *     - confidence scores
 *     - allowlists
 *     - denylists
 *     - entropy-based secret detection
 *     - API key / token signatures
 *     - JWT detection
 *     - cloud credential patterns
 *
 * Do NOT simply keep adding giant regexes.
 *
 * A layered detector is significantly easier to maintain.
 *
 * ============================================================================
 */


/* ============================================================================
 * PII PATTERNS
 * ============================================================================
 *
 * These correspond to the categories in the original Python implementation.
 *
 * IMPORTANT:
 * JavaScript RegExp syntax is similar to Python's regex syntax, but not
 * identical. Test every pattern against real examples before production use.
 */

const PATTERNS = {

    // ------------------------------------------------------------------------
    // BASIC PERSONAL INFORMATION
    // ------------------------------------------------------------------------

    EMAIL_ID:
        /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/gi,

    // UPI/VPA handles have no dotted TLD (user@okhdfcbank), so the EMAIL_ID
    // pattern above can never match them — they need their own type. The
    // trailing negative lookahead keeps dotted addresses for EMAIL_ID:
    // overlap resolution (same start → longer wins) would also prefer the
    // full email, but excluding them here avoids duplicate candidates.
    UPI_VPA:
        /\b[a-zA-Z0-9._-]{2,}@[a-zA-Z][a-zA-Z0-9-]*(?!\.[a-zA-Z]{2,})\b/g,

    PHONE_NUMBER:
        /(?<!\d)(?:\+91[\s.-]?)?[6-9]\d{9}(?!\d)/g,

    DATE_OF_BIRTH:
        /\b(?:DOB|D\.O\.B|Date of Birth|Birth Date)\s*[:\-]?\s*\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/gi,

    AGE:
        /\b(?:age)\s*[:\-]?\s*\d{1,3}\s*(?:years?|yrs?)?\b/gi,


    // ------------------------------------------------------------------------
    // GOVERNMENT / FINANCIAL IDENTIFIERS
    // ------------------------------------------------------------------------

    AADHAAR:
        /(?<!\d)(?:\d{4}[\s-]?){2}\d{4}(?!\d)/g,

    PAN_NUMBER:
        /\b[A-Z]{5}[0-9]{4}[A-Z]\b/gi,

    PASSPORT_NUMBER:
        /\b[A-Z][0-9]{7}\b/gi,

    VOTER_ID:
        /\b[A-Z]{3}[0-9]{7}\b/gi,

    DRIVING_LICENSE:
        /\b[A-Z]{2}[-\s]?[0-9]{2}[-\s]?[0-9]{4}[-\s]?[0-9]{7}\b/gi,

    CARD_NUMBER:
        /(?<!\d)(?:\d[ -]?){13,19}(?!\d)/g,

    BANK_ACCOUNT:
        /(?<=\b(?:account|a\/c|acct)\s*(?:number|no\.?)?\s*[:\-]?\s*)\d{9,18}\b/gi,

    IBAN:
        /\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/gi,

    IFSC_CODE:
        /\b[A-Z]{4}0[A-Z0-9]{6}\b/gi,

    SWIFT_BIC:
        /\b[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}(?:[A-Z0-9]{3})?\b/g, // intentionally case-sensitive: BICs are uppercase by spec (was /gi before 79247a3 — author to confirm)

    GSTIN:
        /\b\d{2}[A-Z]{5}\d{4}[A-Z]\d[Zz][A-Z0-9]\b/gi,

    TAX_ID:
        /(?<=\b(?:tax\s*(?:id|number)|TIN)\s*[:\-]?\s*)[A-Z0-9-]{6,20}\b/gi,


    // ------------------------------------------------------------------------
    // DEVICE / NETWORK IDENTIFIERS
    // ------------------------------------------------------------------------

    IP_ADDRESS:
        /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g,

    MAC_ADDRESS:
        /\b(?:[0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}\b/g,

    DEVICE_ID:
        /(?<=\b(?:device\s*id|device\s*identifier)\s*[:\-]?\s*)[A-Za-z0-9._:-]{6,50}\b/gi,


    // ------------------------------------------------------------------------
    // AUTHENTICATION / SECRETS
    //
    // Convention for every label-prefixed type below: the label lives in a
    // variable-length lookbehind, so the match span is the VALUE ONLY — the
    // label stays visible after redaction. (V8/Node support unbounded
    // lookbehind; this module is Chrome-or-Node only.)
    // ------------------------------------------------------------------------

    USERNAME:
        /(?<=\b(?:username|user\s*name|login\s*id)\s*[:\-]?\s*)[A-Za-z0-9._-]{3,40}\b/gi,

    PASSWORD:
        /(?<=\b(?:password|passwd|pwd)\s*[:=]\s*)\S+/gi,

    PIN:
        /(?<=\b(?:PIN|pin\s*number)\s*[:\-]?\s*)\d{4,6}\b/g,

    OTP:
        /(?<=\b(?:OTP|one[-\s]?time\s+password)\s*[:\-]?\s*)\d{4,8}\b/gi,

    API_KEY:
        /\b(?:api[_\s-]?key|apikey)\s*[:=]\s*[A-Za-z0-9_-]{12,}\b/gi,


    // ------------------------------------------------------------------------
    // ORGANIZATION-SPECIFIC IDENTIFIERS
    // ------------------------------------------------------------------------

    EMPLOYEE_ID:
        /(?<=\b(?:employee\s*(?:id|number|no\.?))\s*[:\-]?\s*)[A-Za-z0-9-]{4,30}\b/gi,

    CUSTOMER_ID:
        /(?<=\b(?:customer\s*(?:id|number|no\.?))\s*[:\-]?\s*)[A-Za-z0-9-]{4,30}\b/gi,

    STUDENT_ID:
        /\b(?:student\s*(?:id|number|no\.?))\s*[:\-]?\s*[A-Za-z0-9-]{4,30}\b/gi,

    PATIENT_ID:
        /\b(?:patient\s*(?:id|number|no\.?))\s*[:\-]?\s*[A-Za-z0-9-]{4,30}\b/gi,

    POLICY_NUMBER:
        /\b(?:policy\s*(?:number|no\.?|id))\s*[:\-]?\s*[A-Za-z0-9-]{5,30}\b/gi
};


/**
 * Replacement strings.
 *
 * Keeping replacements deterministic is useful because the caller can later
 * inspect which category caused a piece of text to be redacted.
 */
const REPLACEMENTS = {};

for (const type of Object.keys(PATTERNS)) {
    REPLACEMENTS[type] = `<${type}>`;
}
// Replacement tokens for Ettin NER entity types.
// Replacement tokens for all Ettin NER entity types.
const NER_REPLACEMENTS = {
    ACCOUNT_NUMBER: "<ACCOUNT_NUMBER>",
    AGE: "<AGE>",
    API_KEY: "<API_KEY>",
    BANK_ROUTING_NUMBER: "<BANK_ROUTING_NUMBER>",
    BIOMETRIC_IDENTIFIER: "<BIOMETRIC_IDENTIFIER>",
    BLOOD_TYPE: "<BLOOD_TYPE>",
    CERTIFICATE_LICENSE_NUMBER: "<CERTIFICATE_LICENSE_NUMBER>",
    CITY: "<CITY>",
    COMPANY_NAME: "<COMPANY_NAME>",
    COORDINATE: "<COORDINATE>",
    COUNTRY: "<COUNTRY>",
    COUNTY: "<COUNTY>",
    CREDIT_DEBIT_CARD: "<CREDIT_DEBIT_CARD>",
    CUSTOMER_ID: "<CUSTOMER_ID>",
    CVV: "<CVV>",
    DATE: "<DATE>",
    DATE_OF_BIRTH: "<DATE_OF_BIRTH>",
    DATE_TIME: "<DATE_TIME>",
    DEVICE_IDENTIFIER: "<DEVICE_IDENTIFIER>",
    EDUCATION_LEVEL: "<EDUCATION_LEVEL>",
    EMAIL: "<EMAIL>",
    EMPLOYEE_ID: "<EMPLOYEE_ID>",
    EMPLOYMENT_STATUS: "<EMPLOYMENT_STATUS>",
    FAX_NUMBER: "<FAX_NUMBER>",
    FIRST_NAME: "<FIRST_NAME>",
    GENDER: "<GENDER>",
    HEALTH_PLAN_BENEFICIARY_NUMBER: "<HEALTH_PLAN_BENEFICIARY_NUMBER>",
    HTTP_COOKIE: "<HTTP_COOKIE>",
    IPV4: "<IPV4>",
    IPV6: "<IPV6>",
    LANGUAGE: "<LANGUAGE>",
    LAST_NAME: "<LAST_NAME>",
    LICENSE_PLATE: "<LICENSE_PLATE>",
    MAC_ADDRESS: "<MAC_ADDRESS>",
    MEDICAL_RECORD_NUMBER: "<MEDICAL_RECORD_NUMBER>",
    NATIONAL_ID: "<NATIONAL_ID>",
    OCCUPATION: "<OCCUPATION>",
    PASSWORD: "<PASSWORD>",
    PHONE_NUMBER: "<PHONE_NUMBER>",
    PIN: "<PIN>",
    POLITICAL_VIEW: "<POLITICAL_VIEW>",
    POSTCODE: "<POSTCODE>",
    RACE_ETHNICITY: "<RACE_ETHNICITY>",
    RELIGIOUS_BELIEF: "<RELIGIOUS_BELIEF>",
    SEXUALITY: "<SEXUALITY>",
    SSN: "<SSN>",
    STATE: "<STATE>",
    STREET_ADDRESS: "<STREET_ADDRESS>",
    SWIFT_BIC: "<SWIFT_BIC>",
    TAX_ID: "<TAX_ID>",
    TIME: "<TIME>",
    UNIQUE_ID: "<UNIQUE_ID>",
    URL: "<URL>",
    USER_NAME: "<USER_NAME>",
    VEHICLE_IDENTIFIER: "<VEHICLE_IDENTIFIER>"
};

/* ============================================================================
 * VERHOEFF CHECKSUM (Aadhaar)
 * ============================================================================
 *
 * Aadhaar numbers carry a Verhoeff check digit and are never issued with a
 * leading 0/1. A bare 12-digit run matches the AADHAAR shape but is usually
 * an order number or identifier — validate before accepting.
 */
const VERHOEFF_D = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
    [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
    [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
    [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
    [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
    [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
    [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
    [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
    [9, 8, 7, 6, 5, 4, 3, 2, 1, 0]
];
const VERHOEFF_P = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
    [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
    [8, 9, 1, 6, 0, 4, 3, 7, 2, 5],
    [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
    [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
    [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
    [7, 0, 4, 6, 9, 1, 3, 2, 5, 8]
];
const VERHOEFF_INV = [0, 4, 3, 2, 1, 5, 6, 7, 8, 9];

function verhoeffCheck(number) {
    const digits = String(number ?? "").replace(/\D/g, "");
    if (digits.length !== 12) return false;
    if (digits[0] === "0" || digits[0] === "1") return false;
    let checksum = 0;
    for (let i = 0; i < digits.length; i++) {
        const digit = Number(digits[digits.length - 1 - i]);
        checksum = VERHOEFF_D[checksum][VERHOEFF_P[i % 8][digit]];
    }
    return checksum === 0;
}

/* ============================================================================
 * VALIDATORS
 * ============================================================================ */


/**
 * Validate a credit/debit-card-like number using the Luhn algorithm.
 *
 * The original Python detector did this specifically for CARD_NUMBER matches.
 *
 * This is NOT proof that something is a real card.
 * It only means the number satisfies the checksum.
 */
function luhn(number) {

    const digits = String(number).replace(/\D/g, "");

    if (digits.length < 13 || digits.length > 19) {
        return false;
    }

    let total = 0;

    // Process from right to left.
    for (let i = 0; i < digits.length; i++) {

        let n = Number(digits[digits.length - 1 - i]);

        if (i % 2 === 1) {
            n *= 2;

            if (n > 9) {
                n -= 9;
            }
        }

        total += n;
    }

    return total % 10 === 0;
}


/**
 * Validate IBAN checksum.
 *
 * IBAN validation:
 *
 *     1. Remove whitespace
 *     2. Move first four characters to the end
 *     3. Convert letters to numbers
 *     4. Calculate modulo 97
 *
 * The modulo operation is done incrementally rather than converting a huge
 * string into a JavaScript Number.
 *
 * This avoids precision problems.
 */
function ibanValid(iban) {

    const normalized = String(iban)
        .replace(/\s+/g, "")
        .toUpperCase();

    if (!/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(normalized)) {
        return false;
    }

    const rearranged =
        normalized.slice(4) +
        normalized.slice(0, 4);

    let remainder = 0;

    for (const char of rearranged) {

        if (/[A-Z]/.test(char)) {

            // A = 10 ... Z = 35
            const value = char.charCodeAt(0) - 55;

            const digits = String(value);

            for (const digit of digits) {
                remainder =
                    (remainder * 10 + Number(digit)) % 97;
            }

        } else {

            remainder =
                (remainder * 10 + Number(char)) % 97;
        }
    }

    return remainder === 1;
}


/**
 * Basic IPv4 validation.
 *
 * The regex already constrains the usual 0-255 range, but having this as a
 * separate function makes the validation layer extensible.
 */
function isValidIPv4(value) {

    const parts = String(value).split(".");

    if (parts.length !== 4) {
        return false;
    }

    return parts.every(part => {

        if (!/^\d+$/.test(part)) {
            return false;
        }

        if (part.length > 1 && part.startsWith("0")) {
            // Optional policy:
            // reject weird representations such as 001.
            return false;
        }

        const number = Number(part);

        return number >= 0 && number <= 255;
    });
}


/* ============================================================================
 * CONTEXT HELPERS
 * ============================================================================ */


/**
 * Get a small amount of surrounding text.
 *
 * Context is extremely useful for reducing false positives.
 *
 * Example:
 *
 *     "Order number: 123456789"
 *
 * versus
 *
 *     "Random value: 123456789"
 *
 * A production version can score the surrounding words.
 */
function getContext(text, start, end, radius = 80) {

    return {
        before: text.slice(
            Math.max(0, start - radius),
            start
        ),

        after: text.slice(
            end,
            Math.min(text.length, end + radius)
        )
    };
}


/**
 * Calculate a rough confidence score.
 *
 * This should eventually become a proper rule-based scoring system.
 */
function calculateConfidence(type, value, context) {

    let score = 0.5;

    // Strong pattern matches.
    const highConfidenceTypes = new Set([
        "EMAIL_ID",
        "UPI_VPA",
        "PAN_NUMBER",
        "AADHAAR",
        "IFSC_CODE",
        "GSTIN",
        "MAC_ADDRESS",
        "API_KEY",
        "PASSWORD",
        "OTP"
    ]);

    if (highConfidenceTypes.has(type)) {
        score += 0.25;
    }

    // Explicit context words increase confidence.
    const combined =
        `${context.before} ${context.after}`.toLowerCase();

    const contextWords = [
        "email",
        "phone",
        "mobile",
        "address",
        "account",
        "password",
        "otp",
        "pin",
        "passport",
        "pan",
        "aadhaar",
        "bank",
        "card",
        "username",
        "login",
        "student",
        "employee",
        "patient",
        "dob",
        "birth",
        "ifsc",
        "upi",
        "vpa",
        "signup",
        "signin",
        "gst",
        "tax"
    ];

    if (contextWords.some(word => combined.includes(word))) {
        score += 0.2;
    }

    // Clamp score.
    return Math.min(1, score);
}


/* ============================================================================
 * MATCH PROCESSING
 * ============================================================================ */


/**
 * Test whether an individual match is valid.
 */
function validateMatch(type, value) {

    switch (type) {

        case "CARD_NUMBER":
            return luhn(value);

        case "AADHAAR":
            return verhoeffCheck(value);

        case "IBAN":
            return ibanValid(value);

        case "IP_ADDRESS":
            return isValidIPv4(value);

        default:
            return true;
    }
}


/**
 * Detect all supported PII in a text string.
 *
 * NOTE (DOM snapshot pipeline contract): `src/pipeline/dom-capture.js` calls
 * NOTE: this once per SEGMENT (segment.text), never on a joined page blob.
 * NOTE: Per-detection `confidence` is passed through untouched into findings
 * NOTE: as `{ type, source: "dom", confidence, structuralHint?, segmentId,
 * NOTE: forceRedacted }`; structural context is a sibling field, never a
 * NOTE: replacement for this score. Findings must never carry raw `value`,
 * NOTE: offsets, or domPath (redact before logging).
 *
 * Returns:
 *
 * {
 *   text,
 *   detections
 * }
 *
 * Each detection contains:
 *
 *     type
 *     value
 *     start
 *     end
 *     confidence
 *     context
 *
 * IMPORTANT:
 * In a truly sensitive application you may NOT want to return "value" at
 * all. Consider returning only a fingerprint/hash or redacted value.
 */
function detectPII(text) {

    text = String(text ?? "");

    const detections = [];


    // ------------------------------------------------------------------------
    // Run every detector.
    // ------------------------------------------------------------------------

    for (const [piiType, regex] of Object.entries(PATTERNS)) {

        // Reset state because global regexes maintain lastIndex.
        regex.lastIndex = 0;

        let match;

        while ((match = regex.exec(text)) !== null) {

            const value = match[0];

            const start = match.index;
            const end = start + value.length;


            // ----------------------------------------------------------------
            // Validation layer.
            // ----------------------------------------------------------------

            if (!validateMatch(piiType, value)) {
                continue;
            }


            // ----------------------------------------------------------------
            // Context.
            // ----------------------------------------------------------------

            const context =
                getContext(text, start, end);


            // ----------------------------------------------------------------
            // Confidence.
            // ----------------------------------------------------------------

            const confidence =
                calculateConfidence(
                    piiType,
                    value,
                    context
                );


            detections.push({
                type: piiType,
                value,
                start,
                end,
                confidence
            });
        }
    }


    // ------------------------------------------------------------------------
    // Sort detections.
    //
    // First:
    //     earliest position
    //
    // Then:
    //     longer match first
    //
    // This mirrors the important behavior of the Python implementation.
    // ------------------------------------------------------------------------

    detections.sort((a, b) => {

        if (a.start !== b.start) {
            return a.start - b.start;
        }

        return (
            (b.end - b.start) -
            (a.end - a.start)
        );
    });


    // ------------------------------------------------------------------------
    // Resolve overlaps.
    // ------------------------------------------------------------------------

    const selected = [];

    for (const detection of detections) {

        const overlaps =
            selected.some(existing =>
                detection.start < existing.end &&
                detection.end > existing.start
            );

        if (!overlaps) {
            selected.push(detection);
        }
    }


    // Sort final results by text position.
    selected.sort(
        (a, b) => a.start - b.start
    );


    return {
        text,
        detections: selected
    };
}


/* ============================================================================
 * REDACTION
 * ============================================================================
 */


/**
 * Redact detected PII from text.
 *
 * This performs replacement RIGHT → LEFT.
 *
 * Why?
 *
 * Replacing a match changes the string length.
 * If you replace earlier matches first, later indexes become invalid.
 */
function redactPII(text, detections) {

    let result = String(text ?? "");
    // Raw-text logging lives behind PII_DEBUG (default off) — this function
    // runs against real page content, so unconditional logging is a leak.
    debugLog(
        "[REDACT] Before:",
        JSON.stringify(result)
    );


    // Work backwards.
    const sorted =
        [...detections]
            .sort((a, b) => b.start - a.start);


    for (const detection of sorted) {

        const replacement =
            REPLACEMENTS[detection.type] ??
            NER_REPLACEMENTS[detection.type] ??
            "<PII>";

        result =
            result.slice(0, detection.start) +
            replacement +
            result.slice(detection.end);
    }
    debugLog(
        "[REDACT] After:",
        JSON.stringify(result)
    );


    return result;
}


/* ============================================================================
 * ONE-SHOT PROCESSOR
 * ============================================================================
 */


/**
 * Detect and redact in one call.
 *
 * This is probably the main function your pipeline should call.
 */
function processPII(text) {

    const detectionResult =
        detectPII(text);

    const redactedText =
        redactPII(
            detectionResult.text,
            detectionResult.detections
        );

    return {

        // Safe output.
        text: redactedText,

        // Metadata.
        detections:
            detectionResult.detections.map(detection => ({
                type: detection.type,
                start: detection.start,
                end: detection.end,
                confidence: detection.confidence,
                source: "regex"
            }))
    };
}
/**
 * Tier 1 — Ettin NER adapter.
 *
 * Receives ONLY the Tier-0-redacted residual text.
 * Returns findings in the same shape expected by redactPII().
 *
 * Ettin model wiring will be connected here.
 */
async function detectPIIWithNER(text) {
    const residualText = String(text ?? "");

    if (!residualText.trim()) {
        return [];
    }

    const ner = await loadNER();

    console.log("[NER] Running Ettin on Tier-0 residual text");

    // IMPORTANT:
    // Ettin receives ONLY the Tier-0 residual text.
    const encoded = await ner.tokenizer(
        residualText,
        {
            return_offsets_mapping: true,
            truncation: true,
            max_length: ner.maxTokens
        }
    );

    console.log("[NER] Tokenization complete");

    // Run Ettin
    const output = await ner.model(encoded);

    const logits = output.logits;

    if (!logits) {
        throw new Error("Ettin NER did not return logits.");
    }

    const data = logits.data;
    const dims = logits.dims;

    if (!data || !dims || dims.length < 3) {
        throw new Error("Unexpected Ettin logits shape.");
    }

    const sequenceLength = dims[dims.length - 2];
    const numberOfLabels = dims[dims.length - 1];

    // Convert offsets into a normal JavaScript array.
    let offsets = encoded.offset_mapping;

    if (offsets?.tolist) {
        offsets = offsets.tolist();
    }

    if (Array.isArray(offsets?.[0])) {
        offsets = offsets[0];
    }

    // If Transformers.js did not provide offset_mapping,
    // try token_to_chars() from the encoded tokenizer output.
    if (!Array.isArray(offsets)) {
        console.log("[NER] offset_mapping unavailable; building manual offsets");

        const tokens =
            ner.tokenizer.tokenize(residualText);

        offsets = [[0, 0]];

        let cursor = 0;

        for (const token of tokens) {

            if (
                !token ||
                token.startsWith("[") ||
                token === "<s>" ||
                token === "</s>"
            ) {
                offsets.push([0, 0]);
                continue;
            }

            let cleanToken = token
                .replace(/^##/, "")
                .replace(/^▁/, "")
                .replace(/^Ġ/, "");

            if (!cleanToken) {
                offsets.push([0, 0]);
                continue;
            }

            let start = residualText.indexOf(
                cleanToken,
                cursor
            );

            if (start === -1) {
                start = residualText
                    .toLowerCase()
                    .indexOf(
                        cleanToken.toLowerCase(),
                        cursor
                    );
            }

            if (start === -1) {
                offsets.push([0, 0]);
                continue;
            }

            const end = start + cleanToken.length;

            offsets.push([start, end]);

            cursor = end;
        }

        offsets.push([0, 0]);
    }

    function softmax(values) {
        const max = Math.max(...values);

        const exps = values.map(value =>
            Math.exp(value - max)
        );

        const sum = exps.reduce(
            (total, value) => total + value,
            0
        );

        return exps.map(value => value / sum);
    }

    function normalizeLabel(label) {
        const value = String(label ?? "O");

        if (value === "O") {
            return {
                prefix: "O",
                entity: null
            };
        }

        const parts = value.split("-", 2);

        if (parts.length === 2) {
            return {
                prefix: parts[0].toUpperCase(),
                entity: parts[1].toLowerCase()
            };
        }

        // Some model configurations may omit BIO prefixes.
        return {
            prefix: "B",
            entity: value.toLowerCase()
        };
    }

    const predictions = [];

    for (let tokenIndex = 0; tokenIndex < sequenceLength; tokenIndex++) {

        const tokenStart =
            offsets[tokenIndex]?.[0] ?? 0;

        const tokenEnd =
            offsets[tokenIndex]?.[1] ?? 0;

        // Skip special tokens.
        if (tokenEnd <= tokenStart) {
            continue;
        }

        const tokenLogits = [];

        for (
            let labelIndex = 0;
            labelIndex < numberOfLabels;
            labelIndex++
        ) {
            const index =
                tokenIndex * numberOfLabels + labelIndex;

            tokenLogits.push(data[index]);
        }

        const probabilities = softmax(tokenLogits);

        let bestLabelIndex = 0;

        for (
            let labelIndex = 1;
            labelIndex < probabilities.length;
            labelIndex++
        ) {
            if (
                probabilities[labelIndex] >
                probabilities[bestLabelIndex]
            ) {
                bestLabelIndex = labelIndex;
            }
        }

        const confidence =
            probabilities[bestLabelIndex];

        const label =
            ner.id2label[bestLabelIndex] ??
            ner.id2label[String(bestLabelIndex)] ??
            "O";

        const parsed = normalizeLabel(label);

        if (
            parsed.prefix === "O" ||
            !parsed.entity ||
            confidence < NER_MIN_SCORE
        ) {
            continue;
        }

        predictions.push({
            prefix: parsed.prefix,
            entity: parsed.entity,
            confidence,
            start: tokenStart,
            end: tokenEnd
        });
    }
    // Debug: inspect raw Ettin token predictions before merging.
    // Gated (default off): the slices below include discarded/unmerged
    // candidate spans, not just final detections — never log unconditionally.
    debugLog("[NER] Raw predictions:");
    debugLog(
        predictions.map(prediction => ({
            entity: prediction.entity,
            prefix: prediction.prefix,
            start: prediction.start,
            end: prediction.end,
            text: residualText.slice(
                prediction.start,
                prediction.end
            ),
            confidence: prediction.confidence
        }))
    );

    // Merge BIO token predictions into entity spans.
    const detections = [];

    let current = null;

    for (const prediction of predictions) {

        const predictionType =
            prediction.entity.toUpperCase();

        const sameEntity =
            current &&
            current.entity === prediction.entity;

        const adjacent =
            current &&
            prediction.start <= current.end + 1;

        if (!current || !sameEntity || !adjacent) {

            if (current) {
                detections.push(current);
            }

            current = {
                entity: prediction.entity,
                type: predictionType,
                value: residualText.slice(
                    prediction.start,
                    prediction.end
                ),
                start: prediction.start,
                end: prediction.end,
                confidence: prediction.confidence,
                source: "ner"
            };

            continue;
        }

        // Merge adjacent pieces of the same PII entity.
        current.end = Math.max(
            current.end,
            prediction.end
        );

        current.value =
            residualText.slice(
                current.start,
                current.end
            );

        current.confidence =
            Math.min(
                current.confidence,
                prediction.confidence
            );
    }

    if (current) {
        detections.push(current);
    }

    console.log(
        `[NER] Ettin detected ${detections.length} candidate(s)`
    );

    return stripPlaceholderDetections(detections, residualText);
}

/**
 * Drop detections that fall inside `<PLACEHOLDER>` spans.
 *
 * Placeholders are already-redacted output (ours or Tier0's). Without this,
 * NER re-fires on bracket fragments ("FIRST", "CITY", "NAME"), the
 * self-audit re-redacts placeholders-inside-placeholders, and the loop can
 * never converge — clean input ends BLOCKED. Pure function (unit-tested).
 */
function stripPlaceholderDetections(detections, text) {
    const source = String(text ?? "");
    const holes = [];
    const re = /<[A-Z0-9_]+>/g;
    let m;
    while ((m = re.exec(source)) !== null) {
        holes.push([m.index, m.index + m[0].length]);
    }
    if (!holes.length) return detections;
    return (detections || []).filter(
        (d) =>
            !holes.some(
                (h) => d.start < h[1] && d.end > h[0]
            )
    );
}
/**
 * Tier 0 + Tier 1 PII processing.
 *
 * Flow:
 *   1. Run Tier 0 regex/checksum detection.
 *   2. Redact Tier 0 findings.
 *   3. Send ONLY the residual text to Ettin NER.
 *   4. Redact Ettin findings from the residual text.
 *
 * NOTE:
 * Ettin integration will be added in the next step.
 */
async function processPIIWithNER(text) {
    // Tier 0
    const tier0Result = processPII(text);

    // Only Tier-0-redacted text goes to Ettin.
    let finalText = tier0Result.text;

    // Tier 1
    const nerDetections = await detectPIIWithNER(finalText);

    // Redact Tier-1 detections.
    finalText = redactPII(
        finalText,
        nerDetections
    );

    /*
     * Self-audit / remediation
     *
     * If the audit discovers additional PII,
     * redact it and audit again.
     *
     * We use a small fixed number of passes so
     * the pipeline cannot enter an infinite loop.
     */
    const MAX_AUDIT_PASSES = 2;

    const auditDetections = [];

    for (
        let auditPass = 1;
        auditPass <= MAX_AUDIT_PASSES;
        auditPass++
    ) {
        console.log(
            `[SELF-AUDIT] Pass ${auditPass}`
        );

        const auditTier0 = detectPII(finalText);

        let auditTier1 = [];

        if (auditTier0.text.trim()) {
            auditTier1 =
                await detectPIIWithNER(finalText);
        }

        const newlyDetected = [
            ...auditTier0.detections,
            ...auditTier1
        ];

        if (newlyDetected.length === 0) {
            console.log(
                "[SELF-AUDIT] Clean after remediation."
            );

            return {
                text: finalText,
                blocked: false,
                detections: [
                    ...tier0Result.detections,
                    ...nerDetections,
                    ...auditDetections
                ]
            };
        }

        console.log(
            `[SELF-AUDIT] Found ${newlyDetected.length} additional candidate(s). Redacting.`
        );

        auditDetections.push(
            ...newlyDetected
        );

        finalText = redactPII(
            finalText,
            newlyDetected
        );
    }

    /*
     * If we reach here, the text could not become
     * clean within the allowed audit passes.
     *
     * CONTRACT (fail-closed): `text: null` on block is a BLOCK signal, not
     * an empty string. Any caller (present or future — e.g. whoever wires
     * the chat loop) MUST treat null as "do not use / do not forward" and
     * must never substitute "" and continue as if clean.
     */
    console.error(
        "[SELF-AUDIT] Could not reach a clean state. Blocking output."
    );

    return {
        text: null,
        blocked: true,
        reason: "SELF_AUDIT_FAILED",
        detections: [
            ...tier0Result.detections,
            ...nerDetections,
            ...auditDetections
        ]
    };
}

/* ============================================================================
 * DOM-SPECIFIC HELPERS
 * ============================================================================
 *
 * IMPORTANT:
 *
 * Do NOT simply do:
 *
 *     document.body.innerHTML
 *
 * and throw it into the regex engine.
 *
 * That can cause:
 *
 *     - huge input sizes
 *     - false positives from JS/CSS
 *     - accidental modification of markup
 *     - broken DOM structure
 *
 * Instead, extract text nodes.
 */


/**
 * Determines whether an element should be ignored.
 */
function shouldIgnoreElement(element) {

    if (!element) {
        return true;
    }

    const tag = element.tagName?.toLowerCase();

    const ignoredTags = new Set([
        "script",
        "style",
        "noscript",
        "template",
        "svg",
        "canvas"
    ]);

    if (ignoredTags.has(tag)) {
        return true;
    }

    // Hidden elements.
    if (
        element.hidden ||
        element.getAttribute?.("aria-hidden") === "true"
    ) {
        return true;
    }

    return false;
}


/**
 * Extract visible-ish text from the DOM.
 *
 * NOTE (DOM snapshot pipeline contract): the v7-extension pipeline no longer
 * NOTE: calls this stub for page capture. The real implementation lives in
 * NOTE: `extension/v7 beta/src/pipeline/dom-capture.js`, which walks the DOM
 * NOTE: (main document + same-origin iframes + open shadow roots) and produces
 * NOTE: ordered SEGMENTS of the form:
 * NOTE:   { id, kind: "text"|"attribute"|"form_value", tag, attr?, text,
 * NOTE:     blockRole, forceRedact, structuralHint?, domPath }.
 * NOTE: Each non-forced segment's `text` is passed to `detectPII` individually
 * NOTE: (never one joined blob), and each resulting finding is tagged
 * NOTE: `source: "dom"` with her `confidence` untouched plus a sibling
 * NOTE: `structuralHint` ({ labelText, autocompleteType, fieldName,
 * NOTE: tableHeader }) from `dom-heuristics.js`. Password/hidden fields are
 * NOTE: pre-classified as forceRedact and skip `detectPII` entirely.
 * NOTE: This function is still exported as-is for any other caller/test that
 * NOTE: depends on it — do not remove it.
 *
 * This is intentionally conservative.
 *
 * A production-grade system should additionally consider:
 *
 *     - CSS visibility
 *     - opacity
 *     - clipping
 *     - viewport intersection
 *     - collapsed elements
 *     - shadow DOM
 *     - iframes
 */
function extractDOMText(root = document.body) {

    const walker =
        document.createTreeWalker(
            root,
            NodeFilter.SHOW_TEXT
        );

    const pieces = [];

    let node;

    while ((node = walker.nextNode())) {

        const parent =
            node.parentElement;

        if (shouldIgnoreElement(parent)) {
            continue;
        }

        const value =
            node.nodeValue ?? "";

        if (!value.trim()) {
            continue;
        }

        pieces.push(value);
    }

    return pieces.join("\n");
}


/**
 * Extract potentially sensitive values from form controls.
 *
 * NOTE (DOM snapshot pipeline contract): superseded for the actual extension
 * NOTE: pipeline by `extension/v7 beta/src/pipeline/dom-capture.js`, which
 * NOTE: collects form values during the same TreeWalker pass as text/attribute
 * NOTE: segments (so rejected hidden subtrees contribute nothing) and flags
 * NOTE: `input[type=password]` / `input[type=hidden]` as always-redact
 * NOTE: (forceRedact, bypassing pattern matching per the password-field
 * NOTE: masking rule). Still exported as-is for other callers/tests.
 *
 * DOM text does NOT contain the value of:
 *
 *     <input value="...">
 *
 * unless it is represented elsewhere.
 *
 * Therefore inputs must be handled separately.
 */
function extractFormValues(root = document) {

    const fields = [];

    const elements =
        root.querySelectorAll?.(
            "input, textarea, select"
        ) ?? [];

    for (const element of elements) {

        if (shouldIgnoreElement(element)) {
            continue;
        }

        const value =
            element.value ?? "";

        if (!value) {
            continue;
        }

        fields.push({
            element,
            value
        });
    }

    return fields;
}


/* ============================================================================
 * DOM REDACTION STRATEGY
 * ============================================================================
 *
 * There are TWO fundamentally different goals:
 *
 * ---------------------------------------------------------------------------
 * A) REDACT THE EXTRACTED DATA
 * ---------------------------------------------------------------------------
 *
 * DOM remains unchanged.
 *
 * Example:
 *
 *     Website
 *       ↓
 *     text extraction
 *       ↓
 *     PII detector
 *       ↓
 *     redacted text sent to AI
 *
 *
 * This is usually the safest design.
 *
 *
 * ---------------------------------------------------------------------------
 * B) MODIFY THE ACTUAL PAGE
 * ---------------------------------------------------------------------------
 *
 * Example:
 *
 *     Email:
 *     john@example.com
 *
 * becomes:
 *
 *     Email:
 *     <EMAIL_ID>
 *
 * This should be done carefully because modifying arbitrary DOM text can
 * interfere with:
 *
 *     - React
 *     - Vue
 *     - Angular
 *     - event handlers
 *     - form controls
 *     - content editing
 *     - application state
 *
 * For privacy middleware, option A is usually preferable.
 */


/* ============================================================================
 * EXPORTS
 * ============================================================================
 *
 * Node.js / CommonJS compatible.
 */

module.exports = {

    PATTERNS,
    REPLACEMENTS,

    luhn,
    ibanValid,
    isValidIPv4,

    detectPII,
    redactPII,
    processPII,
    processPIIWithNER,
    stripPlaceholderDetections,

    extractDOMText,
    extractFormValues
};


/* ============================================================================
 * OPTIONAL CLI TEST
 * ============================================================================
 *
 * Run:
 *
 *     node pii-detector.js
 *
 * Then provide a test string.
 *
 * Example:
 *
 *     Email: someone@example.com
 *     Phone: 9876543210
 *     PAN: ABCDE1234F
 *
 * ============================================================================
 */

if (require.main === module) {

    const readline =
        require("readline");

    const rl =
        readline.createInterface({
            input: process.stdin,
            output: process.stdout,
            terminal: false
        });

    const lines = [];

    console.log("\nPaste text to scan.");
    console.log("Type END on a new line when finished.\n");

    rl.on("line", line => {

        if (line.trim() === "END") {
            rl.close();
            return;
        }

        lines.push(line);
    });

    rl.on("close", async () => {

        const input =
            lines.join("\n");

        const result =
            await processPIIWithNER(input);

        console.log("\nREDACTED:\n");
        console.log(result.text);

        console.log("\nDETECTIONS:\n");
        console.log(
            JSON.stringify(
                result.detections,
                null,
                2
            )
        );
    });
}