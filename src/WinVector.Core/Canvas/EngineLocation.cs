namespace WinVector.Core.Canvas;

/// <summary>
/// Dónde se sirve el motor de edición dentro del WebView2 del lienzo.
/// </summary>
/// <remarks>
/// La aplicación asigna <see cref="HostName"/> a la carpeta <see cref="FolderName"/> de su
/// instalación mediante un host virtual de WebView2, así que el motor se carga sin servidor y sin red.
/// </remarks>
public static class EngineLocation
{
    /// <summary>Nombre del host virtual. Usa un dominio de nivel superior que no existe en internet.</summary>
    public const string HostName = "engine.winvector";

    /// <summary>Carpeta de la instalación con el bundle del motor (copia de <c>src/engine/dist</c>).</summary>
    public const string FolderName = "Engine";

    /// <summary>Página de entrada del motor.</summary>
    public static Uri EntryPage { get; } = new($"https://{HostName}/index.html");
}
