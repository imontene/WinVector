using System.Text.Json;
using WinVector.Core.Bridge;

namespace WinVector.Core.Tests.Bridge;

/// <summary>
/// Motor simulado: responde a los comandos del documento como el motor real y guarda lo que recibe.
/// </summary>
internal sealed class FakeEngine
{
    private readonly FakeBridgeTransport _transport;
    private readonly Dictionary<string, string> _documents = [];

    public FakeEngine(FakeBridgeTransport transport)
    {
        _transport = transport;
        _transport.Posted.Clear();
        _transport.OnPosted = Respond;
    }

    /// <summary>Comandos recibidos, como "document.load d1".</summary>
    public List<string> Commands { get; } = [];

    /// <summary>Documentos que el motor rechazará como no válidos.</summary>
    public HashSet<string> InvalidSvgs { get; } = [];

    public string? ActiveDocument { get; private set; }

    /// <summary>Se ejecuta justo antes de responder a app.ping, por ejemplo para avanzar el reloj.</summary>
    public Action? BeforePingResponse { get; set; }

    public void Ready() =>
        _transport.SendEvent("engine.ready", $$"""{"engineVersion":"0.0.0","protocolVersion":{{BridgeProtocol.Version}}}""");

    private void Respond(string json)
    {
        var message = JsonDocument.Parse(json).RootElement;
        var id = message.GetProperty("id").GetString()!;
        var name = message.GetProperty("name").GetString()!;
        var payload = message.GetProperty("payload");
        var documentId = payload.TryGetProperty("documentId", out var value) ? value.GetString() : null;
        Commands.Add(documentId is null ? name : $"{name} {documentId}");

        switch (name)
        {
            case "document.load":
                var svg = payload.GetProperty("svg").GetString()!;
                if (InvalidSvgs.Contains(svg))
                {
                    _transport.RespondOk(id, name, $$$"""{"documentId":"{{{documentId}}}","loaded":false,"revision":0,"exactMapping":false,"error":{"message":"XML no válido","line":1,"column":2}}""");
                }
                else
                {
                    _documents[documentId!] = svg;
                    _transport.RespondOk(id, name, $$"""{"documentId":"{{documentId}}","loaded":true,"revision":0,"exactMapping":true,"error":null}""");
                }

                break;
            case "document.activate":
                ActiveDocument = documentId;
                _transport.RespondOk(id, name, $$"""{"documentId":"{{documentId}}","revision":0}""");
                break;
            case "document.close":
                _documents.Remove(documentId!);
                _transport.RespondOk(id, name, $$"""{"documentId":"{{documentId}}"}""");
                break;
            case "document.serialize":
                _transport.RespondOk(id, name, $$"""{"documentId":"{{documentId}}","svg":{{JsonSerializer.Serialize(_documents[documentId!])}},"revision":0}""");
                break;
            case "app.ping":
                BeforePingResponse?.Invoke();
                _transport.RespondOk(id, name, """{"sentAt":0,"receivedAt":0}""");
                break;
        }
    }
}
