using Collect.Core.Models;

namespace Collect.Core.Services;

/// <summary>
/// Manages library initialization and metadata.
/// </summary>
public interface ILibraryService
{
    /// <summary>
    /// Initialize a library at the given path, creating the .collect/ folder structure.
    /// </summary>
    Task<LibraryInfo> InitializeAsync(string path, string? name = null, bool useMd5 = false, bool parseTags = true);

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
}
