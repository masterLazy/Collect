import { useState, useEffect, useRef } from "react"
import { Box, Button, Field, HStack, Input, Stack, Tag, Text } from "@chakra-ui/react"
import { Tooltip } from "./ui/tooltip"
import { api } from "../services/api"
import type { AssetDetailDto, AssetTag } from "../types"

interface TagEditorProps {
    tags: AssetTag[]
    assetId: string
    onTagsChange: (tags: AssetTag[]) => void
    onTagClick?: (value: string) => void
    selectedTags?: string[]
    onTagsSaved?: (updatedAsset: AssetDetailDto) => void
}

// Deterministic color map for tag types
const TYPE_COLORS: Record<string, string> = {
    "画师": "blue",
    "人物": "green",
    "作品": "purple",
    "系列": "orange",
    "风格": "pink",
    "主题": "teal",
    "出处": "cyan",
    "角色": "yellow",
}

const DEFAULT_COLOR_CYCLE = ["blue", "green", "purple", "orange", "pink", "teal", "cyan", "yellow"]

// Simple string hash to pick a deterministic color
function getTypeColor(type: string): string {
    if (TYPE_COLORS[type]) return TYPE_COLORS[type]
    let hash = 0
    for (let i = 0; i < type.length; i++) {
        hash = ((hash << 5) - hash) + type.charCodeAt(i)
        hash |= 0
    }
    return DEFAULT_COLOR_CYCLE[Math.abs(hash) % DEFAULT_COLOR_CYCLE.length]
}

function CheckIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
        </svg>
    )
}

function UndoIcon() {
    return (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="1 4 1 10 7 10" />
            <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
        </svg>
    )
}

function PlusIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
    )
}

function XIcon() {
    return (
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 6L6 18M6 6l12 12" />
        </svg>
    )
}

export function TagEditor({ tags, assetId, onTagsChange, onTagClick, selectedTags = [], onTagsSaved }: TagEditorProps) {
    const [initialTags, setInitialTags] = useState<AssetTag[]>([])
    const [inputValue, setInputValue] = useState("")
    const [suggestions, setSuggestions] = useState<string[]>([])
    const [showSuggestions, setShowSuggestions] = useState(false)
    const [saving, setSaving] = useState(false)
    const [inputFocused, setInputFocused] = useState(false)
    const [highlightedIndex, setHighlightedIndex] = useState(-1)
    const inputRef = useRef<HTMLInputElement>(null)
    const blurTimerRef = useRef<ReturnType<typeof setTimeout>>()
    const tagDataByValue = useRef<Map<string, string | null>>(new Map())

    // Capture initial tags when asset changes
    useEffect(() => {
        setInitialTags(tags)
    }, [assetId]) // eslint-disable-line react-hooks/exhaustive-deps

    const hasChanges = tags.length !== initialTags.length ||
        tags.some((t, i) => t.value !== initialTags[i]?.value || t.type !== initialTags[i]?.type)

    useEffect(() => {
        let cancelled = false
        api.getTags(1, 9999).then((res) => {
            if (cancelled) return

            const usedValues = new Set(tags.map((t) => t.value.toLowerCase()))

            // Build a map of tag value -> type from API response
            const typeMap = new Map<string, string | null>()
            for (const group of res.groups) {
                for (const tag of group.tags) {
                    typeMap.set(tag.value, group.type)
                }
            }
            tagDataByValue.current = typeMap

            if (inputValue.length > 0) {
                const partialCategory = inputValue.match(/^\[([^\]]*)$/)
                const completeCategory = inputValue.match(/^\[([^\]]+)\](.*)$/)

                if (partialCategory) {
                    // Case 1: Typing inside brackets [partial → show category suggestions
                    const partial = partialCategory[1].toLowerCase()
                    const categorySuggestions = res.groups
                        .filter(g => g.type !== null && g.type.toLowerCase().includes(partial))
                        .map(g => `[${g.type}]`)
                    setSuggestions(categorySuggestions.slice(0, 10))
                    setShowSuggestions(inputFocused && categorySuggestions.length > 0)
                } else if (completeCategory) {
                    // Case 2: Complete category bracket [Type]partial → show value suggestions for that category
                    const categoryType = completeCategory[1]
                    const valuePartial = completeCategory[2].toLowerCase()
                    const group = res.groups.find(g => g.type === categoryType)
                    if (group) {
                        const usedVals = new Set(tags.map(t => t.value.toLowerCase()))
                        const filtered = group.tags
                            .filter(t => !usedVals.has(t.value.toLowerCase()) && t.value.toLowerCase().includes(valuePartial))
                            .map(t => t.value)
                        setSuggestions(filtered.slice(0, 10))
                        setShowSuggestions(inputFocused && filtered.length > 0)
                    } else {
                        setSuggestions([])
                        setShowSuggestions(false)
                    }
                } else {
                    // Existing logic for regular text search (no bracket)
                    const query = inputValue.toLowerCase()

                    interface ScoredSuggestion { value: string; score: number }
                    const scored: ScoredSuggestion[] = []

                    for (const group of res.groups) {
                        const typeMatch = group.type !== null && group.type.toLowerCase().includes(query)
                        for (const tag of group.tags) {
                            if (usedValues.has(tag.value.toLowerCase())) continue
                            const valueMatch = tag.value.toLowerCase().includes(query)
                            if (valueMatch || typeMatch) {
                                // Higher score = better match
                                // Exact match first, then startsWith, then includes, then type-only match
                                let score = 0
                                if (valueMatch) {
                                    const lc = tag.value.toLowerCase()
                                    if (lc === query) score = 100
                                    else if (lc.startsWith(query)) score = 80
                                    else score = 60
                                } else if (typeMatch) {
                                    // Type-only match: also boost by how many chars of the value match
                                    score = 40
                                }
                                scored.push({ value: tag.value, score })
                            }
                        }
                    }

                    scored.sort((a, b) => b.score - a.score)
                    setSuggestions(scored.slice(0, 10).map((s) => s.value))
                    setShowSuggestions(inputFocused && scored.length > 0)
                }
            } else {
                // Empty input: distribute suggestions across groups for diversity
                const MAX_TOTAL = 10
                const PER_GROUP = 3
                const result: string[] = []
                const allTagEntries: { value: string; groupIndex: number }[] = []

                res.groups.forEach((group, gi) => {
                    const available = group.tags
                        .map((t) => t.value)
                        .filter((v) => !usedValues.has(v.toLowerCase()))
                    // Take PER_GROUP from each group first
                    const taken = available.slice(0, PER_GROUP)
                    result.push(...taken)
                    // Remember leftovers for filling
                    available.slice(PER_GROUP).forEach((v) => allTagEntries.push({ value: v, groupIndex: gi }))
                })

                // If we have room, fill remaining slots round-robin from leftovers
                if (result.length < MAX_TOTAL && allTagEntries.length > 0) {
                    // Group leftovers by group for round-robin
                    const byGroup = new Map<number, string[]>()
                    for (const entry of allTagEntries) {
                        const list = byGroup.get(entry.groupIndex) ?? []
                        list.push(entry.value)
                        byGroup.set(entry.groupIndex, list)
                    }
                    const groupIds = Array.from(byGroup.keys())
                    let idx = 0
                    while (result.length < MAX_TOTAL) {
                        const gid = groupIds[idx % groupIds.length]
                        const remaining = byGroup.get(gid)!
                        if (remaining.length > 0) {
                            result.push(remaining.shift()!)
                        }
                        idx++
                        // Safety: break if we've exhausted all groups
                        if (Array.from(byGroup.values()).every((arr) => arr.length === 0)) break
                    }
                }

                setSuggestions(result.slice(0, MAX_TOTAL))
                setShowSuggestions(inputFocused && result.length > 0)
            }
        }).catch(() => { })
        return () => { cancelled = true }
    }, [inputValue, tags, inputFocused])

    // Reset highlighted index when suggestions change
    const prevSuggestionsLength = useRef(0)
    useEffect(() => {
        if (suggestions.length !== prevSuggestionsLength.current) {
            setHighlightedIndex(-1)
            prevSuggestionsLength.current = suggestions.length
        }
    }, [suggestions])

    const handleFocus = () => {
        if (blurTimerRef.current) clearTimeout(blurTimerRef.current)
        setInputFocused(true)
    }

    const handleBlur = () => {
        // Delay hiding so click on suggestion registers first
        blurTimerRef.current = setTimeout(() => setInputFocused(false), 150)
    }

    const handleAddTag = (value: string) => {
        const trimmed = value.trim()
        if (!trimmed) return

        // Try to parse [Type]Value bracket syntax first
        const bracketMatch = trimmed.match(/^\[([^\]]+)\](.+)$/)
        let extractedValue: string
        let extractedType: string | null

        if (bracketMatch) {
            extractedType = bracketMatch[1]
            extractedValue = bracketMatch[2].trim()
        } else {
            extractedValue = trimmed
            // Look up type from API data (preserve type when adding via suggestion)
            extractedType = tagDataByValue.current.get(extractedValue) ?? null
        }

        if (!extractedValue) return

        // Check for duplicate (type, value) pair
        if (tags.some((t) => t.value === extractedValue && t.type === extractedType)) return

        const newTag: AssetTag = { type: extractedType, value: extractedValue }

        if (extractedType !== null) {
            // Categorized tag: insert after the last existing categorized tag
            const lastCategorizedIdx = tags.map((t, i) => t.type !== null ? i : -1).reduce((last, i) => Math.max(last, i), -1)
            const insertAt = lastCategorizedIdx + 1
            const newTags = [...tags]
            newTags.splice(insertAt, 0, newTag)
            onTagsChange(newTags)
        } else {
            // Uncategorized tag: append at the end
            const newTags = [...tags, newTag]
            onTagsChange(newTags)
        }

        setInputValue("")
        setShowSuggestions(false)
        inputRef.current?.focus()
    }

    const handleRemoveTag = (value: string, type: string | null) => {
        onTagsChange(tags.filter((t) => !(t.value === value && t.type === type)))
    }

    const handleSave = async () => {
        setSaving(true)
        try {
            const updated = await api.updateTags(assetId, tags)
            setInitialTags([...tags])
            onTagsSaved?.(updated)
        } catch {
            // Toast handled by parent
        } finally {
            setSaving(false)
        }
    }

    const handleUndo = () => {
        onTagsChange([...initialTags])
    }

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (!showSuggestions || suggestions.length === 0) {
            if (e.key === "Enter") {
                e.preventDefault()
                handleAddTag(inputValue)
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
                const s = suggestions[highlightedIndex]
                if (s.startsWith('[') && s.endsWith(']')) {
                    setInputValue(s)
                    inputRef.current?.focus()
                } else {
                    handleAddTag(s)
                }
            } else {
                handleAddTag(inputValue)
            }
        } else if (e.key === "Escape") {
            setShowSuggestions(false)
        }
    }

    // Load category order for sorting
    const [categoryOrder, setCategoryOrder] = useState<string[]>([])
    useEffect(() => {
        api.getLibraryInfo().then((info) => {
            if (info.categoryOrder) {
                setCategoryOrder(info.categoryOrder)
            }
        }).catch(() => { })
    }, [])

    return (
        <Stack gap="3" position="relative">
            <HStack gap="1" justify="space-between">
                <HStack gap="1">
                    <Text fontWeight="semibold" fontSize="sm" color="fg">Tags</Text>
                    {hasChanges && (
                        <Text color="red.400" fontWeight="bold" fontSize="sm" lineHeight="1">*</Text>
                    )}
                </HStack>
                <HStack
                    gap="1"
                    opacity={hasChanges ? 1 : 0}
                    transition="opacity 0.15s"
                    flexShrink="0"
                >
                    <Button
                        size="xs"
                        variant="ghost"
                        colorPalette="accent"
                        loading={saving}
                        onClick={handleSave}
                        disabled={!hasChanges}
                        px="1.5"
                    >
                        <CheckIcon />
                    </Button>
                    <Button
                        size="xs"
                        variant="ghost"
                        colorPalette="red"
                        onClick={handleUndo}
                        disabled={!hasChanges}
                        px="1.5"
                    >
                        <UndoIcon />
                    </Button>
                </HStack>
            </HStack>

            <HStack gap="2" flexWrap="wrap">
                {[...tags].sort((a, b) => {
                    // Categorized tags first, sorted by category order, then by type name
                    if (a.type && b.type) {
                        const orderIdx = new Map(categoryOrder.map((name, idx) => [name, idx]))
                        const ai = orderIdx.get(a.type) ?? Number.MAX_SAFE_INTEGER
                        const bi = orderIdx.get(b.type) ?? Number.MAX_SAFE_INTEGER
                        if (ai !== bi) return ai - bi
                        return a.type.localeCompare(b.type)
                    }
                    if (a.type && !b.type) return -1
                    if (!a.type && b.type) return 1
                    return 0
                }).map((tag) => {
                    const colorPalette = tag.type ? getTypeColor(tag.type) : "accent"
                    const isInFilter = selectedTags.includes(tag.value)
                    return (
                        <Box
                            key={(tag.type ?? "") + ":" + tag.value}
                            role="group"
                            display="inline-flex"
                            position="relative"
                            cursor="default"
                        >
                            {tag.type ? (
                                <Tooltip
                                    content={tag.type}
                                    positioning={{ placement: "top", gutter: 4 }}
                                    closeOnPointerDown={false}
                                    lazyMount
                                >
                                    <Tag.Root
                                        size="lg"
                                        colorPalette={colorPalette}
                                        variant={isInFilter ? "solid" : "subtle"}
                                        borderRadius="full"
                                        display="inline-flex"
                                        alignItems="center"
                                        px="2.5"
                                        py="1"
                                        cursor={onTagClick ? "pointer" : "default"}
                                        onClick={onTagClick ? () => onTagClick(tag.value) : undefined}
                                        opacity={tag.type ? 0.85 : 1}
                                    >
                                        <Tag.Label fontSize="sm">{tag.value}</Tag.Label>
                                    </Tag.Root>
                                </Tooltip>
                            ) : (
                                <Tag.Root
                                    size="lg"
                                    colorPalette="accent"
                                    variant={isInFilter ? "solid" : "subtle"}
                                    borderRadius="full"
                                    display="inline-flex"
                                    alignItems="center"
                                    px="2.5"
                                    py="1"
                                    cursor={onTagClick ? "pointer" : "default"}
                                    onClick={onTagClick ? () => onTagClick(tag.value) : undefined}
                                    opacity={0.85}
                                >
                                    <Tag.Label fontSize="sm">{tag.value}</Tag.Label>
                                </Tag.Root>
                            )}
                            <Box
                                as="button"
                                onClick={() => handleRemoveTag(tag.value, tag.type)}
                                position="absolute"
                                top="-1.5"
                                right="-1.5"
                                bg="bg"
                                border="1px solid"
                                borderColor="border"
                                borderRadius="full"
                                width="5"
                                height="5"
                                display="flex"
                                alignItems="center"
                                justifyContent="center"
                                opacity="0"
                                _groupHover={{ opacity: 1 }}
                                _hover={{ opacity: 1, bg: "bg.subtle", cursor: "pointer" }}
                                aria-label={"Remove tag " + tag.value}
                                zIndex="1"
                            >
                                <XIcon />
                            </Box>
                        </Box>
                    )
                })}
            </HStack>

            <Field.Root>
                <HStack gap="2" width="full">
                    <Input
                        ref={inputRef}
                        placeholder="Add tag..."
                        value={inputValue}
                        onChange={(e) => setInputValue(e.target.value)}
                        onFocus={handleFocus}
                        onBlur={handleBlur}
                        onKeyDown={handleKeyDown}
                        size="sm"
                        bg="bg"
                        border="1px solid"
                        borderColor="border"
                        flex="1"
                    />
                    <Box flexShrink="0">
                        <Button
                            size="sm"
                            variant="outline"
                            colorPalette="accent"
                            onClick={() => handleAddTag(inputValue)}
                            disabled={!inputValue.trim()}
                            width="36px"
                            p="0"
                            aria-label="Add tag"
                        >
                            <PlusIcon />
                        </Button>
                    </Box>
                </HStack>
            </Field.Root>

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
                            key={s}
                            px="3"
                            py="2"
                            cursor="pointer"
                            bg={i === highlightedIndex ? { base: "blue.100", _dark: "blue.800" } : undefined}
                            _hover={{ bg: { base: "blue.100", _dark: "blue.800" } }}
                            onClick={() => {
                                if (s.startsWith('[') && s.endsWith(']')) {
                                    // Category suggestion from bracket mode — keep typing
                                    setInputValue(s)
                                    inputRef.current?.focus()
                                } else {
                                    handleAddTag(s)
                                }
                            }}
                            fontSize="sm"
                        >
                            {s}
                        </Box>
                    ))}
                </Box>
            )}
        </Stack>
    )
}
