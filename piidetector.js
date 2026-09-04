"use strict";

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
        /\b(?:account|a\/c|acct)\s*(?:number|no\.?)?\s*[:\-]?\s*\d{9,18}\b/gi,

    IBAN:
        /\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/gi,

    IFSC_CODE:
        /\b[A-Z]{4}0[A-Z0-9]{6}\b/gi,

    SWIFT_BIC:
        /\b[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}(?:[A-Z0-9]{3})?\b/gi,

    GSTIN:
        /\b\d{2}[A-Z]{5}\d{4}[A-Z]\d[Zz][A-Z0-9]\b/gi,

    TAX_ID:
        /\b(?:tax\s*(?:id|number)|TIN)\s*[:\-]?\s*[A-Z0-9-]{6,20}\b/gi,


    // ------------------------------------------------------------------------
    // DEVICE / NETWORK IDENTIFIERS
    // ------------------------------------------------------------------------

    IP_ADDRESS:
        /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g,

    MAC_ADDRESS:
        /\b(?:[0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}\b/g,

    DEVICE_ID:
        /\b(?:device\s*id|device\s*identifier)\s*[:\-]?\s*[A-Za-z0-9._:-]{6,50}\b/gi,


    // ------------------------------------------------------------------------
    // AUTHENTICATION / SECRETS
    // ------------------------------------------------------------------------

    USERNAME:
        /\b(?:username|user\s*name|login\s*id)\s*[:\-]?\s*[A-Za-z0-9._-]{3,40}\b/gi,

    PASSWORD:
        /\b(?:password|passwd|pwd)\s*[:=]\s*\S+/gi,

    PIN:
        /\b(?:PIN|pin\s*number)\s*[:\-]?\s*\d{4,6}\b/g,

    OTP:
        /\b(?:OTP|one[-\s]?time\s+password)\s*[:\-]?\s*\d{4,8}\b/gi,

    API_KEY:
        /\b(?:api[_\s-]?key|apikey)\s*[:=]\s*[A-Za-z0-9_-]{12,}\b/gi,


    // ------------------------------------------------------------------------
    // ORGANIZATION-SPECIFIC IDENTIFIERS
    // ------------------------------------------------------------------------

    EMPLOYEE_ID:
        /\b(?:employee\s*(?:id|number|no\.?))\s*[:\-]?\s*[A-Za-z0-9-]{4,30}\b/gi,

    CUSTOMER_ID:
        /\b(?:customer\s*(?:id|number|no\.?))\s*[:\-]?\s*[A-Za-z0-9-]{4,30}\b/gi,

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
        "patient"
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


    // Work backwards.
    const sorted =
        [...detections]
            .sort((a, b) => b.start - a.start);


    for (const detection of sorted) {

        const replacement =
            REPLACEMENTS[detection.type] ??
            "<PII>";

        result =
            result.slice(0, detection.start) +
            replacement +
            result.slice(detection.end);
    }


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
                confidence: detection.confidence
            }))
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
            output: process.stdout
        });

    rl.question(
        "\nPaste text to scan:\n",
        input => {

            const result =
                processPII(input);

            console.log(
                "\nREDACTED:\n"
            );

            console.log(result.text);

            console.log(
                "\nDETECTIONS:\n"
            );

            console.log(
                JSON.stringify(
                    result.detections,
                    null,
                    2
                )
            );

            rl.close();
        }
    );
}