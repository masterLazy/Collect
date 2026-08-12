import { useEffect, useMemo, useRef, useState } from "react"
import { Box, Center, Spinner, Text, VStack } from "@chakra-ui/react"
import { AssetCard } from "./AssetCard"
import type { AssetDto } from "../types"
import { API_BASE } from "../services/api"

function EmptyIcon() {
    return (
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <polyline points="21 15 16 10 5 21" />
        </svg>
    )
}

interface MasonryGridProps {
    assets: AssetDto[]
    loading: boolean
    hasMore: boolean
    onLoadMore: () => void
    onSelectAsset: (id: string) => void
    currentFolder: string
    searchQuery: string
    removedAssetIds?: Map<string, 'deleted' | 'moved'>
    scrollToAssetId?: string | null
    onScrollTargetHandled?: () => void
}

// Column width adaptation.
// The target column width scales smoothly between 160px (small screens) and
// 280px (wide screens), linearly interpolated across the container width. This
// keeps the column count a monotonic (never decreasing while widening) function
// of width — the old discrete breakpoints made the grid drop from 3 back to 2
// columns when crossing a breakpoint during a resize.
const MIN_COL_WIDTH = 160
const MAX_COL_WIDTH = 280
const NARROW_WIDTH = 480
const WIDE_WIDTH = 1400

function getGap(containerWidth: number): number {
    if (containerWidth <= NARROW_WIDTH) return 8
    if (containerWidth >= WIDE_WIDTH) return 16
    const t = (containerWidth - NARROW_WIDTH) / (WIDE_WIDTH - NARROW_WIDTH)
    return 8 + t * (16 - 8)
}

function getTargetColumnWidth(containerWidth: number): number {
    if (containerWidth <= NARROW_WIDTH) return MIN_COL_WIDTH
    if (containerWidth >= WIDE_WIDTH) return MAX_COL_WIDTH
    const t = (containerWidth - NARROW_WIDTH) / (WIDE_WIDTH - NARROW_WIDTH)
    return MIN_COL_WIDTH + t * (MAX_COL_WIDTH - MIN_COL_WIDTH)
}

function computeColumnCount(containerWidth: number, gap: number, targetColumnWidth: number): number {
    if (containerWidth <= 0) return 1
    return Math.max(1, Math.floor((containerWidth + gap) / (targetColumnWidth + gap)))
}

// Flex columns stretch to fill the row, so the true rendered width per column
// differs from the target. Use the real width for height estimation.
function getActualColumnWidth(containerWidth: number, columnCount: number, gap: number): number {
    if (containerWidth <= 0) return MIN_COL_WIDTH
    return Math.max(1, (containerWidth - (columnCount - 1) * gap) / columnCount)
}

function distributeToColumns(items: AssetDto[], columnCount: number, columnWidth: number): AssetDto[][] {
    const columns: AssetDto[][] = Array.from({ length: columnCount }, () => [])
    const colHeights = new Array(columnCount).fill(0)
    items.forEach((item) => {
        // Estimate card height from aspect ratio (includes the gap below)
        const aspectRatio = item.width && item.height ? item.width / item.height : 4 / 3
        const estimatedHeight = columnWidth / aspectRatio
        const minCol = colHeights.indexOf(Math.min(...colHeights))
        columns[minCol].push(item)
        colHeights[minCol] += estimatedHeight
    })
    return columns
}

// Build a custom drag ghost so the browser no longer shows the small handle
// "button" while dragging. Uses a real DOM element (appended to <body>, then
// removed after the drag) rather than a canvas — some browsers render canvas
// drag images blank/transparent. Shows the asset thumbnail as a clean 1:1
// square card that follows the cursor.
function createDragGhost(thumbSrc: string | null): HTMLDivElement | null {
    const ghost = document.createElement("div")
    // Position off-screen but keep it in the DOM so the drag snapshot renders
    ghost.style.position = "fixed"
    ghost.style.top = "-10000px"
    ghost.style.left = "-10000px"
    ghost.style.width = "112px"
    ghost.style.height = "112px"
    ghost.style.borderRadius = "12px"
    ghost.style.overflow = "hidden"
    ghost.style.boxShadow = "0 4px 16px rgba(0,0,0,0.35)"
    ghost.style.background = "#14141c"
    ghost.style.pointerEvents = "none"

    if (thumbSrc) {
        const img = document.createElement("img")
        img.src = thumbSrc
        img.draggable = false
        img.style.position = "absolute"
        img.style.inset = "0"
        img.style.width = "100%"
        img.style.height = "100%"
        img.style.objectFit = "cover"
        ghost.appendChild(img)
    }

    return ghost
}

export function MasonryGrid({ assets, loading, hasMore, onLoadMore, onSelectAsset, currentFolder, searchQuery, removedAssetIds, scrollToAssetId, onScrollTargetHandled }: MasonryGridProps) {
    const sentinelRef = useRef<HTMLDivElement>(null)
    const containerRef = useRef<HTMLDivElement>(null)
    const loadingRef = useRef(loading)
    const hasMoreRef = useRef(hasMore)
    const onLoadMoreRef = useRef(onLoadMore)
    const [showSentinel, setShowSentinel] = useState(false)
    const [containerWidth, setContainerWidth] = useState(0)
    // Deep-link scroll state
    const scrollHandledRef = useRef<string | null>(null)
    const highlightTimersRef = useRef<{ fade?: ReturnType<typeof setTimeout>; clear?: ReturnType<typeof setTimeout> }>({})
    const [highlightId, setHighlightId] = useState<string | null>(null)
    const [highlightVisible, setHighlightVisible] = useState(false)

    // Keep refs in sync without triggering re-renders
    loadingRef.current = loading
    hasMoreRef.current = hasMore
    onLoadMoreRef.current = onLoadMore

    useEffect(() => {
        setShowSentinel(hasMore || loading)
    }, [hasMore, loading])

    // ResizeObserver to track container width for column computation
    useEffect(() => {
        const container = containerRef.current
        if (!container) return

        const observer = new ResizeObserver((entries) => {
            for (const entry of entries) {
                setContainerWidth(entry.contentRect.width)
            }
        })

        observer.observe(container)
        // Initialize width
        setContainerWidth(container.clientWidth)

        return () => observer.disconnect()
    }, [])

    // Observer — runs after every render so it always attaches when sentinel is in the DOM
    useEffect(() => {
        const sentinel = sentinelRef.current
        if (!sentinel) return

        let busy = false

        const observer = new IntersectionObserver(
            (entries) => {
                if (busy) return
                if (entries[0].isIntersecting && hasMoreRef.current && !loadingRef.current) {
                    busy = true
                    onLoadMoreRef.current()
                    // Reset busy flag after a short delay to allow loading to start
                    setTimeout(() => { busy = false }, 300)
                }
            },
            { rootMargin: "400px" }
        )

        observer.observe(sentinel)

        return () => observer.disconnect()
    })

    // Deep-link scroll: when scrollToAssetId refers to a rendered asset, scroll
    // it to the center once (guarded by a ref that resets when the target goes
    // away), flash an accent ring, then notify the parent so the target clears.
    useEffect(() => {
        if (!scrollToAssetId) {
            scrollHandledRef.current = null
            return
        }
        // Already handled for this exact target — keep the highlight alive
        if (scrollHandledRef.current === scrollToAssetId) return
        // Target asset not rendered yet — wait for it (assets changes re-run this)
        if (!assets.some((a) => a.id === scrollToAssetId)) return

        scrollHandledRef.current = scrollToAssetId

        // Replace any timers left over from a previous target
        clearTimeout(highlightTimersRef.current.fade)
        clearTimeout(highlightTimersRef.current.clear)

        document.getElementById(`asset-${scrollToAssetId}`)?.scrollIntoView({ block: "center" })

        setHighlightId(scrollToAssetId)
        setHighlightVisible(true)
        highlightTimersRef.current.fade = setTimeout(() => setHighlightVisible(false), 1500)
        highlightTimersRef.current.clear = setTimeout(() => {
            setHighlightId(null)
            onScrollTargetHandled?.()
        }, 2000)
    }, [scrollToAssetId, assets, onScrollTargetHandled])

    // Clear any pending highlight timers on unmount
    useEffect(() => () => {
        clearTimeout(highlightTimersRef.current.fade)
        clearTimeout(highlightTimersRef.current.clear)
    }, [])

    // Compute column count and distribute assets. The target column width is a
    // smooth function of container width, so the count never drops on widening.
    const gap = useMemo(() => getGap(containerWidth), [containerWidth])
    const targetColumnWidth = useMemo(() => getTargetColumnWidth(containerWidth), [containerWidth])
    const columnCount = useMemo(
        () => computeColumnCount(containerWidth, gap, targetColumnWidth),
        [containerWidth, gap, targetColumnWidth]
    )
    // Actual rendered column width — flex columns stretch to fill the row, so
    // use the true width for height estimation during distribution.
    const columnWidth = useMemo(
        () => getActualColumnWidth(containerWidth, columnCount, gap),
        [containerWidth, columnCount, gap]
    )
    const columns = useMemo(() => distributeToColumns(assets, columnCount, columnWidth), [assets, columnCount, columnWidth])

    // Drag-drop handling for masonry area
    const dragGhostRef = useRef<HTMLDivElement | null>(null)

    const removeDragGhost = () => {
        dragGhostRef.current?.remove()
        dragGhostRef.current = null
    }

    // Remove any leftover ghost on unmount (e.g. drag interrupted by unmount)
    useEffect(() => () => {
        dragGhostRef.current?.remove()
        dragGhostRef.current = null
    }, [])

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault()
        e.dataTransfer.dropEffect = "move"
    }

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault()
        // Capture and ignore drops on the masonry area
    }

    const handleCardDragStart = (assetId: string) => (e: React.DragEvent) => {
        e.dataTransfer.setData("text/plain", assetId)
        e.dataTransfer.effectAllowed = "move"
        // Replace the default handle "button" ghost with a custom thumbnail
        // drag image so the cursor no longer shows the raw drag button.
        removeDragGhost()
        const asset = assets.find((a) => a.id === assetId)
        const ghost = createDragGhost(asset?.thumbnailUrl ? `${API_BASE}${asset.thumbnailUrl}` : null)
        if (ghost) {
            dragGhostRef.current = ghost
            document.body.appendChild(ghost)
            // Lock the cursor to the ghost's top-left corner so the square
            // drag image follows the pointer naturally.
            e.dataTransfer.setDragImage(ghost, 8, 8)
        }
    }

    const handleCardDragEnd = () => {
        // Clean up the ghost element after the drag finishes
        removeDragGhost()
    }

    return (
        <Box ref={containerRef} onDragOver={handleDragOver} onDrop={handleDrop}>
            {/* Initial loading spinner */}
            {loading && assets.length === 0 ? (
                <Center py="20">
                    <VStack gap="4">
                        <Spinner size="lg" colorPalette="accent" />
                        <Text color="fg.muted" fontSize="sm">Loading assets...</Text>
                    </VStack>
                </Center>
            ) : assets.length === 0 && !loading ? (
                <Center py="20">
                    <VStack gap="4" color="fg.muted">
                        <EmptyIcon />
                        <Text fontSize="sm">
                            {(() => {
                                // Filter conditions (search text or tags: prefix) take
                                // priority — an empty result set does not mean the
                                // folder itself is empty.
                                if (searchQuery) return "No results for '" + searchQuery + "'"
                                if (currentFolder) return "This folder is empty."
                                return "No assets yet. Click Add to upload files."
                            })()}
                        </Text>
                    </VStack>
                </Center>
            ) : (
                <>
                    <Box
                        display="flex"
                        gap={`${gap}px`}
                        alignItems="flex-start"
                    >
                        {columns.map((col, i) => (
                            <Box key={i} flex="1" minW="0" display="flex" flexDirection="column" gap="16px">
                                {col.map((asset) => (
                                    <Box key={asset.id} id={`asset-${asset.id}`} position="relative">
                                        <AssetCard
                                            asset={asset}
                                            apiBase={API_BASE}
                                            onClick={() => onSelectAsset(asset.id)}
                                            onDragStart={handleCardDragStart(asset.id)}
                                            onDragEnd={handleCardDragEnd}
                                            removed={removedAssetIds?.has(asset.id) ? { reason: removedAssetIds.get(asset.id)! as 'deleted' | 'moved' } : undefined}
                                        />
                                        {/* Deep-link highlight ring — fades after ~2s */}
                                        {highlightId === asset.id && (
                                            <Box
                                                position="absolute"
                                                inset="0"
                                                borderRadius="md"
                                                border="2px solid"
                                                borderColor="accent.solid"
                                                pointerEvents="none"
                                                zIndex="1"
                                                opacity={highlightVisible ? 1 : 0}
                                                transition="opacity 0.5s ease"
                                            />
                                        )}
                                    </Box>
                                ))}
                            </Box>
                        ))}
                    </Box>

                    {/* Sentinel for infinite scroll */}
                    <Box ref={sentinelRef} width="full" py="4" display={showSentinel ? "block" : "none"}>
                        {loading && (
                            <Center>
                                <Spinner colorPalette="accent" />
                            </Center>
                        )}
                    </Box>

                    {/* End-of-list message */}
                    {assets.length > 0 && !hasMore && !loading && (
                        <Center py="12">
                            <Text color="fg.muted" fontSize="sm">
                                All assets loaded
                            </Text>
                        </Center>
                    )}
                </>
            )}
        </Box>
    )
}