namespace Collect.Core.Models;

/// <summary>
/// A recently opened library entry persisted for cross-session recall.
/// </summary>
public class RecentLibraryEntry
{
    public string Name { get; set; } = string.Empty;
    public string Path { get; set; } = string.Empty;
    public string LastOpened { get; set; } = string.Empty;
}
