import { Box, Input, Stack } from "@chakra-ui/react"
import { useEffect, useRef, useState } from "react"
import { api } from "../services/api"

interface SearchInputProps {
    value: string
    onChange: (value: string) => void
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

export function SearchInput({ value, onChange }: SearchInputProps) {
    const [localValue, setLocalValue] = useState(value)
    const [suggestions, setSuggestions] = useState<{ value: string; type: string | null }[]>([])
    const [showSuggestions, setShowSuggestions] = useState(false)
    const [inputFocused, setInputFocused] = useState(false)
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

    // Fetch autocomplete suggestions when typing in tags: context
    useEffect(() => {
        let cancelled = false

        const parsed = parseTagsPrefix(localValue)
        if (!parsed) {
            setShowSuggestions(false)
            setSuggestions([])
            return
        }

        const currentPrefix = getCurrentTagPrefix(parsed.suffix)
        if (!currentPrefix) {
            setShowSuggestions(false)
            setSuggestions([])
            return
        }

        const selectedValues = getSelectedTagValues(parsed.suffix)

        api.getTags(1, 9999).then((res) => {
            if (cancelled) return

            const query = currentPrefix.toLowerCase()
            const matching: { value: string; type: string | null }[] = []

            for (const group of res.groups) {
                for (const tag of group.tags) {
                    if (selectedValues.includes(tag.value)) continue
                    if (tag.value.toLowerCase().includes(query)) {
                        matching.push({ value: tag.value, type: group.type })
                    }
                }
            }

            // Sort: exact match first, then startsWith, then includes
            matching.sort((a, b) => {
                const la = a.value.toLowerCase()
                const lb = b.value.toLowerCase()
                if (la === query) return -1
                if (lb === query) return 1
                if (la.startsWith(query) && !lb.startsWith(query)) return -1
                if (!la.startsWith(query) && lb.startsWith(query)) return 1
                return 0
            })

            setSuggestions(matching.slice(0, 10))
            setShowSuggestions(inputFocused && matching.length > 0)
        }).catch(() => { })

        return () => { cancelled = true }
    }, [localValue, inputFocused])

    const handleSuggestionClick = (suggestionValue: string) => {
        const newValue = replaceLastSegment(localValue, suggestionValue)
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

    const parsed = parseTagsPrefix(localValue)
    const showClearButton = localValue.length > 0

    return (
        <Stack gap="0" width="full" maxW="400px" position="relative">
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
                placeholder="Search files or tags:tag1+tag2"
                value={localValue}
                onChange={handleChange}
                onFocus={handleFocus}
                onBlur={handleBlur}
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
            {showSuggestions && parsed && (
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
                    {suggestions.map((s) => (
                        <Box
                            key={s.value}
                            px="3"
                            py="2"
                            cursor="pointer"
                            _hover={{ bg: "bg.subtle" }}
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
