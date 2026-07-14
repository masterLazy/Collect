export interface AssetTag {
    type: string | null;
    value: string;
}

export interface AssetDto {
    id: string;
    fileName: string;
    mimeType: string;
    fileSize: number;
    width: number;
    height: number;
    thumbnailUrl: string;
    importedAt: string;
    lastModified: string | null;
}

export interface AssetDetailDto {
    id: string;
    fileName: string;
    relativePath: string;
    fileSize: number;
    width: number;
    height: number;
    mimeType: string;
    tags: AssetTag[];
    importedAt: string;
    lastModified: string | null;
}

export interface PaginatedResponse<T> {
    items: T[];
    total: number;
    page: number;
    pageSize: number;
}

export interface TagGroupDto {
    type: string | null;
    total: number;
    tags: { value: string; count: number }[];
}

export interface TagGroupsResponse {
    groups: TagGroupDto[];
    totalGroups: number;
}

export interface LibraryInfo {
    id: string;
    name: string;
    path: string;
    assetCount: number;
    categoryOrder?: string[];
    isEncrypted?: boolean;
}

export interface DirectoryNode {
    name: string;
    path: string;
    assetCount: number;
    children: DirectoryNode[];
}

export interface DirectoryTreeResponse {
    root: DirectoryNode;
}

export interface UploadResult {
    added: number;
    errors: UploadError[];
}

export interface UploadError {
    fileName: string;
    reason: string;
}

export interface ServerDrive {
    name: string;
    path: string;
    label: string;
}

export interface ServerDirEntry {
    name: string;
    path: string;
}

export interface ServerBrowseResponse {
    path: string;
    dirs: ServerDirEntry[];
}

export interface TagConflict {
    tagValue: string;
    possibleTypes: string[];
}

export interface ScanResult {
    added: number;
    removed: number;
    total: number;
    tagConflicts: TagConflict[];
}
