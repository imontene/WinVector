using System.Text.Json;
using Microsoft.Extensions.Logging;
using WinVector.Core.Bridge;
using WinVector.Core.Canvas;

namespace WinVector.Core.Tests.Bridge;

/// <summary>Transporte en memoria: guarda lo que envía la aplicación y simula mensajes del motor.</summary>
internal sealed class FakeBridgeTransport : IBridgeTransport
{
    public static readonly string EngineSource = EngineLocation.EntryPage.AbsoluteUri;

    public List<string> Posted { get; } = [];

    public event EventHandler<BridgeTransportMessage>? MessageReceived;

    /// <summary>Si se indica, se llama con cada mensaje enviado (para simular el motor).</summary>
    public Action<string>? OnPosted { get; set; }

    public void PostJson(string json)
    {
        Posted.Add(json);
        OnPosted?.Invoke(json);
    }

    public void Receive(string json, string? source = null) =>
        MessageReceived?.Invoke(this, new BridgeTransportMessage(source ?? EngineSource, json));

    public JsonElement LastPosted() => JsonDocument.Parse(Posted[^1]).RootElement.Clone();

    public void RespondOk(string id, string name, string payloadJson) => Receive(
        $$"""{"kind":"response","id":"{{id}}","name":"{{name}}","protocolVersion":{{BridgeProtocol.Version}},"ok":true,"payload":{{payloadJson}}}""");

    public void SendEvent(string name, string payloadJson, int protocolVersion = BridgeProtocol.Version) => Receive(
        $$"""{"kind":"event","id":"e1","name":"{{name}}","protocolVersion":{{protocolVersion}},"payload":{{payloadJson}}}""");
}

/// <summary>Registrador que guarda los mensajes para poder comprobarlos.</summary>
internal sealed class ListLogger<T> : ILogger<T>
{
    public List<(LogLevel Level, string Message)> Entries { get; } = [];

    public IDisposable? BeginScope<TState>(TState state)
        where TState : notnull => null;

    public bool IsEnabled(LogLevel logLevel) => true;

    public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter) =>
        Entries.Add((logLevel, formatter(state, exception)));
}
