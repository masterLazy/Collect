import { useEffect, useState } from "react"
import {
    Box,
    Button,
    Card,
    Center,
    Checkbox,
    Dialog,
    Field,
    HStack,
    Input,
    Portal,
    Separator,
    Spinner,
    Text,
    VStack,
} from "@chakra-ui/react"
import type { CustomToaster } from "./CustomToast"
import { useDocumentTitle } from "../hooks/useDocumentTitle"
import { api } from "../services/api"
import { ServerPathPicker } from "./ServerPathPicker"
import type { LibraryInfo } from "../types"

function FolderIcon() {
    return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
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

function FolderOpenIcon() {
    return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
            <path d="M1 10l3 9h16l3-9H1z" />
        </svg>
    )
}

function LibraryIcon() {
    return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
            <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
        </svg>
    )
}

interface LibraryManagerProps {
    onLibraryReady: (libraryId?: string) => void
    toaster: CustomToaster
}

export function LibraryManager({ onLibraryReady, toaster }: LibraryManagerProps) {
    const [libraries, setLibraries] = useState<LibraryInfo[]>([])
    const [librariesLoaded, setLibrariesLoaded] = useState(false)
    const [newName, setNewName] = useState("")
    const [newPath, setNewPath] = useState("")
    const [creating, setCreating] = useState(false)
    const [scanning, setScanning] = useState(false)
    const [pendingPath, setPendingPath] = useState("")
    const [pendingName, setPendingName] = useState("")
    const [showCreatePrompt, setShowCreatePrompt] = useState(false)
    const [pathPickerOpen, setPathPickerOpen] = useState(false)
    const [openBrowseOpen, setOpenBrowseOpen] = useState(false)
    const [removeConfirmId, setRemoveConfirmId] = useState<string | null>(null)
    const [encryptLibrary, setEncryptLibrary] = useState(false)
    const [password, setPassword] = useState("")
    const [confirmPassword, setConfirmPassword] = useState("")

    // Page title
    useDocumentTitle("Library Manager · Collect")

    const fetchLibraries = () => {
        api.getLibraries()
            .then((data) => setLibraries(data))
            .catch(() => {
                toaster.create({
                    title: "Load failed",
                    description: "Cannot fetch libraries from server.",
                    type: "error",
                })
            })
            .finally(() => setLibrariesLoaded(true))
    }

    useEffect(() => {
        fetchLibraries()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    const handleCreate = async () => {
        const name = newName.trim()
        const path = newPath.trim()
        if (!name || !path) return

        setCreating(true)
        setScanning(true)
        try {
            const info = await api.initLibrary(path, name, encryptLibrary ? password : undefined)
            await api.scanAssets()
            fetchLibraries()
            toaster.create({
                title: "Library created",
                description: "Library '" + name + "' is ready.",
                type: "success",
            })
            onLibraryReady(info.id)
        } catch {
            setScanning(false)
            toaster.create({
                title: "Failed to create library",
                description: "Check the folder path and try again.",
                type: "error",
            })
        } finally {
            setCreating(false)
        }
    }

    const handleOpenLibrary = async (lib: LibraryInfo) => {
        setScanning(true)
        try {
            await api.loadLibrary(lib.id)
            onLibraryReady(lib.id)
        } catch {
            setScanning(false)
            toaster.create({
                title: "Failed to open library",
                description: "The library may have been moved or deleted.",
                type: "error",
            })
        }
    }

    const handleRemoveLibrary = async (id: string) => {
        try {
            await api.removeLibrary(id)
            setLibraries((prev) => prev.filter((l) => l.id !== id))
            toaster.create({
                title: "Library removed",
                description: "The library has been removed from the registry.",
                type: "success",
            })
        } catch {
            toaster.create({
                title: "Remove failed",
                description: "Could not remove library from registry.",
                type: "error",
            })
        } finally {
            setRemoveConfirmId(null)
        }
    }

    const handleOpenBrowse = async () => {
        // Open the server path picker for "Open Library"
        setOpenBrowseOpen(true)
    }

    const handleOpenBrowseSelect = async (path: string) => {
        setOpenBrowseOpen(false)
        if (!path) return

        setScanning(true)
        try {
            // Initialize handles both existing libraries (finds .collect/library.json)
            // and new folders — no need for a separate check step.
            const name = path.split(/[\\/]/).filter(Boolean).pop() || path
            const info = await api.initLibrary(path, name)
            setScanning(false)
            onLibraryReady(info.id)
        } catch (err: any) {
            setScanning(false)
            toaster.create({
                title: "Open failed",
                description: "Could not open this folder as a library.",
                type: "error",
            })
        }
    }

    return (
        <Box position="relative">
            <Center height="100vh" bg="bg">
                <VStack gap="6" width="full" maxW="960px" px="4">
                    <Box textAlign="center">
                        <Box display="flex" alignItems="center" justifyContent="center" gap="3">
                            <img src="/icon.svg" alt="Collect" style={{ width: 40, height: 40 }} />
                            <Text fontSize="3xl" fontWeight="bold" color="fg">
                                Collect
                            </Text>
                        </Box>
                        <Text color="fg.muted" fontSize="sm" mt="1">
                            Multimedia Asset Manager
                        </Text>
                    </Box>

                    <VStack display={{ base: "flex", md: "none" }} gap="6" width="full" overflow="auto">
                        {/* Your Libraries */}
                        <Card.Root width="full" variant="outline">
                            <Card.Header pb="3">
                                <HStack gap="2">
                                    <LibraryIcon />
                                    <Text fontWeight="semibold" color="fg">Your Libraries</Text>
                                </HStack>
                            </Card.Header>
                            <Card.Body pt="0" maxH="200px" overflow="auto">
                                {!librariesLoaded ? (
                                    <VStack gap="3" py="6" color="fg.muted">
                                        <Spinner size="sm" />
                                        <Text fontSize="sm">Loading libraries...</Text>
                                    </VStack>
                                ) : libraries.length === 0 ? (
                                    <VStack gap="3" py="6" color="fg.muted">
                                        <FolderIcon />
                                        <Text fontSize="sm">No libraries yet. Create or open one below.</Text>
                                    </VStack>
                                ) : (
                                    <VStack gap="0" align="stretch">
                                        {libraries.map((lib, i) => (
                                            <Box key={lib.id}>
                                                {i > 0 && <Separator />}
                                                <HStack
                                                    py="3"
                                                    px="1"
                                                    gap="3"
                                                    cursor="pointer"
                                                    onClick={() => handleOpenLibrary(lib)}
                                                    _hover={{ bg: "bg.subtle" }}
                                                    borderRadius="md"
                                                    transition="background 0.15s"
                                                >
                                                    <Box color="fg.muted" flexShrink="0">
                                                        <FolderIcon />
                                                    </Box>
                                                    <VStack gap="0" align="start" flex="1" minW="0">
                                                        <HStack gap="1">
                                                            {lib.isEncrypted && (
                                                                <Box color="yellow.500" title="Encrypted" flexShrink="0">
                                                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                                                                        <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                                                                        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                                                                    </svg>
                                                                </Box>
                                                            )}
                                                            <Text color="fg" fontWeight="medium" fontSize="sm" truncate>
                                                                {lib.name}
                                                            </Text>
                                                        </HStack>
                                                        <Text color="fg.muted" fontSize="xs" truncate>
                                                            {lib.path}
                                                        </Text>
                                                        <Text color="fg.muted" fontSize="xs">
                                                            {lib.assetCount} assets
                                                        </Text>
                                                    </VStack>
                                                    <Button
                                                        size="xs"
                                                        variant="ghost"
                                                        colorPalette="gray"
                                                        onClick={(e: React.MouseEvent) => {
                                                            e.stopPropagation()
                                                            setRemoveConfirmId(lib.id)
                                                        }}
                                                        aria-label="Remove from registry"
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

                        {/* Open Library */}
                        <Card.Root width="full" variant="outline">
                            <Card.Header pb="3">
                                <HStack gap="2">
                                    <FolderOpenIcon />
                                    <Text fontWeight="semibold" color="fg">Open Library</Text>
                                </HStack>
                            </Card.Header>
                            <Card.Body pt="0">
                                <VStack gap="4">
                                    <Text fontSize="sm" color="fg.muted">
                                        Browse for a folder that already contains a Collect library.
                                    </Text>
                                    <Button variant="outline" size="sm" onClick={handleOpenBrowse}>
                                        <FolderOpenIcon />
                                        <Box as="span" ml="1">Open Library</Box>
                                    </Button>
                                </VStack>
                            </Card.Body>
                        </Card.Root>

                        {/* Create New Library */}
                        <Card.Root id="create-library-section" width="full" variant="outline">
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
                                            <HStack gap="2" width="full">
                                                <Input
                                                    placeholder="e.g. D:/my-pictures/references"
                                                    value={newPath}
                                                    onChange={(e) => setNewPath(e.target.value)}
                                                    bg="bg"
                                                    border="1px solid"
                                                    borderColor="border"
                                                    required
                                                    flex="1"
                                                />
                                                <Button
                                                    type="button"
                                                    variant="outline"
                                                    size="sm"
                                                    onClick={() => setPathPickerOpen(true)}
                                                    flexShrink="0"
                                                >
                                                    Browse
                                                </Button>
                                            </HStack>
                                            <Field.HelperText color="fg.subtle" fontSize="xs">
                                                Click Browse to pick a folder from the server, or type a path.
                                            </Field.HelperText>
                                        </Field.Root>
                                        <Field.Root>
                                            <Checkbox.Root
                                                checked={encryptLibrary}
                                                onCheckedChange={(e: { checked: boolean }) => setEncryptLibrary(!!e.checked)}
                                            >
                                                <Checkbox.HiddenInput />
                                                <Checkbox.Control />
                                                <Checkbox.Label color="fg" fontSize="sm">
                                                    Encrypt this library
                                                </Checkbox.Label>
                                            </Checkbox.Root>
                                        </Field.Root>
                                        {encryptLibrary && (
                                            <VStack gap="3" width="full">
                                                <Field.Root>
                                                    <Field.Label color="fg">Password</Field.Label>
                                                    <Input
                                                        type="password"
                                                        placeholder="Enter password"
                                                        value={password}
                                                        onChange={(e) => setPassword(e.target.value)}
                                                        bg="bg"
                                                        border="1px solid"
                                                        borderColor="border"
                                                        required
                                                    />
                                                </Field.Root>
                                                <Field.Root>
                                                    <Field.Label color="fg">Confirm Password</Field.Label>
                                                    <Input
                                                        type="password"
                                                        placeholder="Confirm password"
                                                        value={confirmPassword}
                                                        onChange={(e) => setConfirmPassword(e.target.value)}
                                                        bg="bg"
                                                        border="1px solid"
                                                        required
                                                        {...(confirmPassword && password !== confirmPassword ? { borderColor: "red.400" } : { borderColor: "border" })}
                                                    />
                                                    {confirmPassword && password !== confirmPassword && (
                                                        <Field.ErrorText>Passwords do not match</Field.ErrorText>
                                                    )}
                                                </Field.Root>
                                            </VStack>
                                        )}
                                        <Button
                                            type="submit"
                                            colorPalette="accent"
                                            width="full"
                                            loading={creating}
                                            disabled={!newName.trim() || !newPath.trim() || (encryptLibrary && (!password || password !== confirmPassword))}
                                        >
                                            Create and Scan
                                        </Button>
                                    </VStack>
                                </Box>
                            </Card.Body>
                        </Card.Root>
                    </VStack>

                    <HStack display={{ base: "none", md: "flex" }} gap="6" width="full" align="stretch" flex="1" minH="0">
                        {/* Left: Your Libraries */}
                        <Card.Root flex="1" variant="outline" maxH="calc(100vh - 160px)">
                            <Card.Header pb="3">
                                <HStack gap="2">
                                    <LibraryIcon />
                                    <Text fontWeight="semibold" color="fg">Your Libraries</Text>
                                </HStack>
                            </Card.Header>
                            <Card.Body pt="0" overflow="auto">
                                {!librariesLoaded ? (
                                    <VStack gap="3" py="6" color="fg.muted">
                                        <Spinner size="sm" />
                                        <Text fontSize="sm">Loading libraries...</Text>
                                    </VStack>
                                ) : libraries.length === 0 ? (
                                    <VStack gap="3" py="6" color="fg.muted">
                                        <FolderIcon />
                                        <Text fontSize="sm">No libraries yet. Create or open one below.</Text>
                                    </VStack>
                                ) : (
                                    <VStack gap="0" align="stretch">
                                        {libraries.map((lib, i) => (
                                            <Box key={lib.id}>
                                                {i > 0 && <Separator />}
                                                <HStack
                                                    py="3"
                                                    px="1"
                                                    gap="3"
                                                    cursor="pointer"
                                                    onClick={() => handleOpenLibrary(lib)}
                                                    _hover={{ bg: "bg.subtle" }}
                                                    borderRadius="md"
                                                    transition="background 0.15s"
                                                >
                                                    <Box color="fg.muted" flexShrink="0">
                                                        <FolderIcon />
                                                    </Box>
                                                    <VStack gap="0" align="start" flex="1" minW="0">
                                                        <HStack gap="1">
                                                            {lib.isEncrypted && (
                                                                <Box color="yellow.500" title="Encrypted" flexShrink="0">
                                                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                                                                        <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                                                                        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                                                                    </svg>
                                                                </Box>
                                                            )}
                                                            <Text color="fg" fontWeight="medium" fontSize="sm" truncate>
                                                                {lib.name}
                                                            </Text>
                                                        </HStack>
                                                        <Text color="fg.muted" fontSize="xs" truncate>
                                                            {lib.path}
                                                        </Text>
                                                        <Text color="fg.muted" fontSize="xs">
                                                            {lib.assetCount} assets
                                                        </Text>
                                                    </VStack>
                                                    <Button
                                                        size="xs"
                                                        variant="ghost"
                                                        colorPalette="gray"
                                                        onClick={(e: React.MouseEvent) => {
                                                            e.stopPropagation()
                                                            setRemoveConfirmId(lib.id)
                                                        }}
                                                        aria-label="Remove from registry"
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

                        {/* Right: Open Library + Create New Library */}
                        <VStack gap="6" width="md" minWidth="380px" maxWidth="420px">
                            {/* Section B: Open Existing Library */}
                            <Card.Root width="full" variant="outline">
                                <Card.Header pb="3">
                                    <HStack gap="2">
                                        <FolderOpenIcon />
                                        <Text fontWeight="semibold" color="fg">Open Library</Text>
                                    </HStack>
                                </Card.Header>
                                <Card.Body pt="0">
                                    <VStack gap="4">
                                        <Text fontSize="sm" color="fg.muted">
                                            Browse for a folder that already contains a Collect library.
                                        </Text>
                                        <Button variant="outline" size="sm" onClick={handleOpenBrowse}>
                                            <FolderOpenIcon />
                                            <Box as="span" ml="1">Open Library</Box>
                                        </Button>
                                    </VStack>
                                </Card.Body>
                            </Card.Root>

                            {/* Section C: Create New Library */}
                            <Card.Root id="create-library-section" width="full" variant="outline" flex="1">
                                <Card.Header pb="3">
                                    <HStack gap="2">
                                        <PlusIcon />
                                        <Text fontWeight="semibold" color="fg">Create New Library</Text>
                                    </HStack>
                                </Card.Header>
                                <Card.Body pt="0" overflow="auto">
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
                                                <HStack gap="2" width="full">
                                                    <Input
                                                        placeholder="e.g. D:/my-pictures/references"
                                                        value={newPath}
                                                        onChange={(e) => setNewPath(e.target.value)}
                                                        bg="bg"
                                                        border="1px solid"
                                                        borderColor="border"
                                                        required
                                                        flex="1"
                                                    />
                                                    <Button
                                                        type="button"
                                                        variant="outline"
                                                        size="sm"
                                                        onClick={() => setPathPickerOpen(true)}
                                                        flexShrink="0"
                                                    >
                                                        Browse
                                                    </Button>
                                                </HStack>
                                                <Field.HelperText color="fg.subtle" fontSize="xs">
                                                    Click Browse to pick a folder from the server, or type a path.
                                                </Field.HelperText>
                                            </Field.Root>
                                            <Field.Root>
                                                <Checkbox.Root
                                                    checked={encryptLibrary}
                                                    onCheckedChange={(e: { checked: boolean }) => setEncryptLibrary(!!e.checked)}
                                                >
                                                    <Checkbox.HiddenInput />
                                                    <Checkbox.Control />
                                                    <Checkbox.Label color="fg" fontSize="sm">
                                                        Encrypt this library
                                                    </Checkbox.Label>
                                                </Checkbox.Root>
                                            </Field.Root>
                                            {encryptLibrary && (
                                                <VStack gap="3" width="full">
                                                    <Field.Root>
                                                        <Field.Label color="fg">Password</Field.Label>
                                                        <Input
                                                            type="password"
                                                            placeholder="Enter password"
                                                            value={password}
                                                            onChange={(e) => setPassword(e.target.value)}
                                                            bg="bg"
                                                            border="1px solid"
                                                            borderColor="border"
                                                            required
                                                        />
                                                    </Field.Root>
                                                    <Field.Root>
                                                        <Field.Label color="fg">Confirm Password</Field.Label>
                                                        <Input
                                                            type="password"
                                                            placeholder="Confirm password"
                                                            value={confirmPassword}
                                                            onChange={(e) => setConfirmPassword(e.target.value)}
                                                            bg="bg"
                                                            border="1px solid"
                                                            required
                                                            {...(confirmPassword && password !== confirmPassword ? { borderColor: "red.400" } : { borderColor: "border" })}
                                                        />
                                                        {confirmPassword && password !== confirmPassword && (
                                                            <Field.ErrorText>Passwords do not match</Field.ErrorText>
                                                        )}
                                                    </Field.Root>
                                                </VStack>
                                            )}
                                            <Button
                                                type="submit"
                                                colorPalette="accent"
                                                width="full"
                                                loading={creating}
                                                disabled={!newName.trim() || !newPath.trim() || (encryptLibrary && (!password || password !== confirmPassword))}
                                            >
                                                Create and Scan
                                            </Button>
                                        </VStack>
                                    </Box>
                                </Card.Body>
                            </Card.Root>
                        </VStack>
                    </HStack>
                </VStack>
            </Center>

            {/* Path picker for Create form */}
            <ServerPathPicker
                open={pathPickerOpen}
                onOpenChange={setPathPickerOpen}
                onSelect={(path) => setNewPath(path)}
            />

            {/* Path picker for Open Library */}
            <ServerPathPicker
                open={openBrowseOpen}
                onOpenChange={setOpenBrowseOpen}
                onSelect={handleOpenBrowseSelect}
            />

            {/* Create prompt dialog */}
            <Dialog.Root open={showCreatePrompt} onOpenChange={(e: { open: boolean }) => setShowCreatePrompt(e.open)}>
                <Portal>
                    <Dialog.Backdrop />
                    <Dialog.Positioner>
                        <Dialog.Content>
                            <Dialog.Header>
                                <Dialog.Title>Create Library?</Dialog.Title>
                            </Dialog.Header>
                            <Dialog.Body>
                                <Text fontSize="sm" color="fg">
                                    The folder does not contain a Collect library.
                                    Would you like to create one?
                                </Text>
                            </Dialog.Body>
                            <Dialog.Footer>
                                <Button variant="outline" onClick={() => setShowCreatePrompt(false)}>
                                    Cancel
                                </Button>
                                <Button
                                    colorPalette="accent"
                                    onClick={() => {
                                        setShowCreatePrompt(false)
                                        setNewName(pendingName)
                                        setNewPath(pendingPath)
                                        document.getElementById("create-library-section")?.scrollIntoView({ behavior: "smooth" })
                                    }}
                                >
                                    Create Library
                                </Button>
                            </Dialog.Footer>
                        </Dialog.Content>
                    </Dialog.Positioner>
                </Portal>
            </Dialog.Root>

            {/* Remove confirmation dialog */}
            <Dialog.Root open={!!removeConfirmId} onOpenChange={() => setRemoveConfirmId(null)}>
                <Portal>
                    <Dialog.Backdrop />
                    <Dialog.Positioner>
                        <Dialog.Content>
                            <Dialog.Header>
                                <Dialog.Title>Remove Library?</Dialog.Title>
                            </Dialog.Header>
                            <Dialog.Body>
                                <Text fontSize="sm" color="fg">
                                    This will remove the library from your registry. The folder and its files will not be deleted.
                                </Text>
                            </Dialog.Body>
                            <Dialog.Footer>
                                <Button variant="outline" onClick={() => setRemoveConfirmId(null)}>
                                    Cancel
                                </Button>
                                <Button
                                    colorPalette="red"
                                    onClick={() => removeConfirmId && handleRemoveLibrary(removeConfirmId)}
                                >
                                    Remove
                                </Button>
                            </Dialog.Footer>
                        </Dialog.Content>
                    </Dialog.Positioner>
                </Portal>
            </Dialog.Root>

            {/* Scanning overlay */}
            {scanning && (
                <Box
                    position="absolute"
                    inset="0"
                    bg="bg/80"
                    backdropFilter="blur(4px)"
                    display="flex"
                    flexDirection="column"
                    alignItems="center"
                    justifyContent="center"
                    gap="4"
                    zIndex="10"
                >
                    <Spinner size="lg" colorPalette="accent" />
                    <Text color="fg" fontWeight="medium">Scanning assets...</Text>
                    <Text color="fg.muted" fontSize="sm">This may take a moment for large libraries.</Text>
                </Box>
            )}
        </Box>
    )
}

