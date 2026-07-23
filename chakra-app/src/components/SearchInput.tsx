import { Box, Input, Stack } from "@chakra-ui/react"
import { useEffect, useRef, useState } from "react"
import { api } from "../services/api"

interface SearchInputProps {
    value: string
    onChange: (value: string) => void
    libraryId?: string
}

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

function parseTagsPrefix(value: string): { prefix: string; suffix: string } | null {
    const match = value.match(/^(.*?tags:)(.*)$/)
    if (!match) return null
    return { prefix: match[1], suffix: match[2] }
}

function getCurrentTagPrefix(suffix: string): string {
    const parts = suffix.split("+")
    return parts[parts.length - 1] || ""
}

function replaceLastSegment(fullValue: string, newTag: string): string {
    const parsed = parseTagsPrefix(fullValue)
    if (!parsed) return fullValue
    const parts = parsed.suffix.split("+")
    // If suffix is empty or only has one segment
    if (parts.length <= 1) {
        return parsed.prefix + newTag
    }
    // Replace last segment
    parts[parts.length - 1] = newTag
    return parsed.prefix + parts.join("+")
}

function getSelectedTagValues(suffix: string): string[] {
    if (!suffix) return []
    return suffix.split("+").filter(Boolean)
}

export function SearchInput({ value, onChange, libraryId }: SearchInputProps) {
    const [localValue, setLocalValue] = useState(value)
    const [suggestions, setSuggestions] = useState<{ value: string; type: string | null }[]>([])
    const [showSuggestions, setShowSuggestions] = useState(false)
    const [inputFocused, setInputFocused] = useState(false)
    const [highlightedIndex, setHighlightedIndex] = useState(-1)
    const timerRef = useRef<ReturnType<typeof setTimeout>>()
    const blurTimerRef = useRef<ReturnType<typeof setTimeout>>()
    const inputRef = useRef<HTMLInputElement>(null)

    useEffect(() => {
        setLocalValue(value)
    }, [value])

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const newValue = e.target.value
        setLocalValue(newValue)

        if (timerRef.current) clearTimeout(timerRef.current)
        timerRef.current = setTimeout(() => {
            onChange(newValue)
        }, 300)
    }

    const handleClear = () => {
        setLocalValue("")
        onChange("")
        inputRef.current?.focus()
    }

    useEffect(() => {
        return () => {
            if (timerRef.current) clearTimeout(timerRef.current)
        }
    }, [])

    // Fetch autocomplete suggestions — 50 items, no scroll-to-load-more
    useEffect(() => {
        let cancelled = false

        const loadSuggestions = async () => {
            try {
                const parsed = parseTagsPrefix(localValue)
                const currentSegment = parsed ? getCurrentTagPrefix(parsed.suffix) : localValue
                const selectedValues = parsed ? getSelectedTagValues(parsed.suffix) : []

                // Check if current segment is in bracket mode: [Cat] or [Cat]val
                const partialCategory = currentSegment.match(/^\[([^\]]*)$/)
                const completeCategory = currentSegment.match(/^\[([^\]]+)\](.*)$/)

                if (partialCategory || completeCategory || localValue.startsWith('[')) {
                    // Bracket autocomplete — load without search param, filter client-side
                    const bracketText = localValue.startsWith('[') ? localValue : currentSegment
                    const bracketPartial = bracketText.match(/^\[([^\]]*)$/)
                    const bracketComplete = bracketText.match(/^\[([^\]]+)\](.*)$/)

                    if (bracketPartial) {
                        const res = await api.getTags(libraryId ?? "", 1, 50)
                        if (cancelled) return
                        const partial = bracketPartial![1].toLowerCase()
                        const cats = res.groups
                            .filter(g => g.type !== null && g.type.toLowerCase().includes(partial))
                            .map(g => `[${g.type}]`)
                        setSuggestions(cats.slice(0, 10).map(v => ({ value: v, type: null })))
                        setShowSuggestions(inputFocused && cats.length > 0)
                        setHighlightedIndex(-1)
                    } else if (bracketComplete) {
                        const res = await api.getTags(libraryId ?? "", 1, 50)
                        if (cancelled) return
                        const categoryType = bracketComplete![1]
                        const valuePartial = bracketComplete![2].toLowerCase()
                        const group = res.groups.find(g => g.type === categoryType)
                        if (group) {
                            const filtered = group.tags
                                .filter(t => t.value.toLowerCase().includes(valuePartial))
                                .map(t => ({ value: t.value, type: group.type }))
                            setSuggestions(filtered.slice(0, 10))
                            setShowSuggestions(inputFocused && filtered.length > 0)
                        } else {
                            setSuggestions([])
                            setShowSuggestions(false)
                        }
                        setHighlightedIndex(-1)
                    }
                    return
                }

                if (!parsed) {
                    setShowSuggestions(false)
                    setSuggestions([])
                    return
                }

                const query = currentSegment.toLowerCase()
                const searchTerm = query || undefined
                const res = await api.getTags(libraryId ?? "", 1, 50, searchTerm)
                if (cancelled) return

                const usedSet = new Set(selectedValues.map(v => v.toLowerCase()))
                const matching: { value: string; type: string | null }[] = []

                for (const group of res.groups) {
                    for (const tag of group.tags) {
                        if (usedSet.has(tag.value.toLowerCase())) continue
                        if (!query || tag.value.toLowerCase().includes(query)) {
                            matching.push({ value: tag.value, type: group.type })
                        }
                    }
                }

                if (query) {
                    matching.sort((a, b) => {
                        const la = a.value.toLowerCase()
                        const lb = b.value.toLowerCase()
                        if (la === query) return -1
                        if (lb === query) return 1
                        if (la.startsWith(query) && !lb.startsWith(query)) return -1
                        if (!la.startsWith(query) && lb.startsWith(query)) return 1
                        return 0
                    })
                }

                setSuggestions(matching)
                setShowSuggestions(inputFocused && matching.length > 0)
                setHighlightedIndex(-1)
            } catch {
                // ignore
            }
        }

        if (inputFocused) {
            loadSuggestions()
        } else {
            setShowSuggestions(false)
        }

        return () => { cancelled = true }
    }, [localValue, inputFocused])

    const handleSuggestionClick = (suggestionValue: string) => {
        const parsed = parseTagsPrefix(localValue)
        let newValue: string

        if (parsed) {
            // tags: mode — replace last segment
            newValue = replaceLastSegment(localValue, suggestionValue)
        } else if (localValue.startsWith('[')) {
            // Bare bracket mode — build bracket expression
            const bracketPartial = localValue.match(/^\[([^\]]*)$/)
            if (bracketPartial && suggestionValue.startsWith('[') && suggestionValue.endsWith(']')) {
                // Category suggestion — set input so user can continue typing
                newValue = suggestionValue
            } else if (localValue.includes(']')) {
                // Already have complete category — append value after ]
                newValue = localValue + suggestionValue
            } else {
                newValue = suggestionValue
            }
        } else {
            newValue = suggestionValue
        }

        setLocalValue(newValue)
        onChange(newValue)
        setShowSuggestions(false)
        inputRef.current?.focus()
    }

    const handleFocus = () => {
        if (blurTimerRef.current) clearTimeout(blurTimerRef.current)
        setInputFocused(true)
    }

    const handleBlur = () => {
        blurTimerRef.current = setTimeout(() => setInputFocused(false), 150)
    }

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (!showSuggestions || suggestions.length === 0) {
            if (e.key === "Enter") {
                // Let normal Enter behavior pass through when no suggestions
            }
            return
        }

        if (e.key === "ArrowDown") {
            e.preventDefault()
            setHighlightedIndex((prev) =>
                prev < suggestions.length - 1 ? prev + 1 : 0
            )
        } else if (e.key === "ArrowUp") {
            e.preventDefault()
            setHighlightedIndex((prev) =>
                prev > 0 ? prev - 1 : suggestions.length - 1
            )
        } else if (e.key === "Enter") {
            e.preventDefault()
            if (highlightedIndex >= 0 && highlightedIndex < suggestions.length) {
                handleSuggestionClick(suggestions[highlightedIndex].value)
            }
        } else if (e.key === "Escape") {
            setShowSuggestions(false)
        }
    }

    const parsed = parseTagsPrefix(localValue)
    const showClearButton = localValue.length > 0

    return (
        <Stack gap="0" width="full" maxW={{ base: "full", md: "400px" }} position="relative">
            <Stack
                position="absolute"
                left="3"
                top="50%"
                transform="translateY(-50%)"
                zIndex="1"
                color="fg.subtle"
                pointerEvents="none"
            >
                <SearchIcon />
            </Stack>
            <Input
                ref={inputRef}
                placeholder="Search filename or tag"
                value={localValue}
                onChange={handleChange}
                onFocus={handleFocus}
                onBlur={handleBlur}
                onKeyDown={handleKeyDown}
                bg="bg"
                border="1px solid"
                borderColor="border"
                _placeholder={{ color: "fg.subtle" }}
                paddingLeft="10"
                paddingRight="10"
            />
            {showClearButton && (
                <Box
                    position="absolute"
                    right="3"
                    top="50%"
                    transform="translateY(-50%)"
                    zIndex="1"
                    color="fg.subtle"
                    cursor="pointer"
                    onClick={handleClear}
                    aria-label="Clear search"
                    _hover={{ color: "fg" }}
                >
                    <XIcon />
                </Box>
            )}
            {showSuggestions && (
                <Box
                    position="absolute"
                    zIndex="dropdown"
                    bg="bg"
                    border="1px solid"
                    borderColor="border"
                    borderRadius="md"
                    shadow="md"
                    mt="1"
                    maxH="200px"
                    overflowY="auto"
                    width="full"
                    top="100%"
                >
                    {suggestions.map((s, i) => (
                        <Box
                            key={s.value}
                            px="3"
                            py="2"
                            cursor="pointer"
                            bg={i === highlightedIndex ? { base: "blue.100", _dark: "blue.800" } : undefined}
                            _hover={{ bg: { base: "blue.100", _dark: "blue.800" } }}
                            onClick={() => handleSuggestionClick(s.value)}
                            fontSize="sm"
                        >
                            {s.value}
                        </Box>
                    ))}
                </Box>
            )}
        </Stack>
    )
}
