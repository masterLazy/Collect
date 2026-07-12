import { useEffect, useRef, useState } from "react"
import { Box, Center, Spinner, Text, VStack } from "@chakra-ui/react"
import { AssetCard } from "./AssetCard"
import type { AssetDto } from "../types"

const API_BASE = "http://localhost:5000"

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

export function MasonryGrid({ assets, loading, hasMore, onLoadMore, onSelectAsset, currentFolder, searchQuery }: MasonryGridProps) {
    const sentinelRef = useRef<HTMLDivElement>(null)
    const loadingRef = useRef(loading)
    const hasMoreRef = useRef(hasMore)
    const onLoadMoreRef = useRef(onLoadMore)
    const [showSentinel, setShowSentinel] = useState(false)

    // Keep refs in sync without triggering re-renders
    loadingRef.current = loading
    hasMoreRef.current = hasMore
    onLoadMoreRef.current = onLoadMore

    useEffect(() => {
        setShowSentinel(hasMore || loading)
    }, [hasMore, loading])

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

    // Initial loading spinner
    if (loading && assets.length === 0) {
        return (
            <Center py="20">
                <VStack gap="4">
                    <Spinner size="lg" colorPalette="accent" />
                    <Text color="fg.muted" fontSize="sm">Loading assets...</Text>
                </VStack>
            </Center>
        )
    }

    if (assets.length === 0 && !loading) {
        let message = "No assets yet. Click Add to upload files."
        if (currentFolder) {
            message = "This folder is empty."
        }
        if (searchQuery) {
            message = "No results for '" + searchQuery + "'"
        }
        return (
            <Center py="20">
                <VStack gap="4" color="fg.muted">
                    <EmptyIcon />
                    <Text fontSize="sm">{message}</Text>
                </VStack>
            </Center>
        )
    }

    return (
        <Box>
            <Box
                css={{
                    columnWidth: "280px",
                    columnCount: "auto",
                    columnGap: "16px",
                    "@media (max-width: 480px)": {
                        columnWidth: "160px",
                        columnGap: "8px",
                    },
                    "@media (min-width: 481px) and (max-width: 767px)": {
                        columnWidth: "200px",
                        columnGap: "12px",
                    },
                }}
            >
                {assets.map((asset) => (
                    <AssetCard
                        key={asset.id}
                        asset={asset}
                        apiBase={API_BASE}
                        onClick={() => onSelectAsset(asset.id)}
                    />
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
        </Box>
    )
}