using Microsoft.Web.WebView2.Core;
using WinVector.Core.Bridge;

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

    public void PostJson(string json) => _core.PostWebMessageAsJson(json);

    public void Dispose() => _core.WebMessageReceived -= OnWebMessageReceived;

    private void OnWebMessageReceived(CoreWebView2 sender, CoreWebView2WebMessageReceivedEventArgs args) =>
        MessageReceived?.Invoke(this, new BridgeTransportMessage(args.Source, args.WebMessageAsJson));
}
