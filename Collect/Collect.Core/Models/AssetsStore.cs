namespace Collect.Core.Models;

/// <summary>
/// JSON-serializable wrapper for the assets collection stored on disk.
/// </summary>
public class AssetsStore
{
    public List<Asset> Assets { get; set; } = new();
}
