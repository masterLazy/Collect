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

        var info = await _libraryService.InitializeAsync(request.Path, request.Name, request.UseMd5, request.ParseTags);
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
}

public class InitRequest
{
    public string Path { get; set; } = string.Empty;
    public string? Name { get; set; }
    public bool UseMd5 { get; set; }
    public bool ParseTags { get; set; } = true;
}

public class CreateDirectoryRequest
{
    public string RelativePath { get; set; } = string.Empty;
}
