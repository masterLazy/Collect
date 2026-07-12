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
}

export interface AssetDetailDto {
    id: string;
    fileName: string;
    storageFileName: string;
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
    name: string;
    path: string;
    totalAssets: number;
    useMd5: boolean;
    parseTags: boolean;
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
