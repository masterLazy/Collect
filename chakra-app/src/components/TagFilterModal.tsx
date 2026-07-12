import { useEffect, useMemo, useRef, useState } from "react"
import {
    Box,
    Button,
    Dialog,
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
import type { TagGroupsResponse } from "../types"

interface TagFilterModalProps {
    selectedTags: string[]
    onTagsChange: (tags: string[]) => void
    onCategorizeSave?: () => void
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

function getTypeColor(type: string): string {
    if (TYPE_COLORS[type]) return TYPE_COLORS[type]
    let hash = 0
    for (let i = 0; i < type.length; i++) {
        hash = ((hash << 5) - hash) + type.charCodeAt(i)
        hash |= 0
    }
    return DEFAULT_COLOR_CYCLE[Math.abs(hash) % DEFAULT_COLOR_CYCLE.length]
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

const PAGE_SIZE = 20

export function TagFilterModal({ selectedTags, onTagsChange, onCategorizeSave }: TagFilterModalProps) {
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
    const [createDialogOpen, setCreateDialogOpen] = useState(false)
    const [createCategoryName, setCreateCategoryName] = useState("")
    const [selectedCreateTags, setSelectedCreateTags] = useState<Set<string>>(new Set())
    const [createTagPage, setCreateTagPage] = useState(0)
    const CREATE_TAG_PAGE_SIZE = 50
    const searchTimerRef = useRef<ReturnType<typeof setTimeout>>()
    const tagDataRef = useRef<TagGroupsResponse | null>(null)
    const dragOverRef = useRef<string | null | undefined>(undefined)

    // Category rename/delete state
    const [catHovered, setCatHovered] = useState<string | null>(null)
    const [catRenameOpen, setCatRenameOpen] = useState(false)
    const [catRenameOldType, setCatRenameOldType] = useState("")
    const [catRenameNewType, setCatRenameNewType] = useState("")
    const [catRenaming, setCatRenaming] = useState(false)
    const [catDeleteOpen, setCatDeleteOpen] = useState(false)
    const [catDeleteType, setCatDeleteType] = useState("")
    const [catDeleting, setCatDeleting] = useState(false)

    // Keep ref in sync
    useEffect(() => {
        tagDataRef.current = tagData
    }, [tagData])

    const hasChanges = pendingChanges.size > 0

    const loadTags = async (page: number, search: string, append: boolean) => {
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
    }

    useEffect(() => {
        if (open) {
            setSearchTerm("")
            setSelectedCategory(null)
            setCurrentPage(1)
            setTagData(null)
            setPendingChanges(new Map())
            setLocalCategories([])
            loadTags(1, "", false)
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open])

    // Reset drag-over highlight when any drag ends (e.g. Escape, drop outside)
    useEffect(() => {
        const onDragEnd = () => {
            dragOverRef.current = undefined
            setDragOverCategory(undefined)
        }
        window.addEventListener("dragend", onDragEnd)
        return () => window.removeEventListener("dragend", onDragEnd)
    }, [])

    const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const value = e.target.value
        setSearchTerm(value)
        if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
        searchTimerRef.current = setTimeout(() => {
            setCurrentPage(1)
            setTagData(null)
            loadTags(1, value, false)
        }, 300)
    }

    const handleShowMore = () => {
        loadTags(currentPage + 1, searchTerm, true)
    }

    const toggleTag = (value: string) => {
        if (selectedTags.includes(value)) {
            onTagsChange(selectedTags.filter((t) => t !== value))
        } else {
            onTagsChange([...selectedTags, value])
        }
    }

    const handleClear = () => {
        onTagsChange([])
    }

    // Create category dialog handlers
    const handleOpenCreateDialog = () => {
        setCreateCategoryName("")
        setSelectedCreateTags(new Set())
        setCreateTagPage(0)
        setCreateDialogOpen(true)
    }

    const handleCreateCategory = () => {
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
    }

    const handleToggleCreateTag = (tagValue: string) => {
        setSelectedCreateTags((prev) => {
            const next = new Set(prev)
            if (next.has(tagValue)) next.delete(tagValue)
            else next.add(tagValue)
            return next
        })
    }

    // Drag handlers — use ref to avoid lag from excessive re-renders on every dragOver event
    const handleTagDragStart = (e: React.DragEvent, tagValue: string, currentType: string | null) => {
        e.dataTransfer.setData("text/plain", tagValue)
        e.dataTransfer.setData("application/x-type", currentType ?? "")
        // Reset drag-over state from any previous drag
        dragOverRef.current = undefined
        setDragOverCategory(undefined)
    }

    const handleCategoryDragOver = (e: React.DragEvent, cat: string | null) => {
        e.preventDefault()
        if (dragOverRef.current === cat) return // skip if same as current — avoids useless re-renders
        dragOverRef.current = cat
        setDragOverCategory(cat)
    }

    const handleCategoryDragLeave = () => {
        dragOverRef.current = undefined
        setDragOverCategory(undefined)
    }

    const handleCategoryDrop = (e: React.DragEvent, newType: string | null) => {
        e.preventDefault()
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
    }

    // Look up a tag entry from original data or from the rendered state
    const findTagEntry = (value: string): { value: string; count: number } | null => {
        for (const g of tagDataRef.current?.groups ?? []) {
            const found = g.tags.find((t) => t.value === value)
            if (found) return found
        }
        return null
    }

    const applyPendingChanges = async () => {
        if (pendingChanges.size === 0) return
        setSaving(true)
        try {
            const changes = Array.from(pendingChanges.entries()).map(([tagValue, newType]) => ({
                tagValue,
                newType,
            }))
            await api.categorizeTags(changes)
            setPendingChanges(new Map())
            setOpen(false)
            onCategorizeSave?.()
        } catch {
            // ignore
        } finally {
            setSaving(false)
        }
    }

    const resetPendingChanges = () => {
        setPendingChanges(new Map())
        // Reload tags to reset local state
        setTagData(null)
        loadTags(1, searchTerm, false)
    }

    // Derive categories from tagData + localCategories
    const serverCategories = useMemo(() => tagData?.groups
        .filter((g) => g.type !== null)
        .map((g) => g.type!) ?? [], [tagData])
    const allCategories = useMemo(() =>
        Array.from(new Set([...serverCategories, ...localCategories])),
        [serverCategories, localCategories])
    const uncategorizedTags = useMemo(() => tagData?.groups
        .find((g) => g.type === null)
        ?.tags ?? [], [tagData])
    const paginatedCreateTags = useMemo(() => (uncategorizedTags ?? []).slice(
        createTagPage * CREATE_TAG_PAGE_SIZE,
        (createTagPage + 1) * CREATE_TAG_PAGE_SIZE
    ), [uncategorizedTags, createTagPage])

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

    const handleCatRename = async () => {
        const newType = catRenameNewType.trim()
        if (!newType || newType === catRenameOldType) return
        setCatRenaming(true)
        try {
            await api.renameCategory(catRenameOldType, newType)
            setCatRenameOpen(false)
            setTagData(null)
            loadTags(1, "", false)
        } catch {
            // silently fail
        } finally {
            setCatRenaming(false)
        }
    }

    const handleCatDelete = async () => {
        setCatDeleting(true)
        try {
            await api.deleteCategory(catDeleteType)
            setCatDeleteOpen(false)
            setSelectedCategory(null)
            setTagData(null)
            loadTags(1, "", false)
        } catch {
            // silently fail
        } finally {
            setCatDeleting(false)
        }
    }

    return (
        <Dialog.Root open={open} onOpenChange={(e: { open: boolean }) => setOpen(e.open)}>
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
                                {/* Search input — full width */}
                                <Input
                                    placeholder="Search tags..."
                                    value={searchTerm}
                                    onChange={handleSearchChange}
                                    bg="bg"
                                    border="1px solid"
                                    borderColor="border"
                                    size="sm"
                                />

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
                                        <Stack gap="0">
                                            {/* "All" — also a drop target to uncategorize */}
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
                                                onClick={() => setSelectedCategory(null)}
                                                onDragOver={(e) => handleCategoryDragOver(e, null)}
                                                onDragLeave={handleCategoryDragLeave}
                                                onDrop={(e) => handleCategoryDrop(e, null)}
                                            >
                                                <Text
                                                    fontSize="sm"
                                                    fontWeight="semibold"
                                                    color={{ _light: "blue.700", _dark: "blue.300" }}
                                                >
                                                    All
                                                </Text>
                                            </Box>
                                            {allCategories.map((cat) => (
                                                <HStack
                                                    key={cat}
                                                    px="2"
                                                    py="1.5"
                                                    borderRadius="md"
                                                    cursor="pointer"
                                                    bg={dragOverCategory === cat
                                                        ? { base: "blue.100", _dark: "blue.800" }
                                                        : selectedCategory === cat
                                                            ? "bg.subtle"
                                                            : "transparent"}
                                                    _hover={{ bg: "bg.subtle" }}
                                                    onClick={() => setSelectedCategory(cat)}
                                                    onDragOver={(e) => handleCategoryDragOver(e, cat)}
                                                    onDragLeave={handleCategoryDragLeave}
                                                    onDrop={(e) => handleCategoryDrop(e, cat)}
                                                    onMouseEnter={() => setCatHovered(cat)}
                                                    onMouseLeave={() => setCatHovered(null)}
                                                    gap="0"
                                                >
                                                    <Text
                                                        fontSize="sm"
                                                        fontWeight={selectedCategory === cat ? "bold" : "normal"}
                                                        color="fg"
                                                        truncate
                                                        flex="1"
                                                    >
                                                        {cat}
                                                    </Text>
                                                    <Menu.Root>
                                                        <Menu.Trigger asChild>
                                                            <Box
                                                                as="button"
                                                                display={catHovered === cat ? "inline-flex" : "none"}
                                                                alignItems="center"
                                                                justifyContent="center"
                                                                width="20px"
                                                                height="20px"
                                                                flexShrink="0"
                                                                borderRadius="sm"
                                                                cursor="pointer"
                                                                _hover={{ bg: { base: "blackAlpha.200", _dark: "whiteAlpha.200" } }}
                                                                onClick={(e: React.MouseEvent) => e.stopPropagation()}
                                                                aria-label="Category options"
                                                                tabIndex={-1}
                                                            >
                                                                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                                                                    <circle cx="5" cy="12" r="1.8" />
                                                                    <circle cx="12" cy="12" r="1.8" />
                                                                    <circle cx="19" cy="12" r="1.8" />
                                                                </svg>
                                                            </Box>
                                                        </Menu.Trigger>
                                                        <Menu.Positioner>
                                                            <Menu.Content minW="120px">
                                                                <Menu.Item
                                                                    value="rename"
                                                                    onClick={(e: React.MouseEvent) => {
                                                                        e.stopPropagation()
                                                                        setCatRenameOldType(cat)
                                                                        setCatRenameNewType(cat)
                                                                        setCatRenameOpen(true)
                                                                    }}
                                                                >
                                                                    Rename
                                                                </Menu.Item>
                                                                <Menu.Item
                                                                    value="delete"
                                                                    color="fg.error"
                                                                    onClick={(e: React.MouseEvent) => {
                                                                        e.stopPropagation()
                                                                        setCatDeleteType(cat)
                                                                        setCatDeleteOpen(true)
                                                                    }}
                                                                >
                                                                    Delete
                                                                </Menu.Item>
                                                            </Menu.Content>
                                                        </Menu.Positioner>
                                                    </Menu.Root>
                                                </HStack>
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
                                        </Stack>
                                    </Box>

                                    {/* Right: Tags panel */}
                                    <Box flex="1" minH="300px" maxH="60vh" overflowY="auto">
                                        {filteredGroups.map((group) => (
                                            <Box key={group.type ?? "__untagged"} mb="4">
                                                <Text fontWeight="semibold" fontSize="sm" color="fg" mb="2">
                                                    {group.type ?? "Uncategorized"}
                                                </Text>
                                                <HStack gap="2" flexWrap="wrap">
                                                    {group.tags.map((t) => {
                                                        const isSelected = selectedTags.includes(t.value)
                                                        const groupColor = group.type ? getTypeColor(group.type) : "gray"
                                                        const colorPalette = isSelected ? "accent" : groupColor
                                                        return (
                                                            <Box
                                                                key={t.value}
                                                                role="group"
                                                                display="inline-flex"
                                                                cursor="pointer"
                                                                onClick={() => toggleTag(t.value)}
                                                                draggable
                                                                onDragStart={(e) => handleTagDragStart(e, t.value, group.type)}
                                                            >
                                                                <Tag.Root
                                                                    size="lg"
                                                                    colorPalette={colorPalette}
                                                                    variant={isSelected ? "solid" : "outline"}
                                                                    borderRadius="full"
                                                                    display="inline-flex"
                                                                    alignItems="center"
                                                                    px="2.5"
                                                                    py="1"
                                                                    opacity={group.type ? 0.75 : 1}
                                                                >
                                                                    <Tag.Label fontSize="sm">{t.value}</Tag.Label>
                                                                    <Text as="span" fontSize="xs" color={isSelected ? "white" : "fg.subtle"} ml="1">
                                                                        ({t.count})
                                                                    </Text>
                                                                </Tag.Root>
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
                                                onClick={handleShowMore}
                                                loading={loadingMore}
                                                colorPalette="accent"
                                            >
                                                Show more
                                            </Button>
                                        )}
                                        {(!tagData || filteredGroups.length === 0) && (
                                            <Text color="fg.muted" fontSize="sm">No tags found</Text>
                                        )}
                                    </Box>
                                </HStack>
                            </Stack>
                        </Dialog.Body>
                        <Dialog.Footer>
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
                                                <Input
                                                    placeholder="Category name..."
                                                    value={createCategoryName}
                                                    onChange={(e) => setCreateCategoryName(e.target.value)}
                                                    bg="bg"
                                                    border="1px solid"
                                                    borderColor="border"
                                                    size="sm"
                                                />
                                                <Box>
                                                    <Text fontWeight="semibold" fontSize="sm" color="fg" mb="2">
                                                        Select tags to add ({selectedCreateTags.size} selected)
                                                    </Text>
                                                    <Box maxH="240px" overflowY="auto">
                                                        <HStack gap="2" flexWrap="wrap">
                                                            {paginatedCreateTags.map((t) => {
                                                                const isSelected = selectedCreateTags.has(t.value)
                                                                return (
                                                                    <Box
                                                                        key={t.value}
                                                                        as="button"
                                                                        px="2.5"
                                                                        py="1"
                                                                        borderRadius="full"
                                                                        border="1px solid"
                                                                        borderColor={isSelected ? "accent.solid" : "border"}
                                                                        bg={isSelected ? { base: "blue.50", _dark: "blue.950" } : "transparent"}
                                                                        cursor="pointer"
                                                                        onClick={() => handleToggleCreateTag(t.value)}
                                                                        fontSize="sm"
                                                                        _hover={{ borderColor: "accent.solid" }}
                                                                    >
                                                                        {t.value}
                                                                    </Box>
                                                                )
                                                            })}
                                                            {uncategorizedTags.length === 0 && (
                                                                <Text color="fg.muted" fontSize="sm">No uncategorized tags available</Text>
                                                            )}
                                                        </HStack>
                                                    </Box>
                                                    {uncategorizedTags.length > CREATE_TAG_PAGE_SIZE && (
                                                        <HStack gap="2" mt="2" justify="center">
                                                            <Button
                                                                size="2xs"
                                                                variant="ghost"
                                                                disabled={createTagPage === 0}
                                                                onClick={() => setCreateTagPage((p) => Math.max(0, p - 1))}
                                                            >
                                                                Previous
                                                            </Button>
                                                            <Text fontSize="xs" color="fg.muted">
                                                                {createTagPage * CREATE_TAG_PAGE_SIZE + 1}–{Math.min((createTagPage + 1) * CREATE_TAG_PAGE_SIZE, uncategorizedTags.length)} of {uncategorizedTags.length}
                                                            </Text>
                                                            <Button
                                                                size="2xs"
                                                                variant="ghost"
                                                                disabled={(createTagPage + 1) * CREATE_TAG_PAGE_SIZE >= uncategorizedTags.length}
                                                                onClick={() => setCreateTagPage((p) => p + 1)}
                                                            >
                                                                Next
                                                            </Button>
                                                        </HStack>
                                                    )}
                                                </Box>
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
                                                loading={catRenaming}
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
                                                loading={catDeleting}
                                                onClick={handleCatDelete}
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
