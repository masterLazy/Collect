import { useEffect, useState } from "react"
import { Box, Button, Dialog, HStack, Input, Portal, Text } from "@chakra-ui/react"
import { api } from "../services/api"
import type { DirectoryNode } from "../types"

function FolderIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
        </svg>
    )
}

function RootIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M12 3v4M12 17v4M3 12h4M17 12h4" />
        </svg>
    )
}

function UncategorizedIcon() {
    return (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10 3.2L5 20h14l-5-16.8a1.5 1.5 0 0 0-2.8 0Z" />
            <path d="M7.5 10.5h9" />
            <path d="M6.5 14.5h11" />
            <path d="M12 3v1" />
        </svg>
    )
}

function ChevronIcon({ expanded }: { expanded: boolean }) {
    return (
        <svg
            width="10"
            height="10"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ transform: expanded ? "rotate(90deg)" : "rotate(0deg)", transition: "transform 0.15s" }}
        >
            <polyline points="9 18 15 12 9 6" />
        </svg>
    )
}

function FolderNode({
    node,
    depth,
    selectedPath,
    onSelect,
}: {
    node: DirectoryNode
    depth: number
    selectedPath: string
    onSelect: (path: string) => void
}) {
    const [expanded, setExpanded] = useState(depth === 0)
    const hasChildren = node.children && node.children.length > 0
    const isSelected = selectedPath === node.path

    return (
        <Box>
            <HStack
                gap="1"
                py="1.5"
                px="3"
                pl={3 + depth * 4}
                cursor="pointer"
                bg={isSelected ? { base: "blue.50", _dark: "blue.950" } : "transparent"}
                borderLeft="2px solid"
                borderLeftColor={isSelected ? "accent.default" : "transparent"}
                _hover={{ bg: { base: "blue.50", _dark: "blue.950" } }}
                onClick={() => onSelect(node.path)}
                transition="background 0.1s"
            >
                <Box
                    as="span"
                    display="inline-flex"
                    alignItems="center"
                    justifyContent="center"
                    width="14px"
                    flexShrink="0"
                    onClick={(e: React.MouseEvent) => { e.stopPropagation(); setExpanded((prev) => !prev) }}
                    color="fg.muted"
                    visibility={hasChildren ? "visible" : "hidden"}
                >
                    <ChevronIcon expanded={expanded} />
                </Box>
                <Box as="span" color="fg.muted" flexShrink="0" display="inline-flex">
                    <FolderIcon />
                </Box>
                <Text
                    fontSize="sm"
                    color="fg"
                    truncate
                    flex="1"
                    fontWeight={isSelected ? "semibold" : "normal"}
                >
                    {node.name}
                </Text>
                {node.assetCount > 0 && (
                    <Text fontSize="xs" color="fg.subtle">{node.assetCount}</Text>
                )}
            </HStack>
            {hasChildren && expanded && (
                <Box>
                    {node.children.map((child) => (
                        <FolderNode
                            key={child.path}
                            node={child}
                            depth={depth + 1}
                            selectedPath={selectedPath}
                            onSelect={onSelect}
                        />
                    ))}
                </Box>
            )}
        </Box>
    )
}

/** Folder tree content (no dialog shell) — embeddable in custom dialogs */
export function DirectoryTreePicker({
    selectedPath,
    onSelect,
    maxHeight = "300px",
}: {
    selectedPath: string
    onSelect: (path: string) => void
    maxHeight?: string
}) {
    const [tree, setTree] = useState<DirectoryNode | null>(null)
    const [loading, setLoading] = useState(true)
    const [creatingSubfolder, setCreatingSubfolder] = useState(false)
    const [newFolderName, setNewFolderName] = useState("")

    const loadTree = () => {
        setLoading(true)
        api.getDirectoryTree().then((data) => setTree(data.root)).catch(() => { }).finally(() => setLoading(false))
    }

    useEffect(() => {
        loadTree()
    }, [])

    const handleCreateSubfolder = async () => {
        const name = newFolderName.trim()
        if (!name) return
        try {
            const parentFolder = selectedPath === "Uncategorized" ? "" : selectedPath
            const relativePath = parentFolder ? `${parentFolder}/${name}` : name
            await api.createDirectory(relativePath)
            setNewFolderName("")
            setCreatingSubfolder(false)
            loadTree()
        } catch {
            // silently fail
        }
    }

    // Sort children: Uncategorized first, then alphabetical
    const sortedChildren = tree
        ? [...tree.children].sort((a, b) => {
            if (a.name === "Uncategorized") return -1
            if (b.name === "Uncategorized") return 1
            return a.name.localeCompare(b.name)
        })
        : []

    if (loading) {
        return <Text fontSize="sm" color="fg.subtle">Loading folders...</Text>
    }

    if (!tree) {
        return <Text fontSize="sm" color="fg.subtle">Failed to load folders.</Text>
    }

    return (
        <Box>
            <Box maxH={maxHeight} overflow="auto" role="tree">
                {/* Uncategorized — always first */}
                <HStack
                    gap="1"
                    py="1.5"
                    px="3"
                    cursor="pointer"
                    bg={selectedPath === "Uncategorized" ? { base: "blue.50", _dark: "blue.950" } : "transparent"}
                    borderLeft="2px solid"
                    borderLeftColor={selectedPath === "Uncategorized" ? "accent.default" : "transparent"}
                    _hover={{ bg: { base: "blue.50", _dark: "blue.950" } }}
                    onClick={() => onSelect("Uncategorized")}
                    transition="background 0.1s"
                >
                    <Box width="14px" flexShrink="0" />
                    <Box as="span" color={{ _light: "blue.600", _dark: "blue.400" }} flexShrink="0" display="inline-flex">
                        <UncategorizedIcon />
                    </Box>
                    <Text
                        fontSize="sm"
                        color={{ _light: "blue.700", _dark: "blue.300" }}
                        truncate
                        flex="1"
                        fontWeight={selectedPath === "Uncategorized" ? "semibold" : "normal"}
                    >
                        Uncategorized
                    </Text>
                </HStack>

                {/* Root item — assets not in any subdirectory */}
                <HStack
                    gap="1"
                    py="1.5"
                    px="3"
                    cursor="pointer"
                    bg={selectedPath === "" ? { base: "blue.50", _dark: "blue.950" } : "transparent"}
                    borderLeft="2px solid"
                    borderLeftColor={selectedPath === "" ? "accent.default" : "transparent"}
                    _hover={{ bg: { base: "blue.50", _dark: "blue.950" } }}
                    onClick={() => onSelect("")}
                    transition="background 0.1s"
                >
                    <Box width="14px" flexShrink="0" />
                    <Box as="span" color="fg.muted" flexShrink="0" display="inline-flex">
                        <RootIcon />
                    </Box>
                    <Text
                        fontSize="sm"
                        color="fg"
                        truncate
                        flex="1"
                        fontWeight={selectedPath === "" ? "semibold" : "normal"}
                    >
                        Root
                    </Text>
                </HStack>

                {/* Separator line */}
                <Box h="1px" bg="border" mx="3" my="1" />

                {/* Regular folders — at depth 0 (no indent) */}
                {sortedChildren.filter((c) => c.name !== "Uncategorized").map((child) => (
                    <FolderNode
                        key={child.path}
                        node={child}
                        depth={0}
                        selectedPath={selectedPath}
                        onSelect={onSelect}
                    />
                ))}
            </Box>

            {/* Create subfolder */}
            <Box mt="3">
                {creatingSubfolder ? (
                    <HStack gap="2">
                        <Input
                            placeholder="New folder name"
                            value={newFolderName}
                            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewFolderName(e.target.value)}
                            size="sm"
                            bg="bg"
                            border="1px solid"
                            borderColor="border"
                            onKeyDown={(e: React.KeyboardEvent) => {
                                if (e.key === "Enter") handleCreateSubfolder()
                            }}
                            autoFocus
                        />
                        <Button size="sm" colorPalette="accent" onClick={handleCreateSubfolder}>
                            Create
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => { setCreatingSubfolder(false); setNewFolderName("") }}>
                            Cancel
                        </Button>
                    </HStack>
                ) : (
                    <Button
                        size="xs"
                        variant="outline"
                        width="full"
                        onClick={() => setCreatingSubfolder(true)}
                    >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                            <line x1="12" y1="11" x2="12" y2="17" />
                            <line x1="9" y1="14" x2="15" y2="14" />
                        </svg>
                        <Box as="span" ml="1.5">New Folder</Box>
                    </Button>
                )}
            </Box>
        </Box>
    )
}

/** Full dialog wrapper for simple directory picking */
export function DirectoryPicker({
    open,
    onOpenChange,
    selectedPath,
    onSelect,
    title = "Select Directory",
}: {
    open: boolean
    onOpenChange: (open: boolean) => void
    selectedPath: string
    onSelect: (path: string) => void
    title?: string
}) {
    return (
        <Dialog.Root open={open} onOpenChange={(e: { open: boolean }) => onOpenChange(e.open)}>
            <Portal>
                <Dialog.Backdrop />
                <Dialog.Positioner>
                    <Dialog.Content>
                        <Dialog.Header>
                            <Dialog.Title>{title}</Dialog.Title>
                        </Dialog.Header>
                        <Dialog.Body>
                            <DirectoryTreePicker
                                selectedPath={selectedPath}
                                onSelect={(path) => { onSelect(path); onOpenChange(false) }}
                            />
                            <Text fontSize="xs" color="fg.subtle" mt="2">
                                Current: {selectedPath || "Root"}
                            </Text>
                        </Dialog.Body>
                        <Dialog.Footer>
                            <Button variant="outline" onClick={() => onOpenChange(false)}>
                                Cancel
                            </Button>
                            <Button colorPalette="accent" onClick={() => onOpenChange(false)}>
                                Select
                            </Button>
                        </Dialog.Footer>
                    </Dialog.Content>
                </Dialog.Positioner>
            </Portal>
        </Dialog.Root>
    )
}
