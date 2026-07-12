namespace Collect.Core.Models;

/// <summary>
/// Represents a directory node in the library's directory tree.
/// </summary>
public class DirectoryNode
{
    public string Name { get; set; } = "";
    public string Path { get; set; } = "";
    public int AssetCount { get; set; }
    public List<DirectoryNode> Children { get; set; } = new();
}
