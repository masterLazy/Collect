import type { AssetDetailDto, AssetDto, AssetTag, DirectoryTreeResponse, LibraryInfo, PaginatedResponse, ScanResult, ServerBrowseResponse, ServerDrive, TagConflict, TagGroupsResponse, UploadResult } from "../types";

const API_BASE = `http://${window.location.hostname}:5000`;

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

async function get<T>(url: string): Promise<T> {
    const response = await fetch(`${API_BASE}${url}`, {
        headers: buildHeaders(),
    });
    if (!response.ok) {
        throw new Error(`API Error: ${response.status} ${response.statusText}`);
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
        throw new Error(`API Error: ${response.status} ${response.statusText}`);
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
        throw new Error(`API Error: ${response.status} ${response.statusText}`);
    }
    return response.json();
}

export const api = {
    initLibrary: (path: string, name: string, password?: string) =>
        post<LibraryInfo>("/api/library/init", { path, name, ...(password ? { password } : {}) }),
    getLibraryInfo: () => get<LibraryInfo>("/api/library/info"),
    scanAssets: () => post<ScanResult>("/api/assets/scan"),
    resolveTagConflicts: (resolutions: { tagValue: string; chosenType: string }[]) =>
        post<{ success: boolean }>("/api/assets/resolve-tag-conflicts", { resolutions }),
    getDirectoryTree: () => get<DirectoryTreeResponse>("/api/library/tree"),
    createDirectory: (relativePath: string) =>
        post<{ path: string }>("/api/library/create-directory", { relativePath }),
    renameDirectory: (relativePath: string, newName: string) =>
        post<{ path: string }>("/api/library/rename-directory", { relativePath, newName }),
    deleteDirectory: (relativePath: string) =>
        post<{ success: boolean }>("/api/library/delete-directory", { relativePath }),
    uploadAssets: async (files: File[], targetDir: string, keepFilename?: boolean, tags?: AssetTag[]) => {
        const formData = new FormData()
        files.forEach((f) => formData.append("files", f))
        formData.append("targetDir", targetDir)
        formData.append("keepFilename", String(keepFilename ?? false))
        if (tags && tags.length > 0) {
            formData.append("tags", JSON.stringify(tags))
        }
        const res = await fetch(API_BASE + "/api/assets/upload", {
            method: "POST",
            headers: buildHeaders(),
            body: formData,
        })
        if (!res.ok) throw new Error("Upload failed")
        return res.json() as Promise<UploadResult>
    },
    getAssets: (page: number, size: number, folder?: string, subfolders?: boolean, sort?: string) => {
        let url = `/api/assets?page=${page}&size=${size}`
        if (folder) url += `&folder=${encodeURIComponent(folder)}`
        if (subfolders !== undefined) url += `&subfolders=${subfolders}`
        if (sort) url += `&sort=${sort}`
        return get<PaginatedResponse<AssetDto>>(url)
    },
    getAsset: (id: string) => get<AssetDetailDto>(`/api/assets/${id}`),
    searchAssets: (query: string, page: number, size: number, folder?: string) =>
        get<PaginatedResponse<AssetDto>>(`/api/assets/search?q=${encodeURIComponent(query)}&page=${page}&size=${size}${folder ? `&folder=${encodeURIComponent(folder)}` : ""}`),
    updateTags: (id: string, tags: AssetTag[]) =>
        put<AssetDetailDto>(`/api/assets/${id}/tags`, { tags }),
    getTags: (page?: number, size?: number, search?: string) => {
        const params = new URLSearchParams()
        params.set("page", String(page ?? 1))
        params.set("size", String(size ?? 50))
        if (search) params.set("search", search)
        return get<TagGroupsResponse>(`/api/tags?${params.toString()}`)
    },
    moveAsset: (id: string, targetFolder: string) =>
        post<AssetDetailDto>(`/api/assets/${id}/move`, { targetFolder }),
    deleteAsset: (id: string) =>
        fetch(`${API_BASE}/api/assets/${id}`, { method: "DELETE", headers: buildHeaders() }).then((r) => {
            if (!r.ok) throw new Error("Delete failed")
        }),
    checkLibraryPath: (path: string) =>
        get<{ isLibrary: boolean; info?: LibraryInfo }>(`/api/library/check?path=${encodeURIComponent(path)}`),
    healthCheck: () => get<LibraryInfo>("/api/library/info"),
    getLibraries: () => get<LibraryInfo[]>("/api/libraries"),
    loadLibrary: (id: string) => post<LibraryInfo>(`/api/library/load/${id}`),
    getTagConflicts: () => get<TagConflict[]>("/api/assets/tag-conflicts"),
    removeLibrary: (id: string) =>
        fetch(`${API_BASE}/api/libraries/${id}`, { method: "DELETE", headers: buildHeaders() }).then((r) => {
            if (!r.ok) throw new Error("Remove failed")
        }),
    getDrives: () => get<ServerDrive[]>("/api/fs/drives"),
    browsePath: (path: string) => get<ServerBrowseResponse>(`/api/fs/browse?path=${encodeURIComponent(path)}`),
    categorizeTags: (changes: { tagValue: string; newType: string | null }[]) =>
        post<{ affectedAssets: number }>("/api/assets/categorize", { changes }),
    renameCategory: (oldType: string, newType: string) =>
        post<{ success: boolean }>("/api/assets/rename-category", { oldType, newType }),
    deleteCategory: (type: string) =>
        post<{ success: boolean }>("/api/assets/delete-category", { type }),
    renameTag: (oldValue: string, newValue: string) =>
        post<{ success: boolean }>("/api/assets/rename-tag", { oldValue, newValue }),
    deleteTag: (value: string) =>
        post<{ success: boolean }>("/api/assets/delete-tag", { value }),
    saveCategoryOrder: (order: string[]) =>
        post<{ success: boolean }>("/api/library/category-order", { order }),
    unlockLibrary: async (id: string, password: string) => {
        const result = await post<{ library: LibraryInfo; token: string }>("/api/library/unlock", { password });
        setToken(result.token);
        return result.library;
    },
    lockLibrary: () =>
        post<{ message: string }>("/api/library/lock"),
    getUnlockStatus: () =>
        get<{ unlocked: boolean; remainingSeconds: number }>("/api/library/unlock-status"),
    decryptLibrary: (password?: string) =>
        post<{ message: string; decryptedCount: number }>("/api/library/decrypt", { password }),
    encryptLibrary: (password: string) =>
        post<{ message: string; encryptedCount: number }>("/api/library/encrypt", { password }),
};
