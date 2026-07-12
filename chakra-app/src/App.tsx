import { useEffect, useState, useCallback } from "react"
import { Box, Center, createToaster, Toaster } from "@chakra-ui/react"
import { Provider } from "./components/ui/provider"
import { TopBar } from "./components/TopBar"
import { MasonryGrid } from "./components/MasonryGrid"
import { Sidebar } from "./components/Sidebar"
import { LibraryManager } from "./components/LibraryManager"
import { DirectoryTree } from "./components/DirectoryTree"
import { AddAssetDialog } from "./components/AddAssetDialog"
import { api } from "./services/api"
import type { AssetDto } from "./types"

const PAGE_SIZE = 30

const toaster = createToaster({
  placement: "top-end",
  gap: 16,
})

function AppContent() {
  const [assets, setAssets] = useState<AssetDto[]>([])
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [initializing, setInitializing] = useState(true)
  const [libraryReady, setLibraryReady] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null)
  const [currentFolder, setCurrentFolder] = useState<string>("")
  const [addDialogOpen, setAddDialogOpen] = useState(false)

  useEffect(() => {
    api.getLibraryInfo()
      .then(() => setLibraryReady(true))
      .catch(() => setLibraryReady(false))
      .finally(() => setInitializing(false))
  }, [])

  const loadAssets = useCallback(async (pageNum: number, query: string, append: boolean) => {
    setLoading(true)
    try {
      let result: Awaited<ReturnType<typeof api.getAssets>>
      if (query) {
        result = await api.searchAssets(query, pageNum, PAGE_SIZE)
      } else {
        result = await api.getAssets(pageNum, PAGE_SIZE, currentFolder || undefined)
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
  }, [currentFolder])

  useEffect(() => {
    if (libraryReady) {
      loadAssets(1, searchQuery, false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [libraryReady, loadAssets])

  const handleSearchChange = useCallback((query: string) => {
    setSearchQuery(query)
    setPage(1)
    setAssets([])
    if (libraryReady) {
      loadAssets(1, query, false)
    }
  }, [libraryReady, loadAssets])

  const handleTagsChange = useCallback((tags: string[]) => {
    setSelectedTags(tags)
    const tagQuery = tags.length > 0 ? "tags:" + tags.join("+") : ""
    setSearchQuery(tagQuery)
    setPage(1)
    setAssets([])
    if (libraryReady) {
      loadAssets(1, tagQuery, false)
    }
  }, [libraryReady, loadAssets])

  const handleLoadMore = useCallback(() => {
    if (loading) return
    const nextPage = page + 1
    setPage(nextPage)
    loadAssets(nextPage, searchQuery, true)
  }, [loading, page, searchQuery, loadAssets])

  const handleFolderChange = useCallback((folder: string) => {
    setCurrentFolder(folder)
    setPage(1)
    setAssets([])
    if (libraryReady) loadAssets(1, searchQuery, false)
  }, [libraryReady, loadAssets, searchQuery])

  const handleSelectAsset = useCallback((id: string) => {
    setSelectedAssetId(id)
  }, [])

  const hasMore = assets.length < total

  if (initializing) {
    return (
      <Center height="100vh" bg="bg">
        <Box color="fg.muted">Loading...</Box>
      </Center>
    )
  }

  if (!libraryReady) {
    return <LibraryManager toaster={toaster} onLibraryReady={() => { setLibraryReady(true); loadAssets(1, "", false) }} />
  }

  return (
    <Box minH="100vh" bg="bg">
      <TopBar
        searchQuery={searchQuery}
        onSearchChange={handleSearchChange}
        selectedTags={selectedTags}
        onTagsChange={handleTagsChange}
        onOpenAddDialog={() => setAddDialogOpen(true)}
      />

      <Box
        display="flex"
        height="calc(100vh - 57px)"
        overflow="hidden"
      >
        {/* Left: Directory Tree */}
        <Box
          width="220px"
          minWidth="180px"
          overflowY="auto"
          borderRight="1px solid"
          borderColor="border"
          display={{ base: "none", md: "block" }}
          py="2"
        >
          <DirectoryTree currentFolder={currentFolder} onFolderChange={handleFolderChange} />
        </Box>

        {/* Center: Masonry */}
        <Box flex="1" overflow="auto" p="4">
          <MasonryGrid
            assets={assets}
            loading={loading}
            hasMore={hasMore}
            onLoadMore={handleLoadMore}
            onSelectAsset={handleSelectAsset}
          />
        </Box>

        {/* Right: Docked Sidebar */}
        {selectedAssetId && (
          <Box
            width="380px"
            minWidth="320px"
            overflowY="auto"
            borderLeft="1px solid"
            borderColor="border"
            py="4"
            px="3"
            css={{ resize: "horizontal" }}
          >
            <Sidebar assetId={selectedAssetId} onClose={() => setSelectedAssetId(null)} toaster={toaster} />
          </Box>
        )}
      </Box>

      <AddAssetDialog
        open={addDialogOpen}
        onOpenChange={setAddDialogOpen}
        toaster={toaster}
        onAssetsAdded={() => { setPage(1); setAssets([]); loadAssets(1, searchQuery, false) }}
      />

      <Toaster toaster={toaster} />
    </Box>
  )
}

export function App() {
  return (
    <Provider>
      <AppContent />
    </Provider>
  )
}
