import { useState, useEffect, useMemo, useRef, useCallback } from "react"
import { Box, Button, HStack, Input, Text } from "@chakra-ui/react"
import { TagBadge } from "./TagBadge"
import { api } from "../services/api"
import type { TagGroupsResponse } from "../types"

const PAGE_SIZE = 50

interface FlatTag {
    value: string
    type: string | null
    count: number
}

export interface TagSelectorProps {
    /** If true, only show uncategorized tags. If false, show all tags grouped by category. */
    showOnlyUncategorized?: boolean
    /** If true, allow selecting multiple tags. If false, single-selection only. Default: true */
    multiSelect?: boolean
    /** Currently selected tag values (as a Set for O(1) lookup) */
    selectedTags: Set<string>
    /** Called when a tag is toggled */
    onToggleTag: (tagValue: string) => void
    libraryId: string
}

export function TagSelector({
    showOnlyUncategorized = false,
    multiSelect = true,
    selectedTags,
    onToggleTag,
    libraryId,
}: TagSelectorProps) {
    const [tagData, setTagData] = useState<TagGroupsResponse | null>(null)
    const [searchTerm, setSearchTerm] = useState("")
    const [page, setPage] = useState(0)
    const searchTimerRef = useRef<ReturnType<typeof setTimeout>>()
    const tagTypeRef = useRef<Map<string, string | null>>(new Map())

    // Load all tags on mount
    useEffect(() => {
        let cancelled = false
            ; (async () => {
                try {
                    // Load a large batch to get all tags at once
                    const result = await api.getTags(libraryId, 1, 200)
                    if (cancelled) return
                    setTagData(result)
                    // Build tag type lookup
                    const typeMap = new Map<string, string | null>()
                    for (const group of result.groups) {
                        for (const t of group.tags) {
                            typeMap.set(t.value, group.type)
                        }
                    }
                    tagTypeRef.current = typeMap
                } catch {
                    // ignore
                }
            })()
        return () => { cancelled = true }
    }, [])

    // Debounced search handler
    const handleSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const value = e.target.value
        setSearchTerm(value)
        if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
        searchTimerRef.current = setTimeout(() => {
            setPage(0)
        }, 300)
    }, [])

    // Flatten all tags with their type info
    const allFlatTags = useMemo<FlatTag[]>(() => {
        if (!tagData) return []
        const result: FlatTag[] = []
        for (const group of tagData.groups) {
            for (const t of group.tags) {
                result.push({ value: t.value, type: group.type, count: t.count })
            }
        }
        return result
    }, [tagData])

    // Filter tags based on search term and uncategorized mode
    const filteredTags = useMemo<FlatTag[]>(() => {
        let filtered = allFlatTags
        // Filter by search
        if (searchTerm) {
            const term = searchTerm.toLowerCase()
            filtered = filtered.filter((t) => t.value.toLowerCase().includes(term))
        }
        // Filter by uncategorized
        if (showOnlyUncategorized) {
            filtered = filtered.filter((t) => t.type === null)
        }
        return filtered
    }, [allFlatTags, searchTerm, showOnlyUncategorized])

    // Paginate
    const totalPages = Math.max(1, Math.ceil(filteredTags.length / PAGE_SIZE))
    const clampedPage = Math.min(page, totalPages - 1)
    const paginatedTags = useMemo<FlatTag[]>(() => {
        return filteredTags.slice(clampedPage * PAGE_SIZE, (clampedPage + 1) * PAGE_SIZE)
    }, [filteredTags, clampedPage])

    // Re-group paginated tags for display (when showOnlyUncategorized = false)
    const groupedTags = useMemo(() => {
        if (showOnlyUncategorized) return null
        const groups = new Map<string | null, FlatTag[]>()
        for (const t of paginatedTags) {
            const key = t.type ?? "__untagged"
            if (!groups.has(key)) groups.set(key, [])
            groups.get(key)!.push(t)
        }
        return Array.from(groups.entries())
    }, [paginatedTags, showOnlyUncategorized])

    const hasPagination = filteredTags.length > PAGE_SIZE

    const handlePrevious = useCallback(() => {
        setPage((p) => Math.max(0, p - 1))
    }, [])

    const handleNext = useCallback(() => {
        setPage((p) => Math.min(totalPages - 1, p + 1))
    }, [totalPages])

    const handleTagClick = useCallback((tagValue: string) => {
        if (multiSelect) {
            onToggleTag(tagValue)
        } else {
            // Single-select: if already selected, deselect; otherwise replace selection with this tag
            if (selectedTags.has(tagValue)) {
                onToggleTag(tagValue)
            } else {
                // Deselect all others and select this one
                // The parent should handle this by clearing and setting just this tag
                onToggleTag(tagValue)
            }
        }
    }, [multiSelect, onToggleTag, selectedTags])

    const showEmptyState = showOnlyUncategorized && filteredTags.length === 0 && tagData !== null

    if (!tagData) {
        return (
            <Box minH="200px">
                <Text color="fg.muted" fontSize="sm" textAlign="center" py="4">Loading tags...</Text>
            </Box>
        )
    }

    return (
        <Box>
            {/* Search input */}
            <Input
                placeholder="Search tags..."
                value={searchTerm}
                onChange={handleSearchChange}
                bg="bg"
                border="1px solid"
                borderColor="border"
                size="sm"
                mb="3"
            />

            {/* Tag list */}
            <Box maxH="300px" minH="200px" overflowY="auto">
                {showOnlyUncategorized ? (
                    // Flat list of uncategorized tags
                    <HStack gap="2" flexWrap="wrap">
                        {paginatedTags.map((t) => {
                            const isSelected = selectedTags.has(t.value)
                            return (
                                <TagBadge
                                    key={t.value}
                                    value={t.value}
                                    type={null}
                                    count={t.count}
                                    isSelected={isSelected}
                                    showCount
                                    onClick={() => handleTagClick(t.value)}
                                />
                            )
                        })}
                        {showEmptyState && (
                            <Text color="fg.muted" fontSize="sm">No uncategorized tags available</Text>
                        )}
                    </HStack>
                ) : (
                    // Grouped display without category headers
                    <Box>
                        {groupedTags?.map(([type, tags]) => (
                            <Box key={type ?? "__untagged"} mb="3">
                                <HStack gap="2" flexWrap="wrap">
                                    {tags.map((t) => {
                                        const isSelected = selectedTags.has(t.value)
                                        return (
                                            <TagBadge
                                                key={t.value}
                                                value={t.value}
                                                type={t.type}
                                                count={t.count}
                                                isSelected={isSelected}
                                                showCount
                                                onClick={() => handleTagClick(t.value)}
                                            />
                                        )
                                    })}
                                </HStack>
                            </Box>
                        ))}
                        {tagData !== null && filteredTags.length === 0 && (
                            <Text color="fg.muted" fontSize="sm">No tags found</Text>
                        )}
                    </Box>
                )}
            </Box>

            {/* Pagination */}
            {hasPagination && (
                <HStack gap="2" mt="3" justify="center">
                    <Button
                        size="2xs"
                        variant="ghost"
                        disabled={clampedPage === 0}
                        onClick={handlePrevious}
                    >
                        Previous
                    </Button>
                    <Text fontSize="xs" color="fg.muted">
                        {clampedPage * PAGE_SIZE + 1}–{Math.min((clampedPage + 1) * PAGE_SIZE, filteredTags.length)} of {filteredTags.length}
                    </Text>
                    <Button
                        size="2xs"
                        variant="ghost"
                        disabled={clampedPage >= totalPages - 1}
                        onClick={handleNext}
                    >
                        Next
                    </Button>
                </HStack>
            )}
        </Box>
    )
}
