import { useCallback, useEffect, useRef, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { Box, Button, Center, HStack, IconButton, Image, Spinner, Text, VStack } from "@chakra-ui/react"
import { useDocumentTitle } from "../hooks/useDocumentTitle"
import { api, API_BASE } from "../services/api"
import type { AssetDetailDto } from "../types"

// Zoom levels (multiplier relative to fit-to-screen size)
const ZOOM_LEVELS = [0, 1, 1.5, 2, 3, 4]
const ZOOM_LABELS = ["Fit", "100%", "150%", "200%", "300%", "400%"]

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

export function ImageViewerPage() {
    const { libraryId, assetId } = useParams()
    const navigate = useNavigate()
    const [asset, setAsset] = useState<AssetDetailDto | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState(false)
    const [imageLoaded, setImageLoaded] = useState(false)

    // Zoom state
    const [zoomLevel, setZoomLevel] = useState(0) // 0 = fit to screen
    const [panX, setPanX] = useState(0)
    const [panY, setPanY] = useState(0)
    const [isDragging, setIsDragging] = useState(false)
    const dragStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 })
    const imageRef = useRef<HTMLImageElement>(null)
    const containerRef = useRef<HTMLDivElement>(null)

    const isZoomed = zoomLevel > 0

    // Page title — uses asset fileName once loaded
    useDocumentTitle(asset ? `${asset.fileName} · Collect` : "Collect")

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
    }, [assetId])

    // Reset pan when zoom changes
    useEffect(() => {
        setPanX(0)
        setPanY(0)
    }, [zoomLevel])

    // Keyboard navigation
    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                handleBack()
            } else if (e.key === "=" || e.key === "+") {
                handleZoomIn()
            } else if (e.key === "-") {
                handleZoomOut()
            }
        }
        window.addEventListener("keydown", onKeyDown)
        return () => window.removeEventListener("keydown", onKeyDown)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [libraryId, zoomLevel])

    const handleBack = () => {
        if (libraryId) {
            const shortId = libraryId.length > 8 ? libraryId.slice(0, 8) : libraryId
            navigate(`/${shortId}`)
        } else {
            navigate("/")
        }
    }

    const handleZoomIn = () => {
        setZoomLevel((prev) => Math.min(prev + 1, ZOOM_LEVELS.length - 1))
    }

    const handleZoomOut = () => {
        setZoomLevel((prev) => Math.max(prev - 1, 0))
    }

    // Compute pan limits so image doesn't go off-screen when zoomed
    const clampPan = useCallback((x: number, y: number) => {
        const container = containerRef.current
        if (!container) return { x, y }
        const cw = container.clientWidth
        const ch = container.clientHeight
        // Allow roughly half the container size as pan in each direction
        const limitX = cw * 0.5
        const limitY = ch * 0.5
        return {
            x: Math.max(-limitX, Math.min(limitX, x)),
            y: Math.max(-limitY, Math.min(limitY, y)),
        }
    }, [])

    // Mouse/pointer drag handlers
    const handlePointerDown = useCallback((e: React.PointerEvent) => {
        if (!isZoomed) return
        setIsDragging(true)
        dragStart.current = { x: e.clientX, y: e.clientY, panX, panY }
        e.currentTarget.setPointerCapture(e.pointerId)
    }, [isZoomed, panX, panY])

    const handlePointerMove = useCallback((e: React.PointerEvent) => {
        if (!isDragging) return
        const dx = e.clientX - dragStart.current.x
        const dy = e.clientY - dragStart.current.y
        const clamped = clampPan(dragStart.current.panX + dx, dragStart.current.panY + dy)
        setPanX(clamped.x)
        setPanY(clamped.y)
    }, [isDragging, clampPan])

    const handlePointerUp = useCallback(() => {
        setIsDragging(false)
    }, [])

    // Wheel zoom
    const handleWheel = useCallback((e: React.WheelEvent) => {
        e.preventDefault()
        if (e.deltaY < 0) {
            setZoomLevel((prev) => Math.min(prev + 1, ZOOM_LEVELS.length - 1))
        } else if (e.deltaY > 0) {
            setZoomLevel((prev) => Math.max(prev - 1, 0))
        }
    }, [])

    // Compute transform
    const zoomMultiplier = ZOOM_LEVELS[zoomLevel] ?? 0
    const isFit = zoomLevel === 0

    return (
        <Box
            height="100vh"
            width="100vw"
            bg="black"
            display="flex"
            flexDirection="column"
            position="relative"
            overflow="hidden"
        >
            {/* Top bar — back button + file name */}
            <HStack
                position="absolute"
                top="0"
                left="0"
                right="0"
                zIndex="10"
                justify="space-between"
                px="4"
                py="3"
                bg="black/50"
                backdropFilter="auto"
                backdropBlur="sm"
            >
                <HStack gap="3">
                    <IconButton
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
                        <Text color="white" fontSize="sm" fontWeight="medium">
                            {asset.fileName}
                        </Text>
                    )}
                </HStack>
            </HStack>

            {/* Image area */}
            <Box
                ref={containerRef}
                flex="1"
                position="relative"
                overflow="hidden"
                cursor={isZoomed ? (isDragging ? "grabbing" : "grab") : "default"}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerUp}
                onWheel={handleWheel}
            >
                {loading && (
                    <Center height="full">
                        <Spinner size="xl" color="white" />
                    </Center>
                )}
                {error && !loading && (
                    <Center height="full">
                        <VStack gap="3">
                            <Text color="white" fontSize="lg">Failed to load image</Text>
                            <Button variant="outline" colorPalette="accent" onClick={handleBack}>
                                Back to library
                            </Button>
                        </VStack>
                    </Center>
                )}
                {asset && !loading && !error && (
                    <Center
                        height="full"
                        width="full"
                        position="relative"
                    >
                        {!imageLoaded && (
                            <Spinner position="absolute" color="white" zIndex="1" />
                        )}
                        {isFit ? (
                            <Image
                                ref={imageRef}
                                src={API_BASE + "/api/assets/" + assetId + "/image?t=" + encodeURIComponent(asset.lastModified ?? "") + "&libraryId=" + encodeURIComponent(libraryId!)}
                                alt={asset.fileName}
                                maxWidth="95%"
                                maxHeight="calc(100vh - 100px)"
                                objectFit="contain"
                                opacity={imageLoaded ? 1 : 0}
                                transition="opacity 0.3s"
                                onLoad={() => setImageLoaded(true)}
                                onError={() => { setImageLoaded(true); setError(true) }}
                                userSelect="none"
                                draggable={false}
                            />
                        ) : (
                            <Box
                                position="relative"
                                transform={`translate(${panX}px, ${panY}px)`}
                                transition={isDragging ? "none" : "transform 0.15s ease-out"}
                                style={{ transformOrigin: "center center" }}
                            >
                                <Image
                                    ref={imageRef}
                                    src={API_BASE + "/api/assets/" + assetId + "/image?t=" + encodeURIComponent(asset.lastModified ?? "") + "&libraryId=" + encodeURIComponent(libraryId!)}
                                    alt={asset.fileName}
                                    opacity={imageLoaded ? 1 : 0}
                                    transition="opacity 0.3s"
                                    onLoad={() => setImageLoaded(true)}
                                    onError={() => { setImageLoaded(true); setError(true) }}
                                    userSelect="none"
                                    draggable={false}
                                    style={{
                                        transform: `scale(${zoomMultiplier})`,
                                        transformOrigin: "center center",
                                    }}
                                />
                            </Box>
                        )}
                    </Center>
                )}
            </Box>

            {/* Bottom zoom bar */}
            {asset && !loading && !error && (
                <HStack
                    position="absolute"
                    bottom="0"
                    left="0"
                    right="0"
                    zIndex="10"
                    justify="center"
                    px="4"
                    py="3"
                    bg="black/50"
                    backdropFilter="auto"
                    backdropBlur="sm"
                    gap="3"
                >
                    <IconButton
                        variant="ghost"
                        color="white"
                        size="xs"
                        onClick={handleZoomOut}
                        disabled={zoomLevel === 0}
                        aria-label="Zoom out"
                        _hover={{ bg: "white/10" }}
                    >
                        <MinusIcon />
                    </IconButton>
                    <Text color="white" fontSize="sm" minW="48px" textAlign="center" userSelect="none">
                        {ZOOM_LABELS[zoomLevel]}
                    </Text>
                    <IconButton
                        variant="ghost"
                        color="white"
                        size="xs"
                        onClick={handleZoomIn}
                        disabled={zoomLevel === ZOOM_LEVELS.length - 1}
                        aria-label="Zoom in"
                        _hover={{ bg: "white/10" }}
                    >
                        <PlusIcon />
                    </IconButton>
                    <Box as="span" color="whiteAlpha.600" mx="2">|</Box>
                    <Text color="white" fontSize="xs">
                        {asset.width} × {asset.height}
                    </Text>
                    <Box as="span" color="whiteAlpha.600" mx="1">·</Box>
                    <Text color="white" fontSize="xs">
                        {asset.mimeType}
                    </Text>
                </HStack>
            )}
        </Box>
    )
}
