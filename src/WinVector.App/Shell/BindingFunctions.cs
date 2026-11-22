using System.Globalization;
using Microsoft.UI;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Media;
using Windows.UI;
using WinVector.Core.Bridge;
using WinVector.Core.Shell;
using BridgeStop = WinVector.Core.Bridge.GradientStop;

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

    /// <summary>Muestra de una pintura en el panel: su color o, si es un degradado, sus paradas.</summary>
    public static Brush PaintSwatch(string? paint, IReadOnlyList<BridgeStop>? stops) =>
        paint == "url" && stops is { Count: > 0 } ? GradientBrush(stops) : PaintBrush(paint);

    /// <summary>Degradado horizontal con las paradas, para la vista previa del editor (issue #109).</summary>
    public static Brush GradientBrush(IReadOnlyList<BridgeStop>? stops)
    {
        var brush = new LinearGradientBrush { StartPoint = new Windows.Foundation.Point(0, 0.5), EndPoint = new Windows.Foundation.Point(1, 0.5) };
        foreach (var stop in stops ?? [])
        {
            brush.GradientStops.Add(new Microsoft.UI.Xaml.Media.GradientStop { Color = StopColor(stop), Offset = stop.Offset });
        }

        return brush;
    }

    /// <summary>Pincel del color de una parada, con su opacidad.</summary>
    public static Brush StopBrush(BridgeStop stop) => new SolidColorBrush(StopColor(stop));

    private static Color StopColor(BridgeStop stop)
    {
        var color = TryParseColor(stop.Color, out var parsed) ? parsed : Colors.Black;
        color.A = (byte)Math.Round(Math.Clamp(stop.Opacity, 0, 1) * 255);
        return color;
    }

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
