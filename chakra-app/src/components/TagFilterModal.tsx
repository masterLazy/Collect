import { useEffect, useRef, useState } from "react"
import {
    Box,
    Button,
    Dialog,
    HStack,
    Input,
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

const PAGE_SIZE = 20

export function TagFilterModal({ selectedTags, onTagsChange }: TagFilterModalProps) {
    const [open, setOpen] = useState(false)
    const [tagData, setTagData] = useState<TagGroupsResponse | null>(null)
    const [searchTerm, setSearchTerm] = useState("")
    const [currentPage, setCurrentPage] = useState(1)
    const [loadingMore, setLoadingMore] = useState(false)
    const searchTimerRef = useRef<ReturnType<typeof setTimeout>>()
    const tagDataRef = useRef<TagGroupsResponse | null>(null)

    // Keep ref in sync
    useEffect(() => {
        tagDataRef.current = tagData
    }, [tagData])

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
            setCurrentPage(1)
            setTagData(null)
            loadTags(1, "", false)
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open])

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

    return (
        <Dialog.Root open={open} onOpenChange={(e: { open: boolean }) => setOpen(e.open)}>
            <Dialog.Trigger asChild>
                <Button variant="outline" size="sm">
                    <FilterIcon />
                    Tags
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
                    <Dialog.Content maxW="520px">
                        <Dialog.Header>
                            <HStack justify="space-between" width="full">
                                <Dialog.Title>Filter by Tags</Dialog.Title>
                                <Dialog.CloseTrigger asChild>
                                    <Button variant="ghost" size="sm">
                                        <XIcon />
                                    </Button>
                                </Dialog.CloseTrigger>
                            </HStack>
                        </Dialog.Header>
                        <Dialog.Body>
                            <Stack gap="4">
                                {/* Search input */}
                                <Input
                                    placeholder="Search tags..."
                                    value={searchTerm}
                                    onChange={handleSearchChange}
                                    bg="bg"
                                    border="1px solid"
                                    borderColor="border"
                                    size="sm"
                                />

                                {tagData?.groups.map((group) => (
                                    <Box key={group.type ?? "__untagged"}>
                                        <Text fontWeight="semibold" fontSize="sm" color="fg" mb="3">
                                            {group.type ?? "Untagged"}
                                        </Text>
                                        <HStack gap="2" flexWrap="wrap">
                                            {group.tags.map((t) => {
                                                const isSelected = selectedTags.includes(t.value)
                                                return (
                                                    <Tag.Root
                                                        key={t.value}
                                                        size="md"
                                                        colorPalette={isSelected ? "accent" : "gray"}
                                                        variant={isSelected ? "solid" : "outline"}
                                                        cursor="pointer"
                                                        onClick={() => toggleTag(t.value)}
                                                        py="1"
                                                    >
                                                        <Tag.Label fontSize="sm" fontWeight="medium">{t.value}</Tag.Label>
                                                        <Text as="span" fontSize="xs" color="fg.subtle" ml="1">
                                                            ({t.count})
                                                        </Text>
                                                    </Tag.Root>
                                                )
                                            })}
                                        </HStack>
                                        {group.tags.length < group.total && (
                                            <Button
                                                variant="ghost"
                                                size="xs"
                                                mt="2"
                                                onClick={handleShowMore}
                                                loading={loadingMore}
                                                colorPalette="accent"
                                            >
                                                Show more ({group.total - group.tags.length} remaining)
                                            </Button>
                                        )}
                                    </Box>
                                ))}
                                {(!tagData || tagData.groups.length === 0) && (
                                    <Text color="fg.muted" fontSize="sm">No tags yet</Text>
                                )}
                            </Stack>
                        </Dialog.Body>
                        <Dialog.Footer>
                            <Button variant="outline" size="sm" onClick={handleClear} disabled={selectedTags.length === 0}>
                                Clear
                            </Button>
                            <Button colorPalette="accent" size="sm" onClick={() => setOpen(false)}>
                                Done
                            </Button>
                        </Dialog.Footer>
                    </Dialog.Content>
                </Dialog.Positioner>
            </Portal>
        </Dialog.Root>
    )
}
