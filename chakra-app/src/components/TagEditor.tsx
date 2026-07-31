import { useState, useEffect, useRef } from "react"
import { Box, Button, Field, HStack, Input, Stack, Text } from "@chakra-ui/react"
import { TagBadge } from "./TagBadge"
import { api } from "../services/api"
import { CopyButton } from "./CopyButton"
import type { AssetDetailDto, AssetTag } from "../types"
import type { CustomToaster } from "./CustomToast"

interface TagEditorProps {
    tags: AssetTag[]
    assetId: string
    onTagsChange: (tags: AssetTag[]) => void
    onTagClick?: (value: string) => void
    selectedTags?: string[]
    onTagsSaved?: (updatedAsset: AssetDetailDto) => void
    libraryId: string
    toaster?: CustomToaster
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

function EditIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
        </svg>
    )
}

export function TagEditor({ tags, assetId, onTagsChange, onTagClick, selectedTags = [], onTagsSaved, libraryId, toaster }: TagEditorProps) {
    const [initialTags, setInitialTags] = useState<AssetTag[]>([])
    const [inputValue, setInputValue] = useState("")
    const [suggestions, setSuggestions] = useState<string[]>([])
    const [showSuggestions, setShowSuggestions] = useState(false)
    const [saving, setSaving] = useState(false)
    const [deleteMode, setDeleteMode] = useState(false)
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

    // Load tag suggestions — 50 items, no scroll-to-load-more
    useEffect(() => {
        let cancelled = false

        const loadSuggestions = async () => {
            try {
                const usedValues = new Set(tags.map((t) => t.value.toLowerCase()))
                const partialCategory = inputValue.match(/^\[([^\]]*)$/)
                const completeCategory = inputValue.match(/^\[([^\]]+)\](.*)$/)

                let newSuggestions: string[] = []

                if (partialCategory) {
                    // Case 1: Typing inside brackets [partial → show category suggestions
                    // Load without search param so we can filter group names client-side
                    const result = await api.getTags(libraryId, 1, 50)
                    if (cancelled) return
                    // Build type map from response
                    const typeMap = new Map<string, string | null>()
                    for (const group of result.groups) {
                        for (const tag of group.tags) {
                            typeMap.set(tag.value, group.type)
                        }
                    }
                    tagDataByValue.current = typeMap
                    const partial = partialCategory[1].toLowerCase()
                    newSuggestions = result.groups
                        .filter(g => g.type !== null && g.type.toLowerCase().includes(partial))
                        .map(g => `[${g.type}]`)
                } else if (completeCategory) {
                    // Case 2: Complete category bracket [Type]partial → show value suggestions for that category
                    // Load without search param, filter client-side by group type
                    const result = await api.getTags(libraryId, 1, 50)
                    if (cancelled) return
                    // Build type map from response
                    const typeMap = new Map<string, string | null>()
                    for (const group of result.groups) {
                        for (const tag of group.tags) {
                            typeMap.set(tag.value, group.type)
                        }
                    }
                    tagDataByValue.current = typeMap
                    const categoryType = completeCategory[1]
                    const valuePartial = completeCategory[2].toLowerCase()
                    const group = result.groups.find(g => g.type === categoryType)
                    if (group) {
                        const usedVals = new Set(tags.map(t => t.value.toLowerCase()))
                        newSuggestions = group.tags
                            .filter(t => !usedVals.has(t.value.toLowerCase()) && t.value.toLowerCase().includes(valuePartial))
                            .map(t => t.value)
                    }
                } else {
                    // Normal search or empty input — pass search term to API for server-side filtering
                    const searchTerm = inputValue || undefined
                    const result = await api.getTags(libraryId, 1, 50, searchTerm)
                    if (cancelled) return
                    // Build type map from response
                    const typeMap = new Map<string, string | null>()
                    for (const group of result.groups) {
                        for (const tag of group.tags) {
                            typeMap.set(tag.value, group.type)
                        }
                    }
                    tagDataByValue.current = typeMap
                    // Flatten all tag values from response, filtering used ones
                    for (const group of result.groups) {
                        for (const tag of group.tags) {
                            if (!usedValues.has(tag.value.toLowerCase())) {
                                newSuggestions.push(tag.value)
                            }
                        }
                    }
                }

                setSuggestions(newSuggestions)
                setShowSuggestions(inputFocused && newSuggestions.length > 0)
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
    }, [inputValue, tags, inputFocused])

    const handleFocus = () => {
        if (blurTimerRef.current) clearTimeout(blurTimerRef.current)
        setInputFocused(true)
    }

    const handleBlur = () => {
        // Delay hiding so click on suggestion registers first
        blurTimerRef.current = setTimeout(() => setInputFocused(false), 150)
    }

    const handleAddTag = (value: string, splitOnDash = false) => {
        const trimmed = value.trim()
        if (!trimmed) return

        // Split by "-" separator if requested
        const segments = splitOnDash && trimmed.includes('-')
            ? trimmed.split('-').map(s => s.trim()).filter(Boolean)
            : [trimmed]

        let currentTags = [...tags]

        for (const segment of segments) {
            // Try to parse [Type]Value bracket syntax first
            const bracketMatch = segment.match(/^\[([^\]]+)\](.+)$/)
            let extractedValue: string
            let extractedType: string | null

            if (bracketMatch) {
                extractedType = bracketMatch[1]
                extractedValue = bracketMatch[2].trim()
            } else {
                extractedValue = segment
                // Look up type from API data (preserve type when adding via suggestion)
                extractedType = tagDataByValue.current.get(extractedValue) ?? null
            }

            if (!extractedValue) continue

            // Check for duplicate (type, value) pair
            if (currentTags.some((t) => t.value === extractedValue && t.type === extractedType)) continue

            const newTag: AssetTag = { type: extractedType, value: extractedValue }

            if (extractedType !== null) {
                // Categorized tag: insert after the last existing categorized tag
                const lastCategorizedIdx = currentTags.map((t, i) => t.type !== null ? i : -1).reduce((last, i) => Math.max(last, i), -1)
                const insertAt = lastCategorizedIdx + 1
                currentTags.splice(insertAt, 0, newTag)
            } else {
                // Uncategorized tag: append at the end
                currentTags.push(newTag)
            }
        }

        if (currentTags.length !== tags.length || JSON.stringify(currentTags) !== JSON.stringify(tags)) {
            onTagsChange(currentTags)
            setDeleteMode(true)
        }

        setInputValue("")
        setShowSuggestions(false)
        inputRef.current?.focus()
    }

    const handleRemoveTag = (value: string, type: string | null) => {
        onTagsChange(tags.filter((t) => !(t.value === value && t.type === type)))
    }

    const handleSave = async () => {
        if (!hasChanges) {
            // No actual changes — just exit edit mode
            setDeleteMode(false)
            return
        }
        setSaving(true)
        try {
            const updated = await api.updateTags(assetId, tags, libraryId)
            setInitialTags(updated.tags)
            setDeleteMode(false)
            onTagsSaved?.(updated)
        } catch {
            // Toast handled by parent
        } finally {
            setSaving(false)
        }
    }

    const handleUndo = () => {
        onTagsChange([...initialTags])
        setDeleteMode(false)
    }

    const getTagString = () =>
        tags.map(t => t.type ? `[${t.type}]${t.value}` : t.value).join("-")

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (!showSuggestions || suggestions.length === 0) {
            if (e.key === "Enter") {
                e.preventDefault()
                handleAddTag(inputValue, true)
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
                handleAddTag(inputValue, true)
            }
        } else if (e.key === "Escape") {
            setShowSuggestions(false)
        }
    }

    // Load category order for sorting
    const [categoryOrder, setCategoryOrder] = useState<string[]>([])
    useEffect(() => {
        api.getLibraryInfo(libraryId).then((info) => {
            if (info.categoryOrder) {
                setCategoryOrder(info.categoryOrder)
            }
        }).catch(() => { })
    }, [libraryId])

    return (
        <Stack gap="3" position="relative">
            <HStack gap="1" justify="space-between">
                <HStack gap="1">
                    <Text fontWeight="semibold" fontSize="sm" color="fg">Tags</Text>
                    <Text
                        color="red.400"
                        fontWeight="bold"
                        fontSize="sm"
                        lineHeight="1"
                        visibility={hasChanges ? "visible" : "hidden"}
                    >*</Text>
                    {/* Copy — always visible when there are tags */}
                    {tags.length > 0 && (
                        <CopyButton text={getTagString()} />
                    )}
                    {/* Pen — shown when not in edit mode */}
                    {!deleteMode && !hasChanges && tags.length > 0 && (
                        <Box
                            as="button"
                            onClick={() => setDeleteMode(true)}
                            display="inline-flex"
                            alignItems="center"
                            justifyContent="center"
                            width="6"
                            height="6"
                            borderRadius="md"
                            color="fg.subtle"
                            opacity={0.5}
                            _hover={{ opacity: 1, bg: "bg.subtle", cursor: "pointer" }}
                            transition="opacity 0.1s ease"
                            aria-label="Edit tags"
                        >
                            <EditIcon />
                        </Box>
                    )}
                </HStack>
                {onTagsSaved && (
                    <HStack gap="1" flexShrink="0">
                        {/* Reset — always rendered, visible only when there are pending changes */}
                        <Box
                            visibility={hasChanges ? "visible" : "hidden"}
                            display="inline-flex"
                        >
                            <Button
                                size="xs"
                                variant="ghost"
                                colorPalette="red"
                                onClick={handleUndo}
                                px="1.5"
                            >
                                <UndoIcon />
                            </Button>
                        </Box>
                        {/* Check — always rendered, visible when in edit mode or there are pending changes */}
                        <Box
                            visibility={(deleteMode || hasChanges) ? "visible" : "hidden"}
                            display="inline-flex"
                        >
                            <Button
                                size="xs"
                                variant="ghost"
                                colorPalette="accent"
                                loading={saving}
                                onClick={handleSave}
                                px="1.5"
                            >
                                <CheckIcon />
                            </Button>
                        </Box>

                    </HStack>
                )}
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
                    const isInFilter = selectedTags.includes(tag.value)
                    return (
                        <Box
                            key={(tag.type ?? "") + ":" + tag.value}
                            role="group"
                            display="inline-flex"
                            position="relative"
                            cursor="default"
                        >
                            <TagBadge
                                value={tag.value}
                                type={tag.type}
                                isSelected={isInFilter}
                                variant="subtle"
                                onClick={onTagClick ? () => onTagClick(tag.value) : undefined}
                            />
                            {deleteMode && (
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
                                    _hover={{ bg: "bg.subtle", cursor: "pointer" }}
                                    aria-label={"Remove tag " + tag.value}
                                    zIndex="1"
                                >
                                    <XIcon />
                                </Box>
                            )}
                        </Box>
                    )
                })}

            </HStack>

            <Field.Root>
                <HStack gap="2" width="full">
                    <Input
                        ref={inputRef}
                        placeholder="Add tags..."
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
                            onClick={() => handleAddTag(inputValue, true)}
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
