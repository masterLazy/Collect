import { useEffect, useState, useCallback, useRef } from "react"
import { useParams, useNavigate, useLocation } from "react-router-dom"
import { useDocumentTitle } from "../hooks/useDocumentTitle"
import {
    Box,
    Button,
    Center,
    Dialog,
    Field,
    HStack,
    IconButton,
    Input,
    Portal,
    Spinner,
    Drawer,
    Text,
    VStack,
} from "@chakra-ui/react"
import { TopBar } from "./TopBar"
import { MasonryGrid } from "./MasonryGrid"
import { Sidebar } from "./Sidebar"
import { DirectoryTree } from "./DirectoryTree"
import { AddAssetDialog } from "./AddAssetDialog"
import { TagConflictDialog } from "./TagConflictDialog"
import { useCustomToaster, ToastContainer, CustomToaster } from "./CustomToast"
import { api } from "../services/api"
import type { AssetDto, TagConflict } from "../types"

const PAGE_SIZE = 30

// Convert internal folder value to API folder parameter
const toApiFolder = (folder: string): string | undefined => {
    if (folder === "") return undefined // All — no folder filter
    if (folder === "__root__") return "__root__" // Root directory
    return folder // specific subdirectory
}

// Root folder should only show direct files, not subfolder contents.
// All other views include subfolders by default.
const getSubfolders = (folder: string): boolean | undefined =>
    folder === "__root__" ? false : undefined

export type SortMode = "newest" | "name" | "random"

export function LibraryPage() {
    const { libraryId, "*": splat } = useParams()
    const navigate = useNavigate()
    const location = useLocation()
    const toaster = useCustomToaster()
    const [treeRefreshKey, setTreeRefreshKey] = useState(0)

    // Derive folder and search from URL
    // splat=undefined  → /:libraryId       → All mode → folder=""
    // splat=""         → /:libraryId/root   → Root mode → folder="__root__"
    // splat="ai"       → /:libraryId/root/ai → folder="ai"
    const folderFromUrl = splat === undefined ? "" : (splat === "" ? "__root__" : splat)
    const searchFromUrl = new URLSearchParams(location.search).get("s") || ""
    const alwaysShowSearchFromUrl = new URLSearchParams(location.search).get("ss") === "1"

    const [assets, setAssets] = useState<AssetDto[]>([])
    const [page, setPage] = useState(1)
    const [total, setTotal] = useState(0)
    const [loading, setLoading] = useState(false)
    const [libraryLoading, setLibraryLoading] = useState(true)
    const [libraryError, setLibraryError] = useState(false)
    const [searchQuery, setSearchQuery] = useState(searchFromUrl)
    const [selectedTags, setSelectedTags] = useState<string[]>([])
    const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null)
    const [currentFolder, setCurrentFolder] = useState(folderFromUrl)
    const [addDialogOpen, setAddDialogOpen] = useState(false)
    const [mobileTreeOpen, setMobileTreeOpen] = useState(false)
    const [scanning, setScanning] = useState(false)
    const [tagConflicts, setTagConflicts] = useState<TagConflict[]>([])
    const [conflictDialogOpen, setConflictDialogOpen] = useState(false)
    const [resolvingConflicts, setResolvingConflicts] = useState(false)
    const [isMobile, setIsMobile] = useState(false)
    const sortFromUrl = (new URLSearchParams(location.search).get("sort") as SortMode) || "newest"
    const [alwaysShowSearch, setAlwaysShowSearch] = useState(alwaysShowSearchFromUrl)
    const [sortMode, setSortMode] = useState<SortMode>(sortFromUrl)

    const [libraryName, setLibraryName] = useState("")
    const [libraryFullId, setLibraryFullId] = useState("")
    const [libraryPath, setLibraryPath] = useState("")

    const [showUnlockDialog, setShowUnlockDialog] = useState(false)
    const [unlockPassword, setUnlockPassword] = useState("")
    const [unlockError, setUnlockError] = useState("")
    const [unlocking, setUnlocking] = useState(false)
    const [libraryEncrypted, setLibraryEncrypted] = useState(false)
    const [decrypting, setDecrypting] = useState(false)
    const [showDecryptDialog, setShowDecryptDialog] = useState(false)
    const [decryptPassword, setDecryptPassword] = useState("")
    const [decryptError, setDecryptError] = useState("")
    const [showEncryptDialog, setShowEncryptDialog] = useState(false)
    const [encryptPassword, setEncryptPassword] = useState("")
    const [encryptConfirm, setEncryptConfirm] = useState("")
    const [encryptError, setEncryptError] = useState("")
    const [encrypting, setEncrypting] = useState(false)
    // Track removed asset IDs with reason for permanent blur overlay
    const [removedAssetMap, setRemovedAssetMap] = useState<Map<string, 'deleted' | 'moved'>>(new Map())
    const initialSyncDone = useRef(false)

    // Dynamic page title based on library name and folder
    const folderPart =
        currentFolder === "" || currentFolder === "__root__"
            ? libraryName
            : `${libraryName}/${currentFolder}`
    useDocumentTitle(folderPart ? `${folderPart} · Collect` : "Library Manager · Collect")

    // Load library by ID on mount (retry handled by backend RetryMiddleware)
    useEffect(() => {
        if (!libraryId) return

        let cancelled = false

        setLibraryLoading(true)
        setLibraryError(false)

        api.loadLibrary(libraryId)
            .then((info) => {
                if (cancelled) return
                setLibraryName(info.name)
                setLibraryFullId(info.id)
                setLibraryPath(info.path)
                if (info.isEncrypted) {
                    setLibraryEncrypted(true)
                    // Check if already unlocked (10-min persistence)
                    api.getUnlockStatus(libraryId!)
                        .then((status) => {
                            if (!status.unlocked) setShowUnlockDialog(true)
                        })
                        .catch(() => setShowUnlockDialog(true))
                }
            })
            .catch(() => {
                if (cancelled) return
                setLibraryError(true)
            })
            .finally(() => {
                if (!cancelled) setLibraryLoading(false)
            })

        return () => { cancelled = true }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [libraryId])

    // Sync folder from URL on initial load and on URL changes
    useEffect(() => {
        if (libraryLoading) return
        if (!initialSyncDone.current) {
            // First mount: use URL values, load assets
            initialSyncDone.current = true
            setCurrentFolder(folderFromUrl)
            setSearchQuery(searchFromUrl)

            // Parse tags from URL search query on initial load
            const tagMatch = searchFromUrl.match(/^tags:(.+)$/)
            if (tagMatch) {
                const parsedTags = tagMatch[1].split("+").filter(Boolean)
                setSelectedTags(parsedTags)
            }

            loadAssets(1, searchFromUrl, false, toApiFolder(folderFromUrl), getSubfolders(folderFromUrl))
                .then(() => {
                    // Check for tag conflicts after initial load
                    api.getTagConflicts(libraryId!).then((conflicts) => {
                        if (conflicts && conflicts.length > 0) {
                            setTagConflicts(conflicts)
                            setConflictDialogOpen(true)
                        }
                    }).catch(() => { })
                })
                .catch(() => { })
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [libraryLoading])

    // Mobile detection
    useEffect(() => {
        const mq = window.matchMedia("(max-width: 767px)")
        setIsMobile(mq.matches)
        const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches)
        mq.addEventListener("change", handler)
        return () => mq.removeEventListener("change", handler)
    }, [])

    // Update URL when folder or search changes (skip the initial sync)
    const updateUrl = useCallback((folder: string, query: string, sort?: string) => {
        let base: string
        if (folder === "") {
            base = `/${libraryId}` // All
        } else if (folder === "__root__") {
            base = `/${libraryId}/root` // Root
        } else {
            base = `/${libraryId}/root/${folder}` // subdirectory
        }
        const params = new URLSearchParams()
        if (query) params.set("s", query)
        const resolvedSort = sort ?? sortMode
        if (resolvedSort !== "newest") params.set("sort", resolvedSort)
        if (alwaysShowSearch) params.set("ss", "1")
        const searchStr = params.toString()
        navigate(`${base}${searchStr ? `?${searchStr}` : ""}`, { replace: true })
    }, [libraryId, navigate, alwaysShowSearch, sortMode])

    const loadAssets = useCallback(async (pageNum: number, query: string, append: boolean, folder?: string, subfolders?: boolean, sort?: string) => {
        setLoading(true)
        try {
            const resolvedSort = sort ?? sortMode
            let result: Awaited<ReturnType<typeof api.getAssets>>
            if (query) {
                result = await api.searchAssets(libraryId!, query, pageNum, PAGE_SIZE, folder || undefined)
            } else {
                result = await api.getAssets(libraryId!, pageNum, PAGE_SIZE, folder || undefined, subfolders, resolvedSort === "newest" ? undefined : resolvedSort)
            }
            setAssets((prev) => (append ? [...prev, ...result.items] : result.items))
            setTotal(result.total)
        } catch {
            toaster.create({
                title: "Load failed",
                description: "Cannot fetch assets. Check backend server.",
                type: "error",
            })
        } finally {
            setLoading(false)
        }
    }, [sortMode])

    const handleSearchChange = useCallback((query: string) => {
        setSearchQuery(query)
        setPage(1)
        updateUrl(currentFolder, query)

        // Sync selectedTags with tags: prefix in search query
        const tagMatch = query.match(/^tags:(.+)$/)
        if (tagMatch) {
            const parsedTags = tagMatch[1].split("+").filter(Boolean)
            setSelectedTags(parsedTags)
        } else {
            setSelectedTags([])
        }

        if (!libraryLoading) {
            loadAssets(1, query, false, toApiFolder(currentFolder), getSubfolders(currentFolder))
        }
    }, [currentFolder, libraryLoading, loadAssets, updateUrl, sortMode])

    const handleSortChange = useCallback((mode: SortMode) => {
        setSortMode(mode)
        setPage(1)
        setAssets([])
        updateUrl(currentFolder, searchQuery, mode)
        if (!libraryLoading) {
            loadAssets(1, searchQuery, false, toApiFolder(currentFolder), getSubfolders(currentFolder), mode)
        }
    }, [currentFolder, libraryLoading, loadAssets, updateUrl, searchQuery])

    const handleTagsChange = useCallback((tags: string[]) => {
        setSelectedTags(tags)
        const tagQuery = tags.length > 0 ? "tags:" + tags.join("+") : ""
        setSearchQuery(tagQuery)
        setPage(1)
        updateUrl(currentFolder, tagQuery)
        if (!libraryLoading) {
            loadAssets(1, tagQuery, false, toApiFolder(currentFolder), getSubfolders(currentFolder))
        }
    }, [currentFolder, libraryLoading, loadAssets, updateUrl])

    const handleLoadMore = useCallback(() => {
        if (loading) return
        const nextPage = page + 1
        setPage(nextPage)
        loadAssets(nextPage, searchQuery, true, toApiFolder(currentFolder), getSubfolders(currentFolder))
    }, [loading, page, searchQuery, loadAssets, currentFolder])

    const handleAssetMoved = useCallback((assetId?: string, reason?: 'deleted' | 'moved') => {
        if (!assetId) {
            // Fallback: full refresh
            setPage(1)
            setAssets([])
            setTreeRefreshKey((k) => k + 1)
            loadAssets(1, searchQuery, false, toApiFolder(currentFolder), getSubfolders(currentFolder))
            return
        }
        if (reason === 'deleted' || reason === 'moved') {
            // Keep the card in grid with permanent blur overlay
            setRemovedAssetMap((prev) => new Map(prev).set(assetId, reason!))
        }
        // Always refresh directory tree counts after any change
        setTreeRefreshKey((k) => k + 1)
    }, [loadAssets, searchQuery, currentFolder])

    const handleMoveAsset = useCallback(async (assetId: string, targetFolder: string) => {
        // Show blur overlay immediately
        setRemovedAssetMap((prev) => new Map(prev).set(assetId, 'moved'))
        try {
            await api.moveAsset(assetId, targetFolder, libraryId!)
            toaster.create({
                title: "Asset moved",
                description: `Moved to ${targetFolder || "root"}`,
                type: "success",
            })
            // Refresh directory tree counts — grid stays unchanged
            setTreeRefreshKey((k) => k + 1)
        } catch {
            // Move failed — remove blur overlay
            setRemovedAssetMap((prev) => {
                const next = new Map(prev)
                next.delete(assetId)
                return next
            })
            toaster.create({
                title: "Move failed",
                description: "Could not move asset to that folder.",
                type: "error",
            })
        }
    }, [toaster])

    const handleCategorizeSave = useCallback(() => {
        setPage(1)
        setAssets([])
        loadAssets(1, searchQuery, false, toApiFolder(currentFolder), getSubfolders(currentFolder))
    }, [loadAssets, searchQuery, currentFolder])

    const handleRescan = useCallback(async () => {
        setScanning(true)
        try {
            const result = await api.scanAssets(libraryId!)
            setPage(1)
            setAssets([])
            setTreeRefreshKey((k) => k + 1)
            loadAssets(1, searchQuery, false, toApiFolder(currentFolder), getSubfolders(currentFolder))

            // Check for tag conflicts
            if (result.tagConflicts && result.tagConflicts.length > 0) {
                setTagConflicts(result.tagConflicts)
                setConflictDialogOpen(true)
            } else if (result.added > 0 || result.removed > 0) {
                toaster.create({
                    title: "Scan complete",
                    description: `Added ${result.added}, removed ${result.removed}`,
                    type: "info",
                })
            }
        } catch {
            toaster.create({ title: "Rescan failed", type: "error" })
        } finally {
            setScanning(false)
        }
    }, [loadAssets, searchQuery, currentFolder, toaster, setTreeRefreshKey])

    const handleResolveConflicts = useCallback(async (resolutions: { tagValue: string; chosenType: string }[]) => {
        setResolvingConflicts(true)
        try {
            await api.resolveTagConflicts(libraryId!, resolutions)
            setConflictDialogOpen(false)
            setTagConflicts([])
            // Reload assets to reflect changes
            setPage(1)
            setAssets([])
            loadAssets(1, searchQuery, false, toApiFolder(currentFolder), getSubfolders(currentFolder))
            toaster.create({ title: "Conflicts resolved", type: "success" })
        } catch {
            toaster.create({ title: "Failed to resolve conflicts", type: "error" })
        } finally {
            setResolvingConflicts(false)
        }
    }, [loadAssets, searchQuery, currentFolder, toaster])

    const handleDecrypt = useCallback(async () => {
        // Always show password dialog — supports both regular decrypt and repair mode
        setShowDecryptDialog(true)
    }, [])

    const doDecrypt = useCallback(async (password: string | undefined) => {
        setDecrypting(true)
        setDecryptError("")
        try {
            const result = await api.decryptLibrary(libraryId!, password)
            setLibraryEncrypted(false)
            setShowDecryptDialog(false)
            toaster.create({
                title: "Library decrypted",
                description: result.message,
                type: "success",
            })
            // Navigate back to home to reload
            navigate("/", { state: { forceHome: true } })
        } catch (err: any) {
            const msg = err?.message || "Could not decrypt library."
            if (password !== undefined) {
                setDecryptError(msg)
            } else {
                toaster.create({
                    title: "Decrypt failed",
                    description: msg,
                    type: "error",
                })
            }
        } finally {
            setDecrypting(false)
        }
    }, [navigate, toaster])

    const handleEncrypt = useCallback(async () => {
        if (!encryptPassword || encryptPassword !== encryptConfirm) return
        setEncrypting(true)
        setEncryptError("")
        try {
            const result = await api.encryptLibrary(libraryId!, encryptPassword)
            setLibraryEncrypted(true)
            setShowEncryptDialog(false)
            setEncryptPassword("")
            setEncryptConfirm("")
            toaster.create({
                title: "Library encrypted",
                description: result.message,
                type: "success",
            })
            navigate("/", { state: { forceHome: true } })
        } catch (err: any) {
            const msg = err?.message || "Could not encrypt library."
            setEncryptError(msg)
        } finally {
            setEncrypting(false)
        }
    }, [encryptPassword, encryptConfirm, navigate, toaster])

    const handleFolderChange = useCallback((folder: string) => {
        setCurrentFolder(folder)
        setPage(1)
        setAssets([])
        updateUrl(folder, searchQuery)
        loadAssets(1, searchQuery, false, toApiFolder(folder), getSubfolders(folder))
    }, [loadAssets, updateUrl, searchQuery])

    const handleSelectAsset = useCallback((id: string) => {
        setSelectedAssetId(id)
    }, [])

    const handleSwitchLibrary = useCallback(() => {
        navigate("/", { state: { forceHome: true } })
    }, [navigate])

    const hasMore = assets.length < total

    // Loading state
    if (libraryLoading) {
        return (
            <Center height="100vh" bg="bg">
                <VStack gap="4">
                    <Spinner size="lg" colorPalette="accent" />
                    <Text color="fg.muted" fontSize="sm">Loading library...</Text>
                </VStack>
            </Center>
        )
    }

    // Error state
    if (libraryError) {
        return (
            <Center height="100vh" bg="bg">
                <VStack gap="4">
                    <Text color="fg" fontWeight="bold" fontSize="lg">Library not found</Text>
                    <Text color="fg.muted" fontSize="sm">
                        Could not load library "{libraryId}". It may have been removed.
                    </Text>
                    <Button colorPalette="accent" onClick={() => navigate("/", { state: { forceHome: true } })}>
                        Back to Library Manager
                    </Button>
                </VStack>
            </Center>
        )
    }

    return (
        <Box css={{ height: "100dvh" }} bg="bg" display="flex" flexDirection="column">
            <TopBar
                searchQuery={searchQuery}
                onSearchChange={handleSearchChange}
                selectedTags={selectedTags}
                onTagsChange={handleTagsChange}
                onOpenAddDialog={() => setAddDialogOpen(true)}
                onSwitchLibrary={handleSwitchLibrary}
                onOpenMobileTree={() => setMobileTreeOpen(true)}
                onRescan={handleRescan}
                scanning={scanning}
                libraryName={libraryName}
                libraryPath={libraryPath}
                libraryId={libraryFullId}
                onCategorizeSave={handleCategorizeSave}
                isMobile={isMobile}
                currentFolder={currentFolder}
                onNavigateToFolder={handleFolderChange}
                alwaysShowSearch={alwaysShowSearch}
                onToggleAlwaysShowSearch={() => {
                    setAlwaysShowSearch((v) => {
                        const next = !v
                        // Update URL to persist the setting
                        const params = new URLSearchParams(location.search)
                        if (next) {
                            params.set("ss", "1")
                        } else {
                            params.delete("ss")
                        }
                        const searchStr = params.toString()
                        navigate(`${location.pathname}${searchStr ? `?${searchStr}` : ""}`, { replace: true })
                        return next
                    })
                }}
                onShowAll={() => handleFolderChange("")}
                libraryEncrypted={libraryEncrypted}
                onDecrypt={handleDecrypt}
                decrypting={decrypting}
                onEncrypt={() => setShowEncryptDialog(true)}
                encrypting={encrypting}
                toaster={toaster}
                onLock={async () => {
                    try {
                        await api.lockLibrary(libraryId!);
                        sessionStorage.removeItem("collect-unlock-token");
                        toaster.create({
                            title: "Library locked",
                            description: "Session token has been invalidated.",
                            type: "success",
                        });
                        // Navigate back to home so user re-enters and sees unlock dialog
                        navigate("/", { state: { forceHome: true } });
                    } catch {
                        toaster.create({
                            title: "Lock failed",
                            type: "error",
                        });
                    }
                }}
                sortMode={sortMode}
                onSortChange={handleSortChange}
            />

            <Box
                display="flex"
                flex="1"
                overflow="hidden"
                minH="0"
            >
                {/* Left: Directory Tree (desktop) */}
                <Box
                    width="220px"
                    minWidth="180px"
                    overflow="hidden auto"
                    borderRight="1px solid"
                    borderColor="border"
                    display={{ base: "none", md: "block" }}
                    py="2"
                >
                    <DirectoryTree currentFolder={currentFolder} onFolderChange={handleFolderChange} onMoveAsset={handleMoveAsset} refreshKey={treeRefreshKey} libraryId={libraryId!} />
                </Box>

                {/* Center: Masonry */}
                <Box flex="1" overflow="hidden auto" p={{ base: "2", md: "4" }} position="relative" className="masonry-scroll-container">
                    <MasonryGrid
                        assets={assets}
                        loading={loading}
                        hasMore={hasMore}
                        onLoadMore={handleLoadMore}
                        onSelectAsset={handleSelectAsset}
                        currentFolder={currentFolder}
                        searchQuery={searchQuery}
                        removedAssetIds={removedAssetMap}
                    />
                </Box>

                {/* Right: Docked Sidebar (desktop only) */}
                {selectedAssetId && <SidebarPanel assetId={selectedAssetId} onClose={() => setSelectedAssetId(null)} toaster={toaster as CustomToaster} selectedTags={selectedTags} onTagClick={(value) => handleTagsChange(selectedTags.includes(value) ? selectedTags.filter((t) => t !== value) : [...selectedTags, value])} onRefreshRequested={(id, reason) => handleAssetMoved(id, reason)} />}
            </Box>

            <AddAssetDialog
                open={addDialogOpen}
                onOpenChange={setAddDialogOpen}
                toaster={toaster as CustomToaster}
                isMobile={isMobile}
                onAssetsAdded={() => { setPage(1); setAssets([]); setTreeRefreshKey((k) => k + 1); loadAssets(1, searchQuery, false, currentFolder || undefined, getSubfolders(currentFolder)) }}
                currentFolder={currentFolder}
                libraryId={libraryId}
            />

            {/* Mobile directory drawer (bottom) */}
            <Drawer.Root placement="bottom" open={mobileTreeOpen} onOpenChange={(e: { open: boolean }) => setMobileTreeOpen(e.open)}>
                <Portal>
                    <Drawer.Backdrop />
                    <Drawer.Positioner>
                        <Drawer.Content maxH="80vh" borderTopRadius="lg">
                            <Drawer.Header>
                                <HStack justify="space-between" width="full">
                                    <Drawer.Title>Folders</Drawer.Title>
                                    <Drawer.CloseTrigger asChild>
                                        <Button variant="ghost" size="sm" aria-label="Close">
                                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                <path d="M18 6L6 18M6 6l12 12" />
                                            </svg>
                                        </Button>
                                    </Drawer.CloseTrigger>
                                </HStack>
                            </Drawer.Header>
                            <Drawer.Body>
                                <DirectoryTree
                                    currentFolder={currentFolder}
                                    onFolderChange={(folder) => {
                                        handleFolderChange(folder)
                                        setMobileTreeOpen(false)
                                    }}
                                    onMoveAsset={handleMoveAsset}
                                    refreshKey={treeRefreshKey}
                                    libraryId={libraryId!}
                                />
                            </Drawer.Body>
                        </Drawer.Content>
                    </Drawer.Positioner>
                </Portal>
            </Drawer.Root>

            {/* Mobile bottom sheet for sidebar */}
            <Drawer.Root placement="bottom" open={!!selectedAssetId && isMobile} onOpenChange={(e: { open: boolean }) => { if (!e.open) setSelectedAssetId(null) }}>
                <Portal>
                    <Drawer.Backdrop />
                    <Drawer.Positioner>
                        <Drawer.Content maxH="80vh" borderTopRadius="lg">
                            <Drawer.Header>
                                <HStack justify="flex-end" width="full">
                                    <Drawer.CloseTrigger asChild>
                                        <Button variant="ghost" size="sm" aria-label="Close">
                                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                <path d="M18 6L6 18M6 6l12 12" />
                                            </svg>
                                        </Button>
                                    </Drawer.CloseTrigger>
                                </HStack>
                            </Drawer.Header>
                            <Drawer.Body p="4">
                                <Sidebar assetId={selectedAssetId} onClose={() => setSelectedAssetId(null)} toaster={toaster as CustomToaster} selectedTags={selectedTags} onTagClick={(value) => handleTagsChange(selectedTags.includes(value) ? selectedTags.filter((t) => t !== value) : [...selectedTags, value])} onRefreshRequested={(id, reason) => handleAssetMoved(id, reason)} />
                            </Drawer.Body>
                        </Drawer.Content>
                    </Drawer.Positioner>
                </Portal>
            </Drawer.Root>

            <ToastContainer toasts={toaster.toasts} onDismiss={toaster.dismiss} />

            <TagConflictDialog
                conflicts={tagConflicts}
                open={conflictDialogOpen}
                onResolve={handleResolveConflicts}
                onClose={() => setConflictDialogOpen(false)}
                resolving={resolvingConflicts}
            />

            {/* Unlock dialog for encrypted libraries */}
            <Dialog.Root open={showUnlockDialog} modal={true} onOpenChange={(e: { open: boolean }) => {
                if (!e.open) {
                    // If closed without unlocking, go back to library manager
                    navigate("/", { state: { forceHome: true } })
                }
            }}>
                <Portal>
                    <Dialog.Backdrop />
                    <Dialog.Positioner>
                        <Dialog.Content>
                            <Dialog.Header>
                                <Dialog.Title>Unlock Library</Dialog.Title>
                            </Dialog.Header>
                            <Dialog.Body>
                                <VStack gap="4">
                                    <Text fontSize="sm" color="fg.muted">
                                        This library is encrypted. Enter the password to unlock it.
                                    </Text>
                                    <Field.Root>
                                        <Field.Label color="fg">Password</Field.Label>
                                        <Input
                                            type="password"
                                            placeholder="Enter library password"
                                            value={unlockPassword}
                                            onChange={(e) => { setUnlockPassword(e.target.value); setUnlockError("") }}
                                            bg="bg"
                                            border="1px solid"
                                            borderColor={unlockError ? "red.400" : "border"}
                                            autoFocus
                                        />
                                        {unlockError && (
                                            <Field.ErrorText>{unlockError}</Field.ErrorText>
                                        )}
                                    </Field.Root>
                                </VStack>
                            </Dialog.Body>
                            <Dialog.Footer>
                                <Button variant="outline" onClick={() => navigate("/", { state: { forceHome: true } })}>
                                    Cancel
                                </Button>
                                <Button
                                    colorPalette="accent"
                                    loading={unlocking}
                                    disabled={!unlockPassword.trim()}
                                    onClick={async () => {
                                        setUnlocking(true)
                                        setUnlockError("")
                                        try {
                                            await api.unlockLibrary(libraryId!, libraryId!, unlockPassword)
                                            setShowUnlockDialog(false)
                                            // Reload assets after unlock
                                            const info = await api.getLibraryInfo(libraryId!)
                                            setLibraryName(info.name)
                                            setLibraryFullId(info.id)
                                            setLibraryPath(info.path)
                                            loadAssets(1, searchQuery, false, toApiFolder(currentFolder), getSubfolders(currentFolder))
                                        } catch {
                                            setUnlockError("Incorrect password. Please try again.")
                                        } finally {
                                            setUnlocking(false)
                                        }
                                    }}
                                >
                                    Unlock
                                </Button>
                            </Dialog.Footer>
                        </Dialog.Content>
                    </Dialog.Positioner>
                </Portal>
            </Dialog.Root>

            {/* Decrypt password dialog (for repair/non-unlocked libraries) */}
            <Dialog.Root open={showDecryptDialog} modal={true} onOpenChange={(e: { open: boolean }) => setShowDecryptDialog(e.open)}>
                <Portal>
                    <Dialog.Backdrop />
                    <Dialog.Positioner>
                        <Dialog.Content>
                            <Dialog.Header>
                                <Dialog.Title>Decrypt Library</Dialog.Title>
                            </Dialog.Header>
                            <Dialog.Body>
                                <VStack gap="4">
                                    <Text fontSize="sm" color="fg.muted">
                                        Enter the encryption password to decrypt all files in this library.
                                    </Text>
                                    <Field.Root>
                                        <Field.Label color="fg">Password</Field.Label>
                                        <Input
                                            type="password"
                                            placeholder="Enter original encryption password"
                                            value={decryptPassword}
                                            onChange={(e) => { setDecryptPassword(e.target.value); setDecryptError("") }}
                                            bg="bg"
                                            border="1px solid"
                                            borderColor={decryptError ? "red.400" : "border"}
                                            autoFocus
                                        />
                                        {decryptError && (
                                            <Field.ErrorText>{decryptError}</Field.ErrorText>
                                        )}
                                    </Field.Root>
                                </VStack>
                            </Dialog.Body>
                            <Dialog.Footer>
                                <Button variant="outline" onClick={() => setShowDecryptDialog(false)}>
                                    Cancel
                                </Button>
                                <Button
                                    colorPalette="red"
                                    loading={decrypting}
                                    disabled={!decryptPassword.trim()}
                                    onClick={() => doDecrypt(decryptPassword)}
                                >
                                    Decrypt
                                </Button>
                            </Dialog.Footer>
                        </Dialog.Content>
                    </Dialog.Positioner>
                </Portal>
            </Dialog.Root>

            {/* Encrypt password dialog */}
            <Dialog.Root open={showEncryptDialog} modal={true} onOpenChange={(e: { open: boolean }) => { setShowEncryptDialog(e.open); if (!e.open) { setEncryptPassword(""); setEncryptConfirm(""); setEncryptError("") } }}>
                <Portal>
                    <Dialog.Backdrop />
                    <Dialog.Positioner>
                        <Dialog.Content>
                            <Dialog.Header>
                                <Dialog.Title>Encrypt Library</Dialog.Title>
                            </Dialog.Header>
                            <Dialog.Body>
                                <VStack gap="4">
                                    <Text fontSize="sm" color="fg.muted">
                                        Set a password to encrypt all files in this library.
                                    </Text>
                                    <Field.Root>
                                        <Field.Label color="fg">Password</Field.Label>
                                        <Input
                                            type="password"
                                            placeholder="Enter password"
                                            value={encryptPassword}
                                            onChange={(e) => { setEncryptPassword(e.target.value); setEncryptError("") }}
                                            bg="bg"
                                            border="1px solid"
                                            borderColor="border"
                                            autoFocus
                                        />
                                    </Field.Root>
                                    <Field.Root>
                                        <Field.Label color="fg">Confirm Password</Field.Label>
                                        <Input
                                            type="password"
                                            placeholder="Confirm password"
                                            value={encryptConfirm}
                                            onChange={(e) => { setEncryptConfirm(e.target.value); setEncryptError("") }}
                                            bg="bg"
                                            border="1px solid"
                                            borderColor={encryptConfirm && encryptPassword !== encryptConfirm ? "red.400" : "border"}
                                        />
                                        {encryptConfirm && encryptPassword !== encryptConfirm && (
                                            <Field.ErrorText>Passwords do not match</Field.ErrorText>
                                        )}
                                    </Field.Root>
                                    {encryptError && (
                                        <Text color="red.400" fontSize="sm">{encryptError}</Text>
                                    )}
                                </VStack>
                            </Dialog.Body>
                            <Dialog.Footer>
                                <Button variant="outline" onClick={() => { setShowEncryptDialog(false); setEncryptPassword(""); setEncryptConfirm(""); setEncryptError("") }}>
                                    Cancel
                                </Button>
                                <Button
                                    colorPalette="red"
                                    loading={encrypting}
                                    disabled={!encryptPassword || encryptPassword !== encryptConfirm}
                                    onClick={handleEncrypt}
                                >
                                    Encrypt
                                </Button>
                            </Dialog.Footer>
                        </Dialog.Content>
                    </Dialog.Positioner>
                </Portal>
            </Dialog.Root>
        </Box>
    )
}

/** Sidebar panel with a left-edge drag handle for resizing. */
function SidebarPanel({ assetId, onClose, toaster, onTagClick, selectedTags, onRefreshRequested }: {
    assetId: string
    onClose: () => void
    toaster: CustomToaster
    onTagClick?: (value: string) => void
    selectedTags?: string[]
    onRefreshRequested?: (assetId?: string, reason?: 'deleted' | 'moved') => void
}) {
    const panelRef = useRef<HTMLDivElement>(null)
    const dragging = useRef(false)

    useEffect(() => {
        const panel = panelRef.current
        if (!panel) return

        const onMouseDown = (e: MouseEvent) => {
            // Use clientX vs panel's bounding rect, not offsetX (which is relative to the target element).
            const panelRect = panel.getBoundingClientRect()
            if (e.clientX - panelRect.left > 6) return
            dragging.current = true
            document.body.style.cursor = "ew-resize"
            document.body.style.userSelect = "none"
        }

        const onMouseMove = (e: MouseEvent) => {
            if (!dragging.current) return
            const rect = panel.parentElement!.getBoundingClientRect()
            const newWidth = rect.right - e.clientX
            const clamped = Math.min(600, Math.max(280, newWidth))
            panel.style.width = clamped + "px"
        }

        const onMouseUp = () => {
            if (!dragging.current) return
            dragging.current = false
            document.body.style.cursor = ""
            document.body.style.userSelect = ""
        }

        panel.addEventListener("mousedown", onMouseDown)
        window.addEventListener("mousemove", onMouseMove)
        window.addEventListener("mouseup", onMouseUp)

        return () => {
            panel.removeEventListener("mousedown", onMouseDown)
            window.removeEventListener("mousemove", onMouseMove)
            window.removeEventListener("mouseup", onMouseUp)
        }
    }, [])

    return (
        <Box
            ref={panelRef}
            display={{ base: "none", md: "flex" }}
            flexDirection="column"
            width="380px"
            minWidth="280px"
            maxWidth="600px"
            borderLeft="1px solid"
            borderColor="border"
            css={{
                position: "relative",
                "&::before": {
                    content: '""',
                    position: "absolute",
                    left: 0,
                    top: 0,
                    bottom: 0,
                    width: "6px",
                    cursor: "ew-resize",
                    zIndex: 1,
                },
            }}
        >
            <IconButton
                variant="ghost"
                size="sm"
                onClick={onClose}
                aria-label="Close sidebar"
                position="absolute"
                top="1"
                left="1"
                zIndex={2}
                bg="bg/80"
                border="1px solid"
                borderColor="border"
                css={{ backdropFilter: "blur(4px)" }}
                _hover={{ bg: "bg" }}
            >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M18 6L6 18M6 6l12 12" />
                </svg>
            </IconButton>

            <Box flex="1" overflow="auto" px="3" pt="14" pb="4">
                <Sidebar assetId={assetId} onClose={onClose} toaster={toaster} onTagClick={onTagClick} selectedTags={selectedTags} onRefreshRequested={onRefreshRequested} />
            </Box>
        </Box>
    )
}
