export interface PaletteColor {
    hex: string;
    proportion: number;
}

export interface ColorPalette {
    colors: PaletteColor[];
}

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
    /** Total number of boosts (up-votes) this asset has received. */
    boostCount: number;
    /** True when today's boost for this asset has already been used. */
    boostedToday: boolean;
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
    palette?: ColorPalette | null;
    importedAt: string;
    lastModified: string | null;
    /** Server-relative URL including the libraryId query parameter. */
    thumbnailUrl?: string;
    /** Server-relative URL including the libraryId query parameter. */
    imageUrl?: string;
    /** Total number of boosts (up-votes) this asset has received. */
    boostCount: number;
    /** True when today's boost for this asset has already been used. */
    boostedToday: boolean;
}

/** Result of a boost (up-vote) request for a single asset. */
export interface BoostResultDto {
    assetId: string;
    count: number;
    boostedToday: boolean;
    /** True when the asset had already been boosted today, so the count did not change. */
    alreadyBoosted: boolean;
    /** True when the stored boost state actually changed (false for a no-op call). */
    changed: boolean;
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

/** One tag plus a randomly sampled asset, used by the Explore view. */
export interface TagExploreItemDto {
    value: string;
    count: number;
    assetId: string;
    /** Server-relative URL that already carries the libraryId query parameter. */
    thumbnailUrl: string;
    width: number;
    height: number;
}

export interface TagExploreGroupDto {
    type: string | null;
    tags: TagExploreItemDto[];
}

export interface TagExploreResponse {
    groups: TagExploreGroupDto[];
    totalTags: number;
    truncated: boolean;
}

export interface LibraryInfo {
    id: string;
    name: string;
    path: string;
    assetCount: number;
    categoryOrder?: string[];
    isEncrypted?: boolean;
    encryptFileNames?: boolean;
    /** Persisted gallery layout: "masonry" | "grid". */
    viewMode?: string | null;
    /** Persisted sort order: "newest" | "name" | "random" | "boosts". */
    sortMode?: string | null;
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
