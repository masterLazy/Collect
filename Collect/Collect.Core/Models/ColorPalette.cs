namespace Collect.Core.Models;

/// <summary>
/// Represents a computed color palette for an asset, containing a list
/// of dominant colors and their relative proportions in the image.
/// </summary>
public class ColorPalette
{
    public List<PaletteColor> Colors { get; set; } = new();
}

/// <summary>
/// A single color entry in a palette, with its hex representation and proportion.
/// </summary>
public class PaletteColor
{
    /// <summary>
    /// Hex color string, e.g. "#FF00AA".
    /// </summary>
    public string Hex { get; set; } = string.Empty;

    /// <summary>
    /// Proportion of this color in the image, ranging from 0.0 to 1.0.
    /// The sum of all proportions in a palette is approximately 1.0.
    /// </summary>
    public double Proportion { get; set; }
}
