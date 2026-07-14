using Collect.Core.Services;
using Microsoft.AspNetCore.Mvc;

namespace Collect.Core.Controllers;

[ApiController]
[Route("api/tags")]
public class TagsController : ControllerBase
{
    private readonly ITagService _tagService;

    public TagsController(ITagService tagService)
    {
        _tagService = tagService;
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
        var result = await _tagService.GetTagGroupsAsync(page, size, search);
        return Ok(result);
    }
}
