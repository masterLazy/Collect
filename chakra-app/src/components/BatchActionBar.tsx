import { ActionBar, Button, IconButton, Text } from "@chakra-ui/react"

export interface BatchActionBarProps {
    /** Batch mode is on — the bar stays mounted for as long as it is. */
    open: boolean
    /** Number of currently selected assets. */
    count: number
    /** Number of assets loaded in the current view (used to size "Select all"). */
    total: number
    /** A batch operation is running — all actions are disabled. */
    busy?: boolean
    /** Leave batch mode (also fired by Escape / the close trigger). */
    onExit: () => void
    onSelectAll: () => void
    onClear: () => void
    onMove: () => void
    onDelete: () => void
    onTags: () => void
}

function MoveIcon() {
    return (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
            <polyline points="12 11 15 14 12 17" />
            <line x1="9" y1="14" x2="15" y2="14" />
        </svg>
    )
}

function TagIcon() {
    return (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0l-7.2-7.2A2 2 0 0 1 2.8 12V4.8A2 2 0 0 1 4.8 2.8H12a2 2 0 0 1 1.4.6l7.2 7.2a2 2 0 0 1 0 2.8Z" />
            <circle cx="7.5" cy="7.5" r="1.5" />
        </svg>
    )
}

function TrashIcon() {
    return (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
        </svg>
    )
}

function XIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 6L6 18M6 6l12 12" />
        </svg>
    )
}

/**
 * Chakra UI `ActionBar` shown while batch mode is active. It floats above the
 * gallery and only exposes the three batch operations; confirmations live in
 * their own dialogs so destructive actions are never one click away.
 */
export function BatchActionBar({ open, count, total, busy, onExit, onSelectAll, onClear, onMove, onDelete, onTags }: BatchActionBarProps) {
    const noSelection = count === 0 || !!busy

    return (
        <ActionBar.Root
            open={open}
            onOpenChange={(details: { open: boolean }) => {
                if (!details.open) onExit()
            }}
            // Selecting assets means clicking outside the bar all the time.
            closeOnInteractOutside={false}
        >
            {/* The action bar is an anchor-less popover, so Ark never sets a
                `--z-index` on it and the positioner ends up at `z-index: auto`
                (0). Card overlays such as the selection ring and the batch
                checkmark sit at z-index 1–3 and would paint on top of the bar.
                "docked" (10) puts the bar above those but still below dialogs
                and toasts. */}
            <ActionBar.Positioner zIndex="docked">
                <ActionBar.Content
                    flexWrap={{ base: "wrap", md: "nowrap" }}
                    justifyContent="center"
                    maxW={{ base: "calc(100vw - 24px)", md: "none" }}
                    rowGap="2"
                >
                    <ActionBar.SelectionTrigger cursor="default" tabIndex={-1}>
                        <Text as="span" fontWeight="semibold">
                            {count}
                        </Text>
                        {count === 0 ? " selected" : ` of ${total} selected`}
                    </ActionBar.SelectionTrigger>

                    <ActionBar.Separator />

                    <Button size="sm" variant="ghost" onClick={onSelectAll} disabled={count >= total || !!busy}>
                        Select all
                    </Button>
                    <Button size="sm" variant="ghost" onClick={onClear} disabled={noSelection}>
                        Clear
                    </Button>

                    <ActionBar.Separator />

                    <Button size="sm" variant="outline" onClick={onMove} disabled={noSelection}>
                        <MoveIcon />
                        Move…
                    </Button>
                    <Button size="sm" variant="outline" onClick={onTags} disabled={noSelection}>
                        <TagIcon />
                        Common tags
                    </Button>
                    <Button size="sm" variant="outline" colorPalette="red" onClick={onDelete} disabled={noSelection}>
                        <TrashIcon />
                        Delete
                    </Button>

                    <ActionBar.Separator />

                    <ActionBar.CloseTrigger asChild>
                        <IconButton size="sm" variant="ghost" aria-label="Exit selection mode" title="Exit selection mode">
                            <XIcon />
                        </IconButton>
                    </ActionBar.CloseTrigger>
                </ActionBar.Content>
            </ActionBar.Positioner>
        </ActionBar.Root>
    )
}
