import { Box, Button, HStack, IconButton, Menu, Popover, Portal, Text } from "@chakra-ui/react"
import { useEffect, useRef, useState } from "react"
import { SearchInput } from "./SearchInput"
import { TagFilterModal } from "./TagFilterModal"

interface TopBarProps {
    searchQuery: string
    onSearchChange: (query: string) => void
    selectedTags: string[]
    onTagsChange: (tags: string[]) => void
    onOpenAddDialog: () => void
    onSwitchLibrary: () => void
    onShowAll: () => void
    onOpenMobileTree: () => void
    onRescan?: () => void
    scanning?: boolean
    libraryName?: string
    libraryPath?: string
    libraryId?: string
    onCategorizeSave?: () => void
    isMobile?: boolean
    currentFolder?: string
    alwaysShowSearch?: boolean
    onToggleAlwaysShowSearch?: () => void
    libraryEncrypted?: boolean
    onDecrypt?: () => void
    decrypting?: boolean
    onEncrypt?: () => void
    encrypting?: boolean
    onLock?: () => void
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

function MoreIcon() {
    return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="5" cy="12" r="1.5" />
            <circle cx="12" cy="12" r="1.5" />
            <circle cx="19" cy="12" r="1.5" />
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
    onShowAll,
    onOpenMobileTree,
    onRescan,
    scanning,
    libraryName,
    libraryPath,
    libraryId,
    onCategorizeSave,
    isMobile,
    currentFolder,
    alwaysShowSearch,
    onToggleAlwaysShowSearch,
    libraryEncrypted,
    onDecrypt,
    decrypting,
    onEncrypt,
    encrypting,
    onLock,
}: TopBarProps) {
    // Mobile search bar visibility:
    // - If alwaysShowSearch is on: use scroll-based fade
    // - Otherwise: only visible when search query is not empty
    const [scrollVisible, setScrollVisible] = useState(true)
    const prevScrollRef = useRef(0)

    useEffect(() => {
        const container = document.querySelector<HTMLElement>(".masonry-scroll-container")
        if (!container || !alwaysShowSearch) return

        const handleScroll = () => {
            const currentScroll = container.scrollTop
            if (currentScroll > prevScrollRef.current && currentScroll > 50) {
                setScrollVisible(false)
            } else if (currentScroll < prevScrollRef.current) {
                setScrollVisible(true)
            }
            prevScrollRef.current = currentScroll
        }

        container.addEventListener("scroll", handleScroll, { passive: true })
        return () => container.removeEventListener("scroll", handleScroll)
    }, [alwaysShowSearch])

    const searchVisible = alwaysShowSearch ? scrollVisible : searchQuery.length > 0

    return (
        <Box
            width="full"
            position={{ base: "sticky", md: "static" }}
            top="0"
            zIndex="docked"
            bg="bg"
            borderBottom="1px solid"
            borderColor="border"
        >
            {/* First row: home, library name, search */}
            <HStack
                px={{ base: "2", sm: "4" }}
                py="2.5"
                gap="2"
            >
                {/* Mobile: Show All button (home moved to More menu) */}
                <IconButton
                    variant="ghost"
                    size="sm"
                    aria-label="Show all assets"
                    onClick={onShowAll}
                    display={{ base: "inline-flex", md: "none" }}
                >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="3" y="3" width="7" height="7" rx="1" />
                        <rect x="14" y="3" width="7" height="7" rx="1" />
                        <rect x="3" y="14" width="7" height="7" rx="1" />
                        <rect x="14" y="14" width="7" height="7" rx="1" />
                    </svg>
                </IconButton>

                {/* Desktop: Home button */}
                <IconButton
                    variant="ghost"
                    size="sm"
                    aria-label="Switch library"
                    onClick={onSwitchLibrary}
                    display={{ base: "none", md: "inline-flex" }}
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
                                maxW={{ base: "120px", md: "160px" }}
                                truncate
                                cursor="pointer"
                                userSelect="none"
                                textDecoration="underline"
                                textDecorationColor="border"
                                textUnderlineOffset="3px"
                                borderRight={{ base: currentFolder ? "none" : "1px solid", md: "1px solid" }}
                                borderColor="border"
                                pr={{ base: currentFolder ? "0" : "3", md: "3" }}
                                mr={{ base: currentFolder ? "0" : "1", md: "1" }}
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

                {/* Mobile: current folder indicator */}
                {currentFolder !== undefined && (
                    <Text
                        fontSize="sm"
                        color="fg.muted"
                        flex="1"
                        minW="0"
                        truncate
                        display={{ base: "inline", md: "none" }}
                        title={
                            currentFolder === ""
                                ? "All Assets"
                                : currentFolder === "__root__"
                                    ? "Root"
                                    : currentFolder
                        }
                    >
                        {currentFolder === ""
                            ? ""
                            : currentFolder === "__root__"
                                ? "\\"
                                : currentFolder}
                    </Text>
                )}

                {/* Desktop: SearchInput stays in first row */}
                <Box flex="1" display={{ base: "none", md: "block" }}>
                    <SearchInput value={searchQuery} onChange={onSearchChange} />
                </Box>

                {/* Action buttons */}
                <HStack gap="1" marginLeft="auto" flexShrink="0">
                    {/* Desktop: Rescan */}
                    <IconButton
                        variant="ghost"
                        size="sm"
                        aria-label="Rescan library"
                        loading={scanning}
                        onClick={onRescan}
                        title="Rescan library for external changes"
                        display={{ base: "none", md: "inline-flex" }}
                    >
                        <RefreshIcon />
                    </IconButton>

                    {/* Desktop: Add */}
                    <Button
                        variant="outline"
                        size="sm"
                        colorPalette="accent"
                        onClick={onOpenAddDialog}
                        display={{ base: "none", md: "inline-flex" }}
                    >
                        <PlusIcon />
                        <Box as="span" display={{ base: "none", sm: "inline" }} ml="1">Add</Box>
                    </Button>

                    {/* Tags (visible on all sizes) */}
                    <TagFilterModal
                        selectedTags={selectedTags}
                        onTagsChange={onTagsChange}
                        onCategorizeSave={onCategorizeSave}
                        isMobile={isMobile}
                    />

                    {/* More menu (desktop & mobile) */}
                    <Menu.Root>
                        <Menu.Trigger asChild>
                            <IconButton
                                variant="ghost"
                                size="sm"
                                aria-label="More options"
                            >
                                <MoreIcon />
                            </IconButton>
                        </Menu.Trigger>
                        <Portal>
                            <Menu.Positioner>
                                <Menu.Content minW="160px">
                                    {/* Mobile-only: Back to Manager */}
                                    <Menu.Item value="home" onClick={onSwitchLibrary} py="2.5" display={{ md: "none" }}>
                                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                            <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                                            <polyline points="9 22 9 12 15 12 15 22" />
                                        </svg>
                                        <Box as="span" ml="2">Back to Manager</Box>
                                    </Menu.Item>
                                    {/* Mobile-only: Folders */}
                                    <Menu.Item value="folders" onClick={onOpenMobileTree} py="2.5" display={{ md: "none" }}>
                                        <FolderIcon />
                                        <Box as="span" ml="2">Folders</Box>
                                    </Menu.Item>
                                    {/* Mobile-only: Add Assets */}
                                    <Menu.Item value="add" onClick={onOpenAddDialog} py="2.5" display={{ md: "none" }}>
                                        <PlusIcon />
                                        <Box as="span" ml="2">Add Assets</Box>
                                    </Menu.Item>
                                    {/* Mobile-only: Always show search */}
                                    <Menu.Item
                                        value="always-search"
                                        onClick={onToggleAlwaysShowSearch}
                                        py="2.5"
                                        display={{ md: "none" }}
                                    >
                                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                            <circle cx="11" cy="11" r="8" />
                                            <path d="M21 21l-4.3-4.3" />
                                        </svg>
                                        <Box as="span" ml="2" flex="1">Always show search</Box>
                                        <Box
                                            width="16px"
                                            height="16px"
                                            borderRadius="sm"
                                            border="2px solid"
                                            borderColor="border"
                                            display="flex"
                                            alignItems="center"
                                            justifyContent="center"
                                            flexShrink="0"
                                        >
                                            {alwaysShowSearch && (
                                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                                    <polyline points="20 6 9 17 4 12" />
                                                </svg>
                                            )}
                                        </Box>
                                    </Menu.Item>
                                    {/* Encrypt for non-encrypted libraries */}
                                    {!libraryEncrypted && (
                                        <Menu.Item value="encrypt" onClick={onEncrypt} py="2.5">
                                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                                                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                                            </svg>
                                            <Box as="span" ml="2">Encrypt Library</Box>
                                        </Menu.Item>
                                    )}
                                    {/* Lock for encrypted libraries — token invalidation */}
                                    {libraryEncrypted && (
                                        <Menu.Item value="lock" onClick={onLock} py="2.5">
                                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                                                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                                            </svg>
                                            <Box as="span" ml="2">Lock (expire token)</Box>
                                        </Menu.Item>
                                    )}
                                    {/* Decrypt for encrypted libraries */}
                                    {libraryEncrypted && (
                                        <Menu.Item value="decrypt" onClick={onDecrypt} py="2.5" color="red.500">
                                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                                                <path d="M7 11V7a5 5 0 0 1 9.9-1" />
                                            </svg>
                                            <Box as="span" ml="2">Decrypt Library</Box>
                                        </Menu.Item>
                                    )}
                                </Menu.Content>
                            </Menu.Positioner>
                        </Portal>
                    </Menu.Root>
                </HStack>
            </HStack>

            {/* Second row: mobile search bar — fades out on scroll down */}
            <Box
                px={{ base: "2", sm: "4" }}
                pb="2.5"
                display={{ base: "block", md: "none" }}
                position="absolute"
                top="100%"
                left="0"
                right="0"
                bg="bg"
                opacity={searchVisible ? 1 : 0}
                pointerEvents={searchVisible ? "auto" : "none"}
                css={{ transition: "opacity 0.2s ease" }}
                shadow={searchVisible ? "md" : "none"}
            >
                <SearchInput value={searchQuery} onChange={onSearchChange} />
            </Box>
        </Box>
    )
}
