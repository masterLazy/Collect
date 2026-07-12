import { Box, Image, Skeleton } from "@chakra-ui/react"
import { useState } from "react"
import type { AssetDto } from "../types"

interface AssetCardProps {
    asset: AssetDto
    apiBase: string
    onClick: () => void
}

function BrokenImageIcon() {
    return (
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <polyline points="21 15 16 10 5 21" />
        </svg>
    )
}

export function AssetCard({ asset, apiBase, onClick }: AssetCardProps) {
    const [loaded, setLoaded] = useState(false)
    const [error, setError] = useState(false)
    const isLandscape = asset.width > asset.height
    const aspectRatio = isLandscape ? 4 / 3 : (asset.width && asset.height ? asset.width / asset.height : 4 / 3)

    return (
        <Box
            breakInside="avoid"
            mb="16px"
            cursor="pointer"
            onClick={onClick}
            borderRadius="md"
            overflow="hidden"
            bg="bg.subtle"
            border="1px solid"
            borderColor="border"
            transition="all 0.2s"
            _hover={{ transform: "translateY(-2px)", shadow: "md" }}
        >
            <Box
                position="relative"
                overflow="hidden"
                width="full"
                css={{ aspectRatio }}
            >
                {!loaded && !error && (
                    <Skeleton
                        position="absolute"
                        inset="0"
                        width="full"
                        height="full"
                    />
                )}

                {error ? (
                    <Box
                        width="full"
                        height="full"
                        display="flex"
                        flexDirection="column"
                        alignItems="center"
                        justifyContent="center"
                        gap="2"
                        bg="bg.muted"
                        color="fg.muted"
                        fontSize="sm"
                    >
                        <BrokenImageIcon />
                        <Box>Failed to load</Box>
                    </Box>
                ) : (
                    <Image
                        src={`${apiBase}${asset.thumbnailUrl}`}
                        alt={asset.fileName}
                        width="full"
                        height="full"
                        objectFit="cover"
                        objectPosition="center"
                        opacity={loaded ? 1 : 0}
                        transition="opacity 0.3s"
                        onLoad={() => setLoaded(true)}
                        onError={() => { setLoaded(true); setError(true) }}
                    />
                )}
            </Box>
        </Box>
    )
}
