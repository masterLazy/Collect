using Collect.Core.Models;

namespace Collect.Core.Services;

/// <summary>
/// Manages library initialization and metadata.
/// </summary>
public interface ILibraryService
{
    /// <summary>
    /// Initialize a library at the given path, creating the .collect/ folder structure.
    /// If a library already exists at that path, loads the existing settings instead.
    /// </summary>
    Task<LibraryInfo> InitializeAsync(string path, string? name = null);

    /// <summary>
    /// Check if a given path has an initialized library (looks for .collect/library.json).
    /// Returns the LibraryInfo if found, or null if not.
    /// </summary>
    Task<LibraryInfo?> CheckPathAsync(string path);

    /// <summary>
    /// Get current library metadata.
    /// </summary>
    Task<LibraryInfo?> GetInfoAsync();

    /// <summary>
    /// Get the configured library root path.
    /// </summary>
    string? GetLibraryPath();

    /// <summary>
    /// Get the directory tree of the library.
    /// </summary>
    Task<DirectoryNode> GetDirectoryTreeAsync();

    /// <summary>
    /// Create a new directory under the library.
    /// </summary>
    Task<string> CreateDirectoryAsync(string relativePath);

    /// <summary>
    /// Rename a directory under the library. Returns the new relative path.
    /// </summary>
    Task<string> RenameDirectoryAsync(string oldRelativePath, string newName);

    /// <summary>
    /// Delete a directory by moving its contents to the parent, then removing the empty directory.
    /// Returns true if the directory was successfully deleted.
    /// </summary>
    Task<bool> DeleteDirectoryAsync(string relativePath);

    /// <summary>
    /// Get the list of recent libraries from persistent storage.
    /// </summary>
    Task<List<RecentLibraryEntry>> GetRecentLibrariesAsync();

    /// <summary>
    /// Save the list of recent libraries to persistent storage.
    /// </summary>
    Task SaveRecentLibrariesAsync(List<RecentLibraryEntry> libraries);

    /// <summary>
    /// Update the AssetCount in the library's library.json and the registry.
    /// </summary>
    Task UpdateAssetCountAsync(int count);

    /// <summary>
    /// Get the custom display order for tag categories, or null if not set.
    /// </summary>
    Task<List<string>?> GetCategoryOrderAsync();

    /// <summary>
    /// Set the custom display order for tag categories.
    /// </summary>
    Task SetCategoryOrderAsync(List<string> order);

    /// <summary>
    /// Get all registered libraries from the persistent registry.
    /// </summary>
    Task<List<LibraryInfo>> GetLibrariesAsync();

    /// <summary>
    /// Remove a library from the registry by ID. Does not delete files on disk.
    /// Returns true if the library was found and removed.
    /// </summary>
    Task<bool> RemoveLibraryAsync(string id);

    /// <summary>
    /// Load a library by its registry ID, set it as the current library, and return its info.
    /// Returns null if the ID is not found in the registry.
    /// </summary>
    Task<LibraryInfo?> LoadByIdAsync(string id);
}
