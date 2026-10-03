import { Box, HStack, IconButton, Input, Stack, Text } from "@chakra-ui/react"
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { api } from "../services/api"
import {
    NUMBER_OPERATORS,
    SPAN_COLORS,
    SYNTAX_COLOR,
    analyzeQuery,
    getField,
    lastMeaningfulToken,
    matchFields,
    type ParsedQuery,
    type SearchFieldSpec,
} from "../lib/searchQuery"
import { SearchSyntaxHelp, fieldStarter } from "./SearchSyntaxHelp"

interface SearchInputProps {
    value: string
    onChange: (value: string) => void
    libraryId?: string
}

/** One row of the suggestion list. */
interface Suggestion {
    id: string
    group: string
    primary: string
    secondary?: string
    /** Shown as a tooltip only, never inline. */
    example?: string
    color?: string
    mono?: boolean
    run: () => void
}

type ApplyEdit = (start: number, end: number, text: string) => void

/**
 * The real input paints only the caret — the coloured query lives in a mirror
 * layer behind it — so the two must share the same text metrics. The box is
 * 40px tall with 14px/20px text and a 1px border.
 */
const TEXT_METRICS = {
    fontSize: "sm",
    lineHeight: "20px",
    paddingLeft: "10",
    paddingRight: "14",
} as const

function SearchIcon() {
    return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.3-4.3" />
        </svg>
    )
}

function XIcon() {
    return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 6L6 18M6 6l12 12" />
        </svg>
    )
}

function HelpIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 2.5-3 3.8" />
            <path d="M12 17.5h.01" />
        </svg>
    )
}

/** Rows that insert a whole filter, used both for the menu and for completions. */
function fieldSuggestions(fields: SearchFieldSpec[], insert: (text: string) => void): Suggestion[] {
    return fields.map((field) => ({
        id: "field:" + field.key,
        group: "Filters",
        primary: field.kind === "number" ? `${field.key}>=` : `${field.key}:`,
        secondary: field.description,
        example: field.example,
        mono: true,
        run: () => insert(fieldStarter(field)),
    }))
}

/** Rows for a `tags:` / `withoutTags:` value, including `[type]` autocomplete. */
async function tagSuggestions(
    segment: string,
    used: string[],
    libraryId: string | undefined,
    applyText: (text: string) => void,
): Promise<Suggestion[]> {
    const lower = segment.toLowerCase()
    const partialCategory = /^\[([^\]]*)$/.exec(segment)
    const completeCategory = /^\[([^\]]+)\](.*)$/.exec(segment)

    if (partialCategory) {
        const res = await api.getTags(libraryId ?? "", 1, 50)
        const partial = partialCategory[1].toLowerCase()
        return res.groups
            .filter((group) => group.type !== null && group.type.toLowerCase().indexOf(partial) !== -1)
            .slice(0, 10)
            .map((group) => ({
                id: "cat:" + group.type,
                group: "Tag types",
                primary: `[${group.type}]`,
                mono: true,
                run: () => applyText(`[${group.type}]`),
            }))
    }

    if (completeCategory) {
        const res = await api.getTags(libraryId ?? "", 1, 50)
        const type = completeCategory[1]
        const partial = completeCategory[2].toLowerCase()
        const group = res.groups.find((g) => g.type === type)
        if (!group) return []
        return group.tags
            .filter((tag) => tag.value.toLowerCase().indexOf(partial) !== -1)
            .slice(0, 10)
            .map((tag) => ({
                id: "tag:" + tag.value,
                group: `Values in [${type}]`,
                primary: tag.value,
                secondary: `${tag.count} asset${tag.count === 1 ? "" : "s"}`,
                run: () => applyText(tag.value),
            }))
    }

    const res = await api.getTags(libraryId ?? "", 1, 50, lower || undefined)
    const usedLower = new Set(used.map((v) => v.toLowerCase()))
    const matching: { value: string; type: string | null; count: number }[] = []

    for (const group of res.groups) {
        for (const tag of group.tags) {
            if (usedLower.has(tag.value.toLowerCase())) continue
            if (!lower || tag.value.toLowerCase().indexOf(lower) !== -1) {
                matching.push({ value: tag.value, type: group.type, count: tag.count })
            }
        }
    }

    if (lower) {
        matching.sort((a, b) => {
            const la = a.value.toLowerCase()
            const lb = b.value.toLowerCase()
            if (la === lower) return -1
            if (lb === lower) return 1
            if (la.startsWith(lower) && !lb.startsWith(lower)) return -1
            if (!la.startsWith(lower) && lb.startsWith(lower)) return 1
            return 0
        })
    }

    return matching.slice(0, 12).map((tag) => ({
        id: "tag:" + tag.value,
        group: "Tags",
        primary: tag.value,
        secondary: tag.type ? `[${tag.type}]` : undefined,
        run: () => applyText(tag.value),
    }))
}

/**
 * Works out which rows the suggestion list should show for the token the caret
 * sits in. Only the last token is considered, and only when the caret is at the
 * end of the query — mid-string editing stays out of the way.
 */
async function buildSuggestions(
    parsed: ParsedQuery,
    caret: number,
    libraryId: string | undefined,
    apply: ApplyEdit,
): Promise<Suggestion[]> {
    const raw = parsed.raw
    if (caret !== raw.length) return []

    const last = lastMeaningfulToken(parsed)

    // Empty box: the whole reference, which doubles as a syntax cheat sheet.
    if (!last) return fieldSuggestions(matchFields(""), (text) => apply(raw.length, raw.length, text))

    if (last.kind === "phrase") return []

    // A filter that cannot be used as written: offer the fix.
    if (last.error) {
        const fix = last.fix
        return [
            {
                id: "problem",
                group: "Fix",
                primary: fix ? fix.label : "Remove",
                secondary: last.error,
                mono: true,
                color: SPAN_COLORS.invalid,
                run: () => (fix ? apply(last.start, last.end, fix.replacement) : apply(last.start, last.end, "")),
            },
        ]
    }

    // `width<1920` — the intent is clear, only the operator is not supported.
    // (`>=` / `<=` are real operators, so a `=` right after the sign is excluded.)
    const looseOperator = /^([A-Za-z]+)([<>])([^=].*)$/.exec(last.raw)
    if (looseOperator) {
        const field = getField(looseOperator[1])
        if (field && field.kind === "number") {
            const fixed = looseOperator[2] === "<" ? "<=" : ">="
            return [
                {
                    id: "loose-op",
                    group: "Fix",
                    primary: fixed,
                    secondary: `Use ${fixed} instead of ${looseOperator[2]}`,
                    example: `${field.key}${fixed}${looseOperator[3]}`,
                    mono: true,
                    run: () => apply(last.start, last.end, `${field.key}${fixed}${looseOperator[3]}`),
                },
            ]
        }
    }

    const field = last.field

    // A field name on its own: complete it with a separator.
    if (field && !last.operator) {
        if (field.kind === "number") {
            return NUMBER_OPERATORS.map(({ op, label }) => ({
                id: "sep:" + op,
                group: "Operator",
                primary: op,
                secondary: label,
                example: `${field.key}${op}${field.presets ? field.presets[0] : ""}`,
                mono: true,
                run: () => apply(last.start, last.end, `${field.key}${op}`),
            }))
        }
        return [
            {
                id: "sep",
                group: "Filters",
                primary: `${field.key}:`,
                example: field.example,
                mono: true,
                run: () => apply(last.start, last.end, `${field.key}:`),
            },
        ]
    }

    if (field && field.kind === "tags") {
        const valueStart = last.valueStart === undefined ? last.start : last.valueStart
        const valueText = raw.slice(valueStart, last.end)
        const plus = valueText.lastIndexOf("+")
        const segmentStart = valueStart + plus + 1
        const segment = raw.slice(segmentStart, last.end)
        const sign = segment.startsWith("-") ? "-" : ""
        const previous = last.parts ? last.parts.slice(0, -1) : []
        const used = previous.map((part) => (part.startsWith("-") ? part.slice(1) : part))
        return tagSuggestions(segment.slice(sign.length), used, libraryId, (text) =>
            apply(segmentStart + sign.length, last.end, text),
        )
    }

    if (field && field.kind === "enum") {
        const valueStart = last.valueStart === undefined ? last.start : last.valueStart
        const valueText = raw.slice(valueStart, last.end)
        const comma = valueText.lastIndexOf(",")
        const segmentStart = valueStart + comma + 1
        const partial = raw.slice(segmentStart, last.end).replace(/^\./, "").toLowerCase()
        const used = partial.length > 0 ? [] : last.parts ?? []
        const options = (field.values ?? [])
            .filter((value) => (!partial || value.startsWith(partial)) && used.indexOf(value) === -1)
            .slice(0, 12)
        return options.map((value) => ({
            id: "enum:" + value,
            group: "File types",
            primary: value,
            secondary: value === "image" ? "Any image extension" : undefined,
            mono: true,
            run: () => apply(segmentStart, last.end, value),
        }))
    }

    if (field && field.kind === "number") {
        const sepStart = last.sepStart === undefined ? last.start : last.sepStart
        const sepEnd = last.sepEnd === undefined ? last.end : last.sepEnd
        const valueStart = last.valueStart === undefined ? last.start : last.valueStart
        const items: Suggestion[] = NUMBER_OPERATORS.map(({ op, label }) => ({
            id: "op:" + op,
            group: "Operator",
            primary: op,
            secondary: label,
            mono: true,
            run: () => apply(sepStart, sepEnd, op),
        }))

        for (const preset of field.presets ?? []) {
            items.push({
                id: "preset:" + preset,
                group: "Values",
                primary: preset,
                mono: true,
                run: () => apply(valueStart, last.end, preset),
            })
        }
        return items
    }

    // Plain text: offer the fields that start with what has been typed.
    if (last.raw.length >= 2) {
        const fields = matchFields(last.raw)
        if (fields.length > 0) {
            return fieldSuggestions(fields, (text) => apply(last.start, last.end, text))
        }
    }

    return []
}

export function SearchInput({ value, onChange, libraryId }: SearchInputProps) {
    const [localValue, setLocalValue] = useState(value)
    const [focused, setFocused] = useState(false)
    const [hovered, setHovered] = useState(false)
    const [helpOpen, setHelpOpen] = useState(false)
    const [caret, setCaret] = useState(value.length)
    const [suggestions, setSuggestions] = useState<Suggestion[]>([])
    const [highlightedIndex, setHighlightedIndex] = useState(-1)

    const inputRef = useRef<HTMLInputElement>(null)
    const mirrorRef = useRef<HTMLDivElement>(null)
    const rootRef = useRef<HTMLDivElement>(null)
    const debounceRef = useRef<ReturnType<typeof setTimeout>>()
    const blurRef = useRef<ReturnType<typeof setTimeout>>()

    const parsed = useMemo(() => analyzeQuery(localValue), [localValue])

    useEffect(() => {
        setLocalValue(value)
        setCaret(value.length)
    }, [value])

    useEffect(() => {
        return () => {
            if (debounceRef.current) clearTimeout(debounceRef.current)
            if (blurRef.current) clearTimeout(blurRef.current)
        }
    }, [])

    const syncScroll = useCallback(() => {
        const el = inputRef.current
        const mirror = mirrorRef.current
        if (el && mirror) mirror.scrollLeft = el.scrollLeft
    }, [])

    // `/` focuses the search box from anywhere, like GitHub.
    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key !== "/" || event.ctrlKey || event.metaKey || event.altKey) return
            const active = document.activeElement as HTMLElement | null
            const tag = active ? active.tagName : ""
            if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (active && active.isContentEditable)) {
                return
            }
            const el = inputRef.current
            // Two instances exist (desktop + mobile); only react to the visible one.
            if (!el || el.offsetParent === null) return
            event.preventDefault()
            el.focus()
        }
        document.addEventListener("keydown", onKeyDown)
        return () => document.removeEventListener("keydown", onKeyDown)
    }, [])

    // The syntax panel closes on an outside click or Escape. A hand-rolled panel
    // (rather than a Chakra Popover) keeps focus handling out of the way, so the
    // caret goes straight back into the box after a filter is inserted.
    useEffect(() => {
        if (!helpOpen) return
        const onPointerDown = (event: MouseEvent) => {
            const root = rootRef.current
            if (root && !root.contains(event.target as Node)) setHelpOpen(false)
        }
        document.addEventListener("mousedown", onPointerDown)
        return () => document.removeEventListener("mousedown", onPointerDown)
    }, [helpOpen])

    const commit = useCallback(
        (next: string) => {
            if (debounceRef.current) {
                clearTimeout(debounceRef.current)
                debounceRef.current = undefined
            }
            onChange(next)
        },
        [onChange],
    )

    const applyEdit = useCallback<ApplyEdit>(
        (start, end, text) => {
            const next = localValue.slice(0, start) + text + localValue.slice(end)
            setLocalValue(next)
            commit(next)
            setSuggestions([])
            setHighlightedIndex(-1)
            const position = start + text.length
            setCaret(position)
            requestAnimationFrame(() => {
                const el = inputRef.current
                if (!el) return
                el.focus()
                el.setSelectionRange(position, position)
                syncScroll()
            })
        },
        [localValue, commit, syncScroll],
    )

    useEffect(() => {
        let cancelled = false
        if (!focused) {
            setSuggestions([])
            return
        }
        buildSuggestions(parsed, caret, libraryId, applyEdit)
            .then((items) => {
                if (cancelled) return
                setSuggestions(items)
                setHighlightedIndex(-1)
            })
            .catch(() => {
                if (!cancelled) setSuggestions([])
            })
        return () => {
            cancelled = true
        }
    }, [focused, parsed, caret, libraryId, applyEdit])

    const syncCaret = () => {
        const el = inputRef.current
        if (el) setCaret(el.selectionStart === null ? el.value.length : el.selectionStart)
        syncScroll()
    }

    const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const next = event.target.value
        setLocalValue(next)
        setCaret(event.target.selectionStart === null ? next.length : event.target.selectionStart)
        if (debounceRef.current) clearTimeout(debounceRef.current)
        debounceRef.current = setTimeout(() => onChange(next), 300)
    }

    const handleClear = () => {
        setLocalValue("")
        commit("")
        setSuggestions([])
        setCaret(0)
        inputRef.current?.focus()
    }

    const handleFocus = () => {
        if (blurRef.current) clearTimeout(blurRef.current)
        setFocused(true)
        syncCaret()
    }

    const handleBlur = () => {
        blurRef.current = setTimeout(() => setFocused(false), 150)
    }

    const runSuggestion = (suggestion: Suggestion) => {
        suggestion.run()
        setSuggestions([])
        setHighlightedIndex(-1)
    }

    const handleKeyDown = (event: React.KeyboardEvent) => {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            if (suggestions.length === 0) return
            event.preventDefault()
            setHighlightedIndex((previous) => {
                if (event.key === "ArrowDown") return previous < suggestions.length - 1 ? previous + 1 : 0
                return previous > 0 ? previous - 1 : suggestions.length - 1
            })
            return
        }

        if (event.key === "Enter") {
            if (suggestions.length > 0 && highlightedIndex >= 0) {
                event.preventDefault()
                runSuggestion(suggestions[highlightedIndex])
                return
            }
            // Nothing picked: search right away instead of waiting out the debounce.
            commit(localValue)
            setSuggestions([])
            return
        }

        if (event.key === "Tab") {
            if (suggestions.length === 0) return
            event.preventDefault()
            runSuggestion(suggestions[highlightedIndex >= 0 ? highlightedIndex : 0])
            return
        }

        if (event.key === "Escape") {
            if (helpOpen) {
                event.preventDefault()
                setHelpOpen(false)
                return
            }
            if (suggestions.length > 0) {
                event.preventDefault()
                setSuggestions([])
                return
            }
            if (localValue.length > 0) {
                event.preventDefault()
                handleClear()
                return
            }
            inputRef.current?.blur()
        }
    }

    const showClearButton = localValue.length > 0
    const showAux = focused || hovered || helpOpen
    const showDropdown = focused && !helpOpen && suggestions.length > 0
    const hasProblems = parsed.problems.length > 0

    let lastGroup = ""

    return (
        <Stack
            ref={rootRef}
            gap="0"
            width="full"
            maxW={{ base: "full", md: "400px" }}
            position="relative"
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
        >
            <Stack position="absolute" left="3" top="10px" zIndex="2" color="fg.subtle" pointerEvents="none">
                <SearchIcon />
            </Stack>

            {/* The coloured query is painted here; the real input keeps only the
                caret, so both layers share TEXT_METRICS and the same 1px border. */}
            <Box
                ref={mirrorRef}
                aria-hidden="true"
                position="absolute"
                inset="0"
                zIndex="0"
                bg="bg"
                border="1px solid"
                borderColor={hasProblems ? "red.500" : "border"}
                borderRadius="md"
                overflow="hidden"
                pointerEvents="none"
                display="flex"
                alignItems="center"
                whiteSpace="pre"
                color="fg"
                {...TEXT_METRICS}
            >
                <Box as="span" flexShrink="0">
                    {parsed.spans.map((span, index) => (
                        <Box
                            as="span"
                            key={index}
                            color={span.color}
                            textDecoration={span.underline ? "underline" : undefined}
                            textDecorationStyle={span.underline ? "wavy" : undefined}
                            textDecorationColor={span.underline ? "red.500" : undefined}
                        >
                            {span.text}
                        </Box>
                    ))}
                </Box>
            </Box>

            <Input
                ref={inputRef}
                className="search-mirrored-input"
                value={localValue}
                placeholder="Search — try tags: or size>=1MB"
                aria-label="Search assets"
                aria-invalid={hasProblems || undefined}
                title="Search by file name or filters — press / to focus"
                // The text is invisible (painted by the mirror layer), but the
                // spell checker would still draw its squiggles over it.
                spellCheck={false}
                autoCorrect="off"
                autoCapitalize="none"
                onChange={handleChange}
                onFocus={handleFocus}
                onBlur={handleBlur}
                onKeyDown={handleKeyDown}
                onSelect={syncCaret}
                onClick={syncCaret}
                onScroll={syncScroll}
                position="relative"
                zIndex="1"
                bg="transparent"
                borderColor="transparent"
                _placeholder={{ color: "fg.subtle" }}
                {...TEXT_METRICS}
            />

            {/* Right-hand controls; always mounted so nothing shifts around. */}
            <HStack position="absolute" right="2" top="50%" transform="translateY(-50%)" zIndex="2" gap="0.5">
                <IconButton
                    size="2xs"
                    variant="ghost"
                    colorPalette="gray"
                    aria-label="Search syntax"
                    aria-expanded={helpOpen}
                    title="Search syntax"
                    opacity={showAux ? 0.8 : 0}
                    pointerEvents={showAux ? "auto" : "none"}
                    onClick={() => setHelpOpen((open) => !open)}
                >
                    <HelpIcon />
                </IconButton>

                {showClearButton && (
                    <IconButton
                        size="2xs"
                        variant="ghost"
                        colorPalette="gray"
                        aria-label="Clear search"
                        title="Clear search"
                        opacity={0.8}
                        onClick={handleClear}
                    >
                        <XIcon />
                    </IconButton>
                )}
            </HStack>

            {helpOpen && (
                <Box
                    position="absolute"
                    top="100%"
                    right="0"
                    mt="1"
                    zIndex="dropdown"
                    width="360px"
                    maxW="calc(100vw - 24px)"
                    maxH="70vh"
                    overflowY="auto"
                    bg="bg"
                    border="1px solid"
                    borderColor="border"
                    borderRadius="md"
                    shadow="lg"
                >
                    <SearchSyntaxHelp
                        onPick={(field) => {
                            setHelpOpen(false)
                            const el = inputRef.current
                            const start = el && el.selectionStart !== null ? el.selectionStart : localValue.length
                            applyEdit(start, start, fieldStarter(field))
                        }}
                    />
                </Box>
            )}

            {showDropdown && (
                <Box
                    position="absolute"
                    zIndex="dropdown"
                    bg="bg"
                    border="1px solid"
                    borderColor="border"
                    borderRadius="md"
                    shadow="lg"
                    mt="1"
                    maxH="320px"
                    overflowY="auto"
                    width="full"
                    top="100%"
                >
                    {suggestions.map((suggestion, index) => {
                        const header = suggestion.group !== lastGroup ? suggestion.group : null
                        lastGroup = suggestion.group
                        return (
                            <Fragment key={suggestion.id}>
                                {header && (
                                    <Text
                                        px="3"
                                        pt="1.5"
                                        pb="0.5"
                                        fontSize="2xs"
                                        textTransform="uppercase"
                                        letterSpacing="wider"
                                        color="fg.subtle"
                                    >
                                        {header}
                                    </Text>
                                )}
                                <Box
                                    px="3"
                                    py="1"
                                    cursor="pointer"
                                    display="flex"
                                    alignItems="baseline"
                                    gap="2"
                                    title={suggestion.example}
                                    bg={index === highlightedIndex ? { base: "blue.50", _dark: "blue.950" } : undefined}
                                    _hover={{ bg: { base: "blue.50", _dark: "blue.950" } }}
                                    onMouseDown={(event) => event.preventDefault()}
                                    onMouseEnter={() => setHighlightedIndex(index)}
                                    onClick={() => runSuggestion(suggestion)}
                                >
                                    <Box
                                        as="span"
                                        fontFamily={suggestion.mono ? "mono" : undefined}
                                        fontSize="sm"
                                        color={suggestion.color ?? SYNTAX_COLOR}
                                        flexShrink="0"
                                    >
                                        {suggestion.primary}
                                    </Box>
                                    {suggestion.secondary && (
                                        <Box as="span" fontSize="xs" color="fg.subtle" flex="1" textAlign="right" truncate>
                                            {suggestion.secondary}
                                        </Box>
                                    )}
                                </Box>
                            </Fragment>
                        )
                    })}

                    <HStack
                        position="sticky"
                        bottom="0"
                        bg="bg"
                        borderTop="1px solid"
                        borderColor="border"
                        px="3"
                        py="1"
                        gap="2"
                        fontSize="2xs"
                        color="fg.subtle"
                    >
                        <Box as="span">↑↓ navigate</Box>
                        <Box as="span">Tab complete</Box>
                        <Box as="span">Enter search</Box>
                        <Box as="span">Esc close</Box>
                    </HStack>
                </Box>
            )}
        </Stack>
    )
}
