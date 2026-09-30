import { useEffect, useMemo, useRef, useState } from "react"
import { Box, Button, Center, HStack, Image, Skeleton, Spinner, Stack, Text, VStack } from "@chakra-ui/react"
import { api, API_BASE } from "../services/api"
import type { TagExploreItemDto, TagExploreResponse } from "../types"

interface TagExploreProps {
    libraryId: string
    /** Mirrors the top bar search box; filters tags by value. */
    searchQuery?: string
    onSelectTag: (value: string) => void
}

function CompassIcon() {
    return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="9" />
            <polygon points="15.5 8.5 10.5 10.5 8.5 15.5 13.5 13.5" />
        </svg>
    )
}

function ShuffleIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="16 3 21 3 21 8" />
            <line x1="4" y1="20" x2="21" y2="3" />
            <polyline points="21 16 21 21 16 21" />
            <line x1="15" y1="15" x2="21" y2="21" />
            <line x1="4" y1="4" x2="9" y2="9" />
        </svg>
    )
}

/**
 * Tile thumbnail. Native lazy loading keeps the first paint light — a thumbnail
 * that was never requested before is generated on demand and can take a moment.
 */
function TagThumbnail({ url, alt }: { url: string; alt: string }) {
    const [loaded, setLoaded] = useState(false)
    const [failed, setFailed] = useState(false)
    const imgRef = useRef<HTMLImageElement>(null)

    // A cached image can complete before React attaches onLoad, which would
    // otherwise leave the tile hidden forever.
    useEffect(() => {
        const el = imgRef.current
        if (el && el.complete && el.naturalWidth > 0) setLoaded(true)
    }, [url])

    if (failed) {
        return (
            <Center position="absolute" inset="0" color="fg.subtle">
                <Text fontSize="xs">No preview</Text>
            </Center>
        )
    }

    return (
        <>
            {!loaded && <Skeleton position="absolute" inset="0" />}
            <Image
                ref={imgRef}
                src={API_BASE + url}
                alt={alt}
                width="full"
                height="full"
                objectFit="cover"
                loading="lazy"
                decoding="async"
                opacity={loaded ? 1 : 0}
                transition="opacity 0.3s"
                onLoad={() => setLoaded(true)}
                onError={() => { setLoaded(true); setFailed(true) }}
            />
        </>
    )
}

function TagTile({ tag, onSelect }: { tag: TagExploreItemDto; onSelect: () => void }) {
    return (
        <Box
            as="button"
            onClick={onSelect}
            position="relative"
            aspectRatio="1"
            overflow="hidden"
            borderRadius="md"
            border="1px solid"
            borderColor="border"
            bg="bg.subtle"
            cursor="pointer"
            transition="all 0.15s"
            _hover={{ transform: "translateY(-2px)", shadow: "md" }}
            _focusVisible={{ outline: "2px solid", outlineColor: "border.emphasized", outlineOffset: "2px" }}
            title={tag.value + " · " + tag.count + " asset" + (tag.count === 1 ? "" : "s")}
            aria-label={"Filter by " + tag.value}
        >
            <TagThumbnail url={tag.thumbnailUrl} alt={tag.value} />

            {/* Usage count */}
            <Box position="absolute" top="1.5" right="1.5" bg="black/60" color="white" borderRadius="sm" px="2" py="1">
                <Text fontSize="xs" lineHeight="1.2">{tag.count}</Text>
            </Box>

            {/* Tag value */}
            <Box position="absolute" left="0" right="0" bottom="0" bg="black/65" px="2.5" py="1.5">
                <Text fontSize="sm" color="white" truncate>{tag.value}</Text>
            </Box>
        </Box>
    )
}

/**
 * Explore view: every tag in the library with a randomly sampled image, grouped
 * by category. Clicking a tile filters the gallery by that tag.
 */
export function TagExplore({ libraryId, searchQuery = "", onSelectTag }: TagExploreProps) {
    const [data, setData] = useState<TagExploreResponse | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState(false)
    const [reloadKey, setReloadKey] = useState(0)
    const [debouncedSearch, setDebouncedSearch] = useState(searchQuery)

    // Debounce so typing in the top bar searches tags instead of firing per keystroke.
    useEffect(() => {
        const timer = setTimeout(() => setDebouncedSearch(searchQuery), 300)
        return () => clearTimeout(timer)
    }, [searchQuery])

    // A `tags:` query is a gallery filter, not a tag-name search — ignore it here.
    const tagSearch = debouncedSearch.startsWith("tags:") ? "" : debouncedSearch

    useEffect(() => {
        let cancelled = false
        setLoading(true)
        setError(false)
        api.getTagExplore(libraryId, 400, tagSearch || undefined)
            .then((res) => { if (!cancelled) setData(res) })
            .catch(() => { if (!cancelled) setError(true) })
            .finally(() => { if (!cancelled) setLoading(false) })
        return () => { cancelled = true }
    }, [libraryId, tagSearch, reloadKey])

    const groups = useMemo(
        () => (data?.groups ?? []).filter((group) => group.tags.length > 0),
        [data]
    )
    const shownTags = groups.reduce((sum, group) => sum + group.tags.length, 0)

    return (
        <Stack gap="6">
            {/* Header */}
            <HStack justify="space-between" align="center" gap="3" flexWrap="wrap">
                <Stack gap="0.5">
                    <HStack gap="2" align="center" color="fg">
                        <CompassIcon />
                        <Text fontSize="xl" fontWeight="semibold">Explore</Text>
                    </HStack>
                    <Text fontSize="sm" color="fg.subtle">
                        {data
                            ? `${data.totalTags} tag${data.totalTags === 1 ? "" : "s"} · one random image per tag`
                            : "Every tag with a random image from it"}
                        {tagSearch ? ` · matching “${tagSearch}”` : ""}
                    </Text>
                </Stack>
                <Button size="sm" variant="outline" onClick={() => setReloadKey((k) => k + 1)} loading={loading}>
                    <ShuffleIcon />
                    <Box as="span" ml="1">Shuffle</Box>
                </Button>
            </HStack>

            {error ? (
                <Center py="16">
                    <VStack gap="3">
                        <Text fontSize="sm" color="fg.muted">Could not load tags.</Text>
                        <Button size="sm" variant="outline" onClick={() => setReloadKey((k) => k + 1)}>Retry</Button>
                    </VStack>
                </Center>
            ) : loading && !data ? (
                <Center py="16">
                    <VStack gap="3">
                        <Spinner size="lg" />
                        <Text fontSize="sm" color="fg.muted">Loading tags…</Text>
                    </VStack>
                </Center>
            ) : groups.length === 0 ? (
                <Center py="16">
                    <Text fontSize="sm" color="fg.muted">
                        {tagSearch ? `No tags match “${tagSearch}”.` : "No tags in this library yet."}
                    </Text>
                </Center>
            ) : (
                <>
                    {data?.truncated && (
                        <Text fontSize="xs" color="fg.subtle" mt="-3">
                            Showing the {shownTags} most used of {data.totalTags} tags.
                        </Text>
                    )}
                    {groups.map((group) => (
                        <Stack key={group.type ?? "__uncategorized"} gap="3">
                            <HStack gap="2" align="center">
                                <Text fontSize="md" fontWeight="semibold" color="fg">
                                    {group.type ?? "Uncategorized"}
                                </Text>
                                <Text fontSize="sm" color="fg.subtle">{group.tags.length}</Text>
                                <Box flex="1" height="1px" bg="border" />
                            </HStack>
                            <Box
                                display="grid"
                                gridTemplateColumns="repeat(auto-fill, minmax(184px, 1fr))"
                                gap="3"
                            >
                                {group.tags.map((tag) => (
                                    <TagTile
                                        key={(group.type ?? "") + ":" + tag.value}
                                        tag={tag}
                                        onSelect={() => onSelectTag(tag.value)}
                                    />
                                ))}
                            </Box>
                        </Stack>
                    ))}
                </>
            )}
        </Stack>
    )
}
