using System.Globalization;
using System.Text.RegularExpressions;
using WinVector.Core.Bridge;

namespace WinVector.Core.Shell;

/// <summary>
/// Valida lo que el usuario escribe en el editor de la mesa de trabajo: ancho, alto (longitudes SVG
/// con unidades opcionales) y viewBox (cuatro números).
/// </summary>
public static partial class ArtboardInput
{
    /// <summary>
    /// Convierte los textos del editor en un <see cref="Artboard"/>. Un texto vacío quita el atributo.
    /// </summary>
    /// <returns>False si algún valor no es válido; entonces no se cambia nada.</returns>
    public static bool TryParse(string documentId, string? width, string? height, string? viewBox, out Artboard? artboard)
    {
        artboard = null;
        if (!TryParseLength(width, out var w) || !TryParseLength(height, out var h) || !TryParseViewBox(viewBox, out var box))
        {
            return false;
        }

        artboard = new Artboard(documentId, w, h, box);
        return true;
    }

    /// <summary>Longitud SVG positiva con unidad opcional ("800", "210mm", "100%"). Vacío = null.</summary>
    public static bool TryParseLength(string? text, out string? length)
    {
        length = null;
        if (string.IsNullOrWhiteSpace(text))
        {
            return true;
        }

        var match = LengthPattern().Match(text.Trim());
        if (!match.Success || double.Parse(match.Groups["number"].Value, CultureInfo.InvariantCulture) <= 0)
        {
            return false;
        }

        length = match.Groups["number"].Value + match.Groups["unit"].Value.ToLowerInvariant();
        return true;
    }

    /// <summary>viewBox: cuatro números separados por espacios o comas, con ancho y alto positivos. Vacío = null.</summary>
    public static bool TryParseViewBox(string? text, out Rect? viewBox)
    {
        viewBox = null;
        if (string.IsNullOrWhiteSpace(text))
        {
            return true;
        }

        var parts = text.Split([' ', ',', '\t'], StringSplitOptions.RemoveEmptyEntries);
        if (parts.Length != 4)
        {
            return false;
        }

        var values = new double[4];
        for (var i = 0; i < 4; i++)
        {
            if (!double.TryParse(parts[i], NumberStyles.Float, CultureInfo.InvariantCulture, out values[i]) || !double.IsFinite(values[i]))
            {
                return false;
            }
        }

        if (values[2] <= 0 || values[3] <= 0)
        {
            return false;
        }

        viewBox = new Rect(values[0], values[1], values[2], values[3]);
        return true;
    }

    /// <summary>Texto del viewBox para el editor ("0 0 400 300").</summary>
    public static string Format(Rect? viewBox) =>
        viewBox is null
            ? string.Empty
            : string.Join(' ', new[] { viewBox.X, viewBox.Y, viewBox.Width, viewBox.Height }.Select(v => v.ToString("0.######", CultureInfo.InvariantCulture)));

    [GeneratedRegex(@"^(?<number>(\d+(\.\d*)?|\.\d+)(e[+-]?\d+)?)\s*(?<unit>px|pt|pc|mm|cm|in|em|ex|%)?$", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex LengthPattern();
}
