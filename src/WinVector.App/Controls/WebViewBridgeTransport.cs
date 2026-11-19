using Microsoft.Web.WebView2.Core;
using WinVector.Core.Bridge;
using WinVector.Core.Canvas;

namespace WinVector.App.Controls;

/// <summary>Transporte del puente sobre WebView2: PostWebMessageAsJson y WebMessageReceived.</summary>
internal sealed class WebViewBridgeTransport : IBridgeTransport, IDisposable
{
    private readonly CoreWebView2 _core;

    public WebViewBridgeTransport(CoreWebView2 core)
    {
        _core = core;
        _core.WebMessageReceived += OnWebMessageReceived;
    }

    public event EventHandler<BridgeTransportMessage>? MessageReceived;

    /// <summary>
    /// Archivos soltados sobre el lienzo, con su ruta. Llegan como objetos adicionales del mensaje
    /// files.dropped (postMessageWithAdditionalObjects).
    /// </summary>
    public event EventHandler<IReadOnlyList<string>>? FilesDropped;

    public void PostJson(string json) => _core.PostWebMessageAsJson(json);

    public void Dispose() => _core.WebMessageReceived -= OnWebMessageReceived;

    private void OnWebMessageReceived(CoreWebView2 sender, CoreWebView2WebMessageReceivedEventArgs args)
    {
        MessageReceived?.Invoke(this, new BridgeTransportMessage(args.Source, args.WebMessageAsJson));

        if (args.AdditionalObjects is { Count: > 0 } objects
            && EngineNavigationPolicy.Decide(args.Source) == EngineNavigationDecision.Allow)
        {
            var paths = objects.OfType<CoreWebView2File>().Select(file => file.Path).ToArray();
            if (paths.Length > 0)
            {
                FilesDropped?.Invoke(this, paths);
            }
        }
    }
}
