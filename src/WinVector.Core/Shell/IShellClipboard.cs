namespace WinVector.Core.Shell;

/// <summary>
/// Portapapeles del sistema para SVG. Lo implementa la interfaz (en Windows, con el formato
/// <c>image/svg+xml</c> y como texto) para que este proyecto no dependa de Windows.
/// </summary>
public interface IShellClipboard
{
    /// <summary>Pone un SVG en el portapapeles.</summary>
    Task SetSvgAsync(string svg);

    /// <summary>SVG del portapapeles, o null si no hay ninguno.</summary>
    Task<string?> GetSvgAsync();
}
