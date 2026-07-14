using Microsoft.AspNetCore.Mvc;

namespace Collect.Core.Controllers;

/// <summary>
/// Server-side filesystem browser API.
/// Provides drive listing and directory browsing for library path selection.
/// </summary>
[ApiController]
[Route("api/fs")]
public class FsController : ControllerBase
{
    /// <summary>
    /// GET /api/fs/drives
    /// List available logical drives on the server.
    /// </summary>
    [HttpGet("drives")]
    public IActionResult GetDrives()
    {
        var drives = DriveInfo.GetDrives()
            .Where(d => d.IsReady && d.DriveType == DriveType.Fixed)
            .Select(d => new
            {
                name = d.Name.TrimEnd('\\'),
                path = d.Name,
                label = string.IsNullOrEmpty(d.VolumeLabel)
                    ? d.Name.TrimEnd('\\')
                    : $"{d.Name.TrimEnd('\\')} ({d.VolumeLabel})"
            })
            .ToList();
        return Ok(drives);
    }

    /// <summary>
    /// GET /api/fs/browse?path=C:\Users
    /// List subdirectories at the given path. Returns only directories (not files).
    /// </summary>
    [HttpGet("browse")]
    public IActionResult Browse([FromQuery] string? path)
    {
        if (string.IsNullOrWhiteSpace(path))
            return BadRequest(new { error = "Path is required." });

        if (!Directory.Exists(path))
            return NotFound(new { error = "Directory not found." });

        try
        {
            var dirs = Directory.GetDirectories(path)
                .Select(d => new { name = Path.GetFileName(d), path = d })
                .OrderBy(d => d.name)
                .ToList();
            return Ok(new { path, dirs });
        }
        catch (UnauthorizedAccessException)
        {
            return StatusCode(403, new { error = "Access denied." });
        }
    }
}
