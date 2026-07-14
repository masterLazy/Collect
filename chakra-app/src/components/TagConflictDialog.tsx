import {
    Box,
    Button,
    Dialog,
    HStack,
    Portal,
    Stack,
    Text,
} from "@chakra-ui/react"
import { useEffect, useState } from "react"
import type { TagConflict } from "../types"

interface TagConflictDialogProps {
    conflicts: TagConflict[]
    open: boolean
    onResolve: (resolutions: { tagValue: string; chosenType: string }[]) => void
    onClose: () => void
    resolving?: boolean
}

export function TagConflictDialog({ conflicts, open, onResolve, onClose, resolving }: TagConflictDialogProps) {
    const [selections, setSelections] = useState<Record<string, string>>({})

    // Reset selections when conflicts change
    useEffect(() => {
        const initial: Record<string, string> = {}
        for (const c of conflicts) {
            if (c.possibleTypes.length > 0) {
                initial[c.tagValue] = c.possibleTypes[0]
            }
        }
        setSelections(initial)
    }, [conflicts])

    const handleResolve = () => {
        const resolutions = conflicts
            .filter((c) => selections[c.tagValue])
            .map((c) => ({ tagValue: c.tagValue, chosenType: selections[c.tagValue] }))
        onResolve(resolutions)
    }

    return (
        <Dialog.Root open={open} onOpenChange={(e: { open: boolean }) => { if (!e.open) onClose() }} size="lg">
            <Portal>
                <Dialog.Backdrop />
                <Dialog.Positioner>
                    <Dialog.Content>
                        <Dialog.Header>
                            <Dialog.Title>Resolve Tag Conflicts</Dialog.Title>
                        </Dialog.Header>
                        <Dialog.Body>
                            <Stack gap="4">
                                <Text fontSize="sm" color="fg.muted">
                                    Some tags exist with multiple possible type prefixes. Please choose which type to use for each tag.
                                </Text>
                                {conflicts.map((conflict) => (
                                    <Box
                                        key={conflict.tagValue}
                                        p="3"
                                        border="1px solid"
                                        borderColor="border"
                                        borderRadius="md"
                                    >
                                        <Text fontWeight="semibold" fontSize="sm" mb="2">
                                            Tag: "{conflict.tagValue}"
                                        </Text>
                                        <HStack gap="3" flexWrap="wrap">
                                            {conflict.possibleTypes.map((type) => {
                                                const selected = (selections[conflict.tagValue] ?? conflict.possibleTypes[0]) === type
                                                return (
                                                    <Box
                                                        key={type}
                                                        as="button"
                                                        px="3"
                                                        py="1.5"
                                                        borderRadius="md"
                                                        border="1px solid"
                                                        borderColor={selected ? "accent.solid" : "border"}
                                                        bg={selected ? { base: "blue.50", _dark: "blue.950" } : "transparent"}
                                                        cursor="pointer"
                                                        onClick={() => setSelections((prev) => ({ ...prev, [conflict.tagValue]: type }))}
                                                        fontSize="sm"
                                                        _hover={{ borderColor: "accent.solid" }}
                                                    >
                                                        [{type}]{conflict.tagValue}
                                                    </Box>
                                                )
                                            })}
                                        </HStack>
                                    </Box>
                                ))}
                            </Stack>
                        </Dialog.Body>
                        <Dialog.Footer>
                            <Button variant="outline" onClick={onClose} disabled={resolving}>
                                Skip
                            </Button>
                            <Button colorPalette="accent" onClick={handleResolve} loading={resolving}>
                                Apply
                            </Button>
                        </Dialog.Footer>
                    </Dialog.Content>
                </Dialog.Positioner>
            </Portal>
        </Dialog.Root>
    )
}
