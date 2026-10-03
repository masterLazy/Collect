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
    /** Uniform square cell (grid view) instead of the natural aspect ratio (masonry). */
    uniform?: boolean
    /** Marks this card as the asset currently shown in the sidebar. */
    selected?: boolean
    /** Boost (up-vote) the asset. Omitted for cards that cannot be boosted. */
    onBoost?: (id: string) => void
    /** Take back today's boost (count −1, can be boosted again today). */
    onUndoBoost?: (id: string) => void
    /** Batch mode: activating the card toggles its selection instead of opening the sidebar. */
    selectable?: boolean
    /** Batch mode: whether this card is part of the current batch selection. */
    batchSelected?: boolean
    /** Batch mode: called when the card is activated. */
    onToggleSelect?: () => void
}

function BoostIcon() {
    return (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="19" x2="12" y2="5" />
            <polyline points="5 12 12 5 19 12" />
        </svg>
    )
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

/** Checkmark shown inside the batch-selection indicator of a selected card. */
function CheckIcon() {
    return (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
        </svg>
    )
}

export function AssetCard({ asset, apiBase, onClick, onDragStart, onDragEnd, removed, uniform, selected, onBoost, onUndoBoost, selectable, batchSelected, onToggleSelect }: AssetCardProps) {
    const [loaded, setLoaded] = useState(false)
    const [error, setError] = useState(false)
    const [hovered, setHovered] = useState(false)
    const isLandscape = asset.width > asset.height
    const aspectRatio = uniform ? 1 : (isLandscape ? 4 / 3 : (asset.width && asset.height ? asset.width / asset.height : 4 / 3))

    const isRemoved = !!removed
    const boostedToday = !!asset.boostedToday
    const boostCount = asset.boostCount ?? 0
    // Un-boosted assets stay visually quiet: their pill only appears while the
    // card is hovered (or the pill itself is focused).
    const boostRevealed = boostedToday || boostCount > 0 || hovered
    const canBoost = !!(onBoost || onUndoBoost)

    // In batch mode the whole card acts as a checkbox: drag handle and boost pill
    // are hidden so a click can only mean "toggle selection".
    const activate = () => {
        if (selectable) onToggleSelect?.()
        else onClick()
    }

    return (
        <Box
            cursor={isRemoved ? "default" : "pointer"}
            onClick={isRemoved ? undefined : activate}
            onKeyDown={isRemoved ? undefined : (e: React.KeyboardEvent) => {
                if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault()
                    activate()
                }
            }}
            role={isRemoved ? undefined : (selectable ? "checkbox" : "button")}
            aria-checked={isRemoved ? undefined : (selectable ? !!batchSelected : undefined)}
            tabIndex={isRemoved ? undefined : 0}
            aria-label={selectable ? `${batchSelected ? "Deselect" : "Select"} ${asset.fileName}` : asset.fileName}
            title={asset.fileName}
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

            {/* Batch selection indicator — top-right corner, always visible in batch mode */}
            {!isRemoved && selectable && (
                <Box
                    position="absolute"
                    top="2"
                    right="2"
                    width="24px"
                    height="24px"
                    display="flex"
                    alignItems="center"
                    justifyContent="center"
                    borderRadius="full"
                    border="2px solid"
                    bg={batchSelected ? "blue.600" : "black/50"}
                    borderColor={batchSelected ? "blue.600" : "white"}
                    color="white"
                    boxShadow="sm"
                    pointerEvents="none"
                    zIndex="3"
                >
                    {batchSelected && <CheckIcon />}
                </Box>
            )}

            {/* Drag handle — top-left corner, blends into the card edge, visible on hover */}
            {!isRemoved && !selectable && (
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

            {/* Boost pill — bottom-right corner. White outline on a translucent dark
                scrim while today's boost is available; solid blue once it has been
                given. Hidden until hover for assets that were never boosted.
                Suppressed in batch mode (clicking a card selects, not boosts). */}
            {!isRemoved && canBoost && !selectable && (
                <Box
                    as="button"
                    position="absolute"
                    bottom="1.5"
                    right="1.5"
                    display="flex"
                    alignItems="center"
                    gap="1"
                    px="2"
                    height="24px"
                    borderRadius="full"
                    border="2px solid"
                    bg={boostedToday ? "blue.600" : "black/55"}
                    borderColor={boostedToday ? "blue.600" : "white"}
                    color="white"
                    fontSize="xs"
                    fontWeight="bold"
                    lineHeight="1"
                    cursor="pointer"
                    boxShadow="sm"
                    opacity={boostedToday ? 1 : (boostRevealed ? 0.8 : 0)}
                    pointerEvents={boostRevealed ? "auto" : "none"}
                    transition="opacity 0.2s, background 0.2s, border-color 0.2s"
                    _hover={boostedToday
                        ? { bg: "blue.500", borderColor: "blue.500", opacity: 1 }
                        : { bg: "black/75", opacity: 1 }}
                    _focusVisible={{ opacity: 1, outline: "2px solid", outlineColor: "white", outlineOffset: "2px" }}
                    onClick={(e: React.MouseEvent) => {
                        e.stopPropagation()
                        if (boostedToday) onUndoBoost?.(asset.id)
                        else onBoost?.(asset.id)
                    }}
                    onKeyDown={(e: React.KeyboardEvent) => e.stopPropagation()}
                    aria-label={boostedToday ? `Undo today's boost (${boostCount})` : "Boost this asset"}
                    title={
                        boostedToday
                            ? `Boosted today \u00b7 click to undo (${boostCount} boost${boostCount === 1 ? "" : "s"})`
                            : boostCount > 0
                                ? `Boost \u00b7 ${boostCount} boost${boostCount === 1 ? "" : "s"} so far`
                                : "Boost \u00b7 one per day"
                    }
                    zIndex="1"
                >
                    <BoostIcon />
                    {boostCount > 0 && <Box as="span">{boostCount}</Box>}
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

            {/* Selected ring — the sidebar shows this asset, so mark it in the grid */}
            {selected && !isRemoved && (
                <Box
                    position="absolute"
                    inset="0"
                    border="2px solid"
                    borderColor="blue.600"
                    borderRadius="md"
                    pointerEvents="none"
                    zIndex="3"
                />
            )}
        </Box>
    )
}
