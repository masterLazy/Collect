import type { AssetDetailDto, AssetDto, AssetTag, DirectoryTreeResponse, LibraryInfo, PaginatedResponse, TagGroupsResponse, UploadResult } from "../types";

const API_BASE = "http://localhost:5000";

async function get<T>(url: string): Promise<T> {
    const response = await fetch(`${API_BASE}${url}`);
    if (!response.ok) {
        throw new Error(`API Error: ${response.status} ${response.statusText}`);
    }
    return response.json();
}

async function post<T>(url: string, body?: unknown): Promise<T> {
    const response = await fetch(`${API_BASE}${url}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
    if (!response.ok) {
        throw new Error(`API Error: ${response.status} ${response.statusText}`);
    }
    return response.json();
}

export const api = {
    initLibrary: (path: string, name: string, options?: { useMd5?: boolean; parseTags?: boolean }) =>
        post<LibraryInfo>("/api/library/init", { path, name, useMd5: options?.useMd5 ?? false, parseTags: options?.parseTags ?? true }),
    getLibraryInfo: () => get<LibraryInfo>("/api/library/info"),
    scanAssets: () => post<{ added: number; removed: number; total: number }>("/api/assets/scan"),
    getDirectoryTree: () => get<DirectoryTreeResponse>("/api/library/tree"),
    createDirectory: (relativePath: string) =>
        post<{ path: string }>("/api/library/create-directory", { relativePath }),
    uploadAssets: async (files: File[], targetDir: string, parseTags: boolean = true) => {
        const formData = new FormData()
        files.forEach((f) => formData.append("files", f))
        formData.append("targetDir", targetDir)
        formData.append("parseTags", String(parseTags))
        const res = await fetch("http://localhost:5000/api/assets/upload", {
            method: "POST",
            body: formData,
        })
        if (!res.ok) throw new Error("Upload failed")
        return res.json() as Promise<UploadResult>
    },
    getAssets: (page: number, size: number, folder?: string) =>
        get<PaginatedResponse<AssetDto>>(`/api/assets?page=${page}&size=${size}${folder ? `&folder=${encodeURIComponent(folder)}` : ""}`),
    getAsset: (id: string) => get<AssetDetailDto>(`/api/assets/${id}`),
    searchAssets: (query: string, page: number, size: number) =>
        get<PaginatedResponse<AssetDto>>(`/api/assets/search?q=${encodeURIComponent(query)}&page=${page}&size=${size}`),
    updateTags: (id: string, tags: AssetTag[]) =>
        put<AssetDetailDto>(`/api/assets/${id}/tags`, { tags }),
    getTags: (page?: number, size?: number, search?: string) => {
        const params = new URLSearchParams()
        params.set("page", String(page ?? 1))
        params.set("size", String(size ?? 50))
        if (search) params.set("search", search)
        return get<TagGroupsResponse>(`/api/tags?${params.toString()}`)
    },
};
