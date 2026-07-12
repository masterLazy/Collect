import { useEffect, useState } from "react"
import { Box, HStack, Stack, Text } from "@chakra-ui/react"
import { api } from "../services/api"
import type { DirectoryNode as DirectoryNodeType } from "../types"

interface DirectoryTreeProps {
    currentFolder: string
    onFolderChange: (folder: string) => void
}

function FolderIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
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
}: {
    node: DirectoryNodeType
    depth: number
    currentFolder: string
    onFolderChange: (folder: string) => void
}) {
    const [expanded, setExpanded] = useState(depth < 1)
    const hasChildren = node.children && node.children.length > 0
    const isSelected = currentFolder === node.path

    const handleClick = () => {
        onFolderChange(node.path)
    }

    const toggleExpand = (e: React.MouseEvent) => {
        e.stopPropagation()
        setExpanded((prev) => !prev)
    }

    return (
        <Box>
            <HStack
                gap="1"
                py="1"
                px="3"
                cursor="pointer"
                bg={isSelected ? "bg.subtle" : "transparent"}
                borderLeft="2px solid"
                borderLeftColor={isSelected ? "accent.default" : "transparent"}
                _hover={{ bg: "bg.subtle" }}
                onClick={handleClick}
                transition="background 0.1s"
                role="treeitem"
                aria-selected={isSelected}
            >
                <Box
                    as="span"
                    display="inline-flex"
                    alignItems="center"
                    justifyContent="center"
                    width="16px"
                    flexShrink="0"
                    onClick={hasChildren ? toggleExpand : undefined}
                    color="fg.muted"
                    visibility={hasChildren ? "visible" : "hidden"}
                >
                    <ChevronIcon expanded={expanded} />
                </Box>
                <Box as="span" color="fg.muted" flexShrink="0" display="inline-flex">
                    <FolderIcon />
                </Box>
                <Text fontSize="sm" color="fg" truncate flex="1">
                    {node.name}
                </Text>
                {node.assetCount > 0 && (
                    <Text fontSize="xs" color="fg.subtle" flexShrink="0">
                        ({node.assetCount})
                    </Text>
                )}
            </HStack>
            {hasChildren && expanded && (
                <Box>
                    {node.children.map((child) => (
                        <FolderNode
                            key={child.path}
                            node={child}
                            depth={depth + 1}
                            currentFolder={currentFolder}
                            onFolderChange={onFolderChange}
                        />
                    ))}
                </Box>
            )}
        </Box>
    )
}

export function DirectoryTree({ currentFolder, onFolderChange }: DirectoryTreeProps) {
    const [tree, setTree] = useState<DirectoryNodeType | null>(null)
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        setLoading(true)
        api.getDirectoryTree()
            .then((data) => setTree(data.root))
            .catch(() => { })
            .finally(() => setLoading(false))
    }, [])

    return (
        <Stack gap="0" role="tree" aria-label="Directory tree">
            {/* "All" root item */}
            <HStack
                gap="1"
                py="1"
                px="3"
                cursor="pointer"
                bg={currentFolder === "" ? "bg.subtle" : "transparent"}
                borderLeft="2px solid"
                borderLeftColor={currentFolder === "" ? "accent.default" : "transparent"}
                _hover={{ bg: "bg.subtle" }}
                onClick={() => onFolderChange("")}
                transition="background 0.1s"
                role="treeitem"
                aria-selected={currentFolder === ""}
            >
                <Box width="16px" flexShrink="0" />
                <Box as="span" color="fg.muted" flexShrink="0" display="inline-flex">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                    </svg>
                </Box>
                <Text fontSize="sm" color="fg" truncate flex="1">
                    All
                </Text>
            </HStack>
            {loading ? (
                <Text fontSize="xs" color="fg.subtle" px="3" py="2">
                    Loading...
                </Text>
            ) : tree ? (
                tree.children.map((child) => (
                    <FolderNode
                        key={child.path}
                        node={child}
                        depth={0}
                        currentFolder={currentFolder}
                        onFolderChange={onFolderChange}
                    />
                ))
            ) : null}
        </Stack>
    )
}
