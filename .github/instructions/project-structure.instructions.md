---
description: "Project overview for Collect — multimedia asset manager. Use when: understanding the full-stack architecture, navigating between backend/frontend layers, deciding which project or service to modify, finding relevant files for a feature, or onboarding to the codebase. Covers solution structure, API routes, DI registrations, component hierarchy, encryption support, and filesystem layout."
applyTo: "**"
---

# Collect — Project Overview

> A tag-based multimedia asset manager with a local ASP.NET Core backend, SkiaSharp thumbnails, optional library encryption, and a React + Chakra UI v3 gallery experience.

```
Repository root: d:\Projects\Collect
Solution:        d:\Projects\Collect\Collect\Collect.slnx
```

## Quick Start

```bash
# Backend (runs on http://localhost:5000, Swagger at /swagger)
cd d:\Projects\Collect\Collect
dotnet run --project Collect.Core

# Frontend (runs on http://localhost:3000)
cd d:\Projects\Collect\chakra-app
npm install
npm start
```

## Solution Structure (3 projects)

| Project | Path | Stack |
|---|---|---|
| `Collect.Core` | `Collect/Collect.Core/` | ASP.NET Core 10, controller-based API, SkiaSharp, Swashbuckle |
| `Collect.Wpf` | `Collect/Collect.Wpf/` | .NET 10 WPF desktop app (skeleton only) |
| `chakra-app` | `chakra-app/` | React 18 + Chakra UI v3 + React Router 7 + next-themes |

---

## Backend — Collect.Core

### DI Registration (all Singleton)

| Interface | Implementation | Responsibility |
|---|---|---|
| `IAssetService` | `AssetService` | CRUD, scan/reconcile, tag parsing, search, thumbnail paths, clipboard image, move, rename, categorize, conflict resolution, upload, encryption workflows |
| `ILibraryService` | `LibraryService` | Library init/metadata, directory tree CRUD, recent libraries, registry persistence, encryption state, category order |
| `ITagService` | `TagService` | Aggregates tags from all assets and returns paginated grouped responses |
| `IThumbnailService` | `ThumbnailService` | WebP thumbnail generation (400px max width, quality 85), content-hash deduplication via MD5(path + size + last-write-time), orphan cleanup |
| `IEncryptionService` | `EncryptionService` | AES-256-GCM encryption/decryption helpers for library files |

**Key**: All services are **Singleton**. `AssetService` holds an in-memory `List<Asset>` and relies on a scan-based model rather than a database. Concurrency is guarded by `SemaphoreSlim(1, 1)`.

### Controllers & Route Prefixes

| Controller | File | Route Prefix | Key Endpoints |
|---|---|---|---|
| `AssetsController` | `Controllers/AssetsController.cs` | `api/assets` | `GET /`, `GET /{id}`, `GET /{id}/thumbnail`, `GET /{id}/image`, `GET /search`, `GET /tag-conflicts`, `GET /{id}/clipboard-image`, `POST /scan`, `POST /upload`, `PUT /{id}/tags`, `POST /{id}/move`, `POST /resolve-tag-conflicts`, `POST /categorize`, `POST /rename-category`, `POST /delete-category`, `POST /rename-tag`, `POST /delete-tag`, `DELETE /{id}` |
| `LibraryController` | `Controllers/LibraryController.cs` | `api/library` + `api/libraries` | `POST /init`, `GET /info`, `POST /unlock`, `POST /lock`, `GET /unlock-status`, `POST /encrypt`, `POST /decrypt`, `GET /tree`, `POST /create-directory`, `POST /rename-directory`, `POST /delete-directory`, `GET /check`, `POST /category-order`, `GET /recent`, `POST /recent`, `GET /api/libraries`, `POST /load/{id}`, `DELETE /api/libraries/{id}` |
| `FsController` | `Controllers/FsController.cs` | `api/fs` | `GET /drives`, `GET /browse?path=...` |
| `TagsController` | `Controllers/TagsController.cs` | `api/tags` | `GET /` (paginated, grouped by type) |

### Models and DTOs

| Model / DTO | Key Properties |
|---|---|
| `Asset` | `Id`, `FileName`, `RelativePath`, `FileSize`, `Width`, `Height`, `MimeType`, `Tags`, `ImportedAt`, `LastModified` |
| `AssetTag` | `Type` (nullable, e.g. "画师"), `Value` (e.g. "yaungpeng") |
| `LibraryInfo` | `Id`, `Version`, `Name`, `Path`, `CreatedAt`, `AssetCount`, `CategoryOrder`, `IsEncrypted`, `Salt`, `VerificationHash` |
| `DirectoryNode` | `Name`, `Path`, `AssetCount`, `Children` (recursive tree) |
| `UploadResult` | `Added`, `Errors`, `Skipped` |
| `AssetDto` | List view fields used by the gallery |
| `AssetDetailDto` | Detail view fields including `Tags` and image/thumbnail URLs |
| `PaginatedResponse<T>` | `Items`, `Total`, `Page`, `PageSize` |
| `TagGroupDto` + `TagGroupsResponse` | Grouped tag browser payloads |
| `SearchResultDto` | Search results payload used by the search UI |

### Filesystem Layout (per library)

```text
Library Root/
├── image1.jpg                      ← filename encodes tags: [画师]name-人物-style
├── subfolder/
│   └── image2.png
└── .collect/
    ├── library.json                ← LibraryInfo metadata (persisted by LibraryService)
    └── thumbnails/
        └── <md5hash>.webp          ← SkiaSharp thumbnails (400px max width)
```

### Tag Naming Convention and File-Name-Driven Tag Model

This project treats tags as a file-name-driven metadata model. Tags are not stored in a separate database table; instead, they are derived from the filename and persisted by renaming the file on disk.

#### 1. Parsing rules

When a library is scanned, the backend parses each filename into a list of `AssetTag` objects using the following rules:

- Segments are split by `-`
- A segment like `[画师]yaungpeng` becomes `{ Type: "画师", Value: "yaungpeng" }`
- A plain segment like `人物` becomes `{ Type: null, Value: "人物" }`
- Pure numeric segments are ignored to avoid misinterpreting version numbers or IDs as tags
- The parsed tags are attached to the corresponding `Asset` model

Example:
- `[画师]yaungpeng-人物-伪厚涂.jpg` → tags include a categorized tag `画师/yaungpeng`, an uncategorized tag `人物`, and another uncategorized tag `伪厚涂`

#### 2. Save-time rename behavior

When a user edits tags in the sidebar, the change is not merely an in-memory update. The backend will:

- reorder tags according to the current category order (categorized tags first, uncategorized last)
- rebuild the new filename from the tag list
- compare it with the existing filename
- rename the physical file on disk via `File.Move` when needed
- delete the old thumbnail and let the new one be recreated as appropriate

If the target filename already exists, the system will try numeric suffixes such as `-01`, `-02` to avoid overwriting existing files. If a rename fails, the in-memory tag state is reverted so disk and memory stay consistent.

#### 3. Scan-time normalization mechanism

During scan, the backend does more than just parse tags. It also runs a normalization pass:

- it detects whether the same tag value appears with multiple possible types across the library
- it records unresolved conflicts for user review
- if an untyped tag has exactly one possible type elsewhere in the library, it auto-converts that tag into a typed one
- it reorders tags and re-serializes them back into the filename so the disk representation stays consistent with the current tag model

This is why a scan is not just an index refresh: it can actively rewrite filenames to normalize tag structure and keep the filesystem aligned with the app’s tag semantics.

#### 4. Search semantics

Search is implemented in the backend through `GET /api/assets/search` and `AssetService.SearchAsync`.

The query supports two layers of matching:

- tag-based search via the `tags:` prefix, e.g. `tags:人物+画师`
- plain text search against the filename

The `tags:` prefix is parsed into one or more required tag values. Assets must satisfy all specified tags (AND logic). After the tag filter is applied, any remaining text is used for filename substring matching.

#### 5. Frontend autocomplete and suggestion behavior

The frontend search bar and sidebar tag editor both use the same concept of tag suggestion:

- when the user types `tags:` or continues typing a tag segment, the UI requests tag suggestions from the backend
- when the user types bracketed category syntax like `[画师]` or `[`, the UI can suggest category names or values for the selected category
- suggestions are filtered by the current input, the already selected values, and the category order
- the editor also preserves type information when a user selects a suggested value, so a plain value can still be inserted as a categorized tag when appropriate

#### 6. Why this matters architecturally

- The system is intentionally filesystem-first rather than database-first
- Tag changes are real file operations, not just UI mutations
- Search, autocomplete, tag browsing, and sidebar editing all depend on the same filename-based tag model
- The filename is treated as the source of truth for tag persistence and tag semantics

### Key Architectural Rules

- **No database** — asset state is inferred from the filesystem on each scan. Use `POST /api/assets/scan` after file changes.
- **Tag changes rename files** — `UpdateTagsAsync` rebuilds the filename and calls `File.Move`.
- **Scan-time normalization** — `NormalizeTagsAsync` auto-converts untyped tags when possible, records conflicts, and re-syncs filenames.
- **Thumbnails are content-hash keyed** — MD5 of `filePath + fileSize + lastWriteTimeTicks`. Identical content reuses the thumbnail; orphan cleanup runs during scan.
- **Upload supports filename preservation** — `POST /api/assets/upload` accepts `keepFilename=true` to preserve the original filename instead of using only the extension.
- **Encrypted libraries** — unlock state is tracked via an `X-Unlock-Token` header, and files can be encrypted/decrypted in place.
- **Library metadata is persisted** — recent libraries, category order, and registry entries are stored through `LibraryService`.
- **Tag management is global** — category/tag rename/delete operations update all matching assets across the library.

---

## Frontend — chakra-app

### Routing

| Route | Component | Description |
|---|---|---|
| `/` | `HomePage` | Connection check, library manager, and redirect to an active library |
| `/:libraryId` | `LibraryPage` | Main browsing experience with gallery, tree, sidebar, and top bar |
| `/:libraryId/root/*` | `LibraryPage` | Root-folder browsing variant |
| `/:libraryId/view/:assetId` | `ImageViewerPage` | Full-screen preview page |

### Component Hierarchy

```text
<Provider>                    (src/components/ui/provider.tsx — ChakraProvider + ThemeProvider)
  <BrowserRouter>
    <App>
      <HomePage>
        └── <LibraryManager>    (library init/open/recent library UI)
      <LibraryPage>           (main browsing page)
        ├── <TopBar>          (search, filter, add, home, rescan, library name)
        │   ├── <SearchInput> (search by text/tags)
        │   └── <TagFilterModal> (tag browser, category management)
        ├── <DirectoryTree>   (folder navigation with context menus)
        ├── <MasonryGrid>     (waterfall gallery with infinite scroll)
        │   └── <AssetCard>   (thumbnail card, loading/error states)
        └── <Sidebar>         (asset detail, preview, tags, metadata, actions)
            └── <TagEditor>   (tag add/remove/autocomplete)
<other components>
  ├── <AddAssetDialog>        (drag-drop upload with target dir picker and keepFilename toggle)
  ├── <TagConflictDialog>     (resolve tag type conflicts)
  ├── <ServerPathPicker>      (server-side filesystem browser)
  ├── <ImageViewerPage>       (fullscreen image preview)
  └── <CustomToast>           (toast notification hook)
```

### API Endpoints Consumed by Frontend

All calls are centralized in `src/services/api.ts` and target `http://localhost:5000`.

| Category | Endpoints |
|---|---|
| **Library** | `GET /api/library/info`, `POST /api/library/init`, `GET /api/library/check`, `GET /api/library/tree`, `POST /api/library/create-directory`, `POST /api/library/rename-directory`, `POST /api/library/delete-directory`, `POST /api/library/load/{id}`, `GET /api/libraries`, `DELETE /api/libraries/{id}`, `GET /api/library/recent`, `POST /api/library/recent`, `POST /api/library/unlock`, `POST /api/library/lock`, `GET /api/library/unlock-status`, `POST /api/library/encrypt`, `POST /api/library/decrypt`, `POST /api/library/category-order` |
| **Assets** | `POST /api/assets/scan`, `GET /api/assets`, `GET /api/assets/search`, `GET /api/assets/{id}`, `GET /api/assets/{id}/thumbnail`, `GET /api/assets/{id}/image`, `GET /api/assets/{id}/clipboard-image`, `PUT /api/assets/{id}/tags`, `POST /api/assets/{id}/move`, `DELETE /api/assets/{id}`, `POST /api/assets/upload`, `GET /api/assets/tag-conflicts`, `POST /api/assets/resolve-tag-conflicts`, `POST /api/assets/categorize`, `POST /api/assets/rename-category`, `POST /api/assets/delete-category`, `POST /api/assets/rename-tag`, `POST /api/assets/delete-tag` |
| **Tags** | `GET /api/tags` |
| **Filesystem** | `GET /api/fs/drives`, `GET /api/fs/browse?path=...` |

### TypeScript Types

All types are defined in `src/types.ts` and mirror the backend DTOs closely.

### Key Frontend Patterns

- **Chakra UI v3** — uses `@chakra-ui/react` v3 with `next-themes` for theme. Import from `@chakra-ui/react`.
- **Custom toast system** — `CustomToast` avoids Chakra v3 `toaster.create()` API issues.
- **Masonry layout** — `MasonryGrid` uses `IntersectionObserver` for infinite scroll and progressive loading.
- **Tag filter** — uses `tags:keyword1+keyword2` query prefixes in `SearchInput`.
- **Upload flow** — `AddAssetDialog` supports drag/drop, target-folder selection, and opt-in filename preservation.
- **Library security** — unlock state is kept in `sessionStorage` via the `X-Unlock-Token` header.

---

## WPF Desktop — Collect.Wpf

Skeleton project only. `MainWindow.xaml` contains an empty `Grid` (800×450) and no UI or functionality is implemented yet.

---

## Common Task Locations

| Task | Backend File(s) | Frontend File(s) |
|---|---|---|
| Asset scanning / file detection | `Services/AssetService.cs` (ScanAsync) | — |
| Thumbnail generation / cleanup | `Services/ThumbnailService.cs` | — |
| Tag editing / file rename | `Services/AssetService.cs` (UpdateTagsAsync) | `components/TagEditor.tsx` |
| Search / filtering | `Services/AssetService.cs` (SearchAsync) | `components/SearchInput.tsx` |
| Folder navigation | `Services/LibraryService.cs` | `components/DirectoryTree.tsx` |
| Library CRUD / registry / recent libs | `Controllers/LibraryController.cs`, `Services/LibraryService.cs` | `components/LibraryManager.tsx` |
| Upload | `Services/AssetService.cs` (UploadAssetsAsync) | `components/AddAssetDialog.tsx` |
| Tag browser / category management | `Services/TagService.cs`, `Services/AssetService.cs` | `components/TagFilterModal.tsx` |
| Sidebar / asset detail | — | `components/Sidebar.tsx` |
| Gallery grid | — | `components/MasonryGrid.tsx` |
| Image viewer | — | `components/ImageViewerPage.tsx` |
| API client | — | `services/api.ts` |
| Library metadata persistence | `Services/LibraryService.cs` | — |
| Encryption / unlock workflow | `Controllers/LibraryController.cs`, `Services/AssetService.cs`, `Services/EncryptionService.cs` | — |
| Error handling | `Middleware/ErrorHandlingMiddleware.cs` | — |
