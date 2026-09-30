using Collect.Core.Services;
using Microsoft.AspNetCore.Mvc;

namespace Collect.Core.Controllers;

[ApiController]
[Route("api/tags")]
public class TagsController : ControllerBase
{
    private readonly ITagService _tagService;
    private readonly ILibraryService _libraryService;

    public TagsController(ITagService tagService, ILibraryService libraryService)
    {
        _tagService = tagService;
        _libraryService = libraryService;
    }

    /// <summary>
    /// GET /api/tags?page=1&amp;size=50&amp;search=...
    /// Get all tags grouped by type with usage counts, with pagination and optional search.
    /// </summary>
    [HttpGet]
    public async Task<IActionResult> GetTags(
        [FromQuery] int page = 1,
        [FromQuery] int size = 50,
        [FromQuery] string? search = null)
    {
        // Strict mode: a name-encrypted library that is locked must not reveal real names/tags.
        if (_libraryService.IsEncryptedLibrary() && _libraryService.EncryptsFileNames() && !_libraryService.IsLibraryUnlocked(GetUnlockToken()))
            return StatusCode(403, new { error = "Library is locked. Please unlock first." });

        var result = await _tagService.GetTagGroupsAsync(page, size, search);
        return Ok(result);
    }

    /// <summary>
    /// GET /api/tags/explore?maxTags=400&amp;search=...
    /// Every tag grouped by type, each carrying a randomly sampled asset, for the
    /// Explore page. Samples are re-drawn on every request, so calling it again
    /// reshuffles the tiles.
    /// </summary>
    [HttpGet("explore")]
    public async Task<IActionResult> GetExploreTags(
        [FromQuery] int maxTags = 400,
        [FromQuery] string? search = null)
    {
        if (_libraryService.IsEncryptedLibrary() && _libraryService.EncryptsFileNames() && !_libraryService.IsLibraryUnlocked(GetUnlockToken()))
            return StatusCode(403, new { error = "Library is locked. Please unlock first." });

        var result = await _tagService.GetTagExploreAsync(maxTags, search);
        return Ok(result);
    }

    private string? GetUnlockToken() =>
        Request.Headers.TryGetValue("X-Unlock-Token", out var values) ? values.FirstOrDefault() : null;
}
