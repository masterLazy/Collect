/**
 * Search box grammar.
 *
 * A query is a list of whitespace separated tokens. A token becomes a filter
 * when it names a known field and is followed by a separator and a value:
 *
 *   tags:cat+dog          assets carrying both tags
 *   tags:cat+-dog         …but not "dog"
 *   tags:[artist]foo      scoped to one tag type
 *   withoutTags:sketch    assets that must not carry the tag
 *   type:png,webp         file type (aliases: ext, format)
 *   size>=1MB             units: B, KB, MB, GB
 *   width>=1920           pixels
 *   height<=1080
 *   ratio~1.5             width ÷ height
 *   boost>=3
 *   "two words"           a verbatim file-name phrase
 *   anything else         plain file-name text
 *
 * Numeric fields accept >=, <= and ~ (about, ±10%).
 *
 * The backend mirrors this in Collect.Core/Services/AssetSearchQuery.cs — keep
 * both sides in sync when a field is added or renamed.
 */

export type SearchFieldKind = "tags" | "number" | "enum"

export interface SearchFieldSpec {
    /** Canonical name used in queries. */
    key: string
    aliases: string[]
    kind: SearchFieldKind
    label: string
    description: string
    /** Numeric fields: accepted operators, most common first. */
    operators?: string[]
    /** Numeric fields: unit family offered by the suggestion list. */
    unit?: "bytes" | "pixels"
    /** Numeric fields: handy values offered by the suggestion list. */
    presets?: string[]
    /** Enum fields: accepted values. */
    values?: string[]
    /** A complete example, used by the cheat sheet. */
    example: string
}

export const SEARCH_FIELDS: SearchFieldSpec[] = [
    {
        key: "tags",
        aliases: ["tag"],
        kind: "tags",
        label: "Tags",
        description: "Assets carrying all of these tags",
        example: "tags:cat+dog",
    },
    {
        key: "withoutTags",
        aliases: ["withouttag", "notags", "notag"],
        kind: "tags",
        label: "Without tags",
        description: "Assets that do not carry these tags",
        example: "withoutTags:sketch",
    },
    {
        key: "type",
        aliases: ["ext", "format"],
        kind: "enum",
        label: "File type",
        description: "Match the file extension",
        values: ["png", "jpg", "jpeg", "gif", "webp", "bmp", "tiff", "tif", "image"],
        example: "type:png,webp",
    },
    {
        key: "size",
        aliases: ["filesize"],
        kind: "number",
        label: "File size",
        description: "B, KB, MB or GB — 1 MB = 1024 KB",
        unit: "bytes",
        operators: [">=", "<=", "~"],
        presets: ["100KB", "500KB", "1MB", "5MB", "10MB"],
        example: "size>=1MB",
    },
    {
        key: "width",
        aliases: [],
        kind: "number",
        label: "Width",
        description: "Pixel width",
        unit: "pixels",
        operators: [">=", "<=", "~"],
        presets: ["1280", "1920", "2560", "3840"],
        example: "width>=1920",
    },
    {
        key: "height",
        aliases: [],
        kind: "number",
        label: "Height",
        description: "Pixel height",
        unit: "pixels",
        operators: [">=", "<=", "~"],
        presets: ["720", "1080", "1440", "2160"],
        example: "height>=1080",
    },
    {
        key: "ratio",
        aliases: ["aspect"],
        kind: "number",
        label: "Aspect ratio",
        description: "Width ÷ height — above 1 is landscape",
        operators: [">=", "<=", "~"],
        presets: ["1", "1.33", "1.5", "1.78"],
        example: "ratio>=1.5",
    },
    {
        key: "boost",
        aliases: ["boosts"],
        kind: "number",
        label: "Boosts",
        description: "Boost count received",
        operators: [">=", "<=", "~"],
        presets: ["1", "3", "5", "10"],
        example: "boost>=3",
    },
]

const FIELD_BY_NAME = new Map<string, SearchFieldSpec>()
for (const field of SEARCH_FIELDS) {
    FIELD_BY_NAME.set(field.key.toLowerCase(), field)
    for (const alias of field.aliases) FIELD_BY_NAME.set(alias.toLowerCase(), field)
}

/** Numeric operators, in the order the suggestion list shows them. */
export const NUMBER_OPERATORS: { op: string; label: string }[] = [
    { op: ">=", label: "at least" },
    { op: "<=", label: "at most" },
    { op: "~", label: "about (±10%)" },
]

const TAGS_SEPARATOR = ":"
const NUMBER_SEPARATORS = [">=", "<=", "~"]

/**
 * Every piece of filter syntax is painted in one colour — Chakra's blue. The
 * highlight layer must not change font weight either, because that would make
 * it wider than the real input text underneath and the two would drift apart.
 */
export const SYNTAX_COLOR = "blue.600"

/** Colours used by the highlight layer. Only problems get a second colour. */
export const SPAN_COLORS = {
    plain: "fg",
    invalid: "red.600",
}

// ──────────────────────────────────────────────
//  Analysis
// ──────────────────────────────────────────────

export type SpanKind =
    | "plain"
    | "space"
    | "field"
    | "separator"
    | "operator"
    | "tagValue"
    | "numberValue"
    | "enumValue"
    | "phrase"
    | "invalid"

export interface QuerySpan {
    text: string
    kind: SpanKind
    color?: string
    /** Wavy underline for a token that cannot be used. Does not change metrics. */
    underline?: boolean
}

export interface QueryFix {
    /** Short label for the fix button, e.g. `size`. */
    label: string
    /** Replacement text for the whole token. */
    replacement: string
}

export interface QueryToken {
    kind: "space" | "word" | "phrase"
    /** Exact source text, so the highlight layer can rebuild the query. */
    raw: string
    start: number
    end: number
    /** Set when this token is a filter (or tried to be one). */
    field?: SearchFieldSpec
    /** Field name exactly as typed, before alias resolution. */
    fieldName?: string
    operator?: string
    value?: string
    /** Tag values or file types already split on their separator. */
    parts?: string[]
    /** Absolute offsets, used to rewrite a single piece of the token. */
    fieldStart?: number
    fieldEnd?: number
    sepStart?: number
    sepEnd?: number
    valueStart?: number
    valueEnd?: number
    /** A recognised filter whose value is still being typed. */
    incomplete?: boolean
    /** Human readable reason this token cannot be used as written. */
    error?: string
    fix?: QueryFix
}

export interface ParsedQuery {
    raw: string
    /** Every token, including whitespace, in source order. */
    tokens: QueryToken[]
    /** Same content, ready to render, covering the whole query. */
    spans: QuerySpan[]
    /** Tokens that resolve to a usable filter. */
    filters: QueryToken[]
    /** Tokens that name a filter but cannot be used. */
    problems: QueryToken[]
    /** Values of the `tags:` filter, in order. */
    tags: string[]
    withoutTags: string[]
    hasFilters: boolean
}

const TERM_PATTERN = /^([A-Za-z]+)(:|>=|<=|~)(.*)$/
const NUMBER_PATTERN = /^(\d+(?:\.\d+)?)([A-Za-z]*)$/

function isSpace(ch: string): boolean {
    return ch === " " || ch === "\t" || ch === "\n" || ch === "\r"
}

function findField(name: string): SearchFieldSpec | undefined {
    return FIELD_BY_NAME.get(name.toLowerCase())
}

/** Field names that look like what the user meant — used for the "did you mean" hint. */
function closestField(name: string): { field: SearchFieldSpec; name: string } | undefined {
    const lower = name.toLowerCase()
    if (lower.length < 2) return undefined

    let best: { field: SearchFieldSpec; name: string; score: number } | undefined
    for (const field of SEARCH_FIELDS) {
        for (const candidate of [field.key, ...field.aliases]) {
            const target = candidate.toLowerCase()
            let score = Infinity
            if (target.startsWith(lower) || lower.startsWith(target)) score = Math.abs(target.length - lower.length)
            else if (lower.length >= 3 && distance(lower, target) <= 2) score = distance(lower, target)
            if (score < (best ? best.score : Infinity)) best = { field, name: candidate, score }
        }
    }
    return best ? { field: best.field, name: best.name } : undefined
}

function distance(a: string, b: string): number {
    const rows: number[][] = []
    for (let i = 0; i <= a.length; i++) rows.push([i])
    for (let j = 0; j <= b.length; j++) rows[0][j] = j
    for (let i = 1; i <= a.length; i++) {
        for (let j = 1; j <= b.length; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1
            rows[i][j] = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + cost)
        }
    }
    return rows[a.length][b.length]
}

function unitError(field: SearchFieldSpec, unit: string): string {
    if (field.unit === "bytes") return `Unknown unit "${unit}" — use B, KB, MB or GB`
    return `Unknown unit "${unit}" — ${field.key} is a plain pixel count`
}

/** Splits tag text into values, resolving `[type]` scopes and `-` negation. */
function splitTagParts(value: string): { text: string; negated: boolean }[] {
    const parts: { text: string; negated: boolean }[] = []
    for (const raw of value.split("+")) {
        let text = raw.trim()
        let negated = false
        if (text.startsWith("-")) {
            negated = true
            text = text.slice(1).trim()
        }
        if (text.length === 0) continue
        parts.push({ text, negated })
    }
    return parts
}

interface TokenShape {
    field?: SearchFieldSpec
    fieldName?: string
    operator?: string
    value?: string
    parts?: string[]
    incomplete?: boolean
    error?: string
    fix?: QueryFix
    invalidSpan?: boolean
}

/** Classifies one bare word. */
function classifyWord(word: string): TokenShape {
    const term = TERM_PATTERN.exec(word)

    if (!term) {
        // `size` / `tags` on their own: a field the user has not finished. The
        // suggestion list offers the separator, so no error is reported.
        const name = /^[A-Za-z]+$/.test(word) ? word : ""
        const field = name ? findField(name) : undefined
        return field ? { field, fieldName: name, incomplete: true } : {}
    }

    const [, name, sep, rawValue] = term
    const value = rawValue.trim()
    const field = findField(name)

    if (!field) {
        const close = closestField(name)
        if (!close) return {} // e.g. "http://x" — plain text, not a failed filter
        const prefix = rawValue.slice(0, rawValue.length - value.length)
        return {
            fieldName: name,
            operator: sep,
            value,
            invalidSpan: true,
            error: `Unknown filter "${name}"`,
            fix: { label: close.name, replacement: close.name + sep + prefix + value },
        }
    }

    const shape: TokenShape = { field, fieldName: name, operator: sep, value }

    if (field.kind === "tags") {
        if (sep !== TAGS_SEPARATOR) {
            shape.invalidSpan = true
            shape.error = `${field.key} needs a colon, e.g. ${field.example}`
            shape.fix = { label: `${field.key}:`, replacement: `${name}:${rawValue}` }
            return shape
        }
        const parts = splitTagParts(value)
        shape.parts = parts.map((p) => (p.negated ? "-" + p.text : p.text))
        if (parts.length === 0) shape.incomplete = true
        return shape
    }

    if (field.kind === "enum") {
        if (sep !== TAGS_SEPARATOR) {
            shape.invalidSpan = true
            shape.error = `${field.key} needs a colon, e.g. ${field.example}`
            shape.fix = { label: `${field.key}:`, replacement: `${name}:${rawValue}` }
            return shape
        }
        const parts = value
            .split(",")
            .map((p) => p.trim().replace(/^\./, "").toLowerCase())
            .filter((p) => p.length > 0)
        shape.parts = parts
        if (parts.length === 0) shape.incomplete = true
        return shape
    }

    // Numeric field
    if (field.kind === "number") {
        if (NUMBER_SEPARATORS.indexOf(sep) === -1) {
            shape.invalidSpan = true
            shape.error = `${field.key} needs >=, <= or ~, e.g. ${field.example}`
            shape.fix = { label: ">=", replacement: `${name}>=${rawValue}` }
            return shape
        }
        if (value.length === 0) {
            shape.incomplete = true
            return shape
        }
        const number = NUMBER_PATTERN.exec(value)
        if (!number) {
            shape.invalidSpan = true
            shape.error = `${field.key} expects a number, e.g. ${field.example}`
            return shape
        }
        const unit = number[2].toLowerCase()
        const allowedUnits =
            field.unit === "bytes"
                ? ["", "b", "k", "kb", "kib", "m", "mb", "mib", "g", "gb", "gib"]
                : field.unit === "pixels"
                    ? ["", "px"]
                    : [""]
        if (allowedUnits.indexOf(unit) === -1) {
            shape.invalidSpan = true
            shape.error = unitError(field, number[2])
            return shape
        }
        return shape
    }

    return shape
}

/** Parses a query into tokens, highlight spans and the filters they describe. */
export function analyzeQuery(raw: string): ParsedQuery {
    const tokens: QueryToken[] = []
    const spans: QuerySpan[] = []

    const push = (token: QueryToken) => {
        tokens.push(token)
    }

    let i = 0
    while (i < raw.length) {
        const ch = raw[i]

        if (isSpace(ch)) {
            const start = i
            while (i < raw.length && isSpace(raw[i])) i++
            push({ kind: "space", raw: raw.slice(start, i), start, end: i })
            spans.push({ text: raw.slice(start, i), kind: "space" })
            continue
        }

        if (ch === '"') {
            const start = i
            i++
            const innerStart = i
            while (i < raw.length && raw[i] !== '"') i++
            const inner = raw.slice(innerStart, i)
            if (i < raw.length) i++ // closing quote
            const token: QueryToken = { kind: "phrase", raw: raw.slice(start, i), start, end: i, value: inner }
            push(token)
            spans.push({ text: raw.slice(start, i), kind: "phrase", color: SPAN_COLORS.plain })
            continue
        }

        const start = i
        while (i < raw.length && !isSpace(raw[i]) && raw[i] !== '"') i++
        const word = raw.slice(start, i)
        const shape = classifyWord(word)

        const token: QueryToken = {
            kind: "word",
            raw: word,
            start,
            end: i,
            ...shape,
        }
        push(token)

        // `name` + separator are only known when the term pattern matched.
        const term = TERM_PATTERN.exec(word)
        if (term && shape.fieldName !== undefined) {
            const [, nameText, sepText] = term
            token.fieldStart = start
            token.fieldEnd = start + nameText.length
            token.sepStart = token.fieldEnd
            token.sepEnd = token.sepStart + sepText.length
            token.valueStart = token.sepEnd
            token.valueEnd = start + word.length
        }

        // ── highlight spans for this token ──
        if (!token.field) {
            if (token.error) {
                spans.push({ text: word, kind: "invalid", color: SPAN_COLORS.invalid, underline: true })
            } else {
                spans.push({ text: word, kind: "plain", color: SPAN_COLORS.plain })
            }
            continue
        }

        const fieldColor = SYNTAX_COLOR
        if (token.error) {
            spans.push({ text: word, kind: "invalid", color: SPAN_COLORS.invalid, underline: true })
            continue
        }

        const fieldStart = token.fieldStart
        const fieldEnd = token.fieldEnd
        const sepStart = token.sepStart
        const sepEnd = token.sepEnd
        const valueStart = token.valueStart
        const valueEnd = token.valueEnd

        if (fieldStart === undefined || fieldEnd === undefined ||
            sepStart === undefined || sepEnd === undefined ||
            valueStart === undefined || valueEnd === undefined
        ) {
            // A bare field name, e.g. `size` — highlight the name only.
            spans.push({ text: word, kind: "field", color: fieldColor })
            continue
        }

        spans.push({ text: raw.slice(fieldStart, fieldEnd), kind: "field", color: fieldColor })
        spans.push({ text: raw.slice(sepStart, sepEnd), kind: sepKindOf(token), color: fieldColor })

        const valueText = raw.slice(valueStart, valueEnd)
        if (valueText.length > 0) {
            if (token.field.kind === "tags") {
                // Colour each tag, keep the `+` separators muted.
                let offset = valueStart
                for (const piece of valueText.split("+")) {
                    if (piece.length > 0) {
                        spans.push({ text: piece, kind: "tagValue", color: fieldColor })
                    }
                    offset += piece.length
                    if (offset < valueEnd) {
                        spans.push({ text: raw[offset], kind: "separator", color: fieldColor })
                        offset += 1
                    }
                }
            } else if (token.field.kind === "enum") {
                spans.push({ text: valueText, kind: "enumValue", color: fieldColor })
            } else {
                spans.push({ text: valueText, kind: "numberValue", color: fieldColor })
            }
        }
    }

    const filters = tokens.filter((t) => t.field && !t.error && !t.incomplete)
    const problems = tokens.filter((t) => t.error)
    const tags: string[] = []
    const withoutTags: string[] = []

    for (const token of tokens) {
        if (!token.field || token.field.kind !== "tags" || !token.parts) continue
        for (const part of token.parts) {
            if (part.startsWith("-")) continue
            // `tags:[artist]foo` filters on the value `foo`, scoped to a type,
            // so the UI (Tags button, filter modal) works with the value alone.
            const value = part.replace(/^\[[^\]]*\]/, "")
            if (value.length === 0) continue
            if (token.field.key === "tags") tags.push(value)
            else withoutTags.push(value)
        }
    }

    return {
        raw,
        tokens,
        spans,
        filters,
        problems,
        tags,
        withoutTags,
        hasFilters: tokens.some((t) => t.field !== undefined),
    }
}

function sepKindOf(token: QueryToken): SpanKind {
    return token.field && token.field.kind === "number" ? "operator" : "separator"
}

// ──────────────────────────────────────────────
//  Helpers used by the page and the suggestion list
// ──────────────────────────────────────────────

/** Tag values selected through the `tags:` filter. */
export function extractQueryTags(query: string): string[] {
    return analyzeQuery(query).tags
}

/**
 * The free-text part of a query: bare words and quoted phrases only. Used where
 * a plain search string is expected, e.g. filtering the Explore tag browser.
 */
export function extractQueryText(query: string): string {
    return analyzeQuery(query)
        .tokens.filter((token) => token.kind === "phrase" || (token.kind === "word" && !token.field))
        .map((token) => (token.kind === "phrase" ? token.value ?? "" : token.raw))
        .filter((text) => text.length > 0)
        .join(" ")
}

/**
 * Rewrites the `tags:` filter, keeping every other token (filters and free
 * text) exactly where it was. Passing an empty list removes the filter.
 */
export function setQueryTags(query: string, tags: string[]): string {
    const parsed = analyzeQuery(query)
    const kept = parsed.tokens
        .filter((t) => t.kind !== "space")
        .filter((t) => !(t.field && t.field.kind === "tags" && t.field.key === "tags"))
        .map((t) => t.raw)

    const values = tags.map((t) => t.trim()).filter((t) => t.length > 0)
    if (values.length > 0) kept.push(`tags:${values.join("+")}`)

    return kept.join(" ")
}

/** Fields whose name or alias starts with the typed prefix. */
export function matchFields(prefix: string): SearchFieldSpec[] {
    const lower = prefix.toLowerCase()
    if (lower.length === 0) return SEARCH_FIELDS
    return SEARCH_FIELDS.filter((field) =>
        [field.key, ...field.aliases].some((name) => name.toLowerCase().startsWith(lower))
    )
}

/** The last non-whitespace token, which is what the suggestion list reacts to. */
export function lastMeaningfulToken(parsed: ParsedQuery): QueryToken | undefined {
    for (let i = parsed.tokens.length - 1; i >= 0; i--) {
        if (parsed.tokens[i].kind !== "space") return parsed.tokens[i]
    }
    return undefined
}

/** A field by canonical name. */
export function getField(key: string): SearchFieldSpec | undefined {
    return FIELD_BY_NAME.get(key.toLowerCase())
}

/** Formats a byte count for the suggestion hints. */
export function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`
    const units = ["KB", "MB", "GB"]
    let value = bytes / 1024
    let index = 0
    while (value >= 1024 && index < units.length - 1) {
        value /= 1024
        index++
    }
    return `${value >= 10 ? Math.round(value) : Math.round(value * 10) / 10} ${units[index]}`
}
