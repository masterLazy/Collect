import { useEffect, useRef, useState } from "react"
import {
    Box,
    Button,
    Checkbox,
    Dialog,
    Drawer,
    HStack,
    Portal,
    Stack,
    Tag,
    Text,
    VStack,
} from "@chakra-ui/react"
import { api } from "../services/api"
import { TagEditor } from "./TagEditor"
import { DirectoryPicker } from "./DirectoryPicker"
import type { CustomToaster } from "./CustomToast"
import type { AssetTag, UploadResult } from "../types"

interface AddAssetDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    toaster: CustomToaster
    isMobile?: boolean
    onAssetsAdded: () => void
    currentFolder?: string
    libraryId?: string
}

interface FileEntry {
    file: File
    status: "ready" | "error"
    errorReason?: string
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

const ALLOWED_TYPES = [
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
    "image/bmp",
    "image/tiff",
    "image/svg+xml",
    "image/avif",
]

function formatSize(bytes: number): string {
    if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + " MB"
    if (bytes >= 1024) return (bytes / 1024).toFixed(0) + " KB"
    return bytes + " B"
}

export function AddAssetDialog({ open, onOpenChange, toaster, isMobile, onAssetsAdded, currentFolder = "", libraryId }: AddAssetDialogProps) {
    const [files, setFiles] = useState<FileEntry[]>([])
    const [targetDir, setTargetDir] = useState("Uncategorized")
    const [uploading, setUploading] = useState(false)
    const [dragOver, setDragOver] = useState(false)
    const [folderDialogOpen, setFolderDialogOpen] = useState(false)
    const [keepFilename, setKeepFilename] = useState(false)
    const [batchTags, setBatchTags] = useState<AssetTag[]>([])
    const fileInputRef = useRef<HTMLInputElement>(null)

    useEffect(() => {
        if (open) {
            const defaultTargetDir = currentFolder === ""
                ? "Uncategorized"
                : currentFolder === "__root__"
                    ? ""
                    : currentFolder

            setFiles([])
            setTargetDir(defaultTargetDir)
            setUploading(false)
            setDragOver(false)
            setFolderDialogOpen(false)

            setKeepFilename(false)
            setBatchTags([])
        }
    }, [open, currentFolder])

    const addFiles = (fileList: FileList) => {
        const newEntries: FileEntry[] = Array.from(fileList).map((f) => {
            if (!ALLOWED_TYPES.includes(f.type)) {
                return { file: f, status: "error" as const, errorReason: "Unsupported format" }
            }
            return { file: f, status: "ready" as const }
        })
        setFiles((prev) => [...prev, ...newEntries])
    }

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault()
        setDragOver(false)
        if (e.dataTransfer.files.length > 0) {
            addFiles(e.dataTransfer.files)
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
            addFiles(e.target.files)
        }
        e.target.value = ""
    }

    const removeFile = (index: number) => {
        setFiles((prev) => prev.filter((_, i) => i !== index))
    }

    const handleSubmit = async () => {
        const readyFiles = files.filter((f) => f.status === "ready").map((f) => f.file)
        if (readyFiles.length === 0) return

        setUploading(true)
        try {
            const result: UploadResult = await api.uploadAssets(libraryId ?? "", readyFiles, targetDir, keepFilename, batchTags)
            toaster.create({
                title: "Upload complete",
                description: result.added + " file(s) added" + (result.errors.length > 0 ? ", " + result.errors.length + " error(s)" : ""),
                type: "success",
            })
            onAssetsAdded()
            onOpenChange(false)
        } catch {
            toaster.create({
                title: "Upload failed",
                description: "Check the backend server and try again.",
                type: "error",
            })
        } finally {
            setUploading(false)
        }
    }

    const leftPanel = (
        <Stack gap="4" flex="1" minW="0">
            {/* Drop zone */}
            <Box
                border="2px dashed"
                borderColor={dragOver ? "accent.default" : "border"}
                borderRadius="md"
                p="8"
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
                    accept="image/*"
                    style={{ display: "none" }}
                    onChange={handleFileInputChange}
                />
                <VStack gap="2">
                    <Box color="fg.muted">
                        <UploadIcon />
                    </Box>
                    <Text color="fg" fontWeight="medium">
                        Drag & drop files here, or click to select
                    </Text>
                    <Text color="fg.subtle" fontSize="sm">
                        Supports JPEG, PNG, WebP, GIF, BMP, TIFF, SVG, AVIF
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
                checked={keepFilename}
                onCheckedChange={(e: { checked: boolean }) => setKeepFilename(!!e.checked)}
            >
                <Checkbox.HiddenInput />
                <Checkbox.Control />
                <Checkbox.Label color="fg" fontSize="sm">
                    Keep filename
                </Checkbox.Label>
            </Checkbox.Root>
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

            {/* File list preview */}
            {files.length > 0 && (
                <Stack gap="2">
                    <Text fontWeight="semibold" fontSize="sm" color="fg">
                        Selected Files ({files.length})
                    </Text>
                    <Box maxH="200px" overflowY="auto" border="1px solid" borderColor="border" borderRadius="md" p="2">
                        {files.map((entry, i) => (
                            <HStack key={i} gap="2" py="1" px="1" _hover={{ bg: "bg.subtle" }} borderRadius="sm">
                                <Text fontSize="sm" color="fg" truncate flex="1">
                                    {entry.file.name}
                                </Text>
                                <Text fontSize="xs" color="fg.subtle" flexShrink="0">
                                    {formatSize(entry.file.size)}
                                </Text>
                                {entry.status === "error" ? (
                                    <Tag.Root size="sm" colorPalette="red" variant="subtle">
                                        <Tag.Label>{entry.errorReason}</Tag.Label>
                                    </Tag.Root>
                                ) : (
                                    <Tag.Root size="sm" colorPalette="green" variant="subtle">
                                        <Tag.Label>Ready</Tag.Label>
                                    </Tag.Root>
                                )}
                                <Button
                                    size="xs"
                                    variant="ghost"
                                    onClick={() => removeFile(i)}
                                    aria-label={"Remove " + entry.file.name}
                                >
                                    <XIcon />
                                </Button>
                            </HStack>
                        ))}
                    </Box>
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
                                    disabled={files.filter((f) => f.status === "ready").length === 0}
                                    onClick={handleSubmit}
                                >
                                    Upload
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
                                disabled={files.filter((f) => f.status === "ready").length === 0}
                                onClick={handleSubmit}
                            >
                                Upload
                            </Button>
                        </Dialog.Footer>
                    </Dialog.Content>
                </Dialog.Positioner>
            </Portal>
        </Dialog.Root>
    )
}
