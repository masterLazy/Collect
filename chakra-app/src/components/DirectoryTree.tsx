import { useCallback, useEffect, useRef, useState } from "react"
import { Box, Button, Dialog, Field, HStack, Input, Menu, Portal, Stack, Text } from "@chakra-ui/react"
import { api } from "../services/api"
import type { DirectoryNode as DirectoryNodeType } from "../types"

interface DirectoryTreeProps {
    currentFolder: string
    onFolderChange: (folder: string) => void
    onMoveAsset?: (assetId: string, targetFolder: string) => void
    refreshKey?: number
}

function FolderIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
        </svg>
    )
}

function AllIcon() {
    return (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="7" height="7" rx="1" />
            <rect x="14" y="3" width="7" height="7" rx="1" />
            <rect x="3" y="14" width="7" height="7" rx="1" />
            <rect x="14" y="14" width="7" height="7" rx="1" />
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
    currentFolder,
    onFolderChange,
    loadTree,
    onMoveAsset,
}: {
    node: DirectoryNodeType
    depth: number
    currentFolder: string
    onFolderChange: (folder: string) => void
    loadTree: () => void
    onMoveAsset?: (assetId: string, targetFolder: string) => void
}) {
    // Top-level folders expanded by default, deeper ones collapsed
    const [expanded, setExpanded] = useState(depth === 0)
    const [isHovered, setIsHovered] = useState(false)
    const [renameDialogOpen, setRenameDialogOpen] = useState(false)
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
    const [renameName, setRenameName] = useState(node.name)
    const [renaming, setRenaming] = useState(false)
    const [deleting, setDeleting] = useState(false)
    const [subdirDialogOpen, setSubdirDialogOpen] = useState(false)
    const [subdirName, setSubdirName] = useState("")
    const [creatingSubdir, setCreatingSubdir] = useState(false)
    const [dragOver, setDragOver] = useState(false)
    const hasChildren = node.children && node.children.length > 0
    const isSelected = currentFolder === node.path
    const isUncategorized = node.name === "Uncategorized"
    const showMenu = !isUncategorized

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault()
        e.stopPropagation()
        setDragOver(true)
        e.dataTransfer.dropEffect = "move"
    }

    const handleDragLeave = (e: React.DragEvent) => {
        e.stopPropagation()
        setDragOver(false)
    }

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault()
        e.stopPropagation()
        setDragOver(false)
        const assetId = e.dataTransfer.getData("text/plain")
        if (assetId && onMoveAsset) {
            onMoveAsset(assetId, node.path)
        }
    }

    const handleClick = () => {
        onFolderChange(node.path)
    }

    const toggleExpand = (e: React.MouseEvent) => {
        e.stopPropagation()
        setExpanded((prev) => !prev)
    }

    const getParentPath = (path: string) => {
        const idx = path.lastIndexOf("/")
        return idx >= 0 ? path.slice(0, idx) : ""
    }

    const handleRename = async () => {
        if (!renameName.trim() || renameName.trim() === node.name) return
        setRenaming(true)
        try {
            const parentPath = getParentPath(node.path)
            // If renamed folder is at root (no parent), just use newName
            const newPath = parentPath ? `${parentPath}/${renameName.trim()}` : renameName.trim()
            await api.renameDirectory(node.path, renameName.trim())
            if (currentFolder === node.path) {
                onFolderChange(newPath)
            }
            setRenameDialogOpen(false)
            loadTree()
        } catch {
            // silently fail
        } finally {
            setRenaming(false)
        }
    }

    const handleDelete = async () => {
        setDeleting(true)
        try {
            await api.deleteDirectory(node.path)
            if (currentFolder === node.path) {
                onFolderChange("")
            }
            setDeleteDialogOpen(false)
            loadTree()
        } catch {
            // silently fail
        } finally {
            setDeleting(false)
        }
    }

    const handleCreateSubdir = async () => {
        if (!subdirName.trim()) return
        setCreatingSubdir(true)
        try {
            const subdirPath = node.path ? `${node.path}/${subdirName.trim()}` : subdirName.trim()
            await api.createDirectory(subdirPath)
            setSubdirDialogOpen(false)
            setSubdirName("")
            setExpanded(true) // auto-expand parent so user sees the new folder
            loadTree()
        } catch {
            // silently fail
        } finally {
            setCreatingSubdir(false)
        }
    }

    return (
        <Box>
            <HStack
                gap="1"
                py="1.5"
                pl={3 + depth * 4}
                pr="3"
                cursor="pointer"
                position="relative"
                bg={dragOver
                    ? { base: "blue.100", _dark: "blue.800" }
                    : isSelected
                        ? { base: "blue.50", _dark: "blue.950" }
                        : "transparent"}
                borderLeft="2px solid"
                borderLeftColor={dragOver
                    ? { base: "blue.300", _dark: "blue.600" }
                    : isSelected
                        ? "accent.default"
                        : "transparent"}
                _hover={{ bg: dragOver ? { base: "blue.100", _dark: "blue.800" } : { base: "blue.50", _dark: "blue.950" } }}
                onClick={handleClick}
                onMouseEnter={() => setIsHovered(true)}
                onMouseLeave={() => setIsHovered(false)}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                transition="background 0.1s"
                role="treeitem"
                aria-selected={isSelected}
                title={node.path || node.name}
            >
                <Box
                    as="span"
                    display="inline-flex"
                    alignItems="center"
                    justifyContent="center"
                    width="14px"
                    flexShrink="0"
                    onClick={hasChildren ? toggleExpand : undefined}
                    color="fg.muted"
                    visibility={hasChildren ? "visible" : "hidden"}
                >
                    <ChevronIcon expanded={expanded} />
                </Box>
                <Box as="span" color={isUncategorized ? { _light: "blue.600", _dark: "blue.400" } : "fg.muted"} flexShrink="0" display="inline-flex">
                    {isUncategorized ? <UncategorizedIcon /> : <FolderIcon />}
                </Box>
                <Text
                    fontSize="sm"
                    color={isUncategorized ? { _light: "blue.700", _dark: "blue.300" } : "fg"}
                    truncate
                    flex="1"
                    fontWeight={isSelected ? "semibold" : "normal"}
                >
                    {node.name}
                </Text>
                {node.assetCount > 0 && !(showMenu && isHovered) && (
                    <Text fontSize="xs" color="fg.subtle" flexShrink="0">
                        {node.assetCount}
                    </Text>
                )}
                {showMenu && (
                    <Menu.Root
                        onOpenChange={(e: { open: boolean }) => {
                            // Prevent the folder click when menu opens
                            if (e.open) setIsHovered(true)
                        }}
                    >
                        <Menu.Trigger asChild>
                            <Box
                                as="button"
                                display={isHovered ? "inline-flex" : "none"}
                                alignItems="center"
                                justifyContent="center"
                                width="20px"
                                height="20px"
                                flexShrink="0"
                                borderRadius="sm"
                                cursor="pointer"
                                _hover={{ bg: { base: "blackAlpha.200", _dark: "whiteAlpha.200" } }}
                                onClick={(e: React.MouseEvent) => e.stopPropagation()}
                                aria-label="Folder options"
                                tabIndex={-1}
                            >
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                                    <circle cx="5" cy="12" r="1.8" />
                                    <circle cx="12" cy="12" r="1.8" />
                                    <circle cx="19" cy="12" r="1.8" />
                                </svg>
                            </Box>
                        </Menu.Trigger>
                        <Menu.Positioner>
                            <Menu.Content minW="120px">
                                <Menu.Item
                                    value="new-subdir"
                                    onClick={(e: React.MouseEvent) => {
                                        e.stopPropagation()
                                        setSubdirName("")
                                        setSubdirDialogOpen(true)
                                    }}
                                >
                                    New Subdirectory
                                </Menu.Item>
                                <Menu.Item
                                    value="rename"
                                    onClick={(e: React.MouseEvent) => {
                                        e.stopPropagation()
                                        setRenameName(node.name)
                                        setRenameDialogOpen(true)
                                    }}
                                >
                                    Rename
                                </Menu.Item>
                                <Menu.Item
                                    value="delete"
                                    color="fg.error"
                                    onClick={(e: React.MouseEvent) => {
                                        e.stopPropagation()
                                        setDeleteDialogOpen(true)
                                    }}
                                >
                                    Delete
                                </Menu.Item>
                            </Menu.Content>
                        </Menu.Positioner>
                    </Menu.Root>
                )}
            </HStack>

            {/* Rename Dialog */}
            <Dialog.Root open={renameDialogOpen} onOpenChange={(e: { open: boolean }) => setRenameDialogOpen(e.open)}>
                <Portal>
                    <Dialog.Backdrop />
                    <Dialog.Positioner>
                        <Dialog.Content>
                            <Dialog.Header>
                                <Dialog.Title>Rename Folder</Dialog.Title>
                            </Dialog.Header>
                            <Dialog.Body>
                                <Field.Root>
                                    <Field.Label>New folder name</Field.Label>
                                    <Input
                                        value={renameName}
                                        onChange={(e) => setRenameName(e.target.value)}
                                        size="sm"
                                        onKeyDown={(e: React.KeyboardEvent) => {
                                            if (e.key === "Enter") handleRename()
                                        }}
                                        autoFocus
                                    />
                                </Field.Root>
                            </Dialog.Body>
                            <Dialog.Footer>
                                <Button variant="outline" onClick={() => setRenameDialogOpen(false)}>
                                    Cancel
                                </Button>
                                <Button
                                    colorPalette="accent"
                                    loading={renaming}
                                    disabled={!renameName.trim() || renameName.trim() === node.name}
                                    onClick={handleRename}
                                >
                                    Rename
                                </Button>
                            </Dialog.Footer>
                        </Dialog.Content>
                    </Dialog.Positioner>
                </Portal>
            </Dialog.Root>

            {/* Delete Confirmation Dialog */}
            <Dialog.Root open={deleteDialogOpen} onOpenChange={(e: { open: boolean }) => setDeleteDialogOpen(e.open)}>
                <Portal>
                    <Dialog.Backdrop />
                    <Dialog.Positioner>
                        <Dialog.Content>
                            <Dialog.Header>
                                <Dialog.Title>Delete Folder</Dialog.Title>
                            </Dialog.Header>
                            <Dialog.Body>
                                <Text fontSize="sm" color="fg">
                                    Are you sure you want to delete <strong>{node.name}</strong>?
                                </Text>
                                <Text fontSize="sm" color="fg.subtle" mt="2">
                                    All files in this folder will be moved to the parent directory. This action cannot be undone.
                                </Text>
                            </Dialog.Body>
                            <Dialog.Footer>
                                <Button variant="outline" onClick={() => setDeleteDialogOpen(false)}>
                                    Cancel
                                </Button>
                                <Button
                                    colorPalette="red"
                                    loading={deleting}
                                    onClick={handleDelete}
                                >
                                    Delete
                                </Button>
                            </Dialog.Footer>
                        </Dialog.Content>
                    </Dialog.Positioner>
                </Portal>
            </Dialog.Root>

            {/* New Subdirectory Dialog */}
            <Dialog.Root open={subdirDialogOpen} onOpenChange={(e: { open: boolean }) => setSubdirDialogOpen(e.open)}>
                <Portal>
                    <Dialog.Backdrop />
                    <Dialog.Positioner>
                        <Dialog.Content>
                            <Dialog.Header>
                                <Dialog.Title>New Subdirectory</Dialog.Title>
                                <Text fontSize="sm" color="fg.subtle" mt="1">in {node.path || "root"}</Text>
                            </Dialog.Header>
                            <Dialog.Body>
                                <Field.Root>
                                    <Field.Label>Folder name</Field.Label>
                                    <Input
                                        value={subdirName}
                                        onChange={(e) => setSubdirName(e.target.value)}
                                        placeholder="e.g. landscapes"
                                        size="sm"
                                        onKeyDown={(e: React.KeyboardEvent) => {
                                            if (e.key === "Enter") handleCreateSubdir()
                                        }}
                                        autoFocus
                                    />
                                </Field.Root>
                            </Dialog.Body>
                            <Dialog.Footer>
                                <Button variant="outline" onClick={() => { setSubdirDialogOpen(false); setSubdirName("") }}>
                                    Cancel
                                </Button>
                                <Button
                                    colorPalette="accent"
                                    loading={creatingSubdir}
                                    disabled={!subdirName.trim()}
                                    onClick={handleCreateSubdir}
                                >
                                    Create
                                </Button>
                            </Dialog.Footer>
                        </Dialog.Content>
                    </Dialog.Positioner>
                </Portal>
            </Dialog.Root>

            {hasChildren && expanded && (
                <Box>
                    {node.children.map((child) => (
                        <FolderNode
                            key={child.path}
                            node={child}
                            depth={depth + 1}
                            currentFolder={currentFolder}
                            onFolderChange={onFolderChange}
                            loadTree={loadTree}
                            onMoveAsset={onMoveAsset}
                        />
                    ))}
                </Box>
            )}
        </Box>
    )
}

export function DirectoryTree({ currentFolder, onFolderChange, onMoveAsset, refreshKey }: DirectoryTreeProps) {
    const [tree, setTree] = useState<DirectoryNodeType | null>(null)
    const [loading, setLoading] = useState(true)
    const [createDirOpen, setCreateDirOpen] = useState(false)
    const [newDirName, setNewDirName] = useState("")
    const [creating, setCreating] = useState(false)
    const [rootDragOver, setRootDragOver] = useState(false)
    const treeVersionRef = useRef(0)

    const loadTree = useCallback(() => {
        const ver = ++treeVersionRef.current
        setLoading(true)
        api.getDirectoryTree()
            .then((data) => {
                if (ver === treeVersionRef.current) setTree(data.root)
            })
            .catch(() => { })
            .finally(() => {
                if (ver === treeVersionRef.current) setLoading(false)
            })
    }, [])

    useEffect(() => {
        loadTree()
    }, [loadTree, refreshKey])

    const handleCreateDirectory = async () => {
        if (!newDirName.trim()) return
        setCreating(true)
        try {
            // Create folder relative to the currently selected folder
            // __root__ means we're at the library root, same as empty string
            const parentFolder = currentFolder === "__root__" ? "" : currentFolder
            const relativePath = parentFolder
                ? `${parentFolder}/${newDirName.trim()}`
                : newDirName.trim()
            await api.createDirectory(relativePath)
            setCreateDirOpen(false)
            setNewDirName("")
            loadTree()
        } catch {
            // silently fail
        } finally {
            setCreating(false)
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

    return (
        <Stack gap="0" role="tree" aria-label="Directory tree">
            {/* "All" root item */}
            <HStack
                gap="1"
                py="1.5"
                px="3"
                cursor="pointer"
                bg={currentFolder === "" ? { base: "blue.50", _dark: "blue.950" } : "transparent"}
                borderLeft="2px solid"
                borderLeftColor={currentFolder === "" ? "accent.default" : "transparent"}
                _hover={{ bg: { base: "blue.50", _dark: "blue.950" } }}
                onClick={() => onFolderChange("")}
                transition="background 0.1s"
                role="treeitem"
                aria-selected={currentFolder === ""}
            >
                <Box width="14px" flexShrink="0" />
                <Box as="span" color={{ _light: "blue.600", _dark: "blue.400" }} flexShrink="0" display="inline-flex">
                    <AllIcon />
                </Box>
                <Text fontSize="sm" color={{ _light: "blue.700", _dark: "blue.300" }} truncate flex="1" fontWeight="semibold">
                    All
                </Text>
            </HStack>

            {/* Separator line */}
            <Box h="1px" bg="border" mx="3" my="1" />

            {loading ? (
                <Text fontSize="xs" color="fg.subtle" px="3" py="2">
                    Loading...
                </Text>
            ) : (
                <>
                    {/* Uncategorized — always first among folders */}
                    {sortedChildren.filter((c) => c.name === "Uncategorized").map((child) => (
                        <FolderNode
                            key={child.path}
                            node={child}
                            depth={0}
                            currentFolder={currentFolder}
                            onFolderChange={onFolderChange}
                            loadTree={loadTree}
                            onMoveAsset={onMoveAsset}
                        />
                    ))}

                    {/* "Root" item — assets not in any subdirectory */}
                    <HStack
                        gap="1"
                        py="1.5"
                        px="3"
                        cursor="pointer"
                        bg={rootDragOver ? { base: "blue.100", _dark: "blue.800" } : currentFolder === "__root__" ? { base: "blue.50", _dark: "blue.950" } : "transparent"}
                        borderLeft="2px solid"
                        borderLeftColor={rootDragOver ? { base: "blue.300", _dark: "blue.600" } : currentFolder === "__root__" ? "accent.default" : "transparent"}
                        _hover={{ bg: rootDragOver ? { base: "blue.100", _dark: "blue.800" } : { base: "blue.50", _dark: "blue.950" } }}
                        onClick={() => onFolderChange("__root__")}
                        onDragOver={(e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); setRootDragOver(true); e.dataTransfer.dropEffect = "move"; }}
                        onDragLeave={(e: React.DragEvent) => { e.stopPropagation(); setRootDragOver(false); }}
                        onDrop={(e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); setRootDragOver(false); const assetId = e.dataTransfer.getData("text/plain"); if (assetId && onMoveAsset) { onMoveAsset(assetId, ""); } }}
                        transition="background 0.1s"
                        role="treeitem"
                        aria-selected={currentFolder === "__root__"}
                    >
                        <Box width="14px" flexShrink="0" />
                        <Box as="span" color="fg.muted" flexShrink="0" display="inline-flex">
                            <RootIcon />
                        </Box>
                        <Text fontSize="sm" color="fg" truncate flex="1">
                            Root
                        </Text>
                    </HStack>

                    {/* Regular folders */}
                    {sortedChildren.filter((c) => c.name !== "Uncategorized").map((child) => (
                        <FolderNode
                            key={child.path}
                            node={child}
                            depth={0}
                            currentFolder={currentFolder}
                            onFolderChange={onFolderChange}
                            loadTree={loadTree}
                            onMoveAsset={onMoveAsset}
                        />
                    ))}
                </>
            )}

            {/* New Folder button */}
            <Box px="3" pt="3">
                <Button size="xs" variant="outline" width="full" onClick={() => setCreateDirOpen(true)}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                        <line x1="12" y1="11" x2="12" y2="17" />
                        <line x1="9" y1="14" x2="15" y2="14" />
                    </svg>
                    <Box as="span" ml="1.5">New Folder</Box>
                </Button>
            </Box>

            {/* Create Directory Dialog */}
            <Dialog.Root open={createDirOpen} onOpenChange={(e: { open: boolean }) => setCreateDirOpen(e.open)}>
                <Portal>
                    <Dialog.Backdrop />
                    <Dialog.Positioner>
                        <Dialog.Content>
                            <Dialog.Header>
                                <Dialog.Title>Create New Directory</Dialog.Title>
                                <Text fontSize="sm" color="fg.subtle" mt="1">
                                    {currentFolder === "__root__" ? "in \\" : currentFolder ? `in ${currentFolder}\\` : "in library root"}
                                </Text>
                            </Dialog.Header>
                            <Dialog.Body>
                                <Field.Root>
                                    <Field.Label>Folder name</Field.Label>
                                    <Input
                                        value={newDirName}
                                        onChange={(e) => setNewDirName(e.target.value)}
                                        placeholder="e.g. landscapes"
                                        size="sm"
                                        onKeyDown={(e: React.KeyboardEvent) => { if (e.key === "Enter") handleCreateDirectory() }}
                                    />
                                </Field.Root>
                            </Dialog.Body>
                            <Dialog.Footer>
                                <Button variant="outline" onClick={() => { setCreateDirOpen(false); setNewDirName("") }}>
                                    Cancel
                                </Button>
                                <Button
                                    colorPalette="accent"
                                    loading={creating}
                                    disabled={!newDirName.trim()}
                                    onClick={handleCreateDirectory}
                                >
                                    Create
                                </Button>
                            </Dialog.Footer>
                        </Dialog.Content>
                    </Dialog.Positioner>
                </Portal>
            </Dialog.Root>
        </Stack>
    )
}
