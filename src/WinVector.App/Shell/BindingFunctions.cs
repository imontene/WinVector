using System.Globalization;
using Microsoft.UI;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Media;
using Windows.UI;
using WinVector.Core.Bridge;
using WinVector.Core.Shell;

namespace WinVector.App.Shell;

/// <summary>Funciones para x:Bind en MainWindow.xaml (se usan con el prefijo <c>app:</c>).</summary>
public static class BindingFunctions
{
    public static Visibility VisibleWhen(bool value) => value ? Visibility.Visible : Visibility.Collapsed;

    public static Visibility VisibleUnless(bool value) => value ? Visibility.Collapsed : Visibility.Visible;

    public static string ArtboardWidthText(Artboard? artboard) => artboard?.Width ?? string.Empty;

    public static string ArtboardHeightText(Artboard? artboard) => artboard?.Height ?? string.Empty;

    public static string ArtboardViewBoxText(Artboard? artboard) => ArtboardInput.Format(artboard?.ViewBox);

    /// <summary>Pincel para la muestra de una pintura: su color, o transparente si no es un color.</summary>
    public static Brush PaintBrush(string? paint) =>
        TryParseColor(paint, out var color) ? new SolidColorBrush(color) : new SolidColorBrush(Colors.Transparent);

    /// <summary>Lee un color "#rrggbb".</summary>
    public static bool TryParseColor(string? paint, out Color color)
    {
        color = Colors.Transparent;
        if (MainViewModel.NormalizePaint(paint) is not { } hex || hex == "none")
        {
            return false;
        }

        var value = uint.Parse(hex.AsSpan(1), NumberStyles.HexNumber, CultureInfo.InvariantCulture);
        color = Color.FromArgb(0xff, (byte)(value >> 16), (byte)(value >> 8), (byte)value);
        return true;
    }

    /// <summary>Escribe un color como "#rrggbb".</summary>
    public static string ToHex(Color color) => $"#{color.R:x2}{color.G:x2}{color.B:x2}";
}
