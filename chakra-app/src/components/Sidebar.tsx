import { useEffect, useState } from "react"
import {
    Box,
    createToaster,
    HStack,
    IconButton,
    Image,
    Separator,
    Skeleton,
    Stack,
    Text,
    VStack,
} from "@chakra-ui/react"
import { api } from "../services/api"
import { TagEditor } from "./TagEditor"
import type { AssetDetailDto, AssetTag } from "../types"

const API_BASE = "http://localhost:5000"

interface SidebarProps {
    assetId: string | null
    onClose: () => void
    toaster: ReturnType<typeof createToaster>
}

const aspectRatioNames: Record<string, string> = {
    "1": "1:1",
    "1.33": "4:3",
    "1.5": "3:2",
    "1.78": "16:9",
    "1.85": "1.85:1",
    "2.35": "2.35:1",
    "0.75": "3:4",
    "0.67": "2:3",
    "0.56": "9:16",
    "1.6": "16:10",
    "1.25": "5:4",
}

function getClosestAspectRatio(w: number, h: number): string {
    if (!w || !h) return ""
    const ratio = w / h
    const rounded = Math.round(ratio * 100) / 100
    return aspectRatioNames[String(rounded)] || w + ":" + h
}

function XIcon() {
    return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 6L6 18M6 6l12 12" />
        </svg>
    )
}

export function Sidebar({ assetId, onClose, toaster }: SidebarProps) {
    const [asset, setAsset] = useState<AssetDetailDto | null>(null)
    const [loading, setLoading] = useState(false)
    const [imageLoaded, setImageLoaded] = useState(false)
    const [error, setError] = useState(false)
    const [tags, setTags] = useState<AssetTag[]>([])

    useEffect(() => {
        if (!assetId) {
            setAsset(null)
            return
        }
        setLoading(true)
        setError(false)
        setImageLoaded(false)
        api.getAsset(assetId)
            .then((data) => {
                setAsset(data)
                setTags(data.tags)
            })
            .catch(() => setError(true))
            .finally(() => setLoading(false))
    }, [assetId])

    const handleTagsChange = (newTags: AssetTag[]) => {
        setTags(newTags)
    }

    return (
        <Stack gap="4">
            {/* Header */}
            <HStack justify="space-between">
                <Text fontSize="lg" fontWeight="semibold" color="fg" truncate>
                    {loading ? "Loading..." : (asset ? asset.fileName.replace(/\.[^.]+$/, "") : "")}
                </Text>
                <IconButton variant="ghost" size="sm" onClick={onClose} aria-label="Close sidebar">
                    <XIcon />
                </IconButton>
            </HStack>

            {/* Preview image */}
            <Box borderRadius="md" overflow="hidden" bg="bg.subtle" border="1px solid" borderColor="border">
                {!imageLoaded && !error && (
                    <Skeleton loading height="200px" width="full" />
                )}
                {error ? (
                    <Box height="200px" display="flex" alignItems="center" justifyContent="center" bg="bg.muted">
                        <Text color="fg.muted" fontSize="sm">Failed to load</Text>
                    </Box>
                ) : (
                    <Image
                        src={API_BASE + "/api/assets/" + assetId + "/image"}
                        alt=""
                        width="full"
                        display={imageLoaded ? "block" : "none"}
                        loading="lazy"
                        onLoad={() => setImageLoaded(true)}
                        onError={() => { setImageLoaded(true); setError(true) }}
                    />
                )}
            </Box>

            {/* Metadata rows */}
            {loading && (
                <Stack gap="3">
                    <Skeleton loading height="16px" width="60%" />
                    <Skeleton loading height="16px" width="40%" />
                    <Skeleton loading height="16px" width="50%" />
                </Stack>
            )}

            {asset && !loading && (
                <>
                    <VStack gap="2" align="stretch">
                        <HStack justify="space-between">
                            <Text fontSize="sm" color="fg.muted">File</Text>
                            <Text fontSize="sm" color="fg">{asset.fileName}</Text>
                        </HStack>
                        <HStack justify="space-between">
                            <Text fontSize="sm" color="fg.muted">Resolution</Text>
                            <Text fontSize="sm" color="fg">{asset.width} x {asset.height}</Text>
                        </HStack>
                        <HStack justify="space-between">
                            <Text fontSize="sm" color="fg.muted">Aspect Ratio</Text>
                            <Text fontSize="sm" color="fg">
                                {getClosestAspectRatio(asset.width, asset.height)}
                            </Text>
                        </HStack>
                        <HStack justify="space-between">
                            <Text fontSize="sm" color="fg.muted">Path</Text>
                            <Text fontSize="sm" color="fg" textAlign="end" wordBreak="break-all">
                                {asset.relativePath}
                            </Text>
                        </HStack>
                        <HStack justify="space-between">
                            <Text fontSize="sm" color="fg.muted">Size</Text>
                            <Text fontSize="sm" color="fg">
                                {asset.fileSize > 1024 * 1024
                                    ? (asset.fileSize / (1024 * 1024)).toFixed(1) + " MB"
                                    : (asset.fileSize / 1024).toFixed(0) + " KB"}
                            </Text>
                        </HStack>
                    </VStack>

                    <Separator />

                    <TagEditor
                        tags={tags}
                        assetId={asset.id}
                        onTagsChange={handleTagsChange}
                    />
                </>
            )}
        </Stack>
    )
}
