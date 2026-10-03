import { Button, Dialog, Portal, Text } from "@chakra-ui/react"

interface BatchDeleteDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    /** Number of assets that will be deleted. */
    count: number
    /** A batch operation is running. */
    busy?: boolean
    onConfirm: () => void
}

/**
 * Batch delete confirmation. Deleting removes files from disk, so the action is
 * always gated behind an explicit confirmation.
 */
export function BatchDeleteDialog({ open, onOpenChange, count, busy, onConfirm }: BatchDeleteDialogProps) {
    return (
        <Dialog.Root open={open} onOpenChange={(e: { open: boolean }) => onOpenChange(e.open)}>
            <Portal>
                <Dialog.Backdrop />
                <Dialog.Positioner>
                    <Dialog.Content>
                        <Dialog.Header>
                            <Dialog.Title>Delete {count} asset{count === 1 ? "" : "s"}</Dialog.Title>
                        </Dialog.Header>
                        <Dialog.Body>
                            <Text fontSize="sm" color="fg">
                                This permanently deletes {count === 1 ? "this asset" : `these ${count} assets`} from disk.
                                This action cannot be undone.
                            </Text>
                        </Dialog.Body>
                        <Dialog.Footer>
                            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
                                Cancel
                            </Button>
                            <Button colorPalette="red" loading={busy} onClick={onConfirm}>
                                Delete
                            </Button>
                        </Dialog.Footer>
                    </Dialog.Content>
                </Dialog.Positioner>
            </Portal>
        </Dialog.Root>
    )
}
