import type { AssetDetailDto, AssetDto, AssetTag, BoostResultDto, DirectoryNode, DirectoryTreeResponse, LibraryInfo, PaginatedResponse, ScanResult, ServerBrowseResponse, ServerDrive, TagConflict, TagExploreResponse, TagGroupsResponse, UploadResult } from "../types";

// In development (npm start), the CRA dev server proxies /api/* to the backend.
// In production (CollectHost), the backend serves both API and static files on the same origin.
// So we always use relative URLs — the proxy / same-origin handles the rest.
// Override with REACT_APP_API_PORT in .env.development when backend runs on a non-default port.
export const API_BASE = "";

// ── Unlock Token Management ──────────────────────────
// Token is stored in sessionStorage (persists across F5, cleared on tab close)
// This keeps the unlock device-specific (different browsers/devices get different tokens)

function getToken(): string | null {
    return sessionStorage.getItem("collect-unlock-token");
}

function setToken(token: string) {
    sessionStorage.setItem("collect-unlock-token", token);
}

function clearToken() {
    sessionStorage.removeItem("collect-unlock-token");
}

function buildHeaders(extra?: Record<string, string>): Record<string, string> {
    const headers: Record<string, string> = { ...extra };
    const token = getToken();
    if (token) headers["X-Unlock-Token"] = token;
    return headers;
}

/**
 * Error thrown by the API helpers when a request returns a non-OK status.
 * Carries the HTTP status so callers can branch on it (e.g. a 403 from a
 * locked name-encrypted library should trigger the unlock dialog).
 */
export class ApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
        super(message);
        this.name = "ApiError";
        this.status = status;
    }
}

async function get<T>(url: string): Promise<T> {
    const response = await fetch(`${API_BASE}${url}`, {
        headers: buildHeaders(),
    });
    if (!response.ok) {
        let errorMsg = `API Error: ${response.status} ${response.statusText}`;
        try {
            const errorBody = await response.json();
            if (errorBody.error) {
                errorMsg = `${response.status} - ${errorBody.error}`;
            } else if (errorBody.detail) {
                errorMsg = `${response.status} - ${errorBody.detail}`;
            }
        } catch { /* ignore parsing errors */ }
        throw new ApiError(errorMsg, response.status);
    }
    return response.json();
}

async function post<T>(url: string, body?: unknown): Promise<T> {
    const response = await fetch(`${API_BASE}${url}`, {
        method: "POST",
        headers: buildHeaders({ "Content-Type": "application/json" }),
        body: body ? JSON.stringify(body) : undefined,
    });
    if (!response.ok) {
        let errorMsg = `API Error: ${response.status} ${response.statusText}`;
        try {
            const errorBody = await response.json();
            if (errorBody.error) {
                errorMsg = `${response.status} - ${errorBody.error}`;
            } else if (errorBody.detail) {
                errorMsg = `${response.status} - ${errorBody.detail}`;
            }
        } catch { /* ignore parsing errors */ }
        throw new ApiError(errorMsg, response.status);
    }
    return response.json();
}

async function put<T>(url: string, body: unknown): Promise<T> {
    const response = await fetch(`${API_BASE}${url}`, {
        method: "PUT",
        headers: buildHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(body),
    });
    if (!response.ok) {
        let errorMsg = `API Error: ${response.status} ${response.statusText}`;
        try {
            const errorBody = await response.json();
            if (errorBody.error) {
                errorMsg = `${response.status} - ${errorBody.error}`;
            } else if (errorBody.detail) {
                errorMsg = `${response.status} - ${errorBody.detail}`;
            }
        } catch { /* ignore parsing errors */ }
        throw new ApiError(errorMsg, response.status);
    }
    return response.json();
}

// ── Path Normalization ────────────────────────────────
// Backend paths use OS-native separators (\ on Windows).
// The frontend consistently uses / as the path separator.

function normalizePath(path: string): string {
    return path.replace(/\\/g, "/");
}

function normalizeDirectoryNode(node: DirectoryNode): DirectoryNode {
    return {
        ...node,
        path: normalizePath(node.path),
        children: node.children?.map(normalizeDirectoryNode) ?? [],
    };
}

export const api = {
    initLibrary: (path: string, name: string, password?: string) =>
        post<LibraryInfo>("/api/library/init", {
            path,
            name,
            ...(password ? { password } : {}),
        }),
    getLibraryInfo: (libraryId: string) => get<LibraryInfo>(`/api/library/info?libraryId=${encodeURIComponent(libraryId)}`),
    scanAssets: (libraryId: string) => post<ScanResult>(`/api/assets/scan?libraryId=${encodeURIComponent(libraryId)}`),
    resolveTagConflicts: (libraryId: string, resolutions: { tagValue: string; chosenType: string }[]) =>
        post<{ success: boolean }>(`/api/assets/resolve-tag-conflicts?libraryId=${encodeURIComponent(libraryId)}`, { resolutions }),
    getDirectoryTree: async (libraryId: string) => {
        const result = await get<DirectoryTreeResponse>(`/api/library/tree?libraryId=${encodeURIComponent(libraryId)}`);
        return {
            ...result,
            root: normalizeDirectoryNode(result.root),
        };
    },
    createDirectory: (libraryId: string, relativePath: string) =>
        post<{ path: string }>(`/api/library/create-directory?libraryId=${encodeURIComponent(libraryId)}`, { relativePath }),
    renameDirectory: (libraryId: string, relativePath: string, newName: string) =>
        post<{ path: string }>(`/api/library/rename-directory?libraryId=${encodeURIComponent(libraryId)}`, { relativePath, newName }),
    deleteDirectory: (libraryId: string, relativePath: string) =>
        post<{ success: boolean }>(`/api/library/delete-directory?libraryId=${encodeURIComponent(libraryId)}`, { relativePath }),
    uploadAssets: (
        libraryId: string,
        files: File[],
        targetDir: string,
        keepFilename?: boolean,
        tags?: AssetTag[],
        onProgress?: (loaded: number, total: number) => void,
    ) => {
        const formData = new FormData()
        files.forEach((f) => formData.append("files", f))
        formData.append("targetDir", targetDir)
        formData.append("keepFilename", String(keepFilename ?? false))
        if (tags && tags.length > 0) {
            const normalizedTags = tags
                .filter((tag) => tag && tag.value && tag.value.trim())
                .map((tag) => ({ type: tag.type ?? null, value: tag.value.trim() }))
            formData.append("tags", JSON.stringify(normalizedTags))
            formData.append("tagsJson", JSON.stringify(normalizedTags))
        }

        // XHR instead of fetch so upload progress can be reported for large batches.
        return new Promise<UploadResult>((resolve, reject) => {
            const xhr = new XMLHttpRequest()
            xhr.open("POST", `${API_BASE}/api/assets/upload?libraryId=${encodeURIComponent(libraryId)}`)
            // Content-Type is intentionally not set — the browser adds the multipart boundary.
            const token = getToken()
            if (token) xhr.setRequestHeader("X-Unlock-Token", token)

            if (onProgress) {
                xhr.upload.onprogress = (event) => {
                    if (event.lengthComputable) onProgress(event.loaded, event.total)
                }
            }

            xhr.onload = () => {
                if (xhr.status >= 200 && xhr.status < 300) {
                    try {
                        resolve(JSON.parse(xhr.responseText) as UploadResult)
                    } catch {
                        reject(new ApiError("Upload succeeded but the response could not be read.", xhr.status))
                    }
                    return
                }

                let errorMsg = `API Error: ${xhr.status} ${xhr.statusText}`
                try {
                    const errorBody = JSON.parse(xhr.responseText)
                    if (errorBody.error) {
                        errorMsg = `${xhr.status} - ${errorBody.error}`
                    } else if (errorBody.detail) {
                        errorMsg = `${xhr.status} - ${errorBody.detail}`
                    }
                } catch { /* ignore parsing errors */ }
                reject(new ApiError(errorMsg, xhr.status))
            }

            xhr.onerror = () => reject(new ApiError("Network error while uploading.", 0))
            xhr.onabort = () => reject(new ApiError("Upload cancelled.", 0))
            xhr.send(formData)
        })
    },
    getAssets: (libraryId: string, page: number, size: number, folder?: string, subfolders?: boolean, sort?: string, seed?: number) => {
        let url = `/api/assets?libraryId=${encodeURIComponent(libraryId)}&page=${page}&size=${size}`
        if (folder) url += `&folder=${encodeURIComponent(folder)}`
        if (subfolders !== undefined) url += `&subfolders=${subfolders}`
        if (sort) url += `&sort=${sort}`
        // With a seed the server shuffles deterministically, so paging through
        // sort=random never repeats or skips assets.
        if (seed !== undefined) url += `&seed=${seed}`
        return get<PaginatedResponse<AssetDto>>(url)
    },
    getAsset: async (id: string, libraryId: string) => {
        const result = await get<AssetDetailDto>(`/api/assets/${id}?libraryId=${encodeURIComponent(libraryId)}`);
        return {
            ...result,
            relativePath: normalizePath(result.relativePath),
        };
    },
    searchAssets: (libraryId: string, query: string, page: number, size: number, folder?: string) =>
        get<PaginatedResponse<AssetDto>>(`/api/assets/search?libraryId=${encodeURIComponent(libraryId)}&q=${encodeURIComponent(query)}&page=${page}&size=${size}${folder ? `&folder=${encodeURIComponent(folder)}` : ""}`),
    updateTags: (id: string, tags: AssetTag[], libraryId: string) =>
        put<AssetDetailDto>(`/api/assets/${id}/tags?libraryId=${encodeURIComponent(libraryId)}`, { tags }),
    /**
     * Tags for several assets at once, keyed by asset id. One round trip and no
     * palette/thumbnail work on the server, so it stays cheap for large batches.
     */
    getAssetsTags: (ids: string[], libraryId: string) => {
        const params = new URLSearchParams()
        params.set("libraryId", libraryId)
        params.set("ids", ids.join(","))
        return get<Record<string, AssetTag[]>>(`/api/assets/batch/tags?${params.toString()}`)
    },
    getTags: (libraryId: string, page?: number, size?: number, search?: string) => {
        const params = new URLSearchParams()
        params.set("libraryId", libraryId)
        params.set("page", String(page ?? 1))
        params.set("size", String(size ?? 50))
        if (search) params.set("search", search)
        return get<TagGroupsResponse>(`/api/tags?${params.toString()}`)
    },
    /** Every tag with a randomly sampled asset — re-fetching reshuffles the samples. */
    getTagExplore: (libraryId: string, maxTags?: number, search?: string) => {
        const params = new URLSearchParams()
        params.set("libraryId", libraryId)
        if (maxTags) params.set("maxTags", String(maxTags))
        if (search) params.set("search", search)
        return get<TagExploreResponse>(`/api/tags/explore?${params.toString()}`)
    },
    moveAsset: (id: string, targetFolder: string, libraryId: string) =>
        post<AssetDetailDto>(`/api/assets/${id}/move?libraryId=${encodeURIComponent(libraryId)}`, { targetFolder }),
    /**
     * Boost (up-vote) an asset. The backend allows one boost per asset per local
     * day; a repeat call returns the current count with alreadyBoosted=true.
     */
    boostAsset: (id: string, libraryId: string) =>
        post<BoostResultDto>(`/api/assets/${id}/boost?libraryId=${encodeURIComponent(libraryId)}`),
    /**
     * Take back today's boost: the count drops by one and the once-per-day limit
     * is cleared, so the asset can be boosted again today.
     */
    undoBoost: (id: string, libraryId: string) =>
        post<BoostResultDto>(`/api/assets/${id}/boost/undo?libraryId=${encodeURIComponent(libraryId)}`),
    /** Clear every boost for an asset (count back to zero). */
    resetBoosts: async (id: string, libraryId: string): Promise<BoostResultDto> => {
        const response = await fetch(`${API_BASE}/api/assets/${id}/boost?libraryId=${encodeURIComponent(libraryId)}`, {
            method: "DELETE",
            headers: buildHeaders(),
        })
        if (!response.ok) {
            let errorMsg = `API Error: ${response.status} ${response.statusText}`
            try {
                const errorBody = await response.json()
                if (errorBody.error) errorMsg = `${response.status} - ${errorBody.error}`
            } catch { /* ignore parsing errors */ }
            throw new ApiError(errorMsg, response.status)
        }
        return response.json()
    },
    deleteAsset: (id: string, libraryId: string) =>
        fetch(`${API_BASE}/api/assets/${id}?libraryId=${encodeURIComponent(libraryId)}`, { method: "DELETE", headers: buildHeaders() }).then((r) => {
            if (!r.ok) throw new Error("Delete failed")
        }),
    checkLibraryPath: (path: string) =>
        get<{ isLibrary: boolean; info?: LibraryInfo }>(`/api/library/check?path=${encodeURIComponent(path)}`),
    healthCheck: () => get<LibraryInfo>("/api/library/info"),
    getLibraries: () => get<LibraryInfo[]>("/api/libraries"),
    loadLibrary: (id: string) => post<LibraryInfo>(`/api/library/load/${id}`),
    getTagConflicts: (libraryId: string) => get<TagConflict[]>(`/api/assets/tag-conflicts?libraryId=${encodeURIComponent(libraryId)}`),
    removeLibrary: (id: string) =>
        fetch(`${API_BASE}/api/libraries/${id}`, { method: "DELETE", headers: buildHeaders() }).then((r) => {
            if (!r.ok) throw new Error("Remove failed")
        }),
    getDrives: () => get<ServerDrive[]>("/api/fs/drives"),
    browsePath: (path: string) => get<ServerBrowseResponse>(`/api/fs/browse?path=${encodeURIComponent(path)}`),
    categorizeTags: (libraryId: string, changes: { tagValue: string; newType: string | null }[]) =>
        post<{ affectedAssets: number }>(`/api/assets/categorize?libraryId=${encodeURIComponent(libraryId)}`, { changes }),
    renameCategory: (libraryId: string, oldType: string, newType: string) =>
        post<{ success: boolean }>(`/api/assets/rename-category?libraryId=${encodeURIComponent(libraryId)}`, { oldType, newType }),
    deleteCategory: (libraryId: string, type: string) =>
        post<{ success: boolean }>(`/api/assets/delete-category?libraryId=${encodeURIComponent(libraryId)}`, { type }),
    renameTag: (libraryId: string, oldValue: string, newValue: string) =>
        post<{ success: boolean }>(`/api/assets/rename-tag?libraryId=${encodeURIComponent(libraryId)}`, { oldValue, newValue }),
    deleteTag: (libraryId: string, value: string) =>
        post<{ success: boolean }>(`/api/assets/delete-tag?libraryId=${encodeURIComponent(libraryId)}`, { value }),
    saveCategoryOrder: (libraryId: string, order: string[]) =>
        post<{ success: boolean }>(`/api/library/category-order?libraryId=${encodeURIComponent(libraryId)}`, { order }),
    /**
     * Persist the library's gallery layout and sort order in library.json so the
     * preference is shared by every client that opens this library. Omitted
     * fields keep their stored value.
     */
    setLibraryPreferences: (libraryId: string, prefs: { viewMode?: string; sortMode?: string }) =>
        post<{ success: boolean }>(`/api/library/preferences?libraryId=${encodeURIComponent(libraryId)}`, prefs),
    unlockLibrary: async (libraryId: string, id: string, password: string) => {
        const result = await post<{ library: LibraryInfo; token: string }>(`/api/library/unlock?libraryId=${encodeURIComponent(libraryId)}`, { password });
        setToken(result.token);
        return result.library;
    },
    lockLibrary: (libraryId: string) =>
        post<{ message: string }>(`/api/library/lock?libraryId=${encodeURIComponent(libraryId)}`),
    getUnlockStatus: (libraryId: string) =>
        get<{ unlocked: boolean; remainingSeconds: number }>(`/api/library/unlock-status?libraryId=${encodeURIComponent(libraryId)}`),
    decryptLibrary: (libraryId: string, password?: string) =>
        post<{ message: string; decryptedCount: number }>(`/api/library/decrypt?libraryId=${encodeURIComponent(libraryId)}`, { password }),
    encryptLibrary: (libraryId: string, password: string) =>
        post<{ message: string; encryptedCount: number }>(`/api/library/encrypt?libraryId=${encodeURIComponent(libraryId)}`, { password }),
};
