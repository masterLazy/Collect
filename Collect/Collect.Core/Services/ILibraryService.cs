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
    /// When <paramref name="password"/> is provided, the library is encrypted at rest
    /// using AES-256-GCM (files are encrypted with the derived key).
    /// When <paramref name="encryptFileNames"/> is true (only meaningful with a password),
    /// the library is created with on-disk file-name encryption enabled.
    /// </summary>
    Task<LibraryInfo> InitializeAsync(string path, string? name = null, string? password = null);

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
    /// Get the current library's ID by reading .collect/library.json.
    /// Returns null if no library path is set or the file doesn't exist.
    /// </summary>
    string? GetLibraryId();

    /// <summary>
    /// Resolve a library ID (full or short prefix) to its filesystem path.
    /// </summary>
    Task<string?> GetPathByIdAsync(string id);

    /// <summary>
    /// Resolve a library ID (full or short prefix) to its filesystem path (sync).
    /// </summary>
    string? GetPathById(string id);

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
    /// Apply a mutation to library.json under a file lock.
    /// The action receives the current LibraryInfo and should mutate it in place.
    /// The updated info is then written back to disk.
    /// </summary>
    Task UpdateLibraryInfoAsync(Action<LibraryInfo> updateAction);

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
    /// If the library is encrypted, the encryption key is cleared (forces re-unlock).
    /// </summary>
    Task<LibraryInfo?> LoadByIdAsync(string id);

    /// <summary>
    /// Unlock an encrypted library with the given password.
    /// Returns (info, token) where info is the <see cref="LibraryInfo"/> if successful
    /// (or null if the password is incorrect), and token is a device-specific unlock session token.
    /// The encryption key is held in memory for the duration of the session (5 minutes).
    /// </summary>
    Task<(LibraryInfo? Info, string? Token)> UnlockAsync(string password);

    /// <summary>
    /// Check if the current library is unlocked and get remaining unlock time.
    /// When token is provided, checks that specific session; otherwise checks any valid session.
    /// </summary>
    Task<(bool Unlocked, int RemainingSeconds)> GetUnlockStatusAsync(string? token = null);

    /// <summary>
    /// Check if the current library is encrypted.
    /// </summary>
    bool IsEncryptedLibrary();

    /// <summary>
    /// Check if the current library encrypts on-disk file names.
    /// </summary>
    bool EncryptsFileNames();

    /// <summary>
    /// Check if the current library is unlocked (encryption key is available in memory).
    /// When token is provided, checks that specific session; otherwise checks any valid session.
    /// </summary>
    bool IsLibraryUnlocked(string? token = null);

    /// <summary>
    /// Get the current encryption key, or null if the library is not encrypted or not unlocked.
    /// When token is provided, returns the key for that specific session; otherwise returns any valid key.
    /// </summary>
    byte[]? GetEncryptionKey(string? token = null);

    /// <summary>
    /// Lock the library by clearing the encryption key from memory.
    /// When token is provided, only that session is locked; otherwise all sessions are cleared.
    /// The library stays as the current library but assets cannot be accessed until re-unlocked.
    /// </summary>
    void LockLibrary(string? token = null);

    /// <summary>
    /// Get all encryption keys that have been created in this session (for repair decryption).
    /// </summary>
    IEnumerable<byte[]> GetAllKnownKeys();
}
