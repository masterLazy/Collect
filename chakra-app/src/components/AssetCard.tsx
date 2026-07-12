import { Box, Image, Skeleton } from "@chakra-ui/react"
import { useState } from "react"
import type { AssetDto } from "../types"

interface AssetCardProps {
    asset: AssetDto
    apiBase: string
    onClick: () => void
}

export function AssetCard({ asset, apiBase, onClick }: AssetCardProps) {
    const [loaded, setLoaded] = useState(false)
    const [error, setError] = useState(false)
    const isLandscape = asset.width > asset.height

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
                css={isLandscape ? { aspectRatio: "4/3" } : undefined}
            >
                {!loaded && !error && (
                    <Skeleton
                        loading
                        width="full"
                        height={isLandscape ? undefined : "200px"}
                    >
                        <Box aspectRatio={isLandscape ? 4 / 3 : asset.width / asset.height} width="full" />
                    </Skeleton>
                )}
                {error ? (
                    <Box
                        aspectRatio={16 / 9}
                        width="full"
                        display="flex"
                        alignItems="center"
                        justifyContent="center"
                        bg="bg.muted"
                        color="fg.muted"
                        fontSize="sm"
                    >
                        Failed to load
                    </Box>
                ) : (
                    <Image
                        src={`${apiBase}${asset.thumbnailUrl}`}
                        alt={asset.fileName}
                        width="full"
                        height="full"
                        objectFit={isLandscape ? "cover" : undefined}
                        objectPosition="center"
                        display={loaded ? "block" : "none"}
                        loading="lazy"
                        onLoad={() => setLoaded(true)}
                        onError={() => { setLoaded(true); setError(true) }}
                    />
                )}
            </Box>
        </Box>
    )
}
