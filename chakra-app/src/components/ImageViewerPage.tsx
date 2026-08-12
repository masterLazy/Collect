import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import {
    Box,
    Button,
    Center,
    HStack,
    IconButton,
    Image,
    Separator,
    Spinner,
    Text,
    VStack,
} from "@chakra-ui/react"
import { useDocumentTitle } from "../hooks/useDocumentTitle"
import { api, API_BASE } from "../services/api"
import type { AssetDetailDto } from "../types"
import { CopyButton } from "./CopyButton"
import { PaletteBar } from "./PaletteBar"
import { TagBadge } from "./TagBadge"
import { useCustomToaster, ToastContainer } from "./CustomToast"
import { formatSize, formatDate, getClosestAspectRatio } from "../lib/assetMeta"

// Absolute display scales, multiples of the image's NATURAL size (1 = 100%).
const BASE_ZOOM_SCALES = [0.1, 0.2, 0.3, 0.45, 0.7, 1.0, 1.0, 1.5, 2.2, 3.3]

// Time of no pointer activity before the control overlay fades out.
const CONTROLS_IDLE_MS = 2000

function ArrowLeftIcon() {
    return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5M12 19l-7-7 7-7" />
        </svg>
    )
}

function PlusIcon() {
    return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
    )
}

function MinusIcon() {
    return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
    )
}

function InfoIcon() {
    return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <path d="M12 16v-4M12 8h.01" />
        </svg>
    )
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

function CheckIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
        </svg>
    )
}

export function ImageViewerPage() {
    const { libraryId, assetId } = useParams()
    const navigate = useNavigate()
    const toaster = useCustomToaster()

    const [asset, setAsset] = useState<AssetDetailDto | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState(false)
    const [imageLoaded, setImageLoaded] = useState(false)

    // Zoom / pan state. The refs hold the authoritative values used by the
    // center-anchored zoom math; the state mirrors them for rendering.
    // currentScale is an ABSOLUTE display scale relative to the image's natural
    // pixel size (1 = 100%). isAtFit tracks whether the user is at the Fit position.
    const [currentScale, setCurrentScale] = useState(1)
    const [panX, setPanX] = useState(0)
    const [panY, setPanY] = useState(0)
    const [fitScale, setFitScale] = useState(1) // effective scale of Fit mode
    const [isAtFit, setIsAtFit] = useState(true)
    const [isDragging, setIsDragging] = useState(false)
    const currentScaleRef = useRef(1)
    const isAtFitRef = useRef(true)
    const panRef = useRef({ x: 0, y: 0 })
    const fitScaleRef = useRef(1)
    const dragStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 })
    const containerRef = useRef<HTMLDivElement>(null)

    // UI state
    const [controlsVisible, setControlsVisible] = useState(true)
    const [infoOpen, setInfoOpen] = useState(false)
    const [copiedImage, setCopiedImage] = useState(false)
    const idleTimerRef = useRef<ReturnType<typeof setTimeout>>()

    const isZoomed = !isAtFit
    // effectiveScale is the absolute display scale relative to the image's
    // natural pixel size (1 = 100%).
    const effectiveScale = currentScale

    // Derived, sorted zoom list: the Fit scale is inserted at its real value and
    // the list is sorted ascending so Fit sits at its true position. That way
    // `+` from Fit goes to the next LARGER scale and `-` to the next SMALLER one.
    const zoomEntries = useMemo(() => {
        const scales = Array.from(new Set([...BASE_ZOOM_SCALES, fitScale])).sort((a, b) => a - b)
        return scales.map((s) => ({
            scale: s,
            label: Math.abs(s - fitScale) < 1e-6 ? "Fit" : Math.round(s * 100) + "%",
        }))
    }, [fitScale])

    // Index of a scale within zoomEntries (nearest entry by value). Used for
    // stepping (+/-) and for enabling/disabling the zoom buttons.
    const findZoomIndex = useCallback((scale: number) => {
        let best = 0
        let bestDiff = Number.POSITIVE_INFINITY
        for (let i = 0; i < zoomEntries.length; i++) {
            const diff = Math.abs(zoomEntries[i].scale - scale)
            if (diff < bestDiff) {
                bestDiff = diff
                best = i
            }
        }
        return best
    }, [zoomEntries])

    const zoomIndex = findZoomIndex(currentScale)
    const canZoomOut = zoomIndex > 0
    const canZoomIn = zoomIndex < zoomEntries.length - 1
    const currentLabel = zoomEntries[zoomIndex]?.label ?? "Fit"

    // Read-only display tags: categorized tags first, uncategorized last,
    // preserving relative order within each group (stable sort).
    const sortedTags = asset ? [...(asset.tags ?? [])].sort((a, b) => (a.type ? 0 : 1) - (b.type ? 0 : 1)) : []

    // Page title — uses asset fileName once loaded
    useDocumentTitle(asset ? `${asset.fileName} · Collect` : "Collect")

    // Load asset
    useEffect(() => {
        if (!assetId) {
            setError(true)
            setLoading(false)
            return
        }
        api.getAsset(assetId, libraryId!)
            .then((data) => {
                setAsset(data)
            })
            .catch(() => setError(true))
            .finally(() => setLoading(false))
    }, [assetId, libraryId])

    const setPan = useCallback((x: number, y: number) => {
        panRef.current = { x, y }
        setPanX(x)
        setPanY(y)
    }, [])

    // Compute pan limits so the image doesn't go off-screen when zoomed.
    // Overflow-based: when the rendered image (natural size × effective scale)
    // is smaller than the container in a dimension the limit is 0, which keeps
    // it centered (no off-screen panning at Fit). When zoomed in, the limit
    // grows so every edge is reachable exactly.
    const clampPan = useCallback((x: number, y: number) => {
        const container = containerRef.current
        if (!container) return { x, y }
        const cw = container.clientWidth
        const ch = container.clientHeight
        const scale = currentScaleRef.current
        const imgW = asset?.width ?? 0
        const imgH = asset?.height ?? 0
        const limitX = Math.max(0, (imgW * scale - cw) / 2)
        const limitY = Math.max(0, (imgH * scale - ch) / 2)
        return {
            x: Math.max(-limitX, Math.min(limitX, x)),
            y: Math.max(-limitY, Math.min(limitY, y)),
        }
    }, [asset])

    // Fit scale = the largest scale that fits the whole image in the container
    const recomputeFitScale = useCallback(() => {
        const container = containerRef.current
        if (!container || !asset || !asset.width || !asset.height) return
        const cw = container.clientWidth
        const ch = container.clientHeight
        if (!cw || !ch) return
        const scale = Math.min(cw / asset.width, ch / asset.height)
        fitScaleRef.current = scale
        setFitScale(scale)
    }, [asset])

    // Recompute Fit scale on mount and whenever the container resizes
    useEffect(() => {
        recomputeFitScale()
        const container = containerRef.current
        if (!container) return
        const ro = new ResizeObserver(() => recomputeFitScale())
        ro.observe(container)
        return () => ro.disconnect()
    }, [recomputeFitScale])

    // Keep currentScale tracking Fit whenever the user is at Fit. This covers
    // both the initial measure (asset load) and window/container resizes. Once
    // the user zooms away (isAtFitRef.current === false) their absolute scale
    // is left untouched.
    useEffect(() => {
        if (isAtFitRef.current) {
            currentScaleRef.current = fitScale
            setCurrentScale(fitScale)
        }
    }, [fitScale])

    // Center-anchored zoom: keep the viewport-center pixel fixed across scale
    // changes. With transform-origin center an image point p renders at
    // center + pan + scale*p, so the center pixel is p = -pan/scale. Keeping it
    // at the viewport center requires pan_new = pan_old * scale_new / scale_old.
    const applyZoomBy = useCallback((delta: number) => {
        const oldScale = currentScaleRef.current
        const idx = findZoomIndex(oldScale)
        const newIdx = Math.max(0, Math.min(zoomEntries.length - 1, idx + delta))
        const newScale = zoomEntries[newIdx].scale
        if (newScale === oldScale) return

        // Update the authoritative scale before clamping so clampPan computes
        // limits from the TARGET scale — this keeps center-anchored zoom exact
        // (otherwise zoom-in would clamp against the stale, smaller limit).
        currentScaleRef.current = newScale

        const atFit = Math.abs(newScale - fitScaleRef.current) < 1e-6
        if (atFit) {
            // Returning to Fit — recenter the image
            setPan(0, 0)
        } else {
            // Keep the center pixel fixed, then clamp so the image stays on-screen
            const ratio = newScale / oldScale
            const clamped = clampPan(panRef.current.x * ratio, panRef.current.y * ratio)
            setPan(clamped.x, clamped.y)
        }

        setCurrentScale(newScale)
        isAtFitRef.current = atFit
        setIsAtFit(atFit)
    }, [findZoomIndex, zoomEntries, clampPan, setPan])

    // Return to Fit: recenter the image and snap the scale to the current Fit
    // scale. The zoom-label button is a Fit toggle.
    const resetToFit = useCallback(() => {
        setPan(0, 0)
        currentScaleRef.current = fitScaleRef.current
        setCurrentScale(fitScaleRef.current)
        isAtFitRef.current = true
        setIsAtFit(true)
    }, [setPan])

    // Auto-hiding control overlay: visible on mount and on any pointer activity,
    // fades out after a short idle period.
    const showControls = useCallback(() => {
        setControlsVisible(true)
        if (idleTimerRef.current) clearTimeout(idleTimerRef.current)
        idleTimerRef.current = setTimeout(() => setControlsVisible(false), CONTROLS_IDLE_MS)
    }, [])

    useEffect(() => {
        showControls()
        return () => {
            if (idleTimerRef.current) clearTimeout(idleTimerRef.current)
        }
    }, [showControls])

    // Close: script-opened windows (window.open) close themselves; otherwise
    // navigate back to the library (works for direct URL visits too).
    const handleBack = useCallback(() => {
        if (window.opener) {
            try {
                window.close()
                return
            } catch {
                // fall through to in-app navigation
            }
        }
        if (libraryId) {
            const shortId = libraryId.length > 8 ? libraryId.slice(0, 8) : libraryId
            navigate(`/${shortId}`)
        } else {
            navigate("/")
        }
    }, [libraryId, navigate])

    // Keyboard: Escape closes, +/- zoom. Ignored while typing in inputs so the
    // tag editor keeps its own keys.
    useEffect(() => {
        const isTypingTarget = (target: EventTarget | null): boolean => {
            const el = target as HTMLElement | null
            if (!el) return false
            return el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable
        }
        const onKeyDown = (e: KeyboardEvent) => {
            if (isTypingTarget(e.target)) return
            if (e.key === "Escape") {
                handleBack()
            } else if (e.key === "=" || e.key === "+") {
                applyZoomBy(1)
            } else if (e.key === "-") {
                applyZoomBy(-1)
            }
        }
        window.addEventListener("keydown", onKeyDown)
        return () => window.removeEventListener("keydown", onKeyDown)
    }, [handleBack, applyZoomBy])

    // Wheel zoom must call preventDefault(), so attach a native non-passive
    // listener (React's wheel handler is registered passive and cannot
    // reliably preventDefault). `asset` is a dep so the listener attaches once
    // the image container has mounted.
    useEffect(() => {
        const container = containerRef.current
        if (!container) return
        const onWheel = (e: WheelEvent) => {
            e.preventDefault()
            showControls()
            if (e.deltaY < 0) {
                applyZoomBy(1)
            } else if (e.deltaY > 0) {
                applyZoomBy(-1)
            }
        }
        container.addEventListener("wheel", onWheel, { passive: false })
        return () => container.removeEventListener("wheel", onWheel)
    }, [applyZoomBy, showControls, asset])

    // Pointer/pan handlers
    const handlePointerDown = useCallback((e: React.PointerEvent) => {
        showControls()
        if (!isZoomed) return
        setIsDragging(true)
        dragStart.current = { x: e.clientX, y: e.clientY, panX: panRef.current.x, panY: panRef.current.y }
        e.currentTarget.setPointerCapture(e.pointerId)
    }, [isZoomed, showControls])

    const handlePointerMove = useCallback((e: React.PointerEvent) => {
        if (!isDragging) return
        const dx = e.clientX - dragStart.current.x
        const dy = e.clientY - dragStart.current.y
        const clamped = clampPan(dragStart.current.panX + dx, dragStart.current.panY + dy)
        setPan(clamped.x, clamped.y)
    }, [isDragging, clampPan, setPan])

    const handlePointerUp = useCallback(() => {
        setIsDragging(false)
    }, [])

    const handleCopyImage = useCallback(async () => {
        if (!asset || !assetId) return

        // Non-secure context (plain HTTP) — the Clipboard API is not exposed, so
        // programmatic copying is impossible. Guide the user to the browser's own
        // context menu, which still offers "Copy image" on the preview <img>.
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
    }, [asset, assetId, libraryId, toaster])

    return (
        <Box
            height="100vh"
            width="100vw"
            bg="black"
            className="dark"
            position="relative"
            overflow="hidden"
            onPointerMove={showControls}
            onPointerDown={showControls}
        >
            {/* Loading */}
            {loading && (
                <Center height="100vh">
                    <Spinner size="xl" color="white" />
                </Center>
            )}

            {/* Error */}
            {error && !loading && (
                <Center height="100vh">
                    <VStack gap="3">
                        <Text color="white" fontSize="lg">Failed to load image</Text>
                        <Button variant="outline" colorPalette="accent" onClick={handleBack}>
                            Back to library
                        </Button>
                    </VStack>
                </Center>
            )}

            {/* Full-bleed image area */}
            {asset && !loading && !error && (
                <Box
                    ref={containerRef}
                    position="absolute"
                    inset="0"
                    overflow="hidden"
                    cursor={isZoomed ? (isDragging ? "grabbing" : "grab") : "default"}
                    onPointerDown={handlePointerDown}
                    onPointerMove={handlePointerMove}
                    onPointerUp={handlePointerUp}
                    onPointerCancel={handlePointerUp}
                >
                    {!imageLoaded && (
                        <Center position="absolute" inset="0" zIndex="1">
                            <Spinner color="white" size="xl" />
                        </Center>
                    )}
                    <Box
                        position="absolute"
                        inset="0"
                        display="flex"
                        alignItems="center"
                        justifyContent="center"
                    >
                        {/* Centered container: transform-origin center, so an image
                            point at offset p renders at center + pan + scale*p. */}
                        <Box
                            style={{
                                transform: `translate(${panX}px, ${panY}px) scale(${effectiveScale})`,
                                transformOrigin: "center center",
                            }}
                            transition={isDragging ? "none" : "transform 0.3s ease-out"}
                        >
                            <Image
                                src={API_BASE + "/api/assets/" + assetId + "/image?t=" + encodeURIComponent(asset.lastModified ?? "") + "&libraryId=" + encodeURIComponent(libraryId!)}
                                alt={asset.fileName}
                                maxWidth="none"
                                maxHeight="none"
                                opacity={imageLoaded ? 1 : 0}
                                transition="opacity 0.3s"
                                onLoad={() => setImageLoaded(true)}
                                onError={() => { setImageLoaded(true); setError(true) }}
                                userSelect="none"
                                draggable={false}
                            />
                        </Box>
                    </Box>
                </Box>
            )}

            {/* Auto-hiding control overlay */}
            {asset && !loading && !error && (
                <Box
                    position="absolute"
                    inset="0"
                    zIndex="10"
                    pointerEvents="none"
                    opacity={controlsVisible ? 1 : 0}
                    transition="opacity 0.25s"
                >
                    {/* Top-left: back/close + file name */}
                    <HStack
                        position="absolute"
                        top="3"
                        left="3"
                        gap="2"
                        px="3"
                        py="1.5"
                        borderRadius="full"
                        bg="black/50"
                        backdropFilter="auto"
                        backdropBlur="sm"
                        alignItems="center"
                        pointerEvents="auto"
                        maxWidth="calc(100vw - 24px)"
                        paddingRight="4"
                    >
                        <IconButton
                            borderRadius="full"
                            variant="ghost"
                            color="white"
                            size="sm"
                            onClick={handleBack}
                            aria-label="Back to library"
                            _hover={{ bg: "white/10" }}
                        >
                            <ArrowLeftIcon />
                        </IconButton>
                        {asset && (
                            <Text
                                color="white"
                                fontSize="sm"
                                fontWeight="medium"
                                lineHeight="1"
                                truncate
                            >
                                {asset.fileName}
                            </Text>
                        )}
                    </HStack>

                    {/* Bottom-center: zoom controls, dimensions, info toggle */}
                    <HStack
                        position="absolute"
                        bottom="3"
                        left="50%"
                        transform="translateX(-50%)"
                        gap="1"
                        px="3"
                        py="1.5"
                        borderRadius="full"
                        bg="black/50"
                        backdropFilter="auto"
                        backdropBlur="sm"
                        pointerEvents="auto"
                        maxWidth="calc(100vw - 24px)"
                    >
                        <IconButton
                            borderRadius="full"
                            variant="ghost"
                            color="white"
                            size="xs"
                            onClick={() => applyZoomBy(-1)}
                            disabled={!canZoomOut}
                            aria-label="Zoom out"
                            _hover={{ bg: "white/10" }}
                        >
                            <MinusIcon />
                        </IconButton>
                        <Button
                            variant="ghost"
                            color="white"
                            size="xs"
                            minW="48px"
                            px="2"
                            onClick={resetToFit}
                            title="Reset to Fit"
                            _hover={{ bg: "white/10" }}
                        >
                            {currentLabel}
                        </Button>
                        <IconButton
                            borderRadius="full"
                            variant="ghost"
                            color="white"
                            size="xs"
                            onClick={() => applyZoomBy(1)}
                            disabled={!canZoomIn}
                            aria-label="Zoom in"
                            _hover={{ bg: "white/10" }}
                        >
                            <PlusIcon />
                        </IconButton>
                        <Box as="span" color="whiteAlpha.600" mx="1" userSelect="none">|</Box>
                        <Text color="white" fontSize="xs" userSelect="none" whiteSpace="nowrap">
                            {asset.width} × {asset.height}
                        </Text>
                        <Box as="span" color="whiteAlpha.600" mx="1" userSelect="none">·</Box>
                        <IconButton
                            borderRadius="full"
                            variant="ghost"
                            color="white"
                            size="xs"
                            onClick={() => setInfoOpen((prev) => !prev)}
                            aria-label="Toggle details"
                            aria-pressed={infoOpen}
                            bg={infoOpen ? "white/15" : undefined}
                            _hover={{ bg: "white/10" }}
                        >
                            <InfoIcon />
                        </IconButton>
                    </HStack>
                </Box>
            )}

            {/* Details panel — secondary menu, slides in from the right */}
            {asset && !loading && !error && (
                <Box
                    position="absolute"
                    top="0"
                    right="0"
                    bottom="0"
                    zIndex="20"
                    width={{ base: "min(92vw, 380px)", md: "380px" }}
                    bg="black/85"
                    backdropFilter="auto"
                    backdropBlur="lg"
                    borderLeft="1px solid"
                    borderColor="whiteAlpha.200"
                    transform={infoOpen ? "translateX(0)" : "translateX(102%)"}
                    transition="transform 0.2s ease-in-out"
                    pointerEvents={infoOpen ? "auto" : "none"}
                    overflowY="auto"
                    boxShadow="2xl"
                >
                    <HStack
                        justify="space-between"
                        px="4"
                        py="3"
                        borderBottom="1px solid"
                        borderColor="whiteAlpha.200"
                    >
                        <Text color="white" fontWeight="semibold" fontSize="sm">Details</Text>
                        <IconButton
                            variant="ghost"
                            color="white"
                            size="xs"
                            onClick={() => setInfoOpen(false)}
                            aria-label="Close details"
                            _hover={{ bg: "white/10" }}
                        >
                            <XIcon />
                        </IconButton>
                    </HStack>

                    <VStack gap="4" p="4" alignItems="stretch">
                        {/* Tags (read-only) */}
                        <Box>
                            <Text color="whiteAlpha.700" fontSize="sm" mb="1.5">Tags</Text>
                            {sortedTags.length > 0 ? (
                                <HStack gap="2" flexWrap="wrap">
                                    {sortedTags.map((tag) => (
                                        <TagBadge
                                            key={(tag.type ?? "") + ":" + tag.value}
                                            value={tag.value}
                                            type={tag.type}
                                            variant="subtle"
                                            size="md"
                                        />
                                    ))}
                                </HStack>
                            ) : (
                                <Text color="whiteAlpha.500" fontSize="sm">No tags</Text>
                            )}
                        </Box>

                        {/* Colors */}
                        {asset.palette && (
                            <Box>
                                <Text color="whiteAlpha.700" fontSize="sm" mb="1.5">Colors</Text>
                                <PaletteBar palette={asset.palette} />
                            </Box>
                        )}

                        {/* Metadata grid */}
                        <Box display="grid" gridTemplateColumns="auto 1fr" gapX="3" gapY="1.5" fontSize="sm">
                            <Text color="whiteAlpha.600">Resolution</Text>
                            <Text color="white">{asset.width} × {asset.height}</Text>

                            <Text color="whiteAlpha.600">Aspect Ratio</Text>
                            <Text color="white">
                                {(() => {
                                    const ar = getClosestAspectRatio(asset.width, asset.height)
                                    if (!ar) return "—"
                                    return (
                                        <>
                                            <Text as="span">{ar.text}</Text>
                                            {ar.label && (
                                                <Box
                                                    as="span"
                                                    ml="1.5"
                                                    px="1.5"
                                                    py="0.5"
                                                    borderRadius="sm"
                                                    bg="whiteAlpha.200"
                                                    color="whiteAlpha.800"
                                                    fontSize="xs"
                                                    fontWeight="medium"
                                                    verticalAlign="middle"
                                                >
                                                    {ar.label}
                                                </Box>
                                            )}
                                            {ar.percent < 95 && (
                                                <Text as="span" color="whiteAlpha.500" fontSize="sm" ml="2">
                                                    {ar.percent.toFixed(1)}%
                                                </Text>
                                            )}
                                        </>
                                    )
                                })()}
                            </Text>

                            <Text color="whiteAlpha.600">Size</Text>
                            <Text color="white">{formatSize(asset.fileSize)}</Text>

                            <Text color="whiteAlpha.600">Type</Text>
                            <Text color="white">{asset.mimeType}</Text>

                            <Text color="whiteAlpha.600">Last Modified</Text>
                            <Text color="white">{formatDate(asset.lastModified ?? asset.importedAt)}</Text>
                        </Box>

                        {/* Path with copy */}
                        <Box>
                            <Text color="whiteAlpha.600" fontSize="xs" mb="1">Path</Text>
                            <HStack
                                bg="whiteAlpha.100"
                                borderRadius="md"
                                border="1px solid"
                                borderColor="whiteAlpha.200"
                                px="3"
                                py="2"
                                gap="2"
                                _hover={{ borderColor: "whiteAlpha.400" }}
                                transition="border-color 0.15s"
                            >
                                <Text fontSize="xs" color="white" flex="1" wordBreak="break-all" lineClamp={2}>
                                    {asset.relativePath}
                                </Text>
                                {/* CopyButton resolves to dark-mode tokens inside the
                                    viewer's `dark` scope, so no white override is needed. */}
                                <Box display="inline-flex">
                                    <CopyButton text={asset.relativePath} colorPalette="gray" />
                                </Box>
                            </HStack>
                        </Box>

                        <Separator borderColor="whiteAlpha.200" />

                        {/* Actions */}
                        <VStack gap="2" alignItems="stretch">
                            <Button
                                size="xs"
                                variant="outline"
                                colorPalette="gray"
                                color="white"
                                borderColor="whiteAlpha.300"
                                onClick={handleCopyImage}
                            >
                                {copiedImage ? <CheckIcon /> : <CopyIcon />}
                                <Box as="span" ml="1">{copiedImage ? "Copied!" : "Copy image"}</Box>
                            </Button>
                        </VStack>
                        <Box pb="2" />
                    </VStack>
                </Box>
            )}

            <ToastContainer toasts={toaster.toasts} onDismiss={toaster.dismiss} />
        </Box>
    )
}
