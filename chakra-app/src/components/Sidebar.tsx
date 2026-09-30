import { useCallback, useEffect, useRef, useState } from "react"
import { useParams } from "react-router-dom"
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
    Skeleton,
    Stack,
    Text,
} from "@chakra-ui/react"
import { api, API_BASE } from "../services/api"
import { formatSize, formatDate, getClosestAspectRatio } from "../lib/assetMeta"
import { CopyButton } from "./CopyButton"
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
    /** Authoritative boost state for this asset after a boost made elsewhere. */
    boostPatch?: { id: string; count: number; boostedToday: boolean } | null
    /** Lets the grid update when boosts are reset from the sidebar. */
    onBoostChanged?: (assetId: string, boostCount: number, boostedToday: boolean) => void
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

function MoveIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 7a2 2 0 0 1 2-2h3l2 2h9a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
            <path d="M12 11v5" />
            <path d="M10 13l2-2 2 2" />
        </svg>
    )
}

function ChevronIcon({ open }: { open: boolean }) {
    return (
        <svg
            width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            style={{ transform: open ? "rotate(90deg)" : "rotate(0deg)", transition: "transform 0.15s ease" }}
        >
            <polyline points="9 18 15 12 9 6" />
        </svg>
    )
}

function TagIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0l-7-7A2 2 0 0 1 3 12.2V5a2 2 0 0 1 2-2h7.2a2 2 0 0 1 1.4.6l7 7a2 2 0 0 1 0 2.8z" />
            <circle cx="7.5" cy="7.5" r="1.2" />
        </svg>
    )
}

function PaletteIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="9" />
            <circle cx="9" cy="9" r="1.2" />
            <circle cx="15" cy="9" r="1.2" />
            <circle cx="9.5" cy="15" r="1.2" />
            <circle cx="15" cy="15" r="1.2" />
        </svg>
    )
}

function InfoIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="9" />
            <line x1="12" y1="11" x2="12" y2="16" />
            <line x1="12" y1="8" x2="12" y2="8.01" />
        </svg>
    )
}

function BoostIcon() {
    return (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="19" x2="12" y2="5" />
            <polyline points="5 12 12 5 19 12" />
        </svg>
    )
}

function ResetIcon() {
    return (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="1 4 1 10 7 10" />
            <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
        </svg>
    )
}

function LinkIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.8 1.7" />
            <path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.8-1.7" />
        </svg>
    )
}

type SectionKey = "tags" | "colors" | "details" | "path"

const SECTION_STORAGE_KEY = "collect.sidebar.sections"

function readSectionState(): Record<SectionKey, boolean> {
    const defaults: Record<SectionKey, boolean> = { tags: true, colors: true, details: true, path: false }
    try {
        const raw = localStorage.getItem(SECTION_STORAGE_KEY)
        if (!raw) return defaults
        return { ...defaults, ...(JSON.parse(raw) as Partial<Record<SectionKey, boolean>>) }
    } catch {
        return defaults
    }
}

/**
 * One row of the sidebar's vertical menu. Used both for collapsible sections
 * (with a chevron and `aria-expanded`) and for plain action rows.
 */
function MenuRow({ icon, label, onClick, expanded, trailing, tone }: {
    icon: React.ReactNode
    label: React.ReactNode
    onClick: () => void
    expanded?: boolean
    trailing?: React.ReactNode
    tone?: "danger"
}) {
    return (
        <Box
            as="button"
            width="full"
            display="flex"
            alignItems="center"
            gap="2"
            px="2"
            py="2"
            borderRadius="md"
            textAlign="left"
            color={tone === "danger" ? "fg.error" : "fg"}
            fontSize="sm"
            cursor="pointer"
            transition="background-color 0.12s"
            _hover={{ bg: "bg.subtle" }}
            _focusVisible={{ outline: "2px solid", outlineColor: "border.emphasized", outlineOffset: "-2px" }}
            aria-expanded={expanded}
            onClick={onClick}
        >
            <Box color={tone === "danger" ? "fg.error" : "fg.muted"} flexShrink="0" display="inline-flex">
                {icon}
            </Box>
            <Box flex="1" minW="0" truncate>{label}</Box>
            {trailing}
            {expanded !== undefined && (
                <Box color="fg.subtle" flexShrink="0" display="inline-flex">
                    <ChevronIcon open={expanded} />
                </Box>
            )}
        </Box>
    )
}

/**
 * Collapsible menu section: a vertical-menu row that reveals its content.
 * Open state is owned by the sidebar so it can be persisted across sessions.
 */
function MenuSection({ icon, label, count, open, onToggle, children }: {
    icon: React.ReactNode
    label: string
    count?: number
    open: boolean
    onToggle: () => void
    children: React.ReactNode
}) {
    return (
        <Box borderTopWidth="1px" borderColor="border" pt="1">
            <MenuRow
                icon={icon}
                expanded={open}
                onClick={onToggle}
                label={
                    <Text as="span" fontWeight="medium" fontSize="sm">{label}</Text>
                }
                trailing={count !== undefined ? (
                    <Text as="span" fontSize="xs" color="fg.subtle">{count}</Text>
                ) : undefined}
            />
            {open && <Box px="2" pb="3">{children}</Box>}
        </Box>
    )
}

export function Sidebar({ assetId, onClose, toaster, onTagClick, selectedTags, onTagsSaved, onRefreshRequested, boostPatch, onBoostChanged }: SidebarProps) {
    const { libraryId } = useParams()
    const [asset, setAsset] = useState<AssetDetailDto | null>(null)
    const [loading, setLoading] = useState(false)
    const [imageLoaded, setImageLoaded] = useState(false)
    const [error, setError] = useState(false)
    const [tags, setTags] = useState<AssetTag[]>([])
    const [moveDialogOpen, setMoveDialogOpen] = useState(false)
    const [selectedMoveTarget, setSelectedMoveTarget] = useState<string>("")
    const [moveTargetSelected, setMoveTargetSelected] = useState(false)
    const [moving, setMoving] = useState(false)
    const [deleted, setDeleted] = useState(false)

    // Guards against stale responses when the user quickly switches assets:
    // only the fetch for the current asset may update state.
    const fetchGenRef = useRef(0)

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
        setImageExpanded(false)
        setImageOverflows(false)

        const gen = ++fetchGenRef.current

        api.getAsset(assetId, libraryId!)
            .then((data) => {
                if (fetchGenRef.current !== gen) return
                setAsset(data)
                setTags(data.tags)
            })
            .catch(() => {
                if (fetchGenRef.current === gen) setError(true)
            })
            .finally(() => {
                if (fetchGenRef.current !== gen) return
                setLoading(false)
            })

        return () => {
            // Invalidate any in-flight fetch when the asset changes or the sidebar unmounts,
            // so a slow response can never update state for a stale asset.
            fetchGenRef.current++
        }
    }, [assetId, libraryId])

    const handleTagsChange = (newTags: AssetTag[]) => {
        setTags(newTags)
    }

    // A boost made from the grid (or undone there) updates the count shown here
    // without refetching the whole detail payload.
    useEffect(() => {
        if (!boostPatch) return
        setAsset((prev) => (prev && prev.id === boostPatch.id
            ? { ...prev, boostCount: boostPatch.count, boostedToday: boostPatch.boostedToday }
            : prev))
    }, [boostPatch])

    const [resettingBoosts, setResettingBoosts] = useState(false)
    const [resetBoostsConfirmOpen, setResetBoostsConfirmOpen] = useState(false)

    const handleResetBoosts = async () => {
        if (!asset || !libraryId) return
        setResetBoostsConfirmOpen(false)
        setResettingBoosts(true)
        try {
            const result = await api.resetBoosts(asset.id, libraryId)
            setAsset((prev) => (prev ? { ...prev, boostCount: result.count, boostedToday: result.boostedToday } : prev))
            onBoostChanged?.(asset.id, result.count, result.boostedToday)
            toaster.create({
                title: result.changed ? "Boosts reset" : "Nothing to reset",
                description: result.changed
                    ? "Every boost for this asset was cleared."
                    : "This asset has no boosts.",
                type: "info",
            })
        } catch {
            toaster.create({
                title: "Reset failed",
                description: "Could not clear the boosts for this asset.",
                type: "error",
            })
        } finally {
            setResettingBoosts(false)
        }
    }

    const handleTagsSaved = (updated: AssetDetailDto) => {
        setAsset(updated)
        setTags(updated.tags)
    }

    const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
    const [imageExpanded, setImageExpanded] = useState(false)
    const [imageOverflows, setImageOverflows] = useState(false)
    const [copiedImage, setCopiedImage] = useState(false)
    const [imageHovered, setImageHovered] = useState(false)
    const imageBoxRef = useRef<HTMLDivElement>(null)

    // Vertical-menu section state, remembered across sessions.
    const [sections, setSections] = useState<Record<SectionKey, boolean>>(readSectionState)
    const toggleSection = useCallback((key: SectionKey) => {
        setSections((prev) => {
            const next = { ...prev, [key]: !prev[key] }
            try {
                localStorage.setItem(SECTION_STORAGE_KEY, JSON.stringify(next))
            } catch {
                // Storage unavailable (private mode) — the toggle still works for this session.
            }
            return next
        })
    }, [])

    // Prefer the ~25 KB thumbnail over the original (often 1–2 MB): the preview
    // is only ever rendered at panel width, and the viewer loads the full file.
    const previewSrc = asset?.thumbnailUrl
        ? API_BASE + asset.thumbnailUrl + "&t=" + encodeURIComponent(asset.lastModified ?? "")
        : null

    // A cached image can be complete before React's onLoad is attached, which
    // would leave the preview stuck at opacity 0 behind its skeleton.
    const previewImgRef = useRef<HTMLImageElement>(null)
    useEffect(() => {
        const el = previewImgRef.current
        if (el && el.complete && el.naturalWidth > 0) setImageLoaded(true)
    }, [previewSrc])

    const handleOpenFullscreen = () => {
        if (!assetId || !libraryId) return
        const shortId = libraryId.length > 8 ? libraryId.slice(0, 8) : libraryId
        // Open in a new tab/window so the library stays intact behind the viewer.
        // No noopener: same-origin, and the viewer needs window.opener set so its
        // close button can window.close() the popup it was opened in.
        window.open(`/${shortId}/view/${assetId}`, "_blank")
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

        // Non-secure context (plain HTTP) — the Clipboard API is not exposed, so programmatic
        // copying is impossible. Skip the request entirely and guide the user to the browser's
        // own context menu, which still offers "Copy image" on the preview <img>.
        if (typeof navigator.clipboard === "undefined" || typeof ClipboardItem === "undefined") {
            toaster.create({
                title: "Copy via browser menu",
                type: "info",
                description: "Clipboard isn't available over HTTP. Right-click the image and select \"Copy image\".",
            })
            return
        }

        setCopiedImage(true)
        setTimeout(() => setCopiedImage(false), 2000)
        try {
            const response = await fetch(API_BASE + "/api/assets/" + assetId + "/clipboard-image?libraryId=" + encodeURIComponent(libraryId!))
            if (!response.ok) {
                if (response.status === 403) {
                    throw new Error("Library is locked. Unlock it and try again.")
                }
                if (response.status === 404) {
                    throw new Error("Image file not found on disk.")
                }
                throw new Error("Server error (" + response.status + ").")
            }
            const blob = await response.blob()
            await navigator.clipboard.write([
                new ClipboardItem({ "image/png": blob }),
            ])
            toaster.create({ title: "Image copied", type: "success" })
        } catch (err) {
            setCopiedImage(false)
            toaster.create({
                title: "Failed to copy image",
                type: "error",
                description: err instanceof Error ? err.message : undefined,
            })
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
        <Stack gap="0" flex="1" minH="0" height="full">
            <Box flex="1" minH="0" overflowY="auto">
                {/* Preview — thumbnail quality; click through to the full-resolution viewer */}
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
                        cursor={asset ? "zoom-in" : "default"}
                        css={{ aspectRatio: asset && asset.width && asset.height ? String(asset.width / asset.height) : "4/3" }}
                        maxH={asset && asset.height > asset.width && !imageExpanded ? "52vh" : undefined}
                        overflow="hidden"
                        onClick={() => { if (asset) handleOpenFullscreen() }}
                    >
                        {(!asset || (!imageLoaded && !error)) && (
                            <Skeleton position="absolute" inset="0" width="full" height="full" />
                        )}
                        {error ? (
                            <Box position="absolute" inset="0" display="flex" alignItems="center" justifyContent="center" bg="bg.muted">
                                <Text color="fg.muted" fontSize="sm">Failed to load</Text>
                            </Box>
                        ) : previewSrc ? (
                            <Image
                                ref={previewImgRef}
                                src={previewSrc}
                                alt={asset?.fileName ?? ""}
                                width="full"
                                height="full"
                                objectFit="cover"
                                objectPosition="top"
                                draggable={false}
                                opacity={imageLoaded ? 1 : 0}
                                transition="opacity 0.3s"
                                onLoad={() => setImageLoaded(true)}
                                onError={() => { setImageLoaded(true); setError(true) }}
                            />
                        ) : null}
                        {/* Preview actions — always visible, so touch and keyboard users can reach them */}
                        {asset && imageLoaded && !error && (
                            <HStack position="absolute" top="2" right="2" gap="1">
                                <IconButton
                                    size="xs"
                                    variant="ghost"
                                    bg="black/55"
                                    color="white"
                                    _hover={{ bg: "black/75" }}
                                    opacity={imageHovered ? 1 : 0.9}
                                    transition="opacity 0.15s"
                                    aria-label="Copy image"
                                    title="Copy image"
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
                                    size="xs"
                                    variant="ghost"
                                    bg="black/55"
                                    color="white"
                                    _hover={{ bg: "black/75" }}
                                    opacity={imageHovered ? 1 : 0.9}
                                    transition="opacity 0.15s"
                                    aria-label="Open fullscreen"
                                    title="Open fullscreen"
                                    onClick={(e) => {
                                        e.stopPropagation()
                                        handleOpenFullscreen()
                                    }}
                                >
                                    <ExpandIcon />
                                </IconButton>
                            </HStack>
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
                    <Stack gap="3" px="2" py="3">
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
                        {/* No filename row: tags are stored in the filename, so the Tags
                        section below already carries the asset's identity. */}

                        {/* Vertical menu */}
                        <Box px="1">
                            <MenuSection
                                icon={<TagIcon />}
                                label="Tags"
                                count={tags.length}
                                open={sections.tags}
                                onToggle={() => toggleSection("tags")}
                            >
                                <TagEditor
                                    tags={tags}
                                    assetId={asset.id}
                                    onTagsChange={handleTagsChange}
                                    onTagClick={onTagClick}
                                    selectedTags={selectedTags}
                                    onTagsSaved={handleTagsSaved}
                                    libraryId={libraryId!}
                                    toaster={toaster}
                                    hideLabel
                                />
                            </MenuSection>

                            {asset.palette && (
                                <MenuSection
                                    icon={<PaletteIcon />}
                                    label="Colors"
                                    open={sections.colors}
                                    onToggle={() => toggleSection("colors")}
                                >
                                    <PaletteBar palette={asset.palette} />
                                </MenuSection>
                            )}

                            <MenuSection
                                icon={<InfoIcon />}
                                label="Details"
                                open={sections.details}
                                onToggle={() => toggleSection("details")}
                            >
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

                                    <Text color="fg.muted">Boosts</Text>
                                    <HStack gap="1.5">
                                        <Box
                                            display="inline-flex"
                                            alignItems="center"
                                            gap="1"
                                            color={asset.boostCount > 0 ? "blue.500" : "fg.subtle"}
                                            _dark={{ color: asset.boostCount > 0 ? "blue.300" : "fg.subtle" }}
                                        >
                                            <BoostIcon />
                                            <Text as="span" fontWeight="medium">{asset.boostCount}</Text>
                                        </Box>
                                        {asset.boostedToday && (
                                            <Badge size="sm" colorPalette="blue" variant="surface" fontWeight="medium">today</Badge>
                                        )}
                                        {asset.boostCount > 0 && (
                                            <IconButton
                                                size="2xs"
                                                variant="ghost"
                                                colorPalette="gray"
                                                loading={resettingBoosts}
                                                onClick={() => setResetBoostsConfirmOpen(true)}
                                                aria-label="Reset boosts"
                                                title="Reset all boosts for this asset"
                                            >
                                                <ResetIcon />
                                            </IconButton>
                                        )}
                                    </HStack>
                                </Box>
                            </MenuSection>
                        </Box>

                        <Box px="1">
                            <MenuSection
                                icon={<LinkIcon />}
                                label="Path"
                                open={sections.path}
                                onToggle={() => toggleSection("path")}
                            >
                                <HStack
                                    bg="bg.subtle"
                                    borderRadius="md"
                                    border="1px solid"
                                    borderColor="border"
                                    px="3"
                                    py="2"
                                    gap="2"
                                >
                                    <Text fontSize="xs" color="fg" flex="1" wordBreak="break-all" lineClamp={3}>
                                        {asset.relativePath}
                                    </Text>
                                    <CopyButton text={asset.relativePath} />
                                </HStack>
                            </MenuSection>
                        </Box>

                    </>
                )}

            </Box>

            {/* Actions — pinned below the scroll area. Copy image / fullscreen already
                live on the preview above, so only the non-duplicated actions stay here. */}
            {asset && !loading && !deleted && (
                <Stack gap="0.5" px="1" py="1" borderTopWidth="1px" borderColor="border" flexShrink="0">
                    <MenuRow icon={<MoveIcon />} label="Move to…" onClick={handleOpenMoveDialog} />
                    <MenuRow icon={<TrashIcon />} label="Delete" tone="danger" onClick={() => setDeleteConfirmOpen(true)} />
                </Stack>
            )}

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

            {/* Reset boosts confirmation dialog */}
            <Dialog.Root open={resetBoostsConfirmOpen} onOpenChange={(e: { open: boolean }) => setResetBoostsConfirmOpen(e.open)}>
                <Portal>
                    <Dialog.Backdrop />
                    <Dialog.Positioner>
                        <Dialog.Content>
                            <Dialog.Header>
                                <Dialog.Title>Reset Boosts</Dialog.Title>
                            </Dialog.Header>
                            <Dialog.Body>
                                <Text fontSize="sm" color="fg">
                                    Clear all {asset?.boostCount ?? 0} boost{(asset?.boostCount ?? 0) === 1 ? "" : "s"} for this asset?
                                    This cannot be undone.
                                </Text>
                            </Dialog.Body>
                            <Dialog.Footer>
                                <Button variant="outline" onClick={() => setResetBoostsConfirmOpen(false)}>
                                    Cancel
                                </Button>
                                <Button colorPalette="red" loading={resettingBoosts} onClick={handleResetBoosts}>
                                    Reset
                                </Button>
                            </Dialog.Footer>
                        </Dialog.Content>
                    </Dialog.Positioner>
                </Portal>
            </Dialog.Root>
        </Stack>
    )
}
