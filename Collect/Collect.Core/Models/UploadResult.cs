namespace Collect.Core.Models;

/// <summary>
/// Result of a file upload operation.
/// </summary>
public class UploadResult
{
    public int Added { get; set; }
    public List<UploadError> Errors { get; set; } = new();
}

/// <summary>
/// An error that occurred during file upload.
/// </summary>
public class UploadError
{
    public string FileName { get; set; } = "";
    public string Reason { get; set; } = "";
}
