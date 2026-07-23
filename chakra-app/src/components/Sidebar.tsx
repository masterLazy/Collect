import { useCallback, useEffect, useRef, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import type { CustomToaster } from "./CustomToast"
import {
    Badge,
    Box,
    Button,
    Dialog,
    HStack,
    IconButton,
    Image,
    Portal,
    Separator,
    Skeleton,
    Stack,
    Text,
} from "@chakra-ui/react"
import { api, API_BASE } from "../services/api"
import { copyToClipboard } from "../services/clipboard"
import { PaletteBar } from "./PaletteBar"
import { TagEditor } from "./TagEditor"
import { DirectoryTreePicker } from "./DirectoryPicker"
import type { AssetDetailDto, AssetTag } from "../types"

interface SidebarProps {
    assetId: string | null
    onClose: () => void
    toaster: CustomToaster
    onTagClick?: (value: string) => void
    selectedTags?: string[]
    onTagsSaved?: (updated: AssetDetailDto) => void
    onRefreshRequested?: (assetId?: string, reason?: 'deleted' | 'moved') => void
}

function XIcon() {
    return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 6L6 18M6 6l12 12" />
        </svg>
    )
}

function CopyIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
    )
}

function ExpandIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 3 21 3 21 9" />
            <polyline points="9 21 3 21 3 15" />
            <line x1="21" y1="3" x2="14" y2="10" />
            <line x1="3" y1="21" x2="10" y2="14" />
        </svg>
    )
}

function TrashIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
        </svg>
    )
}

function formatSize(bytes: number): string {
    if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + " MB"
    if (bytes >= 1024) return (bytes / 1024).toFixed(0) + " KB"
    return bytes + " B"
}

function formatDate(iso: string): string {
    try {
        return new Date(iso).toLocaleDateString(undefined, {
            year: "numeric",
            month: "short",
            day: "numeric",
        })
    } catch {
        return iso
    }
}

const aspectRatioEntries: { ratio: number; text: string; label?: string }[] = [
    { ratio: 1, text: "1 : 1", label: "Square" },
    { ratio: 4 / 3, text: "4 : 3" },
    { ratio: 3 / 2, text: "3 : 2" },
    { ratio: 16 / 9, text: "16 : 9" },
    { ratio: 21 / 9, text: "21 : 9" },
    { ratio: 1.618, text: "1.618 : 1", label: "Golden Ratio" },
    { ratio: 1.414, text: "1.414 : 1", label: "Silver Ratio" },
    { ratio: 3 / 4, text: "3 : 4" },
    { ratio: 2 / 3, text: "2 : 3" },
    { ratio: 9 / 16, text: "9 : 16" },
    { ratio: 16 / 10, text: "16 : 10" },
    { ratio: 5 / 4, text: "5 : 4" },
]

function getClosestAspectRatio(w: number, h: number): { text: string; label?: string; percent: number } | null {
    if (!w || !h) return null
    // Always use long side / short side, so ratio >= 1
    const raw = Math.max(w, h) / Math.min(w, h)
    let best = aspectRatioEntries[0]
    let minDiff = Math.abs(raw - best.ratio)
    for (let i = 1; i < aspectRatioEntries.length; i++) {
        const diff = Math.abs(raw - aspectRatioEntries[i].ratio)
        if (diff < minDiff) {
            minDiff = diff
            best = aspectRatioEntries[i]
        }
    }
    const percent = Math.min(100, Math.max(0, Math.round((1 - minDiff / best.ratio) * 100 * 10) / 10))
    return { text: best.text, label: best.label, percent }
}

export function Sidebar({ assetId, onClose, toaster, onTagClick, selectedTags, onTagsSaved, onRefreshRequested }: SidebarProps) {
    const { libraryId } = useParams()
    const navigate = useNavigate()
    const [asset, setAsset] = useState<AssetDetailDto | null>(null)
    const [loading, setLoading] = useState(false)
    const [imageLoaded, setImageLoaded] = useState(false)
    const [error, setError] = useState(false)
    const [tags, setTags] = useState<AssetTag[]>([])
    const [copiedPath, setCopiedPath] = useState(false)
    const [moveDialogOpen, setMoveDialogOpen] = useState(false)
    const [selectedMoveTarget, setSelectedMoveTarget] = useState<string>("")
    const [moveTargetSelected, setMoveTargetSelected] = useState(false)
    const [moving, setMoving] = useState(false)
    const [deleted, setDeleted] = useState(false)

    useEffect(() => {
        if (!assetId) {
            setAsset(null)
            setDeleted(false)
            return
        }
        setDeleted(false)
        setLoading(true)
        setError(false)
        setImageLoaded(false)
        setCopiedPath(false)
        setImageExpanded(false)
        setImageOverflows(false)
        api.getAsset(assetId, libraryId!)
            .then((data) => {
                setAsset(data)
                setTags(data.tags)
            })
            .catch(() => setError(true))
            .finally(() => setLoading(false))
    }, [assetId, libraryId])

    const handleTagsChange = (newTags: AssetTag[]) => {
        setTags(newTags)
    }

    const handleTagsSaved = (updated: AssetDetailDto) => {
        setAsset(updated)
        setTags(updated.tags)
    }

    const handleCopyPath = async () => {
        if (!asset) return
        const ok = await copyToClipboard(asset.relativePath, toaster)
        if (ok) {
            setCopiedPath(true)
            setTimeout(() => setCopiedPath(false), 2000)
        }
    }

    const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
    const [imageExpanded, setImageExpanded] = useState(false)
    const [imageOverflows, setImageOverflows] = useState(false)
    const [copiedImage, setCopiedImage] = useState(false)
    const [imageHovered, setImageHovered] = useState(false)
    const imageBoxRef = useRef<HTMLDivElement>(null)

    const handleOpenFullscreen = () => {
        if (!assetId || !libraryId) return
        const shortId = libraryId.length > 8 ? libraryId.slice(0, 8) : libraryId
        navigate(`/${shortId}/view/${assetId}`)
    }

    const checkOverflow = useCallback(() => {
        const el = imageBoxRef.current
        if (!el || !asset || asset.width >= asset.height) {
            setImageOverflows(false)
            return
        }
        // Calculate the natural rendered height based on container width and image aspect ratio.
        // objectFit="cover" prevents actual scroll overflow, so we compare the computed
        // natural height against the 70vh max-height constraint instead.
        const containerWidth = el.clientWidth
        const aspectRatio = asset.width / asset.height
        const naturalHeight = containerWidth / aspectRatio
        const max70vh = window.innerHeight * 0.7
        setImageOverflows(naturalHeight > max70vh + 1)
    }, [asset])

    // Observe the image box for size changes to reliably detect overflow
    useEffect(() => {
        const el = imageBoxRef.current
        if (!el) return
        const ro = new ResizeObserver(() => {
            checkOverflow()
        })
        ro.observe(el)
        return () => ro.disconnect()
    }, [assetId, imageExpanded, checkOverflow])

    const handleCopyImage = async () => {
        if (!asset || !assetId) return
        setCopiedImage(true)
        setTimeout(() => setCopiedImage(false), 2000)
        try {
            const response = await fetch(API_BASE + "/api/assets/" + assetId + "/clipboard-image?libraryId=" + encodeURIComponent(libraryId!))
            const blob = await response.blob()
            await navigator.clipboard.write([
                new ClipboardItem({ "image/png": blob }),
            ])
            toaster.create({ title: "Image copied", type: "success" })
        } catch {
            setCopiedImage(false)
            toaster.create({ title: "Failed to copy image", type: "error" })
        }
    }

    const handleDelete = async () => {
        if (!asset) return
        try {
            await api.deleteAsset(asset.id, libraryId!)
            toaster.create({ title: "Asset deleted", type: "success" })
            setDeleted(true)
            setAsset(null)
            setDeleteConfirmOpen(false)
            onRefreshRequested?.(asset.id, 'deleted')
        } catch {
            toaster.create({ title: "Delete failed", type: "error" })
        }
    }

    const handleOpenMoveDialog = () => {
        setSelectedMoveTarget("")
        setMoveTargetSelected(true) // Root pre-selected
        setMoveDialogOpen(true)
    }

    const handleMoveAsset = async () => {
        if (!asset || !moveTargetSelected) return
        setMoving(true)
        try {
            const target = selectedMoveTarget // "" = root in backend
            const updated = await api.moveAsset(asset.id, target, libraryId!)
            setAsset(updated)
            setTags(updated.tags)
            toaster.create({ title: "Moved to " + (target || "root"), type: "success" })
            setMoveDialogOpen(false)
            onRefreshRequested?.(asset.id, 'moved')
        } catch {
            toaster.create({ title: "Move failed", type: "error" })
        } finally {
            setMoving(false)
        }
    }

    return (
        <Stack gap="4">
            {/* Preview image — collapse tall images */}
            <Box
                borderRadius="md"
                overflow="hidden"
                bg="bg.subtle"
                border="1px solid"
                borderColor="border"
                position="relative"
                onMouseEnter={() => setImageHovered(true)}
                onMouseLeave={() => setImageHovered(false)}
            >
                <Box
                    ref={imageBoxRef}
                    position="relative"
                    width="full"
                    css={{ aspectRatio: asset && asset.width && asset.height ? String(asset.width / asset.height) : "4/3" }}
                    maxH={asset && asset.height > asset.width && !imageExpanded ? "70vh" : undefined}
                    overflow="hidden"
                >
                    {!imageLoaded && !error && (
                        <Skeleton position="absolute" inset="0" width="full" height="full" />
                    )}
                    {error ? (
                        <Box position="absolute" inset="0" display="flex" alignItems="center" justifyContent="center" bg="bg.muted">
                            <Text color="fg.muted" fontSize="sm">Failed to load</Text>
                        </Box>
                    ) : (
                        <Image
                            src={API_BASE + "/api/assets/" + assetId + "/image?t=" + encodeURIComponent(asset?.lastModified ?? "") + "&libraryId=" + encodeURIComponent(libraryId!)}
                            alt=""
                            width="full"
                            height="full"
                            objectFit="cover"
                            objectPosition="top"
                            opacity={imageLoaded ? 1 : 0}
                            transition="opacity 0.3s"
                            onLoad={() => setImageLoaded(true)}
                            onError={() => { setImageLoaded(true); setError(true) }}
                        />
                    )}
                    {/* Image action buttons — top-right, visible on hover */}
                    {asset && imageLoaded && !error && (
                        <>
                            <IconButton
                                position="absolute"
                                top="2"
                                right="12"
                                size="xs"
                                variant="ghost"
                                bg="black/40"
                                color="white"
                                _hover={{ bg: "black/60" }}
                                opacity={imageHovered ? 1 : 0}
                                transition="opacity 0.15s"
                                aria-label="Copy image"
                                onClick={(e) => {
                                    e.stopPropagation()
                                    handleCopyImage()
                                }}
                            >
                                {copiedImage ? (
                                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                        <polyline points="20 6 9 17 4 12" />
                                    </svg>
                                ) : (
                                    <CopyIcon />
                                )}
                            </IconButton>
                            <IconButton
                                position="absolute"
                                top="2"
                                right="2"
                                size="xs"
                                variant="ghost"
                                bg="black/40"
                                color="white"
                                _hover={{ bg: "black/60" }}
                                opacity={imageHovered ? 1 : 0}
                                transition="opacity 0.15s"
                                aria-label="View fullscreen"
                                onClick={(e) => {
                                    e.stopPropagation()
                                    handleOpenFullscreen()
                                }}
                            >
                                <ExpandIcon />
                            </IconButton>
                        </>
                    )}
                </Box>
                {imageOverflows && !imageExpanded && (
                    <Box
                        position="absolute"
                        bottom="0"
                        left="0"
                        right="0"
                        textAlign="center"
                        pb="3"
                        pt="8"
                        bgGradient="to-t"
                        gradientFrom="bg"
                        gradientTo="transparent"
                        pointerEvents="none"
                    >
                        <Button
                            size="xs"
                            variant="ghost"
                            colorPalette="accent"
                            pointerEvents="auto"
                            onClick={() => setImageExpanded(true)}
                        >
                            Show more
                        </Button>
                    </Box>
                )}
            </Box>

            {/* Loading skeleton */}
            {loading && (
                <Stack gap="3">
                    <Skeleton loading height="16px" width="60%" />
                    <Skeleton loading height="16px" width="40%" />
                    <Skeleton loading height="16px" width="50%" />
                    <Skeleton loading height="16px" width="70%" />
                </Stack>
            )}

            {/* Asset deleted state */}
            {deleted && (
                <Stack gap="4">
                    <Box
                        borderRadius="md"
                        bg="bg.subtle"
                        border="1px solid"
                        borderColor="border"
                        p="6"
                        textAlign="center"
                    >
                        <Stack gap="2">
                            <Text color="fg.muted" fontSize="lg">Asset deleted</Text>
                            <Text color="fg.subtle" fontSize="sm">This asset has been removed from the library.</Text>
                        </Stack>
                    </Box>
                    <Button size="xs" variant="outline" width="full" disabled>
                        Move to...
                    </Button>
                    <Button size="xs" variant="outline" colorPalette="red" disabled>
                        <TrashIcon />
                        <Box as="span" ml="1">Delete</Box>
                    </Button>
                </Stack>
            )}

            {/* Asset details */}
            {asset && !loading && !deleted && (
                <>
                    {/* Tags first — right after preview image */}
                    <Box pt="1">
                        <TagEditor
                            tags={tags}
                            assetId={asset.id}
                            onTagsChange={handleTagsChange}
                            onTagClick={onTagClick}
                            selectedTags={selectedTags}
                            onTagsSaved={handleTagsSaved}
                            libraryId={libraryId!}
                            toaster={toaster}
                        />
                    </Box>

                    <Separator />

                    {/* Palette bar - full width row above metadata */}
                    {asset.palette && (
                        <Box>
                            <Text color="fg.muted" fontSize="sm" mb="1.5">Colors</Text>
                            <PaletteBar palette={asset.palette} />
                        </Box>
                    )}

                    {/* Metadata grid */}
                    <Box
                        display="grid"
                        gridTemplateColumns="auto 1fr"
                        gapX="3"
                        gapY="1.5"
                        fontSize="sm"
                    >
                        <Text color="fg.muted">Resolution</Text>
                        <Text color="fg">{asset.width} × {asset.height}</Text>

                        <Text color="fg.muted">Aspect Ratio</Text>
                        <Text color="fg">
                            {(() => {
                                const ar = getClosestAspectRatio(asset.width, asset.height)
                                if (!ar) return "—"
                                return (
                                    <>
                                        <Text as="span">{ar.text}</Text>
                                        {ar.label && (
                                            <Badge size="sm" colorPalette="accent" variant="surface" fontWeight="medium" ml="1.5">{ar.label}</Badge>
                                        )}
                                        {ar.percent < 95 && (
                                            <Text as="span" color="fg.subtle" fontSize="sm" ml="2">{ar.percent.toFixed(1)}%</Text>
                                        )}
                                    </>
                                )
                            })()}
                        </Text>

                        <Text color="fg.muted">Size</Text>
                        <Text color="fg">{formatSize(asset.fileSize)}</Text>

                        <Text color="fg.muted">Type</Text>
                        <Text color="fg">{asset.mimeType}</Text>

                        <Text color="fg.muted">Last Modified</Text>
                        <Text color="fg">{formatDate(asset.lastModified ?? asset.importedAt)}</Text>
                    </Box>

                    {/* Path with copy icon */}
                    <Box>
                        <Text color="fg.muted" fontSize="xs" mb="1">Path</Text>
                        <HStack
                            bg="bg.subtle"
                            borderRadius="md"
                            border="1px solid"
                            borderColor="border"
                            px="3"
                            py="2"
                            gap="2"
                            _hover={{ borderColor: "border.accent" }}
                            transition="border-color 0.15s"
                        >
                            <Text fontSize="xs" color="fg" flex="1" wordBreak="break-all" lineClamp={2}>
                                {asset.relativePath}
                            </Text>
                            <Box
                                color={copiedPath ? "green.500" : "fg.muted"}
                                flexShrink="0"
                                cursor="pointer"
                                onClick={handleCopyPath}
                            >
                                <CopyIcon />
                            </Box>
                        </HStack>
                    </Box>

                    <Separator />

                    {/* Move to Directory */}
                    <Button size="xs" variant="outline" width="full" onClick={handleOpenMoveDialog}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M5 19l14-4M5 5l14 4-14 4 14 4" />
                        </svg>
                        <Box as="span" ml="1">Move to...</Box>
                    </Button>

                    {/* Delete button with confirmation */}
                    <Button
                        size="xs"
                        variant="outline"
                        colorPalette="red"
                        onClick={() => setDeleteConfirmOpen(true)}
                    >
                        <TrashIcon />
                        <Box as="span" ml="1">Delete</Box>
                    </Button>

                    <Box pb="4" />

                    {/* Move to Directory Dialog */}
                    <Dialog.Root open={moveDialogOpen} onOpenChange={(e: { open: boolean }) => setMoveDialogOpen(e.open)}>
                        <Portal>
                            <Dialog.Backdrop />
                            <Dialog.Positioner>
                                <Dialog.Content>
                                    <Dialog.Header>
                                        <Dialog.Title>Move to Directory</Dialog.Title>
                                    </Dialog.Header>
                                    <Dialog.Body>
                                        <DirectoryTreePicker
                                            selectedPath={selectedMoveTarget}
                                            onSelect={(path) => { setSelectedMoveTarget(path); setMoveTargetSelected(true) }}
                                            libraryId={libraryId!}
                                        />
                                        {!selectedMoveTarget && (
                                            <Text fontSize="xs" color="fg.subtle" mt="2">Select a folder to move the asset into</Text>
                                        )}
                                        {selectedMoveTarget && (
                                            <Text fontSize="xs" color="fg.muted" mt="2">Target: {selectedMoveTarget}</Text>
                                        )}
                                    </Dialog.Body>
                                    <Dialog.Footer>
                                        <Button variant="outline" onClick={() => setMoveDialogOpen(false)}>
                                            Cancel
                                        </Button>
                                        <Button
                                            colorPalette="accent"
                                            loading={moving}
                                            disabled={!moveTargetSelected}
                                            onClick={handleMoveAsset}
                                        >
                                            Move
                                        </Button>
                                    </Dialog.Footer>
                                </Dialog.Content>
                            </Dialog.Positioner>
                        </Portal>
                    </Dialog.Root>

                    {/* Delete confirmation dialog */}
                    <Dialog.Root open={deleteConfirmOpen} onOpenChange={(e: { open: boolean }) => setDeleteConfirmOpen(e.open)}>
                        <Portal>
                            <Dialog.Backdrop />
                            <Dialog.Positioner>
                                <Dialog.Content>
                                    <Dialog.Header>
                                        <Dialog.Title>Delete Asset</Dialog.Title>
                                    </Dialog.Header>
                                    <Dialog.Body>
                                        <Text fontSize="sm" color="fg">
                                            Are you sure you want to delete this asset? This action cannot be undone.
                                        </Text>
                                    </Dialog.Body>
                                    <Dialog.Footer>
                                        <Button variant="outline" onClick={() => setDeleteConfirmOpen(false)}>
                                            Cancel
                                        </Button>
                                        <Button colorPalette="red" onClick={handleDelete}>
                                            Delete
                                        </Button>
                                    </Dialog.Footer>
                                </Dialog.Content>
                            </Dialog.Positioner>
                        </Portal>
                    </Dialog.Root>
                </>
            )}
        </Stack>
    )
}
