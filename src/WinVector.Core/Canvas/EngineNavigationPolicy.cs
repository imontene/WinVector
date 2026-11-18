namespace WinVector.Core.Canvas;

/// <summary>Qué hacer con una navegación dentro del WebView2 del lienzo.</summary>
public enum EngineNavigationDecision
{
    /// <summary>Es una página del motor: se permite.</summary>
    Allow,

    /// <summary>Es un enlace web: se cancela en el lienzo y se abre en el navegador del sistema.</summary>
    OpenExternally,

    /// <summary>Cualquier otra cosa (archivos locales, otros esquemas): se cancela.</summary>
    Block,
}

/// <summary>
/// Decide qué navegaciones puede hacer el lienzo. El lienzo solo muestra el motor; nunca debe
/// salir de él, aunque un SVG abierto contenga enlaces.
/// </summary>
public static class EngineNavigationPolicy
{
    public static EngineNavigationDecision Decide(Uri? uri)
    {
        // Las credenciales en la URI (https://usuario@host/) sirven sobre todo para disfrazar el destino.
        if (uri is null || !uri.IsAbsoluteUri || !string.IsNullOrEmpty(uri.UserInfo))
        {
            return EngineNavigationDecision.Block;
        }

        if (uri.Scheme == Uri.UriSchemeHttps
            && string.Equals(uri.Host, EngineLocation.HostName, StringComparison.OrdinalIgnoreCase)
            && uri.IsDefaultPort)
        {
            return EngineNavigationDecision.Allow;
        }

        if (uri.Scheme == Uri.UriSchemeHttps || uri.Scheme == Uri.UriSchemeHttp)
        {
            return EngineNavigationDecision.OpenExternally;
        }

        return EngineNavigationDecision.Block;
    }

    /// <summary>Versión para las URI en texto que entrega WebView2. Una URI no válida se bloquea.</summary>
    public static EngineNavigationDecision Decide(string? uri) =>
        Uri.TryCreate(uri, UriKind.Absolute, out var parsed) ? Decide(parsed) : EngineNavigationDecision.Block;
}
