import {
    ALLOWED_UPLOAD_EXTENSIONS,
    UPLOAD_ACCEPT_ATTRIBUTE,
    extensionForMimeType,
    fileExtension,
    fileKey,
    imageFilesFromDataTransfer,
    isAllowedUpload,
    makePastedFileName,
    normalizeClipboardFile,
} from "./clipboardFiles"

function makeFile(name: string, type: string, size = 4, lastModified = 1_700_000_000_000): File {
    return new File(["x".repeat(size)], name, { type, lastModified })
}

/** Minimal stand-in for the DataTransfer of a clipboard/drop event. */
function makeDataTransfer(
    items: Array<{ kind: string; type: string; file: File | null }>,
    files: File[] = [],
): DataTransfer {
    return {
        items: items.map((item) => ({
            kind: item.kind,
            type: item.type,
            getAsFile: () => item.file,
        })),
        files,
    } as unknown as DataTransfer
}

describe("format helpers", () => {
    test("fileExtension lower-cases and keeps the dot", () => {
        expect(fileExtension("PHOTO.JPEG")).toBe(".jpeg")
        expect(fileExtension("no-extension")).toBe("")
    })

    test("extensionForMimeType maps known image types and ignores parameters", () => {
        expect(extensionForMimeType("image/jpeg")).toBe("jpg")
        expect(extensionForMimeType("image/tiff")).toBe("tiff")
        expect(extensionForMimeType("image/png; charset=binary")).toBe("png")
        expect(extensionForMimeType("application/octet-stream")).toBe("png")
    })

    test("accept attribute covers both extensions and MIME types", () => {
        expect(UPLOAD_ACCEPT_ATTRIBUTE).toContain(".png")
        expect(UPLOAD_ACCEPT_ATTRIBUTE).toContain("image/jpeg")
    })

    test("allowed extensions mirror the backend upload list", () => {
        expect([...ALLOWED_UPLOAD_EXTENSIONS]).toEqual([
            ".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".tif", ".tiff",
        ])
    })
})

describe("isAllowedUpload", () => {
    test("accepts supported image types", () => {
        expect(isAllowedUpload(makeFile("a.png", "image/png"))).toBe(true)
        expect(isAllowedUpload(makeFile("a.tif", "image/tiff"))).toBe(true)
    })

    test("rejects formats the backend does not accept", () => {
        expect(isAllowedUpload(makeFile("a.svg", "image/svg+xml"))).toBe(false)
        expect(isAllowedUpload(makeFile("a.avif", "image/avif"))).toBe(false)
        expect(isAllowedUpload(makeFile("a.pdf", "application/pdf"))).toBe(false)
    })

    test("falls back to the extension when the browser reports no MIME type", () => {
        expect(isAllowedUpload(makeFile("scan.PNG", ""))).toBe(true)
        expect(isAllowedUpload(makeFile("icon.svg", ""))).toBe(false)
    })
})

describe("fileKey", () => {
    test("changes with size but not with an identical file", () => {
        expect(fileKey(makeFile("a.png", "image/png", 4))).toBe(fileKey(makeFile("a.png", "image/png", 4)))
        expect(fileKey(makeFile("a.png", "image/png", 4))).not.toBe(fileKey(makeFile("a.png", "image/png", 5)))
    })
})

describe("makePastedFileName", () => {
    test("stamps the time and uses the blob type", () => {
        const name = makePastedFileName(
            new Blob([""], { type: "image/jpeg" }),
            new Date(2026, 8, 30, 14, 32, 10),
        )
        expect(name).toBe("pasted-20260930-143210.jpg")
    })

    test("pads single digit components", () => {
        const name = makePastedFileName(
            new Blob([""], { type: "image/png" }),
            new Date(2026, 0, 5, 3, 4, 5),
        )
        expect(name).toBe("pasted-20260105-030405.png")
    })
})

describe("normalizeClipboardFile", () => {
    test("keeps a real file name", () => {
        const file = makeFile("holiday.jpg", "image/jpeg")
        expect(normalizeClipboardFile(file)).toBe(file)
    })

    test("renames browser generated clipboard names", () => {
        expect(normalizeClipboardFile(makeFile("image.png", "image/png")).name).toMatch(/^pasted-\d{8}-\d{6}\.png$/)
        expect(normalizeClipboardFile(makeFile("blob", "image/png")).name).toMatch(/^pasted-\d{8}-\d{6}\.png$/)

        const unnamed = normalizeClipboardFile(new File([""], "", { type: "image/png", lastModified: 0 }))
        expect(unnamed.name).toMatch(/^pasted-\d{8}-\d{6}\.png$/)
        expect(unnamed.type).toBe("image/png")
    })
})

describe("imageFilesFromDataTransfer", () => {
    test("collects image items and ignores text entries", () => {
        const image = makeFile("image.png", "image/png")
        const data = makeDataTransfer([
            { kind: "string", type: "text/plain", file: null },
            { kind: "file", type: "image/png", file: image },
        ])
        const result = imageFilesFromDataTransfer(data)
        expect(result).toHaveLength(1)
        expect(result[0].type).toBe("image/png")
    })

    test("ignores a paste that only carries text", () => {
        const data = makeDataTransfer([{ kind: "string", type: "text/plain", file: null }])
        expect(imageFilesFromDataTransfer(data)).toEqual([])
    })

    test("falls back to dataTransfer.files when items are unavailable", () => {
        const image = makeFile("holiday.jpg", "image/jpeg")
        const data = makeDataTransfer([], [image])
        const result = imageFilesFromDataTransfer(data)
        expect(result).toHaveLength(1)
        expect(result[0].name).toBe("holiday.jpg")
    })

    test("returns nothing for a null clipboard payload", () => {
        expect(imageFilesFromDataTransfer(null)).toEqual([])
    })
})
