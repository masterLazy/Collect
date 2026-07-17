import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
    Box,
    Button,
    Dialog,
    Drawer,
    Field,
    HStack,
    Input,
    Menu,
    Portal,
    Stack,
    Tag,
    Text,
} from "@chakra-ui/react"
import { api } from "../services/api"
import { TagBadge } from "./TagBadge"
import { TagSelector } from "./TagSelector"
import type { TagGroupsResponse } from "../types"
import type { CustomToaster } from "./CustomToast"

interface TagFilterModalProps {
    selectedTags: string[]
    onTagsChange: (tags: string[]) => void
    onCategorizeSave?: () => void
    isMobile?: boolean
    toaster: CustomToaster
}

function FilterIcon() {
    return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
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

function PlusIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
    )
}

function UndoIcon() {
    return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="1 4 1 10 7 10" />
            <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
        </svg>
    )
}

function EditTagIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
        </svg>
    )
}

const PAGE_SIZE = 20

// ── Memoized category list items for performance ──

interface CategoryItemProps {
    cat: string
    index: number
    isSelected: boolean
    isDragOverCat: boolean
    isDragOverTag: boolean
    isDragging: boolean
    isHovered: boolean
    pendingRenameTarget: string | null
    isPendingDelete: boolean
    onSelect: (cat: string) => void
    onDragStart: (e: React.DragEvent, index: number) => void
    onDragOver: (e: React.DragEvent, cat: string | null) => void
    onDragLeave: () => void
    onDrop: (e: React.DragEvent, cat: string | null) => void
    onMouseEnter: (cat: string) => void
    onMouseLeave: () => void
    onRename: (cat: string) => void
    onDelete: (cat: string) => void
}

const CategoryListItem = memo(function CategoryListItem({
    cat, index, isSelected, isDragOverCat, isDragOverTag, isDragging, isHovered,
    pendingRenameTarget, isPendingDelete,
    onSelect, onDragStart, onDragOver, onDragLeave, onDrop,
    onMouseEnter, onMouseLeave, onRename, onDelete,
}: CategoryItemProps) {
    const showPendingIndicator = pendingRenameTarget !== null || isPendingDelete
    return (
        <HStack
            px="2"
            py="1.5"
            borderRadius="md"
            cursor="grab"
            draggable
            bg={isDragOverCat || isDragOverTag
                ? { base: "blue.100", _dark: "blue.800" }
                : isPendingDelete
                    ? { base: "red.50", _dark: "red.950" }
                    : isSelected
                        ? "bg.subtle"
                        : "transparent"}
            _hover={{ bg: isPendingDelete ? { base: "red.50", _dark: "red.950" } : "bg.subtle" }}
            onClick={() => onSelect(cat)}
            onDragStart={(e) => onDragStart(e, index)}
            onDragOver={(e) => onDragOver(e, cat)}
            onDragLeave={onDragLeave}
            onDrop={(e) => onDrop(e, cat)}
            onMouseEnter={() => onMouseEnter(cat)}
            onMouseLeave={onMouseLeave}
            gap="0"
            opacity={isDragging ? 0.4 : 1}
            transition="opacity 0.15s, background 0.1s"
        >
            <Text
                fontSize="sm"
                fontWeight={isSelected ? "bold" : "normal"}
                color={isPendingDelete ? { base: "red.500", _dark: "red.400" } : "fg"}
                textDecoration={isPendingDelete ? "line-through" : "none"}
                truncate
                flex="1"
            >
                {cat}
                {pendingRenameTarget && (
                    <Text as="span" color={{ _light: "orange.600", _dark: "orange.400" }} fontSize="xs" ml="1">
                        → {pendingRenameTarget}
                    </Text>
                )}
                {isPendingDelete && (
                    <Text as="span" color={{ _light: "red.500", _dark: "red.400" }} fontSize="xs" ml="1">
                        (deleted)
                    </Text>
                )}
            </Text>
            {showPendingIndicator && (
                <Box
                    width="8px"
                    height="8px"
                    borderRadius="full"
                    bg={isPendingDelete ? "red.500" : "orange.500"}
                    flexShrink="0"
                    mr="1"
                />
            )}
            <Box
                display={isHovered ? "inline-flex" : "none"}
                gap="1"
                flexShrink="0"
                alignItems="center"
            >
                <Box
                    as="button"
                    display="inline-flex"
                    alignItems="center"
                    justifyContent="center"
                    width="20px"
                    height="20px"
                    borderRadius="sm"
                    cursor="pointer"
                    color={{ _light: "orange.600", _dark: "orange.400" }}
                    _hover={{ bg: { base: "blackAlpha.200", _dark: "whiteAlpha.200" } }}
                    onClick={(e: React.MouseEvent) => { e.stopPropagation(); onRename(cat); }}
                    aria-label="Rename category"
                    tabIndex={-1}
                    title="Rename"
                >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                    </svg>
                </Box>
                <Box
                    as="button"
                    display="inline-flex"
                    alignItems="center"
                    justifyContent="center"
                    width="20px"
                    height="20px"
                    borderRadius="sm"
                    cursor="pointer"
                    color={{ _light: "red.500", _dark: "red.400" }}
                    _hover={{ bg: { base: "blackAlpha.200", _dark: "whiteAlpha.200" } }}
                    onClick={(e: React.MouseEvent) => { e.stopPropagation(); onDelete(cat); }}
                    aria-label="Delete category"
                    tabIndex={-1}
                    title="Delete"
                >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                    </svg>
                </Box>
            </Box>
        </HStack>
    )
})

// ── Memoized tags panel — prevents left-panel state changes from re-rendering right panel ──

interface TagsPanelProps {
    filteredGroups: TagGroupsResponse["groups"]
    selectedTags: string[]
    hasMoreInFiltered: boolean
    loadingMore: boolean
    isEmpty: boolean
    onToggleTag: (value: string) => void
    onShowMore: () => void
    onTagDragStart: (e: React.DragEvent, tagValue: string, groupType: string | null) => void
}

const TagsPanel = memo(function TagsPanel({
    filteredGroups, selectedTags, hasMoreInFiltered, loadingMore,
    isEmpty, onToggleTag, onShowMore, onTagDragStart,
}: TagsPanelProps) {
    return (
        <Box
            flex="1"
            minH="300px"
            maxH="60vh"
            overflowY="auto"
            // Prevent browser default drag behavior when tags are dropped back in the right panel
            onDragOver={(e) => e.preventDefault()}
        >
            {filteredGroups.map((group) => (
                <Box key={group.type ?? "__untagged"} mb="4">
                    <Text fontWeight="semibold" fontSize="sm" color="fg" mb="2">
                        {group.type ?? "Uncategorized"}
                    </Text>
                    <HStack gap="2" flexWrap="wrap">
                        {group.tags.map((t) => {
                            const isSelected = selectedTags.includes(t.value)
                            return (
                                <Box
                                    key={t.value}
                                    role="group"
                                    display="inline-flex"
                                    cursor="pointer"
                                    onClick={() => onToggleTag(t.value)}
                                    draggable
                                    onDragStart={(e) => onTagDragStart(e, t.value, group.type)}
                                >
                                    <TagBadge
                                        value={t.value}
                                        type={group.type}
                                        count={t.count}
                                        isSelected={isSelected}
                                        showCount
                                    />
                                </Box>
                            )
                        })}
                    </HStack>
                </Box>
            ))}
            {hasMoreInFiltered && (
                <Button
                    variant="ghost"
                    size="xs"
                    mt="2"
                    onClick={onShowMore}
                    loading={loadingMore}
                    colorPalette="accent"
                >
                    Show more
                </Button>
            )}
            {isEmpty && (
                <Text color="fg.muted" fontSize="sm">No tags found</Text>
            )}
        </Box>
    )
})

export function TagFilterModal({ selectedTags, onTagsChange, onCategorizeSave, isMobile, toaster }: TagFilterModalProps) {
    const [open, setOpen] = useState(false)
    const [tagData, setTagData] = useState<TagGroupsResponse | null>(null)
    const [searchTerm, setSearchTerm] = useState("")
    const [selectedCategory, setSelectedCategory] = useState<string | null>(null) // null = "All"
    const [currentPage, setCurrentPage] = useState(1)
    const [loadingMore, setLoadingMore] = useState(false)
    const [pendingChanges, setPendingChanges] = useState<Map<string, string | null>>(new Map())
    const [saving, setSaving] = useState(false)
    const [localCategories, setLocalCategories] = useState<string[]>([])
    const [dragOverCategory, setDragOverCategory] = useState<string | null | undefined>(undefined)
    const [categoryOrder, setCategoryOrder] = useState<string[]>([])
    const [dragCatIndex, setDragCatIndex] = useState<number | null>(null)
    const [dragOverCatIndex, setDragOverCatIndex] = useState<number | null>(null)
    const [createDialogOpen, setCreateDialogOpen] = useState(false)
    const [createCategoryName, setCreateCategoryName] = useState("")
    const [selectedCreateTags, setSelectedCreateTags] = useState<Set<string>>(new Set())
    const searchTimerRef = useRef<ReturnType<typeof setTimeout>>()
    const tagDataRef = useRef<TagGroupsResponse | null>(null)
    const dragOverRef = useRef<string | null | undefined>(undefined)

    // Rename tag dialog state
    const [editTagMenuOpen, setEditTagMenuOpen] = useState(false)
    const [renameTagDialogOpen, setRenameTagDialogOpen] = useState(false)
    const [renameTagNewValue, setRenameTagNewValue] = useState("")
    const [renameTagSaving, setRenameTagSaving] = useState(false)
    const [selectedRenameTag, setSelectedRenameTag] = useState<Set<string>>(new Set())

    // Delete tags dialog state
    const [deleteTagsDialogOpen, setDeleteTagsDialogOpen] = useState(false)
    const [selectedDeleteTags, setSelectedDeleteTags] = useState<Set<string>>(new Set())
    const [deleteTagsSaving, setDeleteTagsSaving] = useState(false)

    // Confirm dialog for immediate rename/delete operations
    const [confirmRenameOpen, setConfirmRenameOpen] = useState(false)
    const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false)

    // Pending category renames/deletes (not yet saved)
    const [pendingCategoryRenames, setPendingCategoryRenames] = useState<Map<string, string>>(new Map())
    const [pendingCategoryDeletes, setPendingCategoryDeletes] = useState<Set<string>>(new Set())

    // Category rename/delete state
    const [catHovered, setCatHovered] = useState<string | null>(null)
    const [catRenameOpen, setCatRenameOpen] = useState(false)
    const [catRenameOldType, setCatRenameOldType] = useState("")
    const [catRenameNewType, setCatRenameNewType] = useState("")
    const [catDeleteOpen, setCatDeleteOpen] = useState(false)
    const [catDeleteType, setCatDeleteType] = useState("")

    // Keep ref in sync
    useEffect(() => {
        tagDataRef.current = tagData
    }, [tagData])

    const hasChanges = pendingChanges.size > 0 || pendingCategoryRenames.size > 0 || pendingCategoryDeletes.size > 0

    const loadTags = useCallback(async (page: number, search: string, append: boolean) => {
        setLoadingMore(true)
        try {
            const result = await api.getTags(page, PAGE_SIZE, search || undefined)
            if (append && tagDataRef.current) {
                const current = tagDataRef.current
                const merged = [...current.groups]
                for (const newGroup of result.groups) {
                    const existing = merged.find((g) => g.type === newGroup.type)
                    if (existing) {
                        existing.tags.push(...newGroup.tags)
                        existing.total = newGroup.total
                    } else {
                        merged.push(newGroup)
                    }
                }
                setTagData({ groups: merged, totalGroups: result.totalGroups })
            } else {
                setTagData(result)
            }
            setCurrentPage(page)
        } catch {
            // ignore
        } finally {
            setLoadingMore(false)
        }
    }, [])

    useEffect(() => {
        if (open) {
            setSearchTerm("")
            setSelectedCategory(null)
            setCurrentPage(1)
            setTagData(null)
            setPendingChanges(new Map())
            setLocalCategories([])
            setCategoryOrder([])
            loadTags(1, "", false)
            // Load category order from library info
            api.getLibraryInfo().then((info) => {
                if (info.categoryOrder) {
                    setCategoryOrder(info.categoryOrder)
                }
            }).catch(() => { })
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open])

    // Reset drag-over highlight when any drag ends (e.g. Escape, drop outside)
    useEffect(() => {
        const onDragEnd = () => {
            dragOverRef.current = undefined
            setDragOverCategory(undefined)
            setDragCatIndex(null)
            setDragOverCatIndex(null)
        }
        window.addEventListener("dragend", onDragEnd)
        return () => window.removeEventListener("dragend", onDragEnd)
    }, [])

    const handleSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const value = e.target.value
        setSearchTerm(value)
        if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
        searchTimerRef.current = setTimeout(() => {
            setCurrentPage(1)
            setTagData(null)
            loadTags(1, value, false)
        }, 300)
    }, [loadTags])

    const handleShowMore = useCallback(() => {
        loadTags(currentPage + 1, searchTerm, true)
    }, [loadTags, currentPage, searchTerm])

    const toggleTag = useCallback((value: string) => {
        if (selectedTags.includes(value)) {
            onTagsChange(selectedTags.filter((t) => t !== value))
        } else {
            onTagsChange([...selectedTags, value])
        }
    }, [selectedTags, onTagsChange])

    const handleClear = useCallback(() => {
        onTagsChange([])
    }, [onTagsChange])

    // Create category dialog handlers
    const handleOpenCreateDialog = useCallback(() => {
        setCreateCategoryName("")
        setSelectedCreateTags(new Set())
        setCreateDialogOpen(true)
    }, [])

    const handleCreateCategory = useCallback(() => {
        const name = createCategoryName.trim()
        if (!name || selectedCreateTags.size === 0) return
        setLocalCategories((prev) => [...prev, name])
        // Also add pending changes for each selected tag
        setPendingChanges((prev) => {
            const next = new Map(prev)
            const tags = Array.from(selectedCreateTags)
            for (const tagValue of tags) {
                next.set(tagValue, name)
            }
            return next
        })
        // Update local tagData to reflect the categorization immediately
        setTagData((prev) => {
            if (!prev) return prev
            const tags = Array.from(selectedCreateTags)
            const groups = prev.groups.map((g) => ({
                ...g,
                tags: g.tags.filter((t) => !tags.includes(t.value)),
            }))
            const newTags = tags.map((value) => ({ value, count: 1 }))
            const existingDest = groups.find((g) => g.type === name)
            if (existingDest) {
                existingDest.tags.push(...newTags)
            } else {
                groups.push({ type: name, total: newTags.length, tags: newTags })
            }
            return { ...prev, groups: groups.filter((g) => g.tags.length > 0 || g.type !== null) }
        })
        setCreateDialogOpen(false)
        setCreateCategoryName("")
        setSelectedCreateTags(new Set())
    }, [createCategoryName, selectedCreateTags])

    const handleToggleCreateTag = useCallback((tagValue: string) => {
        setSelectedCreateTags((prev) => {
            const next = new Set(prev)
            if (next.has(tagValue)) next.delete(tagValue)
            else next.add(tagValue)
            return next
        })
    }, [])

    // Drag handlers — use ref to avoid lag from excessive re-renders on every dragOver event
    const handleTagDragStart = useCallback((e: React.DragEvent, tagValue: string, currentType: string | null) => {
        e.dataTransfer.setData("text/plain", tagValue)
        e.dataTransfer.setData("application/x-type", currentType ?? "")
        // Reset drag-over state from any previous drag
        dragOverRef.current = undefined
        setDragOverCategory(undefined)
    }, [])

    // Category reorder drag handlers
    const handleCatDragStart = useCallback((e: React.DragEvent, index: number) => {
        e.dataTransfer.effectAllowed = "move"
        e.dataTransfer.setData("application/x-cat-index", String(index))
        setDragCatIndex(index)
    }, [])

    const handleCategoryDragLeave = useCallback(() => {
        dragOverRef.current = undefined
        setDragOverCategory(undefined)
        setDragOverCatIndex(null)
    }, [])

    // Look up a tag entry from original data or from the rendered state
    const findTagEntry = (value: string): { value: string; count: number } | null => {
        for (const g of tagDataRef.current?.groups ?? []) {
            const found = g.tags.find((t) => t.value === value)
            if (found) return found
        }
        return null
    }

    const applyPendingChanges = useCallback(async () => {
        if (!hasChanges) return
        setSaving(true)
        try {
            // 1. Apply category renames — convert to array first to avoid iterator issues
            const renameEntries: [string, string][] = []
            pendingCategoryRenames.forEach((v, k) => renameEntries.push([k, v]))
            for (let i = 0; i < renameEntries.length; i++) {
                await api.renameCategory(renameEntries[i][0], renameEntries[i][1])
            }
            // 2. Apply category deletes
            const deleteEntries: string[] = []
            pendingCategoryDeletes.forEach((v) => deleteEntries.push(v))
            for (let i = 0; i < deleteEntries.length; i++) {
                await api.deleteCategory(deleteEntries[i])
            }
            // 3. Apply individual tag categorization changes
            if (pendingChanges.size > 0) {
                const changes = Array.from(pendingChanges.entries()).map(([tagValue, newType]) => ({
                    tagValue,
                    newType,
                }))
                await api.categorizeTags(changes)
            }

            // 4. Update category order: replace renamed categories, remove deleted ones
            let updatedOrder = [...categoryOrder]
            for (const [oldName, newName] of renameEntries) {
                const idx = updatedOrder.indexOf(oldName)
                if (idx >= 0) {
                    updatedOrder[idx] = newName
                }
            }
            updatedOrder = updatedOrder.filter((name) => !pendingCategoryDeletes.has(name))
            if (updatedOrder.length > 0) {
                await api.saveCategoryOrder(updatedOrder)
            }
            setCategoryOrder(updatedOrder)

            setPendingChanges(new Map())
            setPendingCategoryRenames(new Map())
            setPendingCategoryDeletes(new Set())

            setOpen(false)
            onCategorizeSave?.()
        } catch {
            // Close dialog on error too so the user isn't stuck
            setOpen(false)
        } finally {
            setSaving(false)
        }
    }, [hasChanges, pendingChanges, pendingCategoryRenames, pendingCategoryDeletes, categoryOrder, onCategorizeSave])

    const resetPendingChanges = useCallback(() => {
        setPendingChanges(new Map())
        setPendingCategoryRenames(new Map())
        setPendingCategoryDeletes(new Set())
        // Reload tags to reset local state
        setTagData(null)
        loadTags(1, searchTerm, false)
    }, [loadTags, searchTerm])

    // Derive categories from tagData + localCategories
    const serverCategories = useMemo(() => tagData?.groups
        .filter((g) => g.type !== null)
        .map((g) => g.type!) ?? [], [tagData])
    const allCategories = useMemo(() => {
        const cats = Array.from(new Set([...serverCategories, ...localCategories]))
        // Sort by categoryOrder if available
        if (categoryOrder.length > 0) {
            const orderIndex = new Map(categoryOrder.map((name, idx) => [name, idx]))
            return [...cats].sort((a, b) => {
                const ai = orderIndex.get(a) ?? Number.MAX_SAFE_INTEGER
                const bi = orderIndex.get(b) ?? Number.MAX_SAFE_INTEGER
                return ai - bi
            })
        }
        return cats
    }, [serverCategories, localCategories, categoryOrder])

    // ── Category drag-over/drop handlers (must be after allCategories) ──

    const handleCategoryDragOver = useCallback((e: React.DragEvent, cat: string | null) => {
        e.preventDefault()
        if (e.dataTransfer.types.includes("application/x-cat-index")) {
            // Category reorder
            const idx = allCategories.indexOf(cat ?? "")
            if (idx >= 0) setDragOverCatIndex(idx)
            return
        }
        // Tag drop
        if (dragOverRef.current === cat) return
        dragOverRef.current = cat
        setDragOverCategory(cat)
    }, [allCategories])

    const handleCategoryDrop = useCallback((e: React.DragEvent, newType: string | null) => {
        e.preventDefault()
        // Check if this is a category reorder
        const catIndexStr = e.dataTransfer.getData("application/x-cat-index")
        // Always clear drag indices first
        setDragCatIndex(null)
        setDragOverCatIndex(null)

        if (catIndexStr) {
            const dragIndex = parseInt(catIndexStr, 10)
            const dropIndex = newType ? allCategories.indexOf(newType) : -1
            if (!isNaN(dragIndex) && dropIndex >= 0 && dragIndex !== dropIndex) {
                const newOrder = [...allCategories]
                const [moved] = newOrder.splice(dragIndex, 1)
                newOrder.splice(dropIndex, 0, moved)
                setCategoryOrder(newOrder)
                api.saveCategoryOrder(newOrder).catch(() => { })
                // Re-sort the tag groups to match the new order immediately
                setTagData((prev) => {
                    if (!prev) return prev
                    const orderIndex = new Map(newOrder.map((name, idx) => [name, idx]))
                    const sorted = [...prev.groups].sort((a, b) => {
                        if (a.type === null && b.type === null) return 0
                        if (a.type === null) return 1
                        if (b.type === null) return -1
                        const ai = orderIndex.get(a.type) ?? Number.MAX_SAFE_INTEGER
                        const bi = orderIndex.get(b.type) ?? Number.MAX_SAFE_INTEGER
                        return ai - bi
                    })
                    return { ...prev, groups: sorted }
                })
            }
            return
        }
        // Clear drag-over highlight
        dragOverRef.current = undefined
        setDragOverCategory(undefined)
        const tagValue = e.dataTransfer.getData("text/plain")
        if (!tagValue) return

        setPendingChanges((prev) => {
            const next = new Map(prev)
            next.set(tagValue, newType)
            return next
        })

        // Update local tagData to reflect the change immediately
        setTagData((prev) => {
            if (!prev) return prev
            const groups = prev.groups.map((g) => ({
                ...g,
                tags: g.tags.filter((t) => t.value !== tagValue),
            }))
            // Find or create destination group
            const destKey = newType ?? "__untagged"
            const existingDest = groups.find((g) => (g.type ?? "__untagged") === destKey)
            const tagEntry = findTagEntry(tagValue)
            if (tagEntry) {
                if (existingDest) {
                    if (!existingDest.tags.find((t) => t.value === tagValue)) {
                        existingDest.tags.push(tagEntry)
                    }
                } else {
                    groups.push({
                        type: newType,
                        total: 1,
                        tags: [tagEntry],
                    })
                }
            }
            return { ...prev, groups: groups.filter((g) => g.tags.length > 0 || g.type !== null) }
        })
    }, [allCategories])

    // Filter groups by selected category; null = show all groups
    const filteredGroups = useMemo(() => selectedCategory === null
        ? (tagData?.groups ?? [])
        : (tagData?.groups ?? []).filter((g) => g.type === selectedCategory),
        [tagData, selectedCategory])

    // Compute if there are more tags to load across all filtered groups
    const hasMoreInFiltered = useMemo(() =>
        filteredGroups.some((g) => g.tags.length < g.total),
        [filteredGroups])

    // ---- Category rename/delete handlers ----

    const handleCatRename = useCallback(() => {
        const newType = catRenameNewType.trim()
        if (!newType || newType === catRenameOldType) return
        // Remove from pending deletes if it was there
        setPendingCategoryDeletes((prev) => {
            const next = new Set(prev)
            next.delete(catRenameOldType)
            return next
        })
        // Also remove any previous rename of this category
        setPendingCategoryRenames((prev) => {
            const next = new Map(prev)
            next.set(catRenameOldType, newType)
            return next
        })
        // Update local tagData immediately for visual feedback
        setTagData((prev) => {
            if (!prev) return prev
            return {
                ...prev,
                groups: prev.groups.map((g) => {
                    if (g.type === catRenameOldType) {
                        return { ...g, type: newType }
                    }
                    return g
                }),
            }
        })
        setCatRenameOpen(false)
    }, [catRenameNewType, catRenameOldType])

    const handleCatDelete = useCallback(() => {
        // If there's a pending rename for this category, cancel it
        setPendingCategoryRenames((prev) => {
            const next = new Map(prev)
            next.delete(catDeleteType)
            return next
        })
        setPendingCategoryDeletes((prev) => {
            const next = new Set(prev)
            next.add(catDeleteType)
            return next
        })
        // Update local tagData immediately: move all tags from this category to uncategorized
        setTagData((prev) => {
            if (!prev) return prev
            const deletedTags: { value: string; count: number }[] = []
            const groups = prev.groups.filter((g) => {
                if (g.type === catDeleteType) {
                    deletedTags.push(...g.tags)
                    return false
                }
                return true
            })
            // Add deleted tags to uncategorized
            const uncatGroup = groups.find((g) => g.type === null)
            if (uncatGroup) {
                uncatGroup.tags.push(...deletedTags)
                uncatGroup.total += deletedTags.length
            } else if (deletedTags.length > 0) {
                groups.push({ type: null, total: deletedTags.length, tags: deletedTags })
            }
            return { ...prev, groups }
        })
        setCatDeleteOpen(false)
        setSelectedCategory(null)
    }, [catDeleteType])

    // ── Stable category callbacks for CategoryListItem ──

    const handleSelectCategory = useCallback((cat: string) => {
        setSelectedCategory(cat)
    }, [])

    const handleCategoryMouseEnter = useCallback((cat: string) => {
        setCatHovered(cat)
    }, [])

    const handleCategoryMouseLeave = useCallback(() => {
        setCatHovered(null)
    }, [])

    const handleCategoryRename = useCallback((cat: string) => {
        setCatRenameOldType(cat)
        setCatRenameNewType(cat)
        setCatRenameOpen(true)
    }, [])

    const handleCategoryDelete = useCallback((cat: string) => {
        setCatDeleteType(cat)
        setCatDeleteOpen(true)
    }, [])

    // ── Rename/Delete tag handlers (immediate with confirm) ──

    const handleRenameTagSelect = useCallback((tagValue: string) => {
        setSelectedRenameTag((prev) => {
            if (prev.has(tagValue)) {
                return new Set()
            }
            return new Set([tagValue])
        })
    }, [])

    const handleConfirmRename = useCallback(async () => {
        const oldValue = Array.from(selectedRenameTag)[0]
        const newValue = renameTagNewValue.trim()
        if (!oldValue || !newValue) return
        setRenameTagSaving(true)
        try {
            await api.renameTag(oldValue, newValue)
            toaster.create({ title: `Tag "${oldValue}" renamed to "${newValue}"`, type: "success" })
            setConfirmRenameOpen(false)
            setRenameTagDialogOpen(false)
            setSelectedRenameTag(new Set())
            setRenameTagNewValue("")
            loadTags(1, searchTerm, false)
        } catch {
            toaster.create({ title: "Failed to rename tag", type: "error" })
        } finally {
            setRenameTagSaving(false)
        }
    }, [selectedRenameTag, renameTagNewValue, loadTags, searchTerm, toaster])

    const handleDeleteTagToggle = useCallback((tagValue: string) => {
        setSelectedDeleteTags((prev) => {
            const next = new Set(prev)
            if (next.has(tagValue)) next.delete(tagValue)
            else next.add(tagValue)
            return next
        })
    }, [])

    const handleConfirmDeleteTags = useCallback(async () => {
        if (selectedDeleteTags.size === 0) return
        setDeleteTagsSaving(true)
        try {
            const deleted = Array.from(selectedDeleteTags)
            for (const tagValue of deleted) {
                await api.deleteTag(tagValue)
            }
            toaster.create({ title: `Deleted ${deleted.length} tag(s)`, type: "success" })
            setConfirmDeleteOpen(false)
            setDeleteTagsDialogOpen(false)
            setSelectedDeleteTags(new Set())
            loadTags(1, searchTerm, false)
        } catch {
            toaster.create({ title: "Failed to delete tags", type: "error" })
        } finally {
            setDeleteTagsSaving(false)
        }
    }, [selectedDeleteTags, loadTags, searchTerm, toaster])

    // Stable callbacks for the "All" item (always passes null as category)
    const handleSelectAll = useCallback(() => setSelectedCategory(null), [])
    const handleAllDragOver = useCallback((e: React.DragEvent) => {
        handleCategoryDragOver(e, null)
    }, [handleCategoryDragOver])
    const handleAllDrop = useCallback((e: React.DragEvent) => {
        handleCategoryDrop(e, null)
    }, [handleCategoryDrop])

    // ── Category list items (shared between desktop and mobile) ──

    const allCategoryItems = (
        <>
            <Box
                px="2"
                py="1.5"
                borderRadius="md"
                cursor="pointer"
                bg={dragOverCategory === null
                    ? { base: "blue.100", _dark: "blue.800" }
                    : selectedCategory === null
                        ? { base: "blue.50", _dark: "blue.950" }
                        : { base: "blue.50/30", _dark: "blue.950/20" }}
                _hover={{ bg: { base: "blue.50", _dark: "blue.950" } }}
                onClick={handleSelectAll}
                onDragOver={handleAllDragOver}
                onDragLeave={handleCategoryDragLeave}
                onDrop={handleAllDrop}
            >
                <Text
                    fontSize="sm"
                    fontWeight="semibold"
                    color={{ _light: "blue.700", _dark: "blue.300" }}
                >
                    All
                </Text>
            </Box>
            {allCategories.map((cat, index) => (
                <CategoryListItem
                    key={cat}
                    cat={cat}
                    index={index}
                    isSelected={selectedCategory === cat}
                    isDragOverCat={dragOverCatIndex === index}
                    isDragOverTag={dragOverCategory === cat}
                    isDragging={dragCatIndex === index}
                    isHovered={catHovered === cat}
                    pendingRenameTarget={pendingCategoryRenames.get(cat) ?? null}
                    isPendingDelete={pendingCategoryDeletes.has(cat)}
                    onSelect={handleSelectCategory}
                    onDragStart={handleCatDragStart}
                    onDragOver={handleCategoryDragOver}
                    onDragLeave={handleCategoryDragLeave}
                    onDrop={handleCategoryDrop}
                    onMouseEnter={handleCategoryMouseEnter}
                    onMouseLeave={handleCategoryMouseLeave}
                    onRename={handleCategoryRename}
                    onDelete={handleCategoryDelete}
                />
            ))}
            {/* Add category button — opens create dialog */}
            <Box
                px="2"
                py="1"
                cursor="pointer"
                _hover={{ bg: "bg.subtle" }}
                onClick={handleOpenCreateDialog}
                borderRadius="md"
            >
                <HStack gap="1" color="fg.subtle">
                    <PlusIcon />
                    <Text fontSize="xs">Add</Text>
                </HStack>
            </Box>
            {/* Edit tags button — opens edit tag options */}
            <Menu.Root open={editTagMenuOpen} onOpenChange={(e: { open: boolean }) => setEditTagMenuOpen(e.open)}>
                <Menu.Trigger asChild>
                    <Box
                        px="2"
                        py="1"
                        cursor="pointer"
                        _hover={{ bg: "bg.subtle" }}
                        borderRadius="md"
                    >
                        <HStack gap="1" color="fg.subtle">
                            <EditTagIcon />
                            <Text fontSize="xs">Edit tags</Text>
                        </HStack>
                    </Box>
                </Menu.Trigger>
                <Menu.Positioner>
                    <Menu.Content>
                        <Menu.Item value="rename" onClick={() => {
                            setRenameTagDialogOpen(true)
                        }}>
                            Rename Tag
                        </Menu.Item>
                        <Menu.Item value="delete" color="fg.error" onClick={() => {
                            setDeleteTagsDialogOpen(true)
                        }}>
                            Delete Tags
                        </Menu.Item>
                    </Menu.Content>
                </Menu.Positioner>
            </Menu.Root>
        </>
    )

    const categoryList = (
        <Stack gap="0">
            {allCategoryItems}
        </Stack>
    )

    const trigger = (
        <Dialog.Trigger asChild>
            <Button variant="outline" size="sm">
                <FilterIcon />
                <Box as="span" display={{ base: "none", sm: "inline" }} ml="1">Tags</Box>
                {selectedTags.length > 0 && (
                    <Tag.Root size="sm" colorPalette="accent" ml="1">
                        <Tag.Label>{selectedTags.length}</Tag.Label>
                    </Tag.Root>
                )}
            </Button>
        </Dialog.Trigger>
    )

    const searchInput = (
        <Input
            placeholder="Search tags..."
            value={searchTerm}
            onChange={handleSearchChange}
            bg="bg"
            border="1px solid"
            borderColor="border"
            size="sm"
        />
    )

    const footer = (
        <HStack width="full" justify="space-between">
            <Button variant="outline" size="sm" onClick={handleClear} disabled={selectedTags.length === 0}>
                Clear
            </Button>
            <HStack gap="2">
                {hasChanges && (
                    <Button variant="ghost" size="sm" onClick={resetPendingChanges} title="Discard changes" aria-label="Discard pending changes">
                        <UndoIcon />
                    </Button>
                )}
                <Button
                    colorPalette="accent"
                    size="sm"
                    onClick={hasChanges ? applyPendingChanges : () => setOpen(false)}
                    loading={saving}
                >
                    {hasChanges ? "Done & Save" : "Done"}
                </Button>
            </HStack>
        </HStack>
    )

    if (isMobile) {
        return (
            <>
                <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
                    <FilterIcon />
                    <Box as="span" display={{ base: "none", sm: "inline" }} ml="1">Tags</Box>
                    {selectedTags.length > 0 && (
                        <Tag.Root size="sm" colorPalette="accent" ml="1">
                            <Tag.Label>{selectedTags.length}</Tag.Label>
                        </Tag.Root>
                    )}
                </Button>
                <Drawer.Root placement="bottom" open={open} onOpenChange={(e: { open: boolean }) => setOpen(e.open)}>
                    <Portal>
                        <Drawer.Backdrop />
                        <Drawer.Positioner>
                            <Drawer.Content maxH="85vh" borderTopRadius="lg">
                                <Drawer.Header>
                                    <HStack justify="space-between" width="full">
                                        <Drawer.Title>
                                            Filter by Tags
                                            {hasChanges && <Box as="span" color="red" ml="1">*</Box>}
                                        </Drawer.Title>
                                        <Drawer.CloseTrigger asChild>
                                            <Button variant="ghost" size="sm">
                                                <XIcon />
                                            </Button>
                                        </Drawer.CloseTrigger>
                                    </HStack>
                                </Drawer.Header>
                                <Drawer.Body>
                                    <Stack gap="3">
                                        {searchInput}
                                        {/* Categories at top — simple pills, no editing */}
                                        <HStack gap="1" flexWrap="wrap">
                                            <Box
                                                px="2.5"
                                                py="1"
                                                borderRadius="full"
                                                border="1px solid"
                                                borderColor={selectedCategory === null ? "accent.solid" : "border"}
                                                bg={selectedCategory === null ? { base: "blue.50", _dark: "blue.950" } : "transparent"}
                                                cursor="pointer"
                                                onClick={handleSelectAll}
                                                fontSize="sm"
                                                fontWeight={selectedCategory === null ? "semibold" : "normal"}
                                                color={selectedCategory === null ? { _light: "blue.700", _dark: "blue.300" } : "fg"}
                                            >
                                                All
                                            </Box>
                                            {allCategories.map((cat) => (
                                                <Box
                                                    key={cat}
                                                    px="2.5"
                                                    py="1"
                                                    borderRadius="full"
                                                    border="1px solid"
                                                    borderColor={selectedCategory === cat ? "accent.solid" : "border"}
                                                    bg={selectedCategory === cat ? { base: "blue.50", _dark: "blue.950" } : "transparent"}
                                                    cursor="pointer"
                                                    onClick={() => handleSelectCategory(cat)}
                                                    fontSize="sm"
                                                    fontWeight={selectedCategory === cat ? "semibold" : "normal"}
                                                    color={selectedCategory === cat ? { _light: "blue.700", _dark: "blue.300" } : "fg"}
                                                >
                                                    {cat}
                                                </Box>
                                            ))}
                                        </HStack>
                                        {/* Tags below */}
                                        <TagsPanel
                                            filteredGroups={filteredGroups}
                                            selectedTags={selectedTags}
                                            hasMoreInFiltered={hasMoreInFiltered}
                                            loadingMore={loadingMore}
                                            isEmpty={!tagData || filteredGroups.length === 0}
                                            onToggleTag={toggleTag}
                                            onShowMore={handleShowMore}
                                            onTagDragStart={handleTagDragStart}
                                        />
                                    </Stack>
                                </Drawer.Body>
                                <Drawer.Footer>
                                    {footer}
                                </Drawer.Footer>
                            </Drawer.Content>
                        </Drawer.Positioner>
                    </Portal>
                </Drawer.Root>
            </>
        )
    }

    return (
        <Dialog.Root open={open} onOpenChange={(e: { open: boolean }) => setOpen(e.open)}>
            {trigger}
            <Portal>
                <Dialog.Backdrop />
                <Dialog.Positioner>
                    <Dialog.Content maxW="800px" maxH="90vh">
                        <Dialog.Header>
                            <HStack justify="space-between" width="full">
                                <Dialog.Title>
                                    Filter by Tags
                                    {hasChanges && <Box as="span" color="red" ml="1">*</Box>}
                                </Dialog.Title>
                                <Dialog.CloseTrigger asChild>
                                    <Button variant="ghost" size="sm">
                                        <XIcon />
                                    </Button>
                                </Dialog.CloseTrigger>
                            </HStack>
                        </Dialog.Header>
                        <Dialog.Body>
                            <Stack gap="4">
                                {searchInput}

                                {/* Two-column layout */}
                                <HStack gap="4" align="flex-start">
                                    {/* Left: Category panel */}
                                    <Box
                                        width="160px"
                                        minWidth="140px"
                                        flexShrink="0"
                                        borderRight="1px solid"
                                        borderColor="border"
                                        pr="3"
                                    >
                                        <Text fontWeight="semibold" fontSize="sm" color="fg" mb="3">Categories</Text>
                                        {categoryList}
                                    </Box>

                                    {/* Right: Tags panel — memoized, won't re-render on left-panel hover changes */}
                                    <TagsPanel
                                        filteredGroups={filteredGroups}
                                        selectedTags={selectedTags}
                                        hasMoreInFiltered={hasMoreInFiltered}
                                        loadingMore={loadingMore}
                                        isEmpty={!tagData || filteredGroups.length === 0}
                                        onToggleTag={toggleTag}
                                        onShowMore={handleShowMore}
                                        onTagDragStart={handleTagDragStart}
                                    />
                                </HStack>
                            </Stack>
                        </Dialog.Body>
                        <Dialog.Footer>
                            {footer}
                        </Dialog.Footer>

                        {/* Create Category Dialog */}
                        <Dialog.Root open={createDialogOpen} onOpenChange={(e: { open: boolean }) => setCreateDialogOpen(e.open)}>
                            <Portal>
                                <Dialog.Backdrop />
                                <Dialog.Positioner>
                                    <Dialog.Content maxW="500px">
                                        <Dialog.Header>
                                            <Dialog.Title>Create Category</Dialog.Title>
                                            <Dialog.CloseTrigger asChild>
                                                <Button variant="ghost" size="sm">
                                                    <XIcon />
                                                </Button>
                                            </Dialog.CloseTrigger>
                                        </Dialog.Header>
                                        <Dialog.Body>
                                            <Stack gap="4">
                                                <Box>
                                                    <Text fontWeight="semibold" fontSize="sm" color="fg" mb="2">
                                                        Select tags to add ({selectedCreateTags.size} selected)
                                                    </Text>
                                                    <TagSelector
                                                        showOnlyUncategorized={true}
                                                        multiSelect={true}
                                                        selectedTags={selectedCreateTags}
                                                        onToggleTag={handleToggleCreateTag}
                                                    />
                                                </Box>
                                                <Field.Root>
                                                    <Field.Label>Category name</Field.Label>
                                                    <Input
                                                        placeholder="Category name..."
                                                        value={createCategoryName}
                                                        onChange={(e) => setCreateCategoryName(e.target.value)}
                                                        bg="bg"
                                                        border="1px solid"
                                                        borderColor="border"
                                                        size="sm"
                                                    />
                                                </Field.Root>
                                            </Stack>
                                        </Dialog.Body>
                                        <Dialog.Footer>
                                            <Button variant="outline" size="sm" onClick={() => setCreateDialogOpen(false)}>
                                                Cancel
                                            </Button>
                                            <Button
                                                colorPalette="accent"
                                                size="sm"
                                                onClick={handleCreateCategory}
                                                disabled={!createCategoryName.trim() || selectedCreateTags.size === 0}
                                            >
                                                Create
                                            </Button>
                                        </Dialog.Footer>
                                    </Dialog.Content>
                                </Dialog.Positioner>
                            </Portal>
                        </Dialog.Root>

                        {/* Category Rename Dialog */}
                        <Dialog.Root open={catRenameOpen} onOpenChange={(e: { open: boolean }) => setCatRenameOpen(e.open)}>
                            <Portal>
                                <Dialog.Backdrop />
                                <Dialog.Positioner>
                                    <Dialog.Content>
                                        <Dialog.Header>
                                            <Dialog.Title>Rename Category</Dialog.Title>
                                        </Dialog.Header>
                                        <Dialog.Body>
                                            <Field.Root>
                                                <Field.Label>New category name</Field.Label>
                                                <Input
                                                    value={catRenameNewType}
                                                    onChange={(e) => setCatRenameNewType(e.target.value)}
                                                    size="sm"
                                                    onKeyDown={(e: React.KeyboardEvent) => {
                                                        if (e.key === "Enter") handleCatRename()
                                                    }}
                                                    autoFocus
                                                />
                                            </Field.Root>
                                        </Dialog.Body>
                                        <Dialog.Footer>
                                            <Button variant="outline" onClick={() => setCatRenameOpen(false)}>
                                                Cancel
                                            </Button>
                                            <Button
                                                colorPalette="accent"
                                                disabled={!catRenameNewType.trim() || catRenameNewType.trim() === catRenameOldType}
                                                onClick={handleCatRename}
                                            >
                                                Rename
                                            </Button>
                                        </Dialog.Footer>
                                    </Dialog.Content>
                                </Dialog.Positioner>
                            </Portal>
                        </Dialog.Root>

                        {/* Category Delete Dialog */}
                        <Dialog.Root open={catDeleteOpen} onOpenChange={(e: { open: boolean }) => setCatDeleteOpen(e.open)}>
                            <Portal>
                                <Dialog.Backdrop />
                                <Dialog.Positioner>
                                    <Dialog.Content>
                                        <Dialog.Header>
                                            <Dialog.Title>Delete Category</Dialog.Title>
                                        </Dialog.Header>
                                        <Dialog.Body>
                                            <Text fontSize="sm" color="fg">
                                                Are you sure you want to delete <strong>{catDeleteType}</strong>? All tags in this category will become uncategorized.
                                            </Text>
                                        </Dialog.Body>
                                        <Dialog.Footer>
                                            <Button variant="outline" onClick={() => setCatDeleteOpen(false)}>
                                                Cancel
                                            </Button>
                                            <Button
                                                colorPalette="red"
                                                onClick={handleCatDelete}
                                            >
                                                Delete
                                            </Button>
                                        </Dialog.Footer>
                                    </Dialog.Content>
                                </Dialog.Positioner>
                            </Portal>
                        </Dialog.Root>

                        {/* Edit Tags Menu — replaced the old Dialog */}

                        {/* Rename Tag Dialog */}
                        <Dialog.Root open={renameTagDialogOpen} onOpenChange={(e: { open: boolean }) => setRenameTagDialogOpen(e.open)}>
                            <Portal>
                                <Dialog.Backdrop />
                                <Dialog.Positioner>
                                    <Dialog.Content maxW="450px">
                                        <Dialog.Header>
                                            <Dialog.Title>Rename Tag</Dialog.Title>
                                            <Dialog.CloseTrigger asChild>
                                                <Button variant="ghost" size="sm">
                                                    <XIcon />
                                                </Button>
                                            </Dialog.CloseTrigger>
                                        </Dialog.Header>
                                        <Dialog.Body>
                                            <Stack gap="4">
                                                <Box>
                                                    <Text fontWeight="semibold" fontSize="sm" color="fg" mb="2">
                                                        Select tag to rename
                                                    </Text>
                                                    <TagSelector
                                                        showOnlyUncategorized={false}
                                                        multiSelect={false}
                                                        selectedTags={selectedRenameTag}
                                                        onToggleTag={handleRenameTagSelect}
                                                    />
                                                </Box>
                                                <Field.Root>
                                                    <Field.Label>
                                                        {selectedRenameTag.size > 0
                                                            ? `New name of "${Array.from(selectedRenameTag)[0]}": `
                                                            : "New name: "}
                                                    </Field.Label>
                                                    <Input
                                                        value={renameTagNewValue}
                                                        onChange={(e) => setRenameTagNewValue(e.target.value)}
                                                        bg="bg"
                                                        border="1px solid"
                                                        borderColor="border"
                                                        size="sm"
                                                        placeholder={"Enter new tag name..."}
                                                        onKeyDown={(e: React.KeyboardEvent) => {
                                                            if (e.key === "Enter" && selectedRenameTag.size && renameTagNewValue.trim()) setConfirmRenameOpen(true)
                                                        }}
                                                    />
                                                </Field.Root>
                                            </Stack>
                                        </Dialog.Body>
                                        <Dialog.Footer>
                                            <Button variant="outline" size="sm" onClick={() => {
                                                selectedRenameTag.clear();
                                                setRenameTagDialogOpen(false);
                                            }}>
                                                Cancel
                                            </Button>
                                            <Button
                                                colorPalette="accent"
                                                size="sm"
                                                onClick={() => {
                                                    if (!selectedRenameTag.size || !renameTagNewValue.trim()) return
                                                    setConfirmRenameOpen(true)
                                                }}
                                                disabled={selectedRenameTag.size === 0 || !renameTagNewValue.trim()}
                                            >
                                                Rename
                                            </Button>
                                        </Dialog.Footer>
                                    </Dialog.Content>
                                </Dialog.Positioner>
                            </Portal>
                        </Dialog.Root>

                        {/* Confirm Rename Tag Dialog */}
                        <Dialog.Root open={confirmRenameOpen} onOpenChange={(e: { open: boolean }) => setConfirmRenameOpen(e.open)}>
                            <Portal>
                                <Dialog.Backdrop />
                                <Dialog.Positioner>
                                    <Dialog.Content maxW="400px">
                                        <Dialog.Header>
                                            <Dialog.Title>Confirm Rename</Dialog.Title>
                                        </Dialog.Header>
                                        <Dialog.Body>
                                            <Text fontSize="sm" color="fg">
                                                Rename "{Array.from(selectedRenameTag)[0]}" to "{renameTagNewValue.trim()}"?
                                            </Text>
                                        </Dialog.Body>
                                        <Dialog.Footer>
                                            <Button variant="outline" size="sm" onClick={() => setConfirmRenameOpen(false)}>
                                                Cancel
                                            </Button>
                                            <Button
                                                colorPalette="accent"
                                                size="sm"
                                                onClick={handleConfirmRename}
                                                loading={renameTagSaving}
                                            >
                                                Rename
                                            </Button>
                                        </Dialog.Footer>
                                    </Dialog.Content>
                                </Dialog.Positioner>
                            </Portal>
                        </Dialog.Root>

                        {/* Delete Tags Dialog */}
                        <Dialog.Root open={deleteTagsDialogOpen} onOpenChange={(e: { open: boolean }) => setDeleteTagsDialogOpen(e.open)}>
                            <Portal>
                                <Dialog.Backdrop />
                                <Dialog.Positioner>
                                    <Dialog.Content maxW="450px">
                                        <Dialog.Header>
                                            <Dialog.Title>Delete Tags</Dialog.Title>
                                            <Dialog.CloseTrigger asChild>
                                                <Button variant="ghost" size="sm">
                                                    <XIcon />
                                                </Button>
                                            </Dialog.CloseTrigger>
                                        </Dialog.Header>
                                        <Dialog.Body>
                                            <Stack gap="4">
                                                <Box>
                                                    <Text fontWeight="semibold" fontSize="sm" color="fg" mb="2">
                                                        Select tags to delete
                                                    </Text>
                                                    <TagSelector
                                                        showOnlyUncategorized={false}
                                                        multiSelect={true}
                                                        selectedTags={selectedDeleteTags}
                                                        onToggleTag={handleDeleteTagToggle}
                                                    />
                                                </Box>
                                                <Box>
                                                    <Text fontSize="sm" color="fg.muted" mb="2">
                                                        {selectedDeleteTags.size > 0
                                                            ? `You are going to delete ${selectedDeleteTags.size} tag${selectedDeleteTags.size !== 1 ? "s" : ""}.`
                                                            : "You are going to delete 0 tags."}
                                                    </Text>
                                                </Box>
                                            </Stack>
                                        </Dialog.Body>
                                        <Dialog.Footer>
                                            <Button variant="outline" size="sm" onClick={() => {
                                                selectedDeleteTags.clear();
                                                setDeleteTagsDialogOpen(false);
                                            }}>
                                                Cancel
                                            </Button>
                                            <Button
                                                colorPalette="red"
                                                size="sm"
                                                onClick={() => {
                                                    if (selectedDeleteTags.size === 0) return
                                                    setConfirmDeleteOpen(true)
                                                }}
                                                disabled={selectedDeleteTags.size === 0}
                                            >
                                                Delete
                                            </Button>
                                        </Dialog.Footer>
                                    </Dialog.Content>
                                </Dialog.Positioner>
                            </Portal>
                        </Dialog.Root>

                        {/* Confirm Delete Tags Dialog */}
                        <Dialog.Root open={confirmDeleteOpen} onOpenChange={(e: { open: boolean }) => setConfirmDeleteOpen(e.open)}>
                            <Portal>
                                <Dialog.Backdrop />
                                <Dialog.Positioner>
                                    <Dialog.Content maxW="450px">
                                        <Dialog.Header>
                                            <Dialog.Title>Confirm Delete</Dialog.Title>
                                        </Dialog.Header>
                                        <Dialog.Body>
                                            <Stack gap="3">
                                                <Text fontSize="sm" color="fg">
                                                    You are going to delete {selectedDeleteTags.size} tag{selectedDeleteTags.size !== 1 ? "s" : ""}:
                                                </Text>
                                                <Box maxH="200px" overflowY="auto">
                                                    <HStack gap="2" flexWrap="wrap">
                                                        {Array.from(selectedDeleteTags).map((value) => (
                                                            <TagBadge key={value} value={value} type={null} isSelected />
                                                        ))}
                                                    </HStack>
                                                </Box>
                                                <Text fontSize="sm" color="fg.subtle">
                                                    This action cannot be undone.
                                                </Text>
                                            </Stack>
                                        </Dialog.Body>
                                        <Dialog.Footer>
                                            <Button variant="outline" size="sm" onClick={() => setConfirmDeleteOpen(false)}>
                                                Cancel
                                            </Button>
                                            <Button
                                                colorPalette="red"
                                                size="sm"
                                                onClick={handleConfirmDeleteTags}
                                                loading={deleteTagsSaving}
                                            >
                                                Delete
                                            </Button>
                                        </Dialog.Footer>
                                    </Dialog.Content>
                                </Dialog.Positioner>
                            </Portal>
                        </Dialog.Root>

                    </Dialog.Content>
                </Dialog.Positioner>
            </Portal>
        </Dialog.Root>
    )
}
