import { useEffect, useRef, useState } from "react"
import {
    Box,
    Button,
    Dialog,
    Field,
    HStack,
    Input,
    Portal,
    Stack,
    Tag,
    Text,
    VStack,
} from "@chakra-ui/react"
import { api } from "../services/api"
import type { CustomToaster } from "./CustomToast"
import type { DirectoryNode, UploadResult } from "../types"

interface AddAssetDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    toaster: CustomToaster
    onAssetsAdded: () => void
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

function FolderPlusIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
            <line x1="12" y1="11" x2="12" y2="17" />
            <line x1="9" y1="14" x2="15" y2="14" />
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

function flattenTree(node: DirectoryNode, prefix: string = ""): { label: string; path: string }[] {
    const items: { label: string; path: string }[] = []
    if (prefix) {
        items.push({ label: prefix + node.name, path: node.path })
    }
    if (node.children) {
        for (const child of node.children) {
            items.push(...flattenTree(child, prefix ? prefix + node.name + "/" : ""))
        }
    }
    return items
}

export function AddAssetDialog({ open, onOpenChange, toaster, onAssetsAdded }: AddAssetDialogProps) {
    const [files, setFiles] = useState<FileEntry[]>([])
    const [targetDir, setTargetDir] = useState("Uncategorized")
    const [uploading, setUploading] = useState(false)
    const [dragOver, setDragOver] = useState(false)
    const [tree, setTree] = useState<DirectoryNode | null>(null)
    const [creatingSubfolder, setCreatingSubfolder] = useState(false)
    const [newFolderName, setNewFolderName] = useState("")
    const fileInputRef = useRef<HTMLInputElement>(null)

    useEffect(() => {
        if (open) {
            api.getDirectoryTree().then((data) => setTree(data.root)).catch(() => { })
            setFiles([])
            setTargetDir("Uncategorized")
            setUploading(false)
            setDragOver(false)
        }
    }, [open])

    const dirOptions = tree ? flattenTree(tree) : []

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

    const handleCreateSubfolder = async () => {
        const name = newFolderName.trim()
        if (!name) return
        try {
            const relativePath = targetDir === "Uncategorized" ? name : targetDir + "/" + name
            await api.createDirectory(relativePath)
            setNewFolderName("")
            setCreatingSubfolder(false)
            const data = await api.getDirectoryTree()
            setTree(data.root)
            setTargetDir(relativePath)
        } catch {
            toaster.create({
                title: "Failed to create folder",
                type: "error",
            })
        }
    }

    const handleSubmit = async () => {
        const readyFiles = files.filter((f) => f.status === "ready").map((f) => f.file)
        if (readyFiles.length === 0) return

        setUploading(true)
        try {
            const result: UploadResult = await api.uploadAssets(readyFiles, targetDir)
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

    return (
        <Dialog.Root open={open} onOpenChange={(e: { open: boolean }) => onOpenChange(e.open)} size="lg">
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
                        <Dialog.Body>
                            <Stack gap="4">
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

                                {/* Target directory */}
                                <Field.Root>
                                    <Field.Label color="fg">Target Directory</Field.Label>
                                    <HStack gap="2">
                                        <select
                                            value={targetDir}
                                            onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setTargetDir(e.target.value)}
                                            style={{
                                                width: "100%",
                                                background: "var(--chakra-colors-bg)",
                                                border: "1px solid var(--chakra-colors-border)",
                                                borderRadius: "var(--chakra-radii-md)",
                                                padding: "8px 12px",
                                                fontSize: "var(--chakra-fontSizes-sm)",
                                                color: "var(--chakra-colors-fg)",
                                                appearance: "none",
                                                WebkitAppearance: "none",
                                                MozAppearance: "none",
                                                cursor: "pointer",
                                            }}
                                        >
                                            {dirOptions.length > 0 ? (
                                                dirOptions.map((opt) => (
                                                    <option key={opt.path} value={opt.path}>
                                                        {opt.label}
                                                    </option>
                                                ))
                                            ) : (
                                                <option value="Uncategorized">Uncategorized</option>
                                            )}
                                        </select>
                                        <Button
                                            size="sm"
                                            variant="ghost"
                                            onClick={() => setCreatingSubfolder(!creatingSubfolder)}
                                            aria-label="Create subfolder"
                                        >
                                            <FolderPlusIcon />
                                        </Button>
                                    </HStack>
                                </Field.Root>

                                {creatingSubfolder && (
                                    <HStack gap="2">
                                        <Input
                                            placeholder="New folder name"
                                            value={newFolderName}
                                            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewFolderName(e.target.value)}
                                            size="sm"
                                            bg="bg"
                                            border="1px solid"
                                            borderColor="border"
                                        />
                                        <Button size="sm" colorPalette="accent" onClick={handleCreateSubfolder}>
                                            Create
                                        </Button>
                                        <Button size="sm" variant="ghost" onClick={() => { setCreatingSubfolder(false); setNewFolderName("") }}>
                                            Cancel
                                        </Button>
                                    </HStack>
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
                        </Dialog.Body>
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
