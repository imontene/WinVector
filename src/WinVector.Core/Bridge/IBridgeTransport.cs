namespace WinVector.Core.Bridge;

/// <summary>Mensaje recibido del lienzo, tal como lo entrega WebView2.</summary>
/// <param name="Source">Dirección de la página que lo envió.</param>
/// <param name="Json">El mensaje serializado en JSON.</param>
public sealed record BridgeTransportMessage(string Source, string Json);

/// <summary>
/// Canal entre la aplicación y el motor. En la aplicación lo implementa el WebView2 del lienzo;
/// en las pruebas, un sustituto en memoria.
/// </summary>
public interface IBridgeTransport
{
    /// <summary>Envía un mensaje JSON al motor.</summary>
    void PostJson(string json);

    /// <summary>Se produce al recibir un mensaje del lienzo.</summary>
    event EventHandler<BridgeTransportMessage>? MessageReceived;
}
