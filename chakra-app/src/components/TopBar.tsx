import { Box, Button, HStack, IconButton, Popover, Portal, Text } from "@chakra-ui/react"
import { useState } from "react"
import { SearchInput } from "./SearchInput"
import { TagFilterModal } from "./TagFilterModal"

interface TopBarProps {
    searchQuery: string
    onSearchChange: (query: string) => void
    selectedTags: string[]
    onTagsChange: (tags: string[]) => void
    onOpenAddDialog: () => void
    onSwitchLibrary: () => void
    onOpenMobileTree: () => void
    onRescan?: () => void
    scanning?: boolean
    libraryName?: string
    libraryPath?: string
    libraryId?: string
    onCategorizeSave?: () => void
}

function PlusIcon() {
    return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
    )
}

function HomeIcon() {
    return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
            <polyline points="9 22 9 12 15 12 15 22" />
        </svg>
    )
}

function FolderIcon() {
    return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
        </svg>
    )
}

function RefreshIcon() {
    return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="23 4 23 10 17 10" />
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
        </svg>
    )
}

function CopyButton({ value }: { value: string }) {
    const [copied, setCopied] = useState(false)

    const handleCopy = (e: React.MouseEvent) => {
        e.stopPropagation()
        navigator.clipboard.writeText(value).then(() => {
            setCopied(true)
            setTimeout(() => setCopied(false), 1500)
        }).catch(() => { })
    }

    return (
        <Button
            size="2xs"
            variant="ghost"
            colorPalette="gray"
            flexShrink="0"
            onClick={handleCopy}
            aria-label="Copy to clipboard"
            minW="unset"
            px="1"
            fontSize="10px"
            fontWeight="normal"
            color={copied ? "green.500" : undefined}
        >
            {copied ? (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                </svg>
            ) : (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
            )}
        </Button>
    )
}

export function TopBar({
    searchQuery,
    onSearchChange,
    selectedTags,
    onTagsChange,
    onOpenAddDialog,
    onSwitchLibrary,
    onOpenMobileTree,
    onRescan,
    scanning,
    libraryName,
    libraryPath,
    libraryId,
    onCategorizeSave,
}: TopBarProps) {
    return (
        <HStack
            width="full"
            px={{ base: "2", sm: "4" }}
            py="2.5"
            bg="bg"
            borderBottom="1px solid"
            borderColor="border"
            gap="2"
        >
            <IconButton
                variant="ghost"
                size="sm"
                aria-label="Switch library"
                onClick={onSwitchLibrary}
            >
                <HomeIcon />
            </IconButton>

            {libraryName && (
                <Popover.Root positioning={{ placement: "bottom-start" }}>
                    <Popover.Trigger>
                        <Text
                            fontSize="sm"
                            fontWeight="medium"
                            color="fg"
                            maxW="160px"
                            truncate
                            cursor="pointer"
                            userSelect="none"
                            textDecoration="underline"
                            textDecorationColor="border"
                            textUnderlineOffset="3px"
                            borderRight="1px solid"
                            borderColor="border"
                            pr="3"
                            mr="1"
                            _hover={{ textDecorationColor: "fg", color: "fg" }}
                            title="Click for details"
                        >
                            {libraryName}
                        </Text>
                    </Popover.Trigger>
                    <Portal>
                        <Popover.Positioner>
                            <Popover.Content
                                bg="white"
                                color="black"
                                border="1px solid"
                                borderColor="gray.200"
                                boxShadow="lg"
                                px="3"
                                py="2.5"
                                fontSize="xs"
                                maxW="400px"
                                minW="280px"
                            >
                                <Popover.Arrow bg="white" borderColor="gray.200" />
                                {libraryPath && (
                                    <HStack gap="2" align="center">
                                        <Text
                                            as="span"
                                            fontWeight="medium"
                                            color="gray.600"
                                            flexShrink="0"
                                            minW="36px"
                                        >
                                            Path:
                                        </Text>
                                        <Text
                                            as="span"
                                            flex="1"
                                            wordBreak="break-all"
                                            lineClamp="2"
                                            title={libraryPath}
                                        >
                                            {libraryPath}
                                        </Text>
                                        <CopyButton value={libraryPath} />
                                    </HStack>
                                )}
                                {libraryId && (
                                    <HStack gap="2" align="center" mt={libraryPath ? "1.5" : "0"}>
                                        <Text
                                            as="span"
                                            fontWeight="medium"
                                            color="gray.600"
                                            flexShrink="0"
                                            minW="36px"
                                        >
                                            ID:
                                        </Text>
                                        <Text
                                            as="span"
                                            flex="1"
                                            fontFamily="mono"
                                            wordBreak="break-all"
                                            lineClamp="2"
                                            title={libraryId}
                                        >
                                            {libraryId}
                                        </Text>
                                        <CopyButton value={libraryId} />
                                    </HStack>
                                )}
                            </Popover.Content>
                        </Popover.Positioner>
                    </Portal>
                </Popover.Root>
            )}

            <SearchInput value={searchQuery} onChange={onSearchChange} />

            <HStack gap="1" marginLeft="auto" flexShrink="0">
                {/* Mobile folders button */}
                <Button
                    variant="outline"
                    size="sm"
                    onClick={onOpenMobileTree}
                    display={{ base: "inline-flex", md: "none" }}
                >
                    <FolderIcon />
                    <Box as="span" display={{ base: "none", sm: "inline" }} ml="1">Folders</Box>
                </Button>

                <IconButton
                    variant="ghost"
                    size="sm"
                    aria-label="Rescan library"
                    loading={scanning}
                    onClick={onRescan}
                    title="Rescan library for external changes"
                >
                    <RefreshIcon />
                </IconButton>

                <Button
                    variant="outline"
                    size="sm"
                    colorPalette="accent"
                    onClick={onOpenAddDialog}
                >
                    <PlusIcon />
                    <Box as="span" display={{ base: "none", sm: "inline" }} ml="1">Add</Box>
                </Button>

                <TagFilterModal
                    selectedTags={selectedTags}
                    onTagsChange={onTagsChange}
                    onCategorizeSave={onCategorizeSave}
                />
            </HStack>
        </HStack>
    )
}
