import { useEffect, useMemo, useRef, useState } from "react"
import { Box, Center, Spinner, Text, VStack } from "@chakra-ui/react"
import { AssetCard } from "./AssetCard"
import type { AssetDto } from "../types"

const API_BASE = `http://${window.location.hostname}:5000`

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
}

function getResponsiveParams(containerWidth: number): { columnWidth: number; gap: number } {
    if (containerWidth <= 480) {
        return { columnWidth: 160, gap: 8 }
    }
    if (containerWidth <= 767) {
        return { columnWidth: 200, gap: 12 }
    }
    return { columnWidth: 280, gap: 16 }
}

function computeColumnCount(containerWidth: number): number {
    if (containerWidth <= 0) return 1
    const { columnWidth, gap } = getResponsiveParams(containerWidth)
    return Math.max(1, Math.floor((containerWidth + gap) / (columnWidth + gap)))
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

export function MasonryGrid({ assets, loading, hasMore, onLoadMore, onSelectAsset, currentFolder, searchQuery }: MasonryGridProps) {
    const sentinelRef = useRef<HTMLDivElement>(null)
    const containerRef = useRef<HTMLDivElement>(null)
    const loadingRef = useRef(loading)
    const hasMoreRef = useRef(hasMore)
    const onLoadMoreRef = useRef(onLoadMore)
    const [showSentinel, setShowSentinel] = useState(false)
    const [containerWidth, setContainerWidth] = useState(0)

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

    // Compute column count and distribute assets
    const columnCount = useMemo(() => computeColumnCount(containerWidth), [containerWidth])
    const { gap, columnWidth } = useMemo(() => getResponsiveParams(containerWidth), [containerWidth])
    const columns = useMemo(() => distributeToColumns(assets, columnCount, columnWidth), [assets, columnCount, columnWidth])

    // Drag-drop handling for masonry area
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
                                if (currentFolder) return "This folder is empty."
                                if (searchQuery) return "No results for '" + searchQuery + "'"
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
                                    <AssetCard
                                        key={asset.id}
                                        asset={asset}
                                        apiBase={API_BASE}
                                        onClick={() => onSelectAsset(asset.id)}
                                        onDragStart={handleCardDragStart(asset.id)}
                                    />
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