import { useEffect, useState, useCallback, useRef } from "react"
import { useParams, useNavigate, useLocation } from "react-router-dom"
import {
    Box,
    Button,
    Center,
    IconButton,
    Spinner,
    Drawer,
    Portal,
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

export function LibraryPage() {
    const { libraryId, "*": splat } = useParams()
    const navigate = useNavigate()
    const location = useLocation()
    const toaster = useCustomToaster()

    // Derive folder and search from URL
    const folderFromUrl = splat || ""
    const searchFromUrl = new URLSearchParams(location.search).get("s") || ""

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

    const [libraryName, setLibraryName] = useState("")
    const [libraryFullId, setLibraryFullId] = useState("")
    const [libraryPath, setLibraryPath] = useState("")

    const initialSyncDone = useRef(false)

    // Load library by ID on mount with retry
    useEffect(() => {
        if (!libraryId) return

        let cancelled = false
        const maxRetries = 2

        const loadWithRetry = async () => {
            for (let attempt = 0; attempt <= maxRetries; attempt++) {
                if (cancelled) return
                try {
                    if (attempt === 0) {
                        setLibraryLoading(true)
                        setLibraryError(false)
                    }
                    const info = await api.loadLibrary(libraryId)
                    if (cancelled) return
                    setLibraryName(info.name)
                    setLibraryFullId(info.id)
                    setLibraryPath(info.path)
                    setLibraryLoading(false)
                    return
                } catch {
                    if (cancelled) return
                    if (attempt < maxRetries) {
                        // Wait before retrying
                        await new Promise(r => setTimeout(r, 300 * (attempt + 1)))
                    } else {
                        setLibraryError(true)
                        setLibraryLoading(false)
                    }
                }
            }
        }

        loadWithRetry()
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

            loadAssets(1, searchFromUrl, false, folderFromUrl || undefined)
                .then(() => {
                    // Check for tag conflicts after initial load
                    api.getTagConflicts().then((conflicts) => {
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
    const updateUrl = useCallback((folder: string, query: string) => {
        const base = `/${libraryId}${folder ? `/${folder}` : ""}`
        const search = query ? `?s=${encodeURIComponent(query)}` : ""
        navigate(`${base}${search}`, { replace: true })
    }, [libraryId, navigate])

    const loadAssets = useCallback(async (pageNum: number, query: string, append: boolean, folder?: string, subfolders?: boolean) => {
        setLoading(true)
        try {
            let result: Awaited<ReturnType<typeof api.getAssets>>
            if (query) {
                result = await api.searchAssets(query, pageNum, PAGE_SIZE, folder || undefined)
            } else {
                result = await api.getAssets(pageNum, PAGE_SIZE, folder || undefined, subfolders)
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
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

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
            loadAssets(1, query, false, currentFolder || undefined)
        }
    }, [currentFolder, libraryLoading, loadAssets, updateUrl])

    const handleTagsChange = useCallback((tags: string[]) => {
        setSelectedTags(tags)
        const tagQuery = tags.length > 0 ? "tags:" + tags.join("+") : ""
        setSearchQuery(tagQuery)
        setPage(1)
        updateUrl(currentFolder, tagQuery)
        if (!libraryLoading) {
            loadAssets(1, tagQuery, false, currentFolder || undefined)
        }
    }, [currentFolder, libraryLoading, loadAssets, updateUrl])

    const handleLoadMore = useCallback(() => {
        if (loading) return
        const nextPage = page + 1
        setPage(nextPage)
        loadAssets(nextPage, searchQuery, true, currentFolder || undefined)
    }, [loading, page, searchQuery, loadAssets, currentFolder])

    const handleAssetMoved = useCallback(() => {
        setPage(1)
        setAssets([])
        loadAssets(1, searchQuery, false, currentFolder || undefined, currentFolder === "" ? undefined : false)
    }, [loadAssets, searchQuery, currentFolder])

    const handleCategorizeSave = useCallback(() => {
        setPage(1)
        setAssets([])
        loadAssets(1, searchQuery, false, currentFolder || undefined)
    }, [loadAssets, searchQuery, currentFolder])

    const handleRescan = useCallback(async () => {
        setScanning(true)
        try {
            const result = await api.scanAssets()
            setPage(1)
            setAssets([])
            loadAssets(1, searchQuery, false, currentFolder || undefined, currentFolder === "" ? undefined : false)

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
    }, [loadAssets, searchQuery, currentFolder, toaster])

    const handleResolveConflicts = useCallback(async (resolutions: { tagValue: string; chosenType: string }[]) => {
        setResolvingConflicts(true)
        try {
            await api.resolveTagConflicts(resolutions)
            setConflictDialogOpen(false)
            setTagConflicts([])
            // Reload assets to reflect changes
            setPage(1)
            setAssets([])
            loadAssets(1, searchQuery, false, currentFolder || undefined, currentFolder === "" ? undefined : false)
            toaster.create({ title: "Conflicts resolved", type: "success" })
        } catch {
            toaster.create({ title: "Failed to resolve conflicts", type: "error" })
        } finally {
            setResolvingConflicts(false)
        }
    }, [loadAssets, searchQuery, currentFolder, toaster])

    const handleFolderChange = useCallback((folder: string) => {
        setCurrentFolder(folder)
        setPage(1)
        setAssets([])
        updateUrl(folder, searchQuery)
        const subfolders = folder === "" ? undefined : false
        loadAssets(1, searchQuery, false, folder || undefined, subfolders)
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
        <Box minH="100vh" bg="bg">
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
            />

            <Box
                display="flex"
                height="calc(100vh - 57px)"
                overflow="hidden"
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
                    <DirectoryTree currentFolder={currentFolder} onFolderChange={handleFolderChange} />
                </Box>

                {/* Center: Masonry */}
                <Box flex="1" overflow="hidden auto" p={{ base: "2", md: "4" }}>
                    <MasonryGrid
                        assets={assets}
                        loading={loading}
                        hasMore={hasMore}
                        onLoadMore={handleLoadMore}
                        onSelectAsset={handleSelectAsset}
                        currentFolder={currentFolder}
                        searchQuery={searchQuery}
                    />
                </Box>

                {/* Right: Docked Sidebar (desktop only) */}
                {selectedAssetId && <SidebarPanel assetId={selectedAssetId} onClose={() => setSelectedAssetId(null)} toaster={toaster as CustomToaster} selectedTags={selectedTags} onTagClick={(value) => handleTagsChange([...selectedTags, value])} onRefreshRequested={handleAssetMoved} />}
            </Box>

            <AddAssetDialog
                open={addDialogOpen}
                onOpenChange={setAddDialogOpen}
                toaster={toaster as CustomToaster}
                onAssetsAdded={() => { setPage(1); setAssets([]); loadAssets(1, searchQuery, false, currentFolder || undefined) }}
            />

            {/* Mobile directory drawer */}
            <Drawer.Root open={mobileTreeOpen} onOpenChange={(e: { open: boolean }) => setMobileTreeOpen(e.open)}>
                <Portal>
                    <Drawer.Backdrop />
                    <Drawer.Positioner>
                        <Drawer.Content>
                            <Drawer.Header>
                                <Drawer.Title>Folders</Drawer.Title>
                                <Drawer.CloseTrigger />
                            </Drawer.Header>
                            <Drawer.Body>
                                <DirectoryTree
                                    currentFolder={currentFolder}
                                    onFolderChange={(folder) => {
                                        handleFolderChange(folder)
                                        setMobileTreeOpen(false)
                                    }}
                                />
                            </Drawer.Body>
                        </Drawer.Content>
                    </Drawer.Positioner>
                </Portal>
            </Drawer.Root>

            {/* Mobile bottom sheet for sidebar */}
            <Drawer.Root open={!!selectedAssetId && isMobile} onOpenChange={(e: { open: boolean }) => { if (!e.open) setSelectedAssetId(null) }}>
                <Portal>
                    <Drawer.Backdrop />
                    <Drawer.Positioner>
                        <Drawer.Content maxH="80vh" borderTopRadius="lg">
                            <Drawer.Body p="4">
                                <Sidebar assetId={selectedAssetId} onClose={() => setSelectedAssetId(null)} toaster={toaster as CustomToaster} selectedTags={selectedTags} onTagClick={(value) => handleTagsChange([...selectedTags, value])} onRefreshRequested={handleAssetMoved} />
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
    onRefreshRequested?: () => void
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
