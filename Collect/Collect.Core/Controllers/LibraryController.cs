using Collect.Core.Models;
using Collect.Core.Services;
using Microsoft.AspNetCore.Mvc;

namespace Collect.Core.Controllers;

[ApiController]
[Route("api/library")]
public class LibraryController : ControllerBase
{
    private readonly ILibraryService _libraryService;

    public LibraryController(ILibraryService libraryService)
    {
        _libraryService = libraryService;
    }

    /// <summary>
    /// POST /api/library/init
    /// Initialize a library at the given filesystem path with an optional display name.
    /// </summary>
    [HttpPost("init")]
    public async Task<IActionResult> Initialize([FromBody] InitRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Path))
            return BadRequest(new { error = "Path is required." });

        if (!Directory.Exists(request.Path))
            return BadRequest(new { error = $"Directory does not exist: {request.Path}" });

        var info = await _libraryService.InitializeAsync(request.Path, request.Name);
        return Ok(info);
    }

    /// <summary>
    /// GET /api/library/info
    /// Get metadata about the current library.
    /// </summary>
    [HttpGet("info")]
    public async Task<IActionResult> GetInfo()
    {
        var info = await _libraryService.GetInfoAsync();
        if (info is null)
            return NotFound(new { error = "Library not initialized." });

        return Ok(info);
    }

    /// <summary>
    /// GET /api/library/tree
    /// Get the directory tree of the library.
    /// </summary>
    [HttpGet("tree")]
    public async Task<IActionResult> GetTree()
    {
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
        var success = await _libraryService.DeleteDirectoryAsync(request.RelativePath);
        if (!success)
            return NotFound(new { error = $"Directory not found: {request.RelativePath}" });

        return Ok(new { success = true });
    }

    /// <summary>
    /// GET /api/library/check?path=...
    /// Check if a given path has an initialized library (looks for .collect/library.json).
    /// Returns the LibraryInfo if found, or 404 with { isLibrary: false }.
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
        return Ok(new { isLibrary = true, info });
    }

    /// <summary>
    /// POST /api/library/category-order
    /// Save the display order of tag categories.
    /// Body: { "order": ["画师", "人物", "作品", ...] }
    /// </summary>
    [HttpPost("category-order")]
    public async Task<IActionResult> SetCategoryOrder([FromBody] CategoryOrderRequest request)
    {
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
    /// </summary>
    [HttpGet("/api/libraries")]
    public async Task<IActionResult> GetLibraries()
    {
        var libraries = await _libraryService.GetLibrariesAsync();
        return Ok(libraries);
    }

    /// <summary>
    /// POST /api/library/load/{id}
    /// Load a library by its registry ID and set it as the current library.
    /// </summary>
    [HttpPost("load/{id}")]
    public async Task<IActionResult> LoadById(string id)
    {
        var info = await _libraryService.LoadByIdAsync(id);
        if (info is null)
            return NotFound(new { error = $"Library '{id}' not found." });
        return Ok(info);
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
