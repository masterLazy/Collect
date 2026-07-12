import { useEffect, useRef, useState } from "react"
import { Box, Center, Spinner, Text, VStack } from "@chakra-ui/react"
import { AssetCard } from "./AssetCard"
import type { AssetDto } from "../types"

const API_BASE = "http://localhost:5000"

interface MasonryGridProps {
    assets: AssetDto[]
    loading: boolean
    hasMore: boolean
    onLoadMore: () => void
    onSelectAsset: (id: string) => void
}

export function MasonryGrid({ assets, loading, hasMore, onLoadMore, onSelectAsset }: MasonryGridProps) {
    const sentinelRef = useRef<HTMLDivElement>(null)
    const [showSentinel, setShowSentinel] = useState(false)

    useEffect(() => {
        const sentinel = sentinelRef.current
        if (!sentinel) return

        const observer = new IntersectionObserver(
            (entries) => {
                if (entries[0].isIntersecting && hasMore && !loading) {
                    onLoadMore()
                }
            },
            { rootMargin: "200px" }
        )

        observer.observe(sentinel)

        return () => observer.disconnect()
    }, [hasMore, loading, onLoadMore])

    useEffect(() => {
        setShowSentinel(hasMore || loading)
    }, [hasMore, loading])

    if (assets.length === 0 && !loading) {
        return (
            <Center py="20">
                <VStack gap="4" color="fg.muted">
                    <Text fontSize="4xl">+</Text>
                    <Text fontSize="lg">Click Import to select a folder</Text>
                </VStack>
            </Center>
        )
    }

    return (
        <Box
            css={{
                columnWidth: "280px",
                columnCount: "auto",
                columnGap: "16px",
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

            <Box ref={sentinelRef} width="full" py="8" display={showSentinel ? "block" : "none"}>
                {loading && (
                    <Center>
                        <Spinner colorPalette="accent" />
                    </Center>
                )}
            </Box>
        </Box>
    )
}