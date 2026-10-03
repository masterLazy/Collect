import { useEffect, useState, useCallback, useRef } from "react"
import { useParams, useNavigate, useLocation } from "react-router-dom"
import { useDocumentTitle } from "../hooks/useDocumentTitle"
import {
    Box,
    Button,
    Center,
    Checkbox,
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
import { TagExplore } from "./TagExplore"
import { BatchActionBar } from "./BatchActionBar"
import { BatchMoveDialog } from "./BatchMoveDialog"
import { BatchDeleteDialog } from "./BatchDeleteDialog"
import { BatchTagDialog } from "./BatchTagDialog"
import { TagConflictDialog } from "./TagConflictDialog"
import { useCustomToaster, ToastContainer, CustomToaster } from "./CustomToast"
import { api, ApiError } from "../services/api"
import { imageFilesFromDataTransfer } from "../lib/clipboardFiles"
import type { AssetDto, TagConflict } from "../types"

const PAGE_SIZE = 30

// While the Explore page is showing, no tree row matches this sentinel, so only
// the Explore entry itself renders as selected.
const EXPLORE_SELECTION_SENTINEL = "__explore__"

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

export type SortMode = "newest" | "name" | "random" | "boosts"

export type ViewMode = "masonry" | "grid"

// Gallery layout and sort order are per-library preferences: they are persisted in
// the library's .collect/library.json so every client opening the library sees the
// same choice. Sort additionally rides in the URL (?sort=) so a shared link keeps
// its ordering — the URL wins when both are present.
const isViewMode = (value: unknown): value is ViewMode => value === "masonry" || value === "grid"

const isSortMode = (value: unknown): value is SortMode =>
    value === "newest" || value === "name" || value === "random" || value === "boosts"

// True when the API call failed with HTTP 403. In strict mode a *locked*
// name-encrypted library (encryptFileNames) returns 403 for list/search/
// detail/tag endpoints, so we should surface the unlock dialog instead of a
// generic error toast and drop any stale plaintext data.
const isForbiddenError = (err: unknown): boolean =>
    err instanceof ApiError
        ? err.status === 403
        : (err as { status?: number } | null)?.status === 403

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
    const [scrollTargetId, setScrollTargetId] = useState<string | null>(null)
    const [currentFolder, setCurrentFolder] = useState(folderFromUrl)
    const [addDialogOpen, setAddDialogOpen] = useState(false)
    const [pendingFiles, setPendingFiles] = useState<File[]>([])
    const [mobileTreeOpen, setMobileTreeOpen] = useState(false)
    const [scanning, setScanning] = useState(false)
    const [tagConflicts, setTagConflicts] = useState<TagConflict[]>([])
    const [conflictDialogOpen, setConflictDialogOpen] = useState(false)
    const [resolvingConflicts, setResolvingConflicts] = useState(false)
    const [isMobile, setIsMobile] = useState(false)
    const sortParamFromUrl = new URLSearchParams(location.search).get("sort")
    const sortFromUrl = isSortMode(sortParamFromUrl) ? sortParamFromUrl : "newest"
    const [alwaysShowSearch, setAlwaysShowSearch] = useState(alwaysShowSearchFromUrl)
    const [sortMode, setSortMode] = useState<SortMode>(sortFromUrl)
    const [viewMode, setViewMode] = useState<ViewMode>("masonry")
    // Seed for the "random" sort. Fixed for as long as the view stays on random, so
    // every page request walks the same shuffled sequence; picking Random again in
    // the sort menu rolls a new seed, which reshuffles the whole list.
    const randomSeedRef = useRef<number>(Math.floor(Math.random() * 1_000_000_000))

    const [libraryName, setLibraryName] = useState("")
    const [libraryFullId, setLibraryFullId] = useState("")
    const [libraryPath, setLibraryPath] = useState("")

    // Explore mode: same shell (top bar, folder tree), but the content area shows
    // the tag browser instead of the asset grid. Driven by the route.
    const exploreMode = location.pathname.replace(/\/+$/, "").endsWith("/explore")

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

    // ── Batch selection ──
    // Selection mode turns the gallery into a checkbox surface and shows the
    // ActionBar with the batch operations.
    const [selectionMode, setSelectionMode] = useState(false)
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
    const [batchMoveOpen, setBatchMoveOpen] = useState(false)
    const [batchDeleteOpen, setBatchDeleteOpen] = useState(false)
    const [batchTagOpen, setBatchTagOpen] = useState(false)
    const [batchBusy, setBatchBusy] = useState(false)

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
                // Restore the library's persisted view preferences. An explicit
                // ?sort= in the URL wins so shared links keep their ordering.
                if (!sortParamFromUrl && isSortMode(info.sortMode)) setSortMode(info.sortMode)
                if (isViewMode(info.viewMode)) setViewMode(info.viewMode)
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

            // Deep-link: a #<asset_id> hash opens the sidebar and scrolls the grid to it
            const hashId = location.hash.replace(/^#/, "")
            if (hashId) {
                setSelectedAssetId(hashId)
                setScrollTargetId(hashId)
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

    // Sync the URL hash to the selected asset — handles browser back/forward
    // and manual URL edits (hash removal closes the sidebar, and vice versa).
    useEffect(() => {
        const hashId = location.hash.replace(/^#/, "")
        setSelectedAssetId(hashId || null)
    }, [location.hash])

    // A different slice of the library (folder, filter, sort, library, Explore)
    // means different assets on screen, so the previous batch selection is dropped.
    useEffect(() => {
        setSelectedIds(new Set())
        if (exploreMode) setSelectionMode(false)
    }, [currentFolder, searchQuery, sortMode, libraryId, exploreMode])

    // Mobile detection
    useEffect(() => {
        const mq = window.matchMedia("(max-width: 767px)")
        setIsMobile(mq.matches)
        const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches)
        mq.addEventListener("change", handler)
        return () => mq.removeEventListener("change", handler)
    }, [])

    // Paste-to-add: an image pasted anywhere on the gallery is handed to the Add
    // Assets dialog (target folder = the folder being browsed). Text pastes are
    // left untouched, and other open overlays keep ownership of the clipboard.
    useEffect(() => {
        const handlePaste = (event: ClipboardEvent) => {
            const pasted = imageFilesFromDataTransfer(event.clipboardData)
            if (pasted.length === 0) return

            // The Add Assets dialog is a portal as well, so only gate on *other*
            // overlays (tag browser, unlock prompts, ...).
            const otherOverlayOpen = !!document.querySelector(
                "[data-scope='dialog'][data-part='content'], [data-scope='drawer'][data-part='content']"
            )
            if (!addDialogOpen && otherOverlayOpen) return

            event.preventDefault()
            setPendingFiles(pasted)
            setAddDialogOpen(true)
            toaster.create({
                title: pasted.length === 1 ? "Image pasted" : pasted.length + " images pasted",
                description: "Review and upload from the Add Assets dialog.",
                type: "info",
            })
        }

        document.addEventListener("paste", handlePaste)
        return () => document.removeEventListener("paste", handlePaste)
    }, [addDialogOpen, toaster])

    // Build the library URL for folder/search/sort, optionally appending an asset
    // hash. Folder/search/sort changes intentionally drop any hash.
    const buildUrl = useCallback((folder: string, query: string, sort?: string, hash?: string, leaveExplore = false) => {
        let base: string
        if (exploreMode && !leaveExplore) {
            base = `/${libraryId}/explore` // Explore keeps its route while searching
        } else if (folder === "") {
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
        return `${base}${searchStr ? `?${searchStr}` : ""}${hash ? `#${hash}` : ""}`
    }, [libraryId, alwaysShowSearch, sortMode, exploreMode])

    // Update URL when folder or search changes (skip the initial sync)
    const updateUrl = useCallback((folder: string, query: string, sort?: string) => {
        navigate(buildUrl(folder, query, sort), { replace: true })
    }, [navigate, buildUrl])

    const loadAssets = useCallback(async (pageNum: number, query: string, append: boolean, folder?: string, subfolders?: boolean, sort?: string) => {
        setLoading(true)
        try {
            const resolvedSort = sort ?? sortMode
            let result: Awaited<ReturnType<typeof api.getAssets>>
            if (query) {
                result = await api.searchAssets(libraryId!, query, pageNum, PAGE_SIZE, folder || undefined)
            } else {
                // Random order is driven by a seed kept for this view: every page
                // request reuses it, so scrolling never shows the same asset twice.
                const seed = resolvedSort === "random" ? randomSeedRef.current : undefined
                result = await api.getAssets(libraryId!, pageNum, PAGE_SIZE, folder || undefined, subfolders, resolvedSort === "newest" ? undefined : resolvedSort, seed)
            }
            setAssets((prev) => (append ? [...prev, ...result.items] : result.items))
            setTotal(result.total)
        } catch (err) {
            // Strict mode: a locked name-encrypted library returns 403 for
            // asset list/search. Surface the unlock dialog instead of the
            // generic toast, and drop any stale plaintext names/tags.
            if (isForbiddenError(err)) {
                setAssets([])
                setSelectedAssetId(null)
                setSelectedTags([])
                setShowUnlockDialog(true)
                toaster.create({
                    title: "Library locked",
                    description: "This library is locked. Please unlock to view its assets and tags.",
                    type: "warning",
                })
            } else {
                toaster.create({
                    title: "Load failed",
                    description: "Cannot fetch assets. Check backend server.",
                    type: "error",
                })
            }
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

        if (!libraryLoading && !exploreMode) {
            loadAssets(1, query, false, toApiFolder(currentFolder), getSubfolders(currentFolder))
        }
    }, [currentFolder, libraryLoading, loadAssets, updateUrl, sortMode, exploreMode])

    // ── Library view preferences (persisted in library.json) ──
    // Rapid toggling would otherwise write the file once per click, so pending
    // changes are coalesced and flushed on a short timer (and on unmount).
    const prefsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const pendingPrefsRef = useRef<{ viewMode?: ViewMode; sortMode?: SortMode }>({})

    const flushPreferences = useCallback(() => {
        if (prefsTimerRef.current) {
            clearTimeout(prefsTimerRef.current)
            prefsTimerRef.current = null
        }
        const pending = pendingPrefsRef.current
        pendingPrefsRef.current = {}
        if (!libraryId || Object.keys(pending).length === 0) return
        api.setLibraryPreferences(libraryId, pending).catch(() => {
            toaster.create({
                title: "Could not save view preferences",
                description: "The layout will not be remembered for this library.",
                type: "warning",
            })
        })
    }, [libraryId, toaster])

    const savePreferences = useCallback((prefs: { viewMode?: ViewMode; sortMode?: SortMode }) => {
        pendingPrefsRef.current = { ...pendingPrefsRef.current, ...prefs }
        if (prefsTimerRef.current) clearTimeout(prefsTimerRef.current)
        prefsTimerRef.current = setTimeout(() => {
            prefsTimerRef.current = null
            flushPreferences()
        }, 500)
    }, [flushPreferences])

    // Flush a pending write when the page unmounts (e.g. switching libraries).
    useEffect(() => () => flushPreferences(), [flushPreferences])

    const handleViewModeChange = useCallback((mode: ViewMode) => {
        setViewMode(mode)
        savePreferences({ viewMode: mode })
    }, [savePreferences])

    const handleSortChange = useCallback((mode: SortMode) => {
        if (mode === "random") randomSeedRef.current = Math.floor(Math.random() * 1_000_000_000)
        setSortMode(mode)
        setPage(1)
        setAssets([])
        updateUrl(currentFolder, searchQuery, mode)
        savePreferences({ sortMode: mode })
        if (!libraryLoading) {
            loadAssets(1, searchQuery, false, toApiFolder(currentFolder), getSubfolders(currentFolder), mode)
        }
    }, [currentFolder, libraryLoading, loadAssets, updateUrl, searchQuery, savePreferences])

    // Boost (up-vote) an asset. The backend allows one boost per asset per day,
    // so the count is updated optimistically and reverted if the call fails.
    const boostInFlightRef = useRef<Set<string>>(new Set())

    const applyBoostState = useCallback((id: string, boostCount: number, boostedToday: boolean) => {
        setAssets((prev) => prev.map((a) => (a.id === id ? { ...a, boostCount, boostedToday } : a)))
    }, [])

    // Latest authoritative boost state, so an open sidebar showing the same asset
    // reflects a boost made from the grid (and vice versa).
    const [boostPatch, setBoostPatch] = useState<{ id: string; count: number; boostedToday: boolean } | null>(null)

    const handleBoost = useCallback(async (id: string) => {
        if (boostInFlightRef.current.has(id)) return
        const current = assets.find((a) => a.id === id)
        if (!current || !libraryId) return
        if (current.boostedToday) {
            toaster.create({
                title: "Already boosted today",
                description: "Each asset can be boosted once per day.",
                type: "info",
            })
            return
        }

        boostInFlightRef.current.add(id)
        const previousCount = current.boostCount
        applyBoostState(id, previousCount + 1, true)
        try {
            const result = await api.boostAsset(id, libraryId)
            applyBoostState(id, result.count, result.boostedToday)
            setBoostPatch({ id, count: result.count, boostedToday: result.boostedToday })
            if (result.alreadyBoosted) {
                toaster.create({
                    title: "Already boosted today",
                    description: "Each asset can be boosted once per day.",
                    type: "info",
                })
            }
        } catch {
            applyBoostState(id, previousCount, false)
            toaster.create({
                title: "Boost failed",
                description: "Could not record the boost. Check the backend server.",
                type: "error",
            })
        } finally {
            boostInFlightRef.current.delete(id)
        }
    }, [assets, libraryId, toaster, applyBoostState])

    // Take back today's boost: count drops by one and the asset can be boosted
    // again today. Only today's boost is undone — use the sidebar to clear all.
    const handleUndoBoost = useCallback(async (id: string) => {
        if (boostInFlightRef.current.has(id)) return
        const current = assets.find((a) => a.id === id)
        if (!current || !libraryId) return

        boostInFlightRef.current.add(id)
        const previous = { count: current.boostCount, boostedToday: current.boostedToday }
        applyBoostState(id, Math.max(0, previous.count - 1), false)
        try {
            const result = await api.undoBoost(id, libraryId)
            applyBoostState(id, result.count, result.boostedToday)
            setBoostPatch({ id, count: result.count, boostedToday: result.boostedToday })
            toaster.create({
                title: result.changed ? "Boost removed" : "Nothing to undo",
                description: result.changed
                    ? "Today's boost was taken back — you can boost this asset again today."
                    : "This asset was not boosted today.",
                type: "info",
            })
        } catch {
            applyBoostState(id, previous.count, previous.boostedToday)
            toaster.create({
                title: "Could not remove boost",
                description: "Check the backend server.",
                type: "error",
            })
        } finally {
            boostInFlightRef.current.delete(id)
        }
    }, [assets, libraryId, toaster, applyBoostState])

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
        if (reason === 'deleted' || (reason === 'moved' && currentFolder !== "")) {
            // Keep the card in grid with permanent blur overlay. A move under
            // "All" does not remove the asset from this view (it only changed
            // folder), so no placeholder is shown there.
            setRemovedAssetMap((prev) => new Map(prev).set(assetId, reason!))
        }
        // Always refresh directory tree counts after any change
        setTreeRefreshKey((k) => k + 1)
    }, [loadAssets, searchQuery, currentFolder])

    const handleMoveAsset = useCallback(async (assetId: string, targetFolder: string) => {
        // Under "All" the asset stays visible after a move, so the "Moved"
        // placeholder is only used when the current folder really loses it.
        const markRemoved = currentFolder !== ""
        // Show blur overlay immediately
        if (markRemoved) setRemovedAssetMap((prev) => new Map(prev).set(assetId, 'moved'))
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
            if (markRemoved) setRemovedAssetMap((prev) => {
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
    }, [toaster, currentFolder, libraryId])

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
        if (exploreMode) {
            // Picking a folder leaves the Explore view. buildUrl is Explore-aware
            // (to keep the route while searching), so opt out explicitly here.
            navigate(buildUrl(folder, searchQuery, undefined, undefined, true))
        } else {
            updateUrl(folder, searchQuery)
        }
        loadAssets(1, searchQuery, false, toApiFolder(folder), getSubfolders(folder))
    }, [loadAssets, updateUrl, searchQuery, exploreMode, buildUrl, navigate])

    const handleSelectAsset = useCallback((id: string) => {
        setSelectedAssetId(id)
        // A manual selection must never trigger an unrelated deep-link scroll
        setScrollTargetId(null)
        navigate(buildUrl(currentFolder, searchQuery, sortMode, id), { replace: true })
    }, [currentFolder, searchQuery, sortMode, buildUrl, navigate])

    const handleCloseSidebar = useCallback(() => {
        setSelectedAssetId(null)
        navigate(buildUrl(currentFolder, searchQuery, sortMode), { replace: true })
    }, [currentFolder, searchQuery, sortMode, buildUrl, navigate])

    // ── Batch selection ──────────────────────────────

    const exitSelectionMode = useCallback(() => {
        setSelectionMode(false)
        setSelectedIds(new Set())
    }, [])

    const handleToggleSelectionMode = useCallback(() => {
        if (selectionMode) {
            exitSelectionMode()
            return
        }
        // The sidebar and a selection click would compete for the same gesture.
        handleCloseSidebar()
        setSelectedIds(new Set())
        setSelectionMode(true)
    }, [selectionMode, exitSelectionMode, handleCloseSidebar])

    const handleToggleSelect = useCallback((id: string) => {
        setSelectedIds((prev) => {
            const next = new Set(prev)
            if (next.has(id)) next.delete(id)
            else next.add(id)
            return next
        })
    }, [])

    // "Select all" covers the assets currently loaded in the gallery — the grid
    // only ever acts on those.
    const handleSelectAllLoaded = useCallback(() => {
        setSelectedIds(new Set(assets.map((a) => a.id)))
    }, [assets])

    const handleClearSelection = useCallback(() => setSelectedIds(new Set()), [])

    const handleBatchMove = useCallback(async (targetFolder: string) => {
        if (!libraryId) return
        const ids = Array.from(selectedIds)
        setBatchBusy(true)
        const failed = new Set<string>()
        let moved = 0
        for (const id of ids) {
            try {
                await api.moveAsset(id, targetFolder, libraryId)
                moved++
            } catch {
                failed.add(id)
            }
        }
        setBatchBusy(false)
        setBatchMoveOpen(false)

        // Outside "All" the current folder loses the assets, so they stay in the
        // grid as "Moved" placeholders. Under "All" they remain part of the view.
        if (currentFolder !== "") {
            setRemovedAssetMap((prev) => {
                const next = new Map(prev)
                ids.forEach((id) => { if (!failed.has(id)) next.set(id, 'moved') })
                return next
            })
        }
        setTreeRefreshKey((k) => k + 1)
        setSelectedIds(new Set())
        toaster.create({
            title: failed.size === 0
                ? `${moved} asset${moved === 1 ? "" : "s"} moved`
                : "Move finished with errors",
            description: failed.size === 0
                ? `Moved to ${targetFolder || "root"}.`
                : `${moved} of ${ids.length} moved to ${targetFolder || "root"}.`,
            type: failed.size === 0 ? "success" : "error",
        })
    }, [selectedIds, libraryId, currentFolder, toaster])

    const handleBatchDelete = useCallback(async () => {
        if (!libraryId) return
        const ids = Array.from(selectedIds)
        setBatchBusy(true)
        const failed = new Set<string>()
        let deleted = 0
        for (const id of ids) {
            try {
                await api.deleteAsset(id, libraryId)
                deleted++
            } catch {
                failed.add(id)
            }
        }
        setBatchBusy(false)
        setBatchDeleteOpen(false)

        // Same treatment as the single-asset delete: the card stays in place,
        // blurred, until the library is rescanned.
        setRemovedAssetMap((prev) => {
            const next = new Map(prev)
            ids.forEach((id) => { if (!failed.has(id)) next.set(id, 'deleted') })
            return next
        })
        setTreeRefreshKey((k) => k + 1)
        setSelectedIds(new Set())
        toaster.create({
            title: failed.size === 0
                ? `${deleted} asset${deleted === 1 ? "" : "s"} deleted`
                : "Delete finished with errors",
            description: failed.size === 0
                ? "The files were removed from disk."
                : `${deleted} of ${ids.length} deleted.`,
            type: failed.size === 0 ? "success" : "error",
        })
    }, [selectedIds, libraryId, toaster])

    // Tag edits rename files on disk, so the visible page is refetched. The
    // selection is kept so the same batch can be edited again.
    const handleBatchTagsApplied = useCallback(() => {
        setPage(1)
        setAssets([])
        setTreeRefreshKey((k) => k + 1)
        loadAssets(1, searchQuery, false, toApiFolder(currentFolder), getSubfolders(currentFolder))
    }, [loadAssets, searchQuery, currentFolder])

    // Explore is a separate route but the same component instance, so nothing
    // reloads the grid when the route changes. Picking a tag there must navigate
    // to the plain library URL *and* run the query immediately — otherwise the
    // filter only shows up after a manual refresh.
    const handleExploreTagSelect = useCallback((value: string) => {
        const query = "tags:" + value
        setSearchQuery(query)
        setSelectedTags([value])
        setCurrentFolder("")
        setPage(1)
        setAssets([])
        navigate(buildUrl("", query, undefined, undefined, true))
        loadAssets(1, query, false, undefined, undefined)
    }, [navigate, buildUrl, loadAssets])

    const handleSwitchLibrary = useCallback(() => {
        navigate("/", { state: { forceHome: true } })
    }, [navigate])

    const hasMore = assets.length < total

    // Page toward a deep-link scroll target until it appears in the grid.
    // While loading we cannot conclude anything (total is not final); once
    // loaded, either keep paging (hasMore) or give up (asset not in directory).
    useEffect(() => {
        if (!scrollTargetId) return
        if (assets.some((a) => a.id === scrollTargetId)) return // MasonryGrid will scroll
        if (loading) return
        if (hasMore) {
            handleLoadMore()
        } else {
            setScrollTargetId(null)
        }
    }, [scrollTargetId, assets, hasMore, loading, handleLoadMore])

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
                viewMode={viewMode}
                onViewModeChange={handleViewModeChange}
                selectionMode={selectionMode}
                onToggleSelectionMode={handleToggleSelectionMode}
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
                    borderRight="1px solid"
                    borderColor="border"
                    display={{ base: "none", md: "flex" }}
                    flexDirection="column"
                    minH="0"
                    py="2"
                >
                    <DirectoryTree currentFolder={exploreMode ? EXPLORE_SELECTION_SENTINEL : currentFolder} onFolderChange={handleFolderChange} onMoveAsset={handleMoveAsset} refreshKey={treeRefreshKey} libraryId={libraryId!} exploreActive={exploreMode} onOpenExplore={() => navigate(`/${libraryId}/explore`)} />
                </Box>

                {/* Center: Explore tag browser or the asset grid */}
                <Box flex="1" overflow="hidden auto" p={{ base: "2", md: "4" }} position="relative" className="masonry-scroll-container">
                    {exploreMode ? (
                        <TagExplore
                            libraryId={libraryId!}
                            searchQuery={searchQuery}
                            onSelectTag={handleExploreTagSelect}
                        />
                    ) : (
                        <MasonryGrid
                            assets={assets}
                            loading={loading}
                            hasMore={hasMore}
                            onLoadMore={handleLoadMore}
                            onSelectAsset={handleSelectAsset}
                            currentFolder={currentFolder}
                            searchQuery={searchQuery}
                            removedAssetIds={removedAssetMap}
                            scrollToAssetId={scrollTargetId}
                            onScrollTargetHandled={() => setScrollTargetId(null)}
                            viewMode={viewMode}
                            selectedAssetId={selectedAssetId}
                            onBoost={handleBoost}
                            onUndoBoost={handleUndoBoost}
                            selectionMode={selectionMode}
                            selectedIds={selectedIds}
                            onToggleSelect={handleToggleSelect}
                        />
                    )}
                </Box>

                {/* Right: Docked Sidebar (desktop only) */}
                {selectedAssetId && !exploreMode && <SidebarPanel assetId={selectedAssetId} onClose={handleCloseSidebar} toaster={toaster as CustomToaster} selectedTags={selectedTags} onTagClick={(value) => handleTagsChange(selectedTags.includes(value) ? selectedTags.filter((t) => t !== value) : [...selectedTags, value])} onRefreshRequested={(id, reason) => handleAssetMoved(id, reason)} boostPatch={boostPatch} onBoostChanged={applyBoostState} />}
            </Box>

            {/* Batch mode: floating action bar plus its confirmations. The bar is
                hidden while a dialog is open — a modal overlay must not have an
                interactive bar floating above it. */}
            <BatchActionBar
                open={selectionMode && !batchMoveOpen && !batchDeleteOpen && !batchTagOpen}
                count={selectedIds.size}
                total={assets.length}
                busy={batchBusy}
                onExit={exitSelectionMode}
                onSelectAll={handleSelectAllLoaded}
                onClear={handleClearSelection}
                onMove={() => setBatchMoveOpen(true)}
                onDelete={() => setBatchDeleteOpen(true)}
                onTags={() => setBatchTagOpen(true)}
            />

            <BatchMoveDialog
                open={batchMoveOpen}
                onOpenChange={setBatchMoveOpen}
                count={selectedIds.size}
                libraryId={libraryId!}
                busy={batchBusy}
                onConfirm={handleBatchMove}
            />

            <BatchDeleteDialog
                open={batchDeleteOpen}
                onOpenChange={setBatchDeleteOpen}
                count={selectedIds.size}
                busy={batchBusy}
                onConfirm={handleBatchDelete}
            />

            <BatchTagDialog
                open={batchTagOpen}
                onOpenChange={setBatchTagOpen}
                ids={Array.from(selectedIds)}
                libraryId={libraryId!}
                toaster={toaster as CustomToaster}
                onApplied={handleBatchTagsApplied}
            />

            <AddAssetDialog
                open={addDialogOpen}
                onOpenChange={setAddDialogOpen}
                toaster={toaster as CustomToaster}
                isMobile={isMobile}
                onAssetsAdded={() => { setPage(1); setAssets([]); setTreeRefreshKey((k) => k + 1); loadAssets(1, searchQuery, false, currentFolder || undefined, getSubfolders(currentFolder)) }}
                currentFolder={currentFolder}
                libraryId={libraryId}
                initialFiles={pendingFiles}
                onInitialFilesConsumed={() => setPendingFiles([])}
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
                                    currentFolder={exploreMode ? EXPLORE_SELECTION_SENTINEL : currentFolder}
                                    onFolderChange={(folder) => {
                                        handleFolderChange(folder)
                                        setMobileTreeOpen(false)
                                    }}
                                    onMoveAsset={handleMoveAsset}
                                    refreshKey={treeRefreshKey}
                                    libraryId={libraryId!}
                                    exploreActive={exploreMode}
                                    onOpenExplore={() => {
                                        setMobileTreeOpen(false)
                                        navigate(`/${libraryId}/explore`)
                                    }}
                                />
                            </Drawer.Body>
                        </Drawer.Content>
                    </Drawer.Positioner>
                </Portal>
            </Drawer.Root>

            {/* Mobile bottom sheet for sidebar */}
            <Drawer.Root placement="bottom" open={!!selectedAssetId && isMobile} onOpenChange={(e: { open: boolean }) => { if (!e.open) handleCloseSidebar() }}>
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
                                <Sidebar assetId={selectedAssetId} onClose={handleCloseSidebar} toaster={toaster as CustomToaster} selectedTags={selectedTags} onTagClick={(value) => handleTagsChange(selectedTags.includes(value) ? selectedTags.filter((t) => t !== value) : [...selectedTags, value])} onRefreshRequested={(id, reason) => handleAssetMoved(id, reason)} boostPatch={boostPatch} onBoostChanged={applyBoostState} />
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
                                            // Refresh directory tree and assets after unlock
                                            setTreeRefreshKey((k) => k + 1)
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
function SidebarPanel({ assetId, onClose, toaster, onTagClick, selectedTags, onRefreshRequested, boostPatch, onBoostChanged }: {
    assetId: string
    onClose: () => void
    toaster: CustomToaster
    onTagClick?: (value: string) => void
    selectedTags?: string[]
    onRefreshRequested?: (assetId?: string, reason?: 'deleted' | 'moved') => void
    boostPatch?: { id: string; count: number; boostedToday: boolean } | null
    onBoostChanged?: (assetId: string, boostCount: number, boostedToday: boolean) => void
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

            <Box flex="1" minH="0" display="flex" flexDirection="column" overflow="hidden" px="3" pt="2" pb="4">
                <Sidebar assetId={assetId} onClose={onClose} toaster={toaster} onTagClick={onTagClick} selectedTags={selectedTags} onRefreshRequested={onRefreshRequested} boostPatch={boostPatch} onBoostChanged={onBoostChanged} />
            </Box>
        </Box>
    )
}
