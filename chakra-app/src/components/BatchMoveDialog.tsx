import { useEffect, useState } from "react"
import { Button, Dialog, Portal, Text } from "@chakra-ui/react"
import { DirectoryTreePicker } from "./DirectoryPicker"

interface BatchMoveDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    /** Number of assets that will be moved. */
    count: number
    libraryId: string
    /** A batch operation is running. */
    busy?: boolean
    onConfirm: (targetFolder: string) => void
}

/**
 * Batch move: pick a target directory, then confirm. The picker alone is not a
 * commitment, so the move only happens from the footer button.
 */
export function BatchMoveDialog({ open, onOpenChange, count, libraryId, busy, onConfirm }: BatchMoveDialogProps) {
    // "" is the library root in the backend.
    const [target, setTarget] = useState("")
    const [targetSelected, setTargetSelected] = useState(true)

    // Reset the picker every time the dialog opens.
    useEffect(() => {
        if (open) {
            setTarget("")
            setTargetSelected(true)
        }
    }, [open])

    return (
        <Dialog.Root open={open} onOpenChange={(e: { open: boolean }) => onOpenChange(e.open)}>
            <Portal>
                <Dialog.Backdrop />
                <Dialog.Positioner>
                    <Dialog.Content>
                        <Dialog.Header>
                            <Dialog.Title>Move {count} asset{count === 1 ? "" : "s"}</Dialog.Title>
                        </Dialog.Header>
                        <Dialog.Body>
                            <Text fontSize="sm" color="fg.muted" mb="3">
                                Choose the folder to move the selected assets into.
                            </Text>
                            <DirectoryTreePicker
                                selectedPath={target}
                                onSelect={(path) => { setTarget(path); setTargetSelected(true) }}
                                libraryId={libraryId}
                            />
                            <Text fontSize="xs" color="fg.muted" mt="2">
                                Target: {target || "Root"}
                            </Text>
                        </Dialog.Body>
                        <Dialog.Footer>
                            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
                                Cancel
                            </Button>
                            <Button
                                colorPalette="accent"
                                loading={busy}
                                disabled={!targetSelected}
                                onClick={() => onConfirm(target)}
                            >
                                Move
                            </Button>
                        </Dialog.Footer>
                    </Dialog.Content>
                </Dialog.Positioner>
            </Portal>
        </Dialog.Root>
    )
}
