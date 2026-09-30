import { useCallback, useEffect, useRef, useState } from "react"
import {
    Box,
    Button,
    Checkbox,
    Dialog,
    Drawer,
    HStack,
    IconButton,
    Image,
    Portal,
    Progress,
    SimpleGrid,
    Stack,
    Text,
    VStack,
} from "@chakra-ui/react"
import { api } from "../services/api"
import {
    ALLOWED_UPLOAD_LABEL,
    UPLOAD_ACCEPT_ATTRIBUTE,
    canReadClipboardImages,
    fileKey,
    isAllowedUpload,
    readClipboardImageFiles,
} from "../lib/clipboardFiles"
import { TagEditor } from "./TagEditor"
import { DirectoryPicker } from "./DirectoryPicker"
import type { CustomToaster } from "./CustomToast"
import type { AssetTag, UploadError, UploadResult } from "../types"

interface AddAssetDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    toaster: CustomToaster
    isMobile?: boolean
    onAssetsAdded: () => void
    currentFolder?: string
    libraryId?: string
    /** Files handed in from outside the dialog (e.g. an image pasted on the gallery). */
    initialFiles?: File[]
    /** Called once `initialFiles` have been queued, so the caller can clear them. */
    onInitialFilesConsumed?: () => void
}

interface FileEntry {
    id: string
    file: File
    /** Local object URL backing the thumbnail — revoked when the entry is dropped. */
    previewUrl: string | null
    status: "ready" | "error"
    errorReason?: string
    source: "drop" | "pick" | "paste"
}

let entryCounter = 0

function makeEntryId(): string {
    entryCounter += 1
    return `entry-${Date.now().toString(36)}-${entryCounter}`
}

function UploadIcon() {
    return (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
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

function BrokenImageIcon() {
    return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <path d="M4 16l4-4 3 3 3-3 6 5" />
            <line x1="4" y1="4" x2="20" y2="20" />
        </svg>
    )
}

const ALLOWED_UPLOAD_HINT = `Unsupported format — only ${ALLOWED_UPLOAD_LABEL}`

function formatSize(bytes: number): string {
    if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + " MB"
    if (bytes >= 1024) return (bytes / 1024).toFixed(0) + " KB"
    return bytes + " B"
}

export function AddAssetDialog({ open, onOpenChange, toaster, isMobile, onAssetsAdded, currentFolder = "", libraryId, initialFiles, onInitialFilesConsumed }: AddAssetDialogProps) {
    const [files, setFiles] = useState<FileEntry[]>([])
    const [targetDir, setTargetDir] = useState("Uncategorized")
    const [uploading, setUploading] = useState(false)
    const [progress, setProgress] = useState(0)
    const [dragOver, setDragOver] = useState(false)
    const [folderDialogOpen, setFolderDialogOpen] = useState(false)
    const [keepFilename, setKeepFilename] = useState(false)
    const [batchTags, setBatchTags] = useState<AssetTag[]>([])
    const [uploadErrors, setUploadErrors] = useState<UploadError[]>([])
    const [readingClipboard, setReadingClipboard] = useState(false)
    const fileInputRef = useRef<HTMLInputElement>(null)

    // Object URLs backing the thumbnails, keyed by entry id. The browser keeps
    // the blob alive until these are revoked, so every removal path must revoke.
    const previewUrls = useRef<Map<string, string>>(new Map())
    // Mirrors `files` so back-to-back calls in the same tick (drop + paste) see
    // the entries queued by the previous call.
    const filesRef = useRef<FileEntry[]>([])

    const commitFiles = useCallback((next: FileEntry[]) => {
        filesRef.current = next
        setFiles(next)
    }, [])

    const revokePreview = useCallback((id: string) => {
        const url = previewUrls.current.get(id)
        if (!url) return
        previewUrls.current.delete(id)
        // Revoke on the next task: the tile still points at this blob until React
        // commits the removal, and revoking it earlier makes the <img> fail to load.
        setTimeout(() => URL.revokeObjectURL(url), 0)
    }, [])

    const revokeAllPreviews = useCallback(() => {
        const urls = Array.from(previewUrls.current.values())
        previewUrls.current.clear()
        if (urls.length > 0) {
            setTimeout(() => urls.forEach((url) => URL.revokeObjectURL(url)), 0)
        }
    }, [])

    // Release every preview blob when the dialog unmounts.
    useEffect(() => revokeAllPreviews, [revokeAllPreviews])

    /**
     * Single entry point for every way images get into the queue (drop, file
     * picker, paste, external hand-off). Duplicates are skipped and unsupported
     * formats are queued as error tiles instead of being silently dropped.
     */
    const addFiles = useCallback((incoming: File[] | FileList, source: FileEntry["source"]) => {
        const list = Array.from(incoming)
        if (list.length === 0) return

        const seen = new Set(filesRef.current.map((entry) => fileKey(entry.file)))
        const added: FileEntry[] = []
        let duplicates = 0

        list.forEach((file) => {
            const key = fileKey(file)
            if (seen.has(key)) {
                duplicates += 1
                return
            }
            seen.add(key)

            const allowed = isAllowedUpload(file)
            const id = makeEntryId()
            let previewUrl: string | null = null
            if (allowed) {
                previewUrl = URL.createObjectURL(file)
                previewUrls.current.set(id, previewUrl)
            }

            added.push({
                id,
                file,
                previewUrl,
                status: allowed ? "ready" : "error",
                errorReason: allowed ? undefined : ALLOWED_UPLOAD_HINT,
                source,
            })
        })

        if (added.length > 0) commitFiles([...filesRef.current, ...added])

        if (duplicates > 0) {
            toaster.create({
                title: "Already in the list",
                description: `${duplicates} duplicate file(s) were skipped.`,
                type: "info",
            })
        }
    }, [commitFiles, toaster])

    // Reset the queue every time the dialog opens.
    useEffect(() => {
        if (!open) return

        revokeAllPreviews()
        filesRef.current = []
        setFiles([])
        setUploading(false)
        setProgress(0)
        setUploadErrors([])
        setDragOver(false)
        setFolderDialogOpen(false)
        setKeepFilename(false)
        setBatchTags([])
        setReadingClipboard(false)
    }, [open, revokeAllPreviews])

    // Keep the default target folder in sync with the folder being browsed.
    useEffect(() => {
        if (!open) return
        setTargetDir(currentFolder === ""
            ? "Uncategorized"
            : currentFolder === "__root__"
                ? ""
                : currentFolder)
    }, [open, currentFolder])

    // Images handed in from outside the dialog (pasted on the gallery) are queued
    // once the dialog is open. Declared after the reset effect so they survive it.
    useEffect(() => {
        if (!open || !initialFiles || initialFiles.length === 0) return
        addFiles(initialFiles, "paste")
        onInitialFilesConsumed?.()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, initialFiles])

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault()
        setDragOver(false)
        if (e.dataTransfer.files.length > 0) {
            addFiles(e.dataTransfer.files, "drop")
        }
    }

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault()
        setDragOver(true)
    }

    const handleDragLeave = () => {
        setDragOver(false)
    }

    const handleFilePick = () => {
        fileInputRef.current?.click()
    }

    const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files.length > 0) {
            addFiles(e.target.files, "pick")
        }
        e.target.value = ""
    }

    /** Click-driven paste — the only paste path browsers offer on tablets/phones. */
    const handlePasteFromClipboard = async () => {
        setReadingClipboard(true)
        try {
            const pasted = await readClipboardImageFiles()
            if (pasted.length === 0) {
                toaster.create({
                    title: "No image in the clipboard",
                    description: "Copy an image first, then try again.",
                    type: "info",
                })
            } else {
                addFiles(pasted, "paste")
            }
        } catch {
            toaster.create({
                title: "Clipboard unavailable",
                description: "Allow clipboard access, or press Ctrl+V instead.",
                type: "error",
            })
        } finally {
            setReadingClipboard(false)
        }
    }

    const removeFile = (id: string) => {
        revokePreview(id)
        commitFiles(filesRef.current.filter((entry) => entry.id !== id))
        setUploadErrors([])
    }

    const clearFiles = () => {
        revokeAllPreviews()
        commitFiles([])
        setUploadErrors([])
    }

    const handleSubmit = async () => {
        const queued = filesRef.current
        const readyFiles = queued.filter((f) => f.status === "ready").map((f) => f.file)
        if (readyFiles.length === 0) return

        setUploading(true)
        setProgress(0)
        setUploadErrors([])
        try {
            const result: UploadResult = await api.uploadAssets(
                libraryId ?? "",
                readyFiles,
                targetDir,
                keepFilename,
                batchTags,
                (loaded, total) => setProgress(total > 0 ? Math.round((loaded / total) * 100) : 0),
            )

            // Keep only what the backend rejected — everything else reached the disk.
            const failedNames = new Set(result.errors.map((error) => error.fileName))
            queued.forEach((entry) => {
                if (!failedNames.has(entry.file.name)) revokePreview(entry.id)
            })
            commitFiles(queued.filter((entry) => failedNames.has(entry.file.name)))

            if (result.errors.length > 0) {
                setUploadErrors(result.errors)
                toaster.create({
                    title: result.added > 0 ? "Upload partially completed" : "Upload failed",
                    description: result.added + " file(s) added, " + result.errors.length + " could not be added.",
                    type: result.added > 0 ? "warning" : "error",
                })
            } else {
                toaster.create({
                    title: "Upload complete",
                    description: result.added + " file(s) added.",
                    type: "success",
                })
            }

            if (result.added > 0) onAssetsAdded()
            if (result.errors.length === 0) onOpenChange(false)
        } catch (error) {
            toaster.create({
                title: "Upload failed",
                description: error instanceof Error ? error.message : "Check the backend server and try again.",
                type: "error",
            })
        } finally {
            setUploading(false)
        }
    }

    const readyCount = files.filter((entry) => entry.status === "ready").length
    const totalSize = files.reduce((sum, entry) => sum + entry.file.size, 0)

    const leftPanel = (
        <Stack gap="4" flex="1" minW="0">
            {/* Drop zone */}
            <Box
                border="2px dashed"
                borderColor={dragOver ? "border.emphasized" : "border"}
                borderRadius="md"
                p={files.length > 0 ? "4" : "6"}
                textAlign="center"
                cursor="pointer"
                bg={dragOver ? "bg.subtle" : "bg"}
                transition="all 0.15s"
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onClick={handleFilePick}
            >
                <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    accept={UPLOAD_ACCEPT_ATTRIBUTE}
                    style={{ display: "none" }}
                    onChange={handleFileInputChange}
                />
                <VStack gap="2">
                    <Box color={dragOver ? "fg" : "fg.muted"}>
                        <UploadIcon />
                    </Box>
                    <Text color="fg" fontWeight="medium" fontSize="sm">
                        Drag & drop images here
                    </Text>
                    <HStack gap="2" justify="center">
                        <Button
                            size="xs"
                            variant="outline"
                            onClick={(e) => { e.stopPropagation(); handleFilePick() }}
                        >
                            Choose files
                        </Button>
                        {canReadClipboardImages() && (
                            <Button
                                size="xs"
                                variant="outline"
                                loading={readingClipboard}
                                onClick={(e) => { e.stopPropagation(); handlePasteFromClipboard() }}
                            >
                                Paste
                            </Button>
                        )}
                    </HStack>
                    {!isMobile && (
                        <Text color="fg.subtle" fontSize="xs">
                            Tip: press Ctrl+V anywhere to paste an image
                        </Text>
                    )}
                    <Text color="fg.subtle" fontSize="xs">
                        Supported: {ALLOWED_UPLOAD_LABEL}
                    </Text>
                </VStack>
            </Box>

            {/* Target directory — button opens a dialog with folder tree */}
            <Text fontSize="sm" fontWeight="semibold" color="fg">Target Directory</Text>
            <Button
                size="sm"
                variant="outline"
                width="full"
                justifyContent="space-between"
                onClick={() => setFolderDialogOpen(true)}
            >
                <Text fontSize="sm" truncate>{targetDir === "" ? "Root" : targetDir}</Text>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                    <polyline points="9 18 15 12 9 6" />
                </svg>
            </Button>

            {/* Folder picker dialog */}
            <DirectoryPicker
                open={folderDialogOpen}
                onOpenChange={(open) => setFolderDialogOpen(open)}
                selectedPath={targetDir}
                onSelect={(path) => setTargetDir(path)}
                title="Select Target Directory"
                libraryId={libraryId!}
            />

            {/* Keep filename checkbox */}
            <Checkbox.Root
                alignSelf="start"
                checked={keepFilename}
                onCheckedChange={(e: { checked: boolean }) => setKeepFilename(!!e.checked)}
            >
                <Checkbox.HiddenInput />
                <Checkbox.Control />
                <Checkbox.Label color="fg" fontSize="sm">
                    Keep filename
                </Checkbox.Label>
            </Checkbox.Root>
            <Text fontSize="xs" color="fg.subtle" mt="-3">
                {keepFilename
                    ? "Uploaded files keep their original names."
                    : "Uploaded files are renamed from the tags on the right."}
            </Text>
        </Stack>
    )

    const rightPanel = !keepFilename && (
        <Box flex="1" minW="0">
            <TagEditor
                tags={batchTags}
                assetId="batch"
                onTagsChange={setBatchTags}
                libraryId={libraryId!}
            />
        </Box>
    )

    const content = (
        <Stack gap="4">
            {/* Desktop: side-by-side layout */}
            {!isMobile ? (
                <HStack gap="6" alignItems="flex-start">
                    {leftPanel}
                    {rightPanel}
                </HStack>
            ) : (
                <Stack gap="4">
                    {leftPanel}
                    {rightPanel}
                </Stack>
            )}

            {/* Upload progress */}
            {uploading && (
                <Stack gap="1">
                    <Progress.Root value={progress} size="sm">
                        <Progress.Track>
                            <Progress.Range />
                        </Progress.Track>
                    </Progress.Root>
                    <Text fontSize="xs" color="fg.subtle">
                        Uploading {readyCount} file{readyCount === 1 ? "" : "s"}… {progress}%
                    </Text>
                </Stack>
            )}

            {/* Files the backend rejected */}
            {uploadErrors.length > 0 && (
                <Box
                    border="1px solid"
                    borderColor="border.error"
                    borderRadius="md"
                    p="3"
                    bg="bg.subtle"
                    maxH="140px"
                    overflowY="auto"
                >
                    <Text fontSize="sm" fontWeight="semibold" color="fg.error">
                        {uploadErrors.length} file{uploadErrors.length === 1 ? "" : "s"} could not be added
                    </Text>
                    <Stack gap="1" mt="1">
                        {uploadErrors.map((error, i) => (
                            <Text key={error.fileName + "-" + i} fontSize="xs" color="fg.muted">
                                <Text as="span" color="fg" fontWeight="medium" title={error.fileName}>
                                    {error.fileName}
                                </Text>
                                {" — " + error.reason}
                            </Text>
                        ))}
                    </Stack>
                </Box>
            )}

            {/* Selected files */}
            {files.length > 0 && (
                <Stack gap="2">
                    <HStack justify="space-between" align="center">
                        <Text fontWeight="semibold" fontSize="sm" color="fg">
                            Selected ({files.length}) · {formatSize(totalSize)}
                        </Text>
                        <Button size="xs" variant="ghost" onClick={clearFiles} disabled={uploading}>
                            Clear all
                        </Button>
                    </HStack>
                    <SimpleGrid
                        columns={{ base: 3, sm: 4, md: 5 }}
                        gap="2"
                        maxH="264px"
                        overflowY="auto"
                        p="1"
                    >
                        {files.map((entry) => (
                            <Box
                                key={entry.id}
                                position="relative"
                                aspectRatio="1"
                                borderRadius="md"
                                overflow="hidden"
                                border="1px solid"
                                borderColor={entry.status === "error" ? "border.error" : "border"}
                                bg="bg.subtle"
                            >
                                {entry.previewUrl ? (
                                    <Image
                                        src={entry.previewUrl}
                                        alt={entry.file.name}
                                        width="full"
                                        height="full"
                                        objectFit="cover"
                                        draggable={false}
                                    />
                                ) : (
                                    <VStack gap="1" h="full" justify="center" color="fg.muted" p="2">
                                        <BrokenImageIcon />
                                        <Text fontSize="10px" textAlign="center" lineHeight="short">
                                            Unsupported
                                        </Text>
                                    </VStack>
                                )}

                                <IconButton
                                    position="absolute"
                                    top="1"
                                    right="1"
                                    zIndex="1"
                                    size="2xs"
                                    variant="solid"
                                    colorPalette="gray"
                                    borderRadius="full"
                                    title="Remove"
                                    aria-label={"Remove " + entry.file.name}
                                    onClick={(e) => { e.stopPropagation(); removeFile(entry.id) }}
                                >
                                    <XIcon />
                                </IconButton>

                                <Box position="absolute" left="0" right="0" bottom="0" bg="black/60" px="1.5" py="1">
                                    <Text fontSize="10px" color="white" truncate title={entry.errorReason ?? entry.file.name}>
                                        {entry.file.name}
                                    </Text>
                                    <Text fontSize="10px" color="whiteAlpha.800">
                                        {formatSize(entry.file.size)}
                                    </Text>
                                </Box>
                            </Box>
                        ))}
                    </SimpleGrid>
                </Stack>
            )}
        </Stack>
    )

    if (isMobile) {
        return (
            <Drawer.Root placement="bottom" open={open} onOpenChange={(e: { open: boolean }) => onOpenChange(e.open)}>
                <Portal>
                    <Drawer.Backdrop />
                    <Drawer.Positioner>
                        <Drawer.Content maxH="85vh" borderTopRadius="lg">
                            <Drawer.Header>
                                <HStack justify="space-between" width="full">
                                    <Drawer.Title>Add Assets</Drawer.Title>
                                    <Drawer.CloseTrigger asChild>
                                        <Button variant="ghost" size="sm" aria-label="Close">
                                            <XIcon />
                                        </Button>
                                    </Drawer.CloseTrigger>
                                </HStack>
                            </Drawer.Header>
                            <Drawer.Body>{content}</Drawer.Body>
                            <Drawer.Footer>
                                <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
                                    Cancel
                                </Button>
                                <Button
                                    colorPalette="accent"
                                    size="sm"
                                    loading={uploading}
                                    disabled={readyCount === 0}
                                    onClick={handleSubmit}
                                >
                                    {readyCount > 0 ? `Upload ${readyCount} file${readyCount === 1 ? "" : "s"}` : "Upload"}
                                </Button>
                            </Drawer.Footer>
                        </Drawer.Content>
                    </Drawer.Positioner>
                </Portal>
            </Drawer.Root>
        )
    }

    return (
        <Dialog.Root open={open} onOpenChange={(e: { open: boolean }) => onOpenChange(e.open)} size="xl">
            <Portal>
                <Dialog.Backdrop />
                <Dialog.Positioner>
                    <Dialog.Content>
                        <Dialog.Header>
                            <HStack justify="space-between" width="full">
                                <Dialog.Title>Add Assets</Dialog.Title>
                                <Dialog.CloseTrigger asChild>
                                    <Button variant="ghost" size="sm" aria-label="Close">
                                        <XIcon />
                                    </Button>
                                </Dialog.CloseTrigger>
                            </HStack>
                        </Dialog.Header>
                        <Dialog.Body>{content}</Dialog.Body>
                        <Dialog.Footer>
                            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
                                Cancel
                            </Button>
                            <Button
                                colorPalette="accent"
                                size="sm"
                                loading={uploading}
                                disabled={readyCount === 0}
                                onClick={handleSubmit}
                            >
                                {readyCount > 0 ? `Upload ${readyCount} file${readyCount === 1 ? "" : "s"}` : "Upload"}
                            </Button>
                        </Dialog.Footer>
                    </Dialog.Content>
                </Dialog.Positioner>
            </Portal>
        </Dialog.Root>
    )
}
