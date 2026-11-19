using System.Globalization;

namespace WinVector.Core.Shell;

/// <summary>Textos SVG de partida para documentos nuevos.</summary>
public static class DocumentTemplates
{
    public const int DefaultWidth = 800;
    public const int DefaultHeight = 600;

    /// <summary>
    /// Documento vacío del tamaño indicado. En milímetros, las coordenadas del documento también son
    /// milímetros, como en Inkscape; en pulgadas, las coordenadas son píxeles a 96 por pulgada.
    /// </summary>
    public static string Blank(DocumentSize size)
    {
        ArgumentNullException.ThrowIfNull(size);
        ArgumentOutOfRangeException.ThrowIfNegativeOrZero(size.Width);
        ArgumentOutOfRangeException.ThrowIfNegativeOrZero(size.Height);
        var (width, height, viewWidth, viewHeight) = size.Unit switch
        {
            LengthUnit.Millimeters => ($"{Number(size.Width)}mm", $"{Number(size.Height)}mm", size.Width, size.Height),
            LengthUnit.Inches => ($"{Number(size.Width)}in", $"{Number(size.Height)}in", size.Width * 96, size.Height * 96),
            _ => (Number(size.Width), Number(size.Height), size.Width, size.Height),
        };
        return string.Create(
            CultureInfo.InvariantCulture,
            $"""
            <?xml version="1.0" encoding="UTF-8"?>
            <svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {Number(viewWidth)} {Number(viewHeight)}">
            </svg>

            """);
    }

    private static string Number(double value) => Math.Round(value, 3).ToString(CultureInfo.InvariantCulture);

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
