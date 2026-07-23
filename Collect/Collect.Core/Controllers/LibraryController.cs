using Collect.Core.Models;
using Collect.Core.Services;
using Microsoft.AspNetCore.Mvc;

namespace Collect.Core.Controllers;

[ApiController]
[Route("api/library")]
public class LibraryController : ControllerBase
{
    private readonly ILibraryService _libraryService;
    private readonly IAssetService _assetService;

    public LibraryController(ILibraryService libraryService, IAssetService assetService)
    {
        _libraryService = libraryService;
        _assetService = assetService;
    }

    /// <summary>
    /// POST /api/library/init
    /// Initialize a library at the given filesystem path with an optional display name
    /// and optional encryption password.
    /// When <paramref name="password"/> is provided, the library files are encrypted at rest
    /// using AES-256-GCM (key derived via PBKDF2).
    /// </summary>
    [HttpPost("init")]
    public async Task<IActionResult> Initialize([FromBody] InitRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Path))
            return BadRequest(new { error = "Path is required." });

        if (!Directory.Exists(request.Path))
            return BadRequest(new { error = $"Directory does not exist: {request.Path}" });

        var info = await _libraryService.InitializeAsync(request.Path, request.Name, request.Password);

        // Strip sensitive encryption data from response
        var sanitized = SanitizeLibraryInfo(info);

        return Ok(sanitized);
    }

    /// <summary>
    /// GET /api/library/info
    /// Get metadata about the current library.
    /// For encrypted libraries, sensitive fields (salt, verification hash) are excluded.
    /// </summary>
    [HttpGet("info")]
    public async Task<IActionResult> GetInfo()
    {
        var info = await _libraryService.GetInfoAsync();
        if (info is null)
            return NotFound(new { error = "Library not initialized." });

        var sanitized = SanitizeLibraryInfo(info);

        // For encrypted libraries that are not unlocked, mask sensitive metadata
        if (info.IsEncrypted && !_libraryService.IsLibraryUnlocked(GetUnlockToken()))
        {
            return Ok(new
            {
                info.Id,
                info.Version,
                info.Name,
                info.Path,
                info.CreatedAt,
                AssetCount = 0,
                info.CategoryOrder,
                info.IsEncrypted,
                Locked = true
            });
        }

        return Ok(sanitized);
    }

    private string? GetUnlockToken() =>
        Request.Headers.TryGetValue("X-Unlock-Token", out var values) ? values.FirstOrDefault() : null;

    /// <summary>
    /// POST /api/library/unlock
    /// Unlock an encrypted library with a password.
    /// Returns the LibraryInfo and a session token if successful, or 401 if the password is wrong.
    /// </summary>
    [HttpPost("unlock")]
    public async Task<IActionResult> Unlock([FromBody] UnlockRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Password))
            return BadRequest(new { error = "Password is required." });

        var (info, token) = await _libraryService.UnlockAsync(request.Password);
        if (info is null)
            return Unauthorized(new { error = "Invalid password." });

        // Invalidate asset cache so the next fetch re-scans with the decryption key,
        // correctly extracting image dimensions from encrypted files.
        _assetService.InvalidateCache();

        var sanitized = SanitizeLibraryInfo(info);
        return Ok(new { library = sanitized, token });
    }

    /// <summary>
    /// POST /api/library/lock
    /// Lock the current library by clearing the encryption key from memory.
    /// The library remains the current library, but assets cannot be accessed until re-unlocked.
    /// </summary>
    [HttpPost("lock")]
    public IActionResult Lock()
    {
        // Clear ALL sessions — not just the caller's token — so all devices are locked out.
        _libraryService.LockLibrary();
        return Ok(new { message = "Library locked." });
    }

    /// <summary>
    /// GET /api/library/unlock-status
    /// Check if the current library is unlocked.
    /// </summary>
    [HttpGet("unlock-status")]
    public async Task<IActionResult> GetUnlockStatus()
    {
        var token = GetUnlockToken();
        var (unlocked, remainingSeconds) = await _libraryService.GetUnlockStatusAsync(token);
        return Ok(new { unlocked, remainingSeconds });
    }

    /// <summary>
    /// POST /api/library/encrypt
    /// Encrypt all files in the current library with the given password.
    /// </summary>
    [HttpPost("encrypt")]
    public async Task<IActionResult> EncryptLibrary([FromBody] EncryptRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Password))
            return BadRequest(new { error = "Password is required." });

        try
        {
            var count = await _assetService.EncryptLibraryAsync(request.Password);
            return Ok(new { message = $"Library encrypted. {count} files processed.", encryptedCount = count });
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { error = ex.Message });
        }
    }

    /// <summary>
    /// POST /api/library/decrypt
    /// Decrypt all encrypted files in the current library and remove encryption.
    /// Accepts an optional password for repair decryption (when library.json says not encrypted
    /// but files are still encrypted, or when the unlock session has expired).
    /// </summary>
    [HttpPost("decrypt")]
    public async Task<IActionResult> DecryptLibrary([FromBody] DecryptRequest? request)
    {
        try
        {
            var password = request?.Password;
            var count = await _assetService.DecryptLibraryAsync(password);
            return Ok(new { message = $"Library decrypted. {count} files processed.", decryptedCount = count });
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { error = ex.Message });
        }
    }

    /// <summary>
    /// Strip sensitive encryption fields (Salt, VerificationHash) from the response.
    /// </summary>
    private static object SanitizeLibraryInfo(LibraryInfo info)
    {
        return new
        {
            info.Id,
            info.Version,
            info.Name,
            info.Path,
            info.CreatedAt,
            info.AssetCount,
            info.CategoryOrder,
            info.IsEncrypted
        };
    }

    /// <summary>
    /// GET /api/library/tree
    /// Get the directory tree of the library.
    /// </summary>
    [HttpGet("tree")]
    public async Task<IActionResult> GetTree()
    {
        if (_libraryService.IsEncryptedLibrary() && !_libraryService.IsLibraryUnlocked(GetUnlockToken()))
            return StatusCode(403, new { error = "Library is locked. Please unlock first." });

        var tree = await _libraryService.GetDirectoryTreeAsync();
        return Ok(new { root = tree });
    }

    /// <summary>
    /// POST /api/library/create-directory
    /// Create a new directory under the library.
    /// </summary>
    [HttpPost("create-directory")]
    public async Task<IActionResult> CreateDirectory([FromBody] CreateDirectoryRequest request)
    {
        if (_libraryService.IsEncryptedLibrary() && !_libraryService.IsLibraryUnlocked(GetUnlockToken()))
            return StatusCode(403, new { error = "Library is locked. Please unlock first." });

        var path = await _libraryService.CreateDirectoryAsync(request.RelativePath);
        return Ok(new { path });
    }

    /// <summary>
    /// POST /api/library/rename-directory
    /// Rename a directory under the library.
    /// </summary>
    [HttpPost("rename-directory")]
    public async Task<IActionResult> RenameDirectory([FromBody] RenameDirectoryRequest request)
    {
        if (_libraryService.IsEncryptedLibrary() && !_libraryService.IsLibraryUnlocked(GetUnlockToken()))
            return StatusCode(403, new { error = "Library is locked. Please unlock first." });

        try
        {
            var path = await _libraryService.RenameDirectoryAsync(request.RelativePath, request.NewName);
            return Ok(new { path });
        }
        catch (DirectoryNotFoundException ex)
        {
            return NotFound(new { error = ex.Message });
        }
        catch (IOException ex)
        {
            return Conflict(new { error = ex.Message });
        }
    }

    /// <summary>
    /// POST /api/library/delete-directory
    /// Delete a directory by moving its contents to the parent, then removing the empty directory.
    /// </summary>
    [HttpPost("delete-directory")]
    public async Task<IActionResult> DeleteDirectory([FromBody] DeleteDirectoryRequest request)
    {
        if (_libraryService.IsEncryptedLibrary() && !_libraryService.IsLibraryUnlocked(GetUnlockToken()))
            return StatusCode(403, new { error = "Library is locked. Please unlock first." });

        var success = await _libraryService.DeleteDirectoryAsync(request.RelativePath);
        if (!success)
            return NotFound(new { error = $"Directory not found: {request.RelativePath}" });

        return Ok(new { success = true });
    }

    /// <summary>
    /// GET /api/library/check?path=...
    /// Check if a given path has an initialized library (looks for .collect/library.json).
    /// Returns the LibraryInfo if found, or 404 with { isLibrary: false }.
    /// Sensitive encryption fields are excluded from the response.
    /// </summary>
    [HttpGet("check")]
    public async Task<IActionResult> CheckPath([FromQuery] string path)
    {
        if (string.IsNullOrWhiteSpace(path))
            return BadRequest(new { error = "Path is required." });
        if (!Directory.Exists(path))
            return BadRequest(new { error = "Directory does not exist." });

        var info = await _libraryService.CheckPathAsync(path);
        if (info is null)
            return NotFound(new { isLibrary = false, path });
        var sanitized = SanitizeLibraryInfo(info);
        return Ok(new { isLibrary = true, info = sanitized });
    }

    /// <summary>
    /// POST /api/library/category-order
    /// Save the display order of tag categories.
    /// Body: { "order": ["画师", "人物", "作品", ...] }
    /// </summary>
    [HttpPost("category-order")]
    public async Task<IActionResult> SetCategoryOrder([FromBody] CategoryOrderRequest request)
    {
        if (_libraryService.IsEncryptedLibrary() && !_libraryService.IsLibraryUnlocked(GetUnlockToken()))
            return StatusCode(403, new { error = "Library is locked. Please unlock first." });

        await _libraryService.SetCategoryOrderAsync(request.Order);
        return Ok(new { success = true });
    }

    /// <summary>
    /// GET /api/library/recent
    /// Get the list of recent libraries from persistent storage.
    /// </summary>
    [HttpGet("recent")]
    public async Task<IActionResult> GetRecentLibraries()
    {
        var libraries = await _libraryService.GetRecentLibrariesAsync();
        return Ok(libraries);
    }

    /// <summary>
    /// POST /api/library/recent
    /// Save/update the list of recent libraries to persistent storage.
    /// </summary>
    [HttpPost("recent")]
    public async Task<IActionResult> SaveRecentLibraries([FromBody] List<RecentLibraryEntry> libraries)
    {
        await _libraryService.SaveRecentLibrariesAsync(libraries);
        return Ok(new { message = "Recent libraries saved." });
    }

    /// <summary>
    /// GET /api/libraries
    /// Get all registered libraries from the persistent registry.
    /// Sensitive encryption fields (salt, verification hash) are excluded.
    /// </summary>
    [HttpGet("/api/libraries")]
    public async Task<IActionResult> GetLibraries()
    {
        var libraries = await _libraryService.GetLibrariesAsync();
        var sanitized = libraries.Select(SanitizeLibraryInfo).ToList();
        return Ok(sanitized);
    }

    /// <summary>
    /// POST /api/library/load/{id}
    /// Load a library by its registry ID and set it as the current library.
    /// For encrypted libraries, sensitive fields are excluded from the response.
    /// </summary>
    [HttpPost("load/{id}")]
    public async Task<IActionResult> LoadById(string id)
    {
        var info = await _libraryService.LoadByIdAsync(id);
        if (info is null)
            return NotFound(new { error = $"Library '{id}' not found." });
        var sanitized = SanitizeLibraryInfo(info);
        return Ok(sanitized);
    }

    /// <summary>
    /// DELETE /api/libraries/{id}
    /// Remove a library from the registry by ID. Does not delete files on disk.
    /// </summary>
    [HttpDelete("/api/libraries/{id}")]
    public async Task<IActionResult> RemoveLibrary(string id)
    {
        var removed = await _libraryService.RemoveLibraryAsync(id);
        if (!removed)
            return NotFound(new { error = $"Library '{id}' not found." });
        return Ok(new { message = "Library removed from registry." });
    }
}

public class InitRequest
{
    public string Path { get; set; } = string.Empty;
    public string? Name { get; set; }
    public string? Password { get; set; }
}

public class UnlockRequest
{
    public string Password { get; set; } = string.Empty;
}

public class CreateDirectoryRequest
{
    public string RelativePath { get; set; } = string.Empty;
}

public class RenameDirectoryRequest
{
    public string RelativePath { get; set; } = "";
    public string NewName { get; set; } = "";
}

public class DeleteDirectoryRequest
{
    public string RelativePath { get; set; } = "";
}

public class CategoryOrderRequest
{
    public List<string> Order { get; set; } = new();
}

public class DecryptRequest
{
    public string? Password { get; set; }
}

public class EncryptRequest
{
    public string Password { get; set; } = string.Empty;
}
