using System.Runtime.InteropServices;
using System.Text;
using Windows.ApplicationModel.DataTransfer;
using Windows.Storage.Streams;
using WinVector.Core.Shell;

namespace WinVector.App.Shell;

/// <summary>
/// Portapapeles de Windows para SVG: se escribe como texto y con el formato <c>image/svg+xml</c>
/// (el que usan los navegadores, Inkscape y otras aplicaciones de diseño), y se lee de cualquiera de
/// los dos.
/// </summary>
internal sealed class WinUIClipboard : IShellClipboard
{
    /// <summary>Formato del portapapeles para SVG.</summary>
    public const string SvgFormat = "image/svg+xml";

    public async Task SetSvgAsync(string svg)
    {
        var package = new DataPackage { RequestedOperation = DataPackageOperation.Copy };
        package.SetText(svg);
        var stream = new InMemoryRandomAccessStream();
        using (var writer = new DataWriter(stream.GetOutputStreamAt(0)))
        {
            writer.WriteBytes(Encoding.UTF8.GetBytes(svg));
            await writer.StoreAsync();
            await writer.FlushAsync();
            writer.DetachStream();
        }

        package.SetData(SvgFormat, stream);
        try
        {
            Clipboard.SetContent(package);
            // Lo copiado sigue disponible aunque se cierre la aplicación.
            Clipboard.Flush();
        }
        catch (Exception ex) when (ex is COMException or UnauthorizedAccessException)
        {
            // Otra aplicación tiene abierto el portapapeles: la copia se pierde, como en cualquier
            // aplicación de Windows. No debe romper la cola de órdenes al motor.
        }
    }

    public async Task<string?> GetSvgAsync()
    {
        try
        {
            var view = Clipboard.GetContent();
            if (view.Contains(SvgFormat) && await ReadAsync(await view.GetDataAsync(SvgFormat)) is { } svg && LooksLikeSvg(svg))
            {
                return svg;
            }

            if (view.Contains(StandardDataFormats.Text) && await view.GetTextAsync() is { } text && LooksLikeSvg(text))
            {
                return text;
            }
        }
        catch (Exception ex) when (ex is COMException or UnauthorizedAccessException)
        {
            // Portapapeles ocupado o contenido que no se puede leer: no hay nada que pegar.
        }

        return null;
    }

    /// <summary>True si el texto parece un documento SVG (y no, por ejemplo, HTML con un svg dentro).</summary>
    internal static bool LooksLikeSvg(string text)
    {
        var trimmed = text.TrimStart('﻿', ' ', '\t', '\r', '\n');
        return trimmed.StartsWith('<')
            && trimmed.Contains("<svg", StringComparison.OrdinalIgnoreCase)
            && !trimmed.StartsWith("<html", StringComparison.OrdinalIgnoreCase)
            && !trimmed.StartsWith("<!DOCTYPE html", StringComparison.OrdinalIgnoreCase);
    }

    private static async Task<string?> ReadAsync(object data)
    {
        switch (data)
        {
            case string text:
                return text;
            case byte[] bytes:
                return Encoding.UTF8.GetString(bytes);
            case IRandomAccessStream stream:
                using (var reader = new DataReader(stream.GetInputStreamAt(0)))
                {
                    var size = (uint)stream.Size;
                    await reader.LoadAsync(size);
                    var buffer = new byte[size];
                    reader.ReadBytes(buffer);
                    return Encoding.UTF8.GetString(buffer);
                }

            default:
                return null;
        }
    }
}
