using Microsoft.UI.Xaml;
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
}
