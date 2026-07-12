import { useEffect, useMemo, useRef, useState } from "react"
import {
    Box,
    Button,
    Dialog,
    HStack,
    Portal,
    Spinner,
    Text,
    VStack,
    createToaster,
} from "@chakra-ui/react"
import { api } from "../services/api"
import type { ServerDirEntry, ServerDrive } from "../types"

function ChevronRightIcon() {
    return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6" />
        </svg>
    )
}

function FolderIcon() {
    return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
        </svg>
    )
}

function ArrowUpIcon() {
    return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="19" x2="12" y2="5" />
            <polyline points="5 12 12 5 19 12" />
        </svg>
    )
}

function HardDriveIcon() {
    return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="22" y1="12" x2="2" y2="12" />
            <path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
            <line x1="6" y1="16" x2="6.01" y2="16" />
            <line x1="10" y1="16" x2="10.01" y2="16" />
        </svg>
    )
}

interface ServerPathPickerProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    onSelect: (path: string) => void
}

export function ServerPathPicker({ open, onOpenChange, onSelect }: ServerPathPickerProps) {
    const toaster = useMemo(() => createToaster({ placement: "top-end", gap: 16 }), [])

    const [drives, setDrives] = useState<ServerDrive[]>([])
    const [currentPath, setCurrentPath] = useState("")
    const [entries, setEntries] = useState<ServerDirEntry[]>([])
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState("")
    const [initialLoading, setInitialLoading] = useState(false)

    // Load drives on first open; cache them so re-opening doesn't flash
    const drivesCacheRef = useRef<ServerDrive[] | null>(null)

    useEffect(() => {
        if (!open) return

        if (drivesCacheRef.current) {
            // Restore cached drives instantly — no flash
            setDrives(drivesCacheRef.current)
            setCurrentPath("")
            setEntries([])
            setError("")
            return
        }

        setInitialLoading(true)
        setError("")
        api.getDrives()
            .then((data) => {
                drivesCacheRef.current = data
                setDrives(data)
                setCurrentPath("")
                setEntries([])
            })
            .catch(() => {
                setError("Cannot connect to server")
            })
            .finally(() => setInitialLoading(false))
    }, [open])

    // Reset when dialog closes
    useEffect(() => {
        if (!open) {
            setError("")
            setCurrentPath("")
            setEntries([])
        }
    }, [open])

    const navigate = async (path: string) => {
        setLoading(true)
        setError("")
        try {
            const result = await api.browsePath(path)
            setCurrentPath(result.path)
            setEntries(result.dirs)
            setDrives([])
        } catch {
            setError("Cannot browse path: " + path)
            toaster.create({
                title: "Browse failed",
                description: "Cannot access this path.",
                type: "error",
            })
        } finally {
            setLoading(false)
        }
    }

    const handleDriveClick = (drive: ServerDrive) => {
        navigate(drive.path || drive.name)
    }

    const handleDirClick = (dir: ServerDirEntry) => {
        navigate(dir.path)
    }

    const handleUp = () => {
        if (!currentPath) return
        // Windows: "C:\foo\bar" → up to "C:\foo" or "C:\"
        const isWindows = currentPath.includes("\\")
        const sep = isWindows ? "\\" : "/"

        const trimmed = currentPath.endsWith(sep) ? currentPath.slice(0, -1) : currentPath
        const lastSep = trimmed.lastIndexOf(sep)
        if (lastSep <= 0) {
            // Go back to drives
            setCurrentPath("")
            setEntries([])
            setLoading(true)
            setError("")
            api.getDrives()
                .then(setDrives)
                .catch(() => setError("Cannot load drives"))
                .finally(() => setLoading(false))
            return
        }

        const parent = trimmed.slice(0, lastSep)
        navigate(parent)
    }

    const handleSelect = () => {
        const path = currentPath || ""
        onSelect(path)
        onOpenChange(false)
    }

    // Build breadcrumb segments
    const breadcrumbs = useMemo(() => {
        if (!currentPath) return []
        const isWindows = currentPath.includes("\\")
        const sep = isWindows ? "\\" : "/"
        const parts = currentPath.split(sep).filter(Boolean)
        const crumbs: { label: string; path: string }[] = []
        let accumulated = ""
        for (let i = 0; i < parts.length; i++) {
            const isDrive = parts[i].match(/^[A-Za-z]:$/)
            if (isWindows && isDrive) {
                accumulated = parts[i] + sep
            } else if (i === 0 && isWindows) {
                accumulated = parts[i]
            } else {
                accumulated = accumulated ? accumulated + sep + parts[i] : parts[i]
            }
            crumbs.push({ label: parts[i], path: accumulated })
        }
        return crumbs
    }, [currentPath])

    const isRootLevel = !currentPath && drives.length > 0

    return (
        <Dialog.Root open={open} onOpenChange={(e: { open: boolean }) => onOpenChange(e.open)} size="md">
            <Portal>
                <Dialog.Backdrop />
                <Dialog.Positioner>
                    <Dialog.Content maxH="70vh" minH="400px">
                        <Dialog.Header>
                            <Dialog.Title>Browse Server Filesystem</Dialog.Title>
                            <Dialog.CloseTrigger />
                        </Dialog.Header>

                        <Dialog.Body>
                            {error ? (
                                <VStack gap="3" py="8" color="fg.muted">
                                    <Text fontSize="sm" color="red.500">{error}</Text>
                                    <Button size="sm" variant="outline" onClick={() => {
                                        if (!currentPath) {
                                            drivesCacheRef.current = null
                                            setDrives([])
                                            setInitialLoading(true)
                                            api.getDrives().then((data) => {
                                                drivesCacheRef.current = data
                                                setDrives(data)
                                            }).catch(() => { }).finally(() => setInitialLoading(false))
                                        } else {
                                            navigate(currentPath)
                                        }
                                    }}>
                                        Retry
                                    </Button>
                                </VStack>
                            ) : initialLoading ? (
                                <VStack gap="3" py="8" color="fg.muted">
                                    <Spinner size="md" />
                                    <Text fontSize="sm">Loading...</Text>
                                </VStack>
                            ) : (
                                <VStack gap="3" align="stretch">
                                    {/* Breadcrumb */}
                                    {breadcrumbs.length > 0 && (
                                        <HStack gap="1" flexWrap="wrap" pb="1">
                                            <Button
                                                variant="ghost"
                                                size="xs"
                                                colorPalette="gray"
                                                onClick={() => {
                                                    setCurrentPath("")
                                                    setEntries([])
                                                    api.getDrives().then(setDrives).catch(() => { })
                                                }}
                                            >
                                                Drives
                                            </Button>
                                            {breadcrumbs.map((crumb, i) => (
                                                <HStack key={crumb.path} gap="1">
                                                    <ChevronRightIcon />
                                                    <Button
                                                        variant="ghost"
                                                        size="xs"
                                                        colorPalette="gray"
                                                        onClick={() => navigate(crumb.path)}
                                                        fontWeight={i === breadcrumbs.length - 1 ? "bold" : "normal"}
                                                        maxW="200px"
                                                        truncate
                                                    >
                                                        {crumb.label}
                                                    </Button>
                                                </HStack>
                                            ))}
                                        </HStack>
                                    )}

                                    {/* Current path display — shown above listing */}
                                    {currentPath && (
                                        <Box
                                            bg="bg.subtle"
                                            px="3"
                                            py="1.5"
                                            borderRadius="md"
                                            fontSize="xs"
                                            color="fg"
                                            fontFamily="mono"
                                            truncate
                                        >
                                            {currentPath}
                                        </Box>
                                    )}

                                    {/* Directory listing — loading spinner only inside this box */}
                                    <Box
                                        minH="160px"
                                        maxH="260px"
                                        overflowY="auto"
                                        border="1px solid"
                                        borderColor="border"
                                        borderRadius="md"
                                    >
                                        {loading ? (
                                            <VStack gap="3" py="8" color="fg.muted">
                                                <Spinner size="md" />
                                                <Text fontSize="sm">Loading...</Text>
                                            </VStack>
                                        ) : isRootLevel ? (
                                            drives.map((drive) => (
                                                <HStack
                                                    key={drive.name}
                                                    px="3"
                                                    py="2.5"
                                                    gap="3"
                                                    cursor="pointer"
                                                    _hover={{ bg: "bg.subtle" }}
                                                    onClick={() => handleDriveClick(drive)}
                                                    borderBottom="1px solid"
                                                    borderColor="border.subtle"
                                                    _last={{ borderBottom: "none" }}
                                                >
                                                    <Box color="fg.muted">
                                                        <HardDriveIcon />
                                                    </Box>
                                                    <Text fontSize="sm" color="fg">{drive.label}</Text>
                                                </HStack>
                                            ))
                                        ) : entries.length === 0 ? (
                                            <VStack gap="3" py="8" color="fg.muted">
                                                <FolderIcon />
                                                <Text fontSize="sm">No subdirectories in this folder.</Text>
                                            </VStack>
                                        ) : (
                                            entries.map((entry) => (
                                                <HStack
                                                    key={entry.path}
                                                    px="3"
                                                    py="2.5"
                                                    gap="3"
                                                    cursor="pointer"
                                                    _hover={{ bg: "bg.subtle" }}
                                                    onClick={() => handleDirClick(entry)}
                                                    borderBottom="1px solid"
                                                    borderColor="border.subtle"
                                                    _last={{ borderBottom: "none" }}
                                                >
                                                    <Box color="fg.muted" flexShrink="0">
                                                        <FolderIcon />
                                                    </Box>
                                                    <Text fontSize="sm" color="fg" truncate>
                                                        {entry.name}
                                                    </Text>
                                                </HStack>
                                            ))
                                        )}
                                    </Box>

                                    {/* Up button */}
                                    {currentPath && (
                                        <HStack gap="2">
                                            <Button
                                                variant="ghost"
                                                size="xs"
                                                colorPalette="gray"
                                                onClick={handleUp}
                                            >
                                                <ArrowUpIcon />
                                                <Box as="span" ml="1">Up</Box>
                                            </Button>
                                        </HStack>
                                    )}
                                </VStack>
                            )}
                        </Dialog.Body>

                        <Dialog.Footer>
                            <Button variant="outline" onClick={() => onOpenChange(false)}>
                                Cancel
                            </Button>
                            <Button
                                colorPalette="accent"
                                onClick={handleSelect}
                                disabled={loading || !(isRootLevel || currentPath)}
                            >
                                Select This Folder
                            </Button>
                        </Dialog.Footer>
                    </Dialog.Content>
                </Dialog.Positioner>
            </Portal>
        </Dialog.Root>
    )
}
