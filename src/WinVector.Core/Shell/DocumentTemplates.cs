using System.Globalization;

namespace WinVector.Core.Shell;

/// <summary>Textos SVG de partida para documentos nuevos.</summary>
public static class DocumentTemplates
{
    public const int DefaultWidth = 800;
    public const int DefaultHeight = 600;

    /// <summary>Documento vacío con una mesa de trabajo del tamaño indicado, en píxeles.</summary>
    public static string Blank(int width = DefaultWidth, int height = DefaultHeight)
    {
        ArgumentOutOfRangeException.ThrowIfNegativeOrZero(width);
        ArgumentOutOfRangeException.ThrowIfNegativeOrZero(height);
        return string.Create(
            CultureInfo.InvariantCulture,
            $"""
            <?xml version="1.0" encoding="UTF-8"?>
            <svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}">
            </svg>

            """);
    }
}
