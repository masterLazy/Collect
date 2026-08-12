import { Box, Image, Skeleton } from "@chakra-ui/react"
import { useState } from "react"
import type { AssetDto } from "../types"

interface AssetCardProps {
    asset: AssetDto
    apiBase: string
    onClick: () => void
    onDragStart?: (e: React.DragEvent) => void
    onDragEnd?: (e: React.DragEvent) => void
    removed?: { reason: 'deleted' | 'moved' }
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

function DragHandleIcon() {
    return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="4" y1="6.5" x2="20" y2="6.5" />
            <line x1="4" y1="12" x2="20" y2="12" />
            <line x1="4" y1="17.5" x2="20" y2="17.5" />
        </svg>
    )
}

export function AssetCard({ asset, apiBase, onClick, onDragStart, onDragEnd, removed }: AssetCardProps) {
    const [loaded, setLoaded] = useState(false)
    const [error, setError] = useState(false)
    const [hovered, setHovered] = useState(false)
    const isLandscape = asset.width > asset.height
    const aspectRatio = isLandscape ? 4 / 3 : (asset.width && asset.height ? asset.width / asset.height : 4 / 3)

    const isRemoved = !!removed

    return (
        <Box
            cursor={isRemoved ? "default" : "pointer"}
            onClick={isRemoved ? undefined : onClick}
            borderRadius="md"
            overflow="hidden"
            bg="bg.subtle"
            border="1px solid"
            borderColor="border"
            transition="all 0.2s"
            _hover={isRemoved ? {} : { transform: "translateY(-2px)", shadow: "md" }}
            onMouseEnter={isRemoved ? undefined : () => setHovered(true)}
            onMouseLeave={isRemoved ? undefined : () => setHovered(false)}
            position="relative"
            pointerEvents={isRemoved ? "none" : undefined}
        >
            <Box
                position="relative"
                overflow="hidden"
                width="full"
                css={{
                    aspectRatio,
                    filter: isRemoved ? "blur(8px) brightness(1.3)" : undefined,
                    _dark: isRemoved ? { filter: "blur(8px) brightness(0.5)" } : undefined,
                }}
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
                        draggable={false}
                        onLoad={() => setLoaded(true)}
                        onError={() => { setLoaded(true); setError(true) }}
                    />
                )}
            </Box>

            {/* Drag handle — top-left corner, blends into the card edge, visible on hover */}
            {!isRemoved && (
                <Box
                    position="absolute"
                    top="0"
                    left="0"
                    width="30px"
                    height="30px"
                    borderBottomRightRadius="xl"
                    display={hovered ? "flex" : "none"}
                    alignItems="center"
                    justifyContent="center"
                    bg="black/50"
                    boxShadow="md"
                    color="white"
                    cursor="grab"
                    draggable
                    opacity={hovered ? 1 : 0}
                    transition="opacity 1.0s"
                    _active={{ cursor: "grabbing", bg: "black/60" }}
                    onDragStart={onDragStart}
                    onDragEnd={onDragEnd}
                    onClick={(e) => e.stopPropagation()}
                    title="Drag to move to folder"
                    zIndex="1"
                >
                    <DragHandleIcon />
                </Box>
            )}

            {/* Removed overlay — same style as Failed to load but with blur+overlay */}
            {isRemoved && (
                <Box
                    position="absolute"
                    inset="0"
                    display="flex"
                    flexDirection="column"
                    alignItems="center"
                    justifyContent="center"
                    gap="2"
                    bg="bg.muted/60"
                    color="fg.muted"
                    fontSize="sm"
                    zIndex="2"
                >
                    <BrokenImageIcon />
                    <Box>{removed!.reason === 'deleted' ? 'Deleted' : 'Moved'}</Box>
                </Box>
            )}
        </Box>
    )
}
