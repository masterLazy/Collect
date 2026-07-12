import { useState } from "react"
import {
    Box,
    Button,
    Card,
    Center,
    Checkbox,
    Field,
    HStack,
    Input,
    Separator,
    Text,
    VStack,
    createToaster,
} from "@chakra-ui/react"
import { api } from "../services/api"

const RECENT_LIBRARIES_KEY = "collect_recent_libraries"

interface RecentLibrary {
    name: string
    path: string
    lastOpened: string
}

function getRecentLibraries(): RecentLibrary[] {
    try {
        const data = localStorage.getItem(RECENT_LIBRARIES_KEY)
        return data ? JSON.parse(data) : []
    } catch {
        return []
    }
}

function addRecentLibrary(lib: RecentLibrary) {
    const list = getRecentLibraries().filter((l) => l.path !== lib.path)
    list.unshift(lib)
    localStorage.setItem(RECENT_LIBRARIES_KEY, JSON.stringify(list.slice(0, 10)))
}

function removeRecentLibrary(path: string) {
    const list = getRecentLibraries().filter((l) => l.path !== path)
    localStorage.setItem(RECENT_LIBRARIES_KEY, JSON.stringify(list))
}

function FolderIcon() {
    return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
        </svg>
    )
}

function ClockIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
        </svg>
    )
}

function PlusIcon() {
    return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
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

interface LibraryManagerProps {
    onLibraryReady: () => void
    toaster: ReturnType<typeof createToaster>
}

export function LibraryManager({ onLibraryReady, toaster }: LibraryManagerProps) {
    const [recentLibraries, setRecentLibraries] = useState<RecentLibrary[]>(getRecentLibraries)
    const [newName, setNewName] = useState("")
    const [newPath, setNewPath] = useState("")
    const [creating, setCreating] = useState(false)
    const [useMd5, setUseMd5] = useState(false)
    const [parseTags, setParseTags] = useState(true)

    const handleCreate = async () => {
        const name = newName.trim()
        const path = newPath.trim()
        if (!name || !path) return

        setCreating(true)
        try {
            await api.initLibrary(path, name, { useMd5, parseTags })
            addRecentLibrary({ name, path, lastOpened: new Date().toISOString() })
            await api.scanAssets()
            toaster.create({
                title: "Library created",
                description: "Library '" + name + "' is ready.",
                type: "success",
            })
            onLibraryReady()
        } catch {
            toaster.create({
                title: "Failed to create library",
                description: "Check the folder path and try again.",
                type: "error",
            })
        } finally {
            setCreating(false)
        }
    }

    const handleOpen = async (lib: RecentLibrary) => {
        try {
            await api.initLibrary(lib.path, lib.name)
            addRecentLibrary({ ...lib, lastOpened: new Date().toISOString() })
            onLibraryReady()
        } catch {
            toaster.create({
                title: "Failed to open library",
                description: "The library path may no longer be valid.",
                type: "error",
            })
        }
    }

    const handleRemoveRecent = (path: string) => {
        removeRecentLibrary(path)
        setRecentLibraries(getRecentLibraries())
    }

    const formatDate = (iso: string) => {
        try {
            return new Date(iso).toLocaleDateString(undefined, {
                year: "numeric",
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
            })
        } catch {
            return iso
        }
    }

    return (
        <Center height="100vh" bg="bg">
            <VStack gap="8" width="full" maxW="540px" px="4">
                <Box textAlign="center">
                    <Text fontSize="3xl" fontWeight="bold" color="fg">
                        Collect
                    </Text>
                    <Text color="fg.muted" fontSize="sm" mt="1">
                        Library Manager
                    </Text>
                </Box>

                {/* Section A: Recent Libraries */}
                <Card.Root width="full" variant="outline">
                    <Card.Header pb="3">
                        <HStack gap="2">
                            <ClockIcon />
                            <Text fontWeight="semibold" color="fg">Recent Libraries</Text>
                        </HStack>
                    </Card.Header>
                    <Card.Body pt="0">
                        {recentLibraries.length === 0 ? (
                            <Text color="fg.muted" fontSize="sm" py="6" textAlign="center">
                                No recent libraries. Create one below.
                            </Text>
                        ) : (
                            <VStack gap="0" align="stretch">
                                {recentLibraries.map((lib, i) => (
                                    <Box key={lib.path}>
                                        {i > 0 && <Separator />}
                                        <HStack
                                            py="3"
                                            px="1"
                                            gap="3"
                                            cursor="pointer"
                                            onClick={() => handleOpen(lib)}
                                            _hover={{ bg: "bg.subtle" }}
                                            borderRadius="md"
                                            transition="background 0.15s"
                                        >
                                            <Box color="fg.muted" flexShrink="0">
                                                <FolderIcon />
                                            </Box>
                                            <VStack gap="0" align="start" flex="1" minW="0">
                                                <Text color="fg" fontWeight="medium" fontSize="sm" truncate>
                                                    {lib.name}
                                                </Text>
                                                <Text color="fg.muted" fontSize="xs" truncate>
                                                    {lib.path}
                                                </Text>
                                                <HStack gap="1" color="fg.muted" fontSize="xs">
                                                    <ClockIcon />
                                                    <Text>{formatDate(lib.lastOpened)}</Text>
                                                </HStack>
                                            </VStack>
                                            <Button
                                                size="xs"
                                                variant="ghost"
                                                colorPalette="gray"
                                                onClick={(e: React.MouseEvent) => {
                                                    e.stopPropagation()
                                                    handleRemoveRecent(lib.path)
                                                }}
                                                aria-label="Remove from recent"
                                                flexShrink="0"
                                            >
                                                <XIcon />
                                            </Button>
                                        </HStack>
                                    </Box>
                                ))}
                            </VStack>
                        )}
                    </Card.Body>
                </Card.Root>

                {/* Section B: Create New Library */}
                <Card.Root width="full" variant="outline">
                    <Card.Header pb="3">
                        <HStack gap="2">
                            <PlusIcon />
                            <Text fontWeight="semibold" color="fg">Create New Library</Text>
                        </HStack>
                    </Card.Header>
                    <Card.Body pt="0">
                        <Box as="form" onSubmit={(e: React.FormEvent) => { e.preventDefault(); handleCreate(); }}>
                            <VStack gap="4">
                                <Field.Root>
                                    <Field.Label color="fg">Library Name</Field.Label>
                                    <Input
                                        placeholder="My Library"
                                        value={newName}
                                        onChange={(e) => setNewName(e.target.value)}
                                        bg="bg"
                                        border="1px solid"
                                        borderColor="border"
                                        required
                                    />
                                </Field.Root>
                                <Field.Root>
                                    <Field.Label color="fg">Folder Path</Field.Label>
                                    <Input
                                        placeholder="e.g. D:/my-pictures/references"
                                        value={newPath}
                                        onChange={(e) => setNewPath(e.target.value)}
                                        bg="bg"
                                        border="1px solid"
                                        borderColor="border"
                                        required
                                    />
                                    <Field.HelperText color="fg.subtle" fontSize="xs">
                                        e.g. D:\my-pictures\references
                                    </Field.HelperText>
                                </Field.Root>
                                <Checkbox.Root checked={parseTags} onCheckedChange={(e: { checked: boolean }) => setParseTags(!!e.checked)}>
                                    <Checkbox.HiddenInput />
                                    <Checkbox.Control />
                                    <Checkbox.Label color="fg" fontSize="sm">Parse tags from filenames</Checkbox.Label>
                                </Checkbox.Root>
                                <Checkbox.Root checked={useMd5} onCheckedChange={(e: { checked: boolean }) => setUseMd5(!!e.checked)}>
                                    <Checkbox.HiddenInput />
                                    <Checkbox.Control />
                                    <Checkbox.Label color="fg" fontSize="sm">Rename files to MD5</Checkbox.Label>
                                </Checkbox.Root>
                                <Button
                                    type="submit"
                                    colorPalette="accent"
                                    width="full"
                                    loading={creating}
                                    disabled={!newName.trim() || !newPath.trim()}
                                >
                                    Create and Scan
                                </Button>
                            </VStack>
                        </Box>
                    </Card.Body>
                </Card.Root>
            </VStack>
        </Center>
    )
}
