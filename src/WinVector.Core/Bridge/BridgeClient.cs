using System.Collections.Concurrent;
using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization.Metadata;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using WinVector.Core.Canvas;

namespace WinVector.Core.Bridge;

/// <summary>
/// Lado de la aplicación del puente: envía comandos al motor y espera su respuesta, y reparte los
/// eventos que el motor envía.
/// </summary>
/// <remarks>
/// Solo acepta mensajes de la página del motor (<see cref="EngineLocation"/>). Los mensajes que no
/// se pueden leer se registran y se descartan: un mensaje defectuoso nunca debe cerrar la aplicación.
/// Los manejadores de eventos se ejecutan en el hilo que entrega el transporte (el de la interfaz).
/// </remarks>
public sealed partial class BridgeClient : IDisposable
{
    /// <summary>Tiempo máximo de espera de una respuesta si no se indica otro.</summary>
    public static readonly TimeSpan DefaultTimeout = TimeSpan.FromSeconds(5);

    private static readonly BridgeJsonContext Json = BridgeJsonContext.Default;

    private readonly IBridgeTransport _transport;
    private readonly ILogger _logger;
    private readonly TimeProvider _time;
    private readonly TimeSpan _timeout;
    private readonly ConcurrentDictionary<string, TaskCompletionSource<JsonElement>> _pending = new();
    private readonly Dictionary<string, List<Action<JsonElement>>> _eventHandlers = [];
    private readonly Lock _eventHandlersLock = new();
    private long _nextId;
    private bool _disposed;

    public BridgeClient(
        IBridgeTransport transport,
        ILogger<BridgeClient>? logger = null,
        TimeProvider? timeProvider = null,
        TimeSpan? timeout = null)
    {
        ArgumentNullException.ThrowIfNull(transport);
        _transport = transport;
        _logger = logger ?? NullLogger<BridgeClient>.Instance;
        _time = timeProvider ?? TimeProvider.System;
        _timeout = timeout ?? DefaultTimeout;
        _transport.MessageReceived += OnMessageReceived;
    }

    /// <summary>
    /// Envía un comando y espera su respuesta.
    /// </summary>
    /// <exception cref="BridgeException">
    /// El motor respondió con un error, no respondió a tiempo (<see cref="BridgeErrorCode.Timeout"/>)
    /// o la respuesta no se pudo leer (<see cref="BridgeErrorCode.InvalidMessage"/>).
    /// </exception>
    /// <param name="timeout">
    /// Tiempo máximo de espera de la respuesta. Si es null, se usa el del cliente. Los comandos que
    /// llevan documentos completos pueden necesitar más: cargar un SVG de 20 MB tarda varios segundos.
    /// </param>
    public async Task<TResponse> SendAsync<TPayload, TResponse>(
        BridgeCommand<TPayload, TResponse> command,
        TPayload payload,
        TimeSpan? timeout = null,
        CancellationToken cancellationToken = default)
    {
        var limit = timeout ?? _timeout;
        ArgumentNullException.ThrowIfNull(command);
        ObjectDisposedException.ThrowIf(_disposed, this);

        var id = string.Create(CultureInfo.InvariantCulture, $"c{Interlocked.Increment(ref _nextId)}");
        var completion = new TaskCompletionSource<JsonElement>(TaskCreationOptions.RunContinuationsAsynchronously);
        _pending[id] = completion;

        try
        {
            var envelope = new BridgeEnvelope(
                BridgeMessageKind.Command,
                id,
                command.Name,
                BridgeProtocol.Version,
                JsonSerializer.SerializeToElement(payload, TypeInfo<TPayload>()));
            _transport.PostJson(JsonSerializer.Serialize(envelope, Json.BridgeEnvelope));

            JsonElement response;
            try
            {
                response = await completion.Task.WaitAsync(limit, _time, cancellationToken).ConfigureAwait(false);
            }
            catch (TimeoutException ex)
            {
                throw new BridgeException(
                    BridgeErrorCode.Timeout,
                    string.Create(CultureInfo.InvariantCulture, $"El motor no respondió a {command.Name} en {limit.TotalSeconds} s."),
                    ex);
            }

            try
            {
                return response.Deserialize(TypeInfo<TResponse>())
                    ?? throw new BridgeException(BridgeErrorCode.InvalidMessage, $"La respuesta a {command.Name} está vacía.");
            }
            catch (JsonException ex)
            {
                throw new BridgeException(BridgeErrorCode.InvalidMessage, $"La respuesta a {command.Name} no es válida: {ex.Message}", ex);
            }
        }
        finally
        {
            _pending.TryRemove(id, out _);
        }
    }

    /// <summary>Recibe un evento del motor hasta que se descarta el objeto devuelto.</summary>
    public IDisposable Subscribe<TPayload>(BridgeEvent<TPayload> bridgeEvent, Action<TPayload> handler)
    {
        ArgumentNullException.ThrowIfNull(bridgeEvent);
        ArgumentNullException.ThrowIfNull(handler);

        var typeInfo = TypeInfo<TPayload>();
        var name = bridgeEvent.Name;
        Action<JsonElement> dispatch = payload =>
        {
            var value = payload.Deserialize(typeInfo);
            if (value is null)
            {
                LogInvalidEventPayload(name, "payload vacío");
                return;
            }

            handler(value);
        };

        lock (_eventHandlersLock)
        {
            if (!_eventHandlers.TryGetValue(name, out var handlers))
            {
                handlers = [];
                _eventHandlers[name] = handlers;
            }

            handlers.Add(dispatch);
        }

        return new Subscription(() =>
        {
            lock (_eventHandlersLock)
            {
                _eventHandlers[name].Remove(dispatch);
            }
        });
    }

    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _transport.MessageReceived -= OnMessageReceived;
        foreach (var pending in _pending.Values)
        {
            pending.TrySetCanceled();
        }
    }

    private void OnMessageReceived(object? sender, BridgeTransportMessage message)
    {
        if (EngineNavigationPolicy.Decide(message.Source) != EngineNavigationDecision.Allow)
        {
            LogForeignMessage(message.Source);
            return;
        }

        BridgeEnvelope? envelope;
        try
        {
            envelope = JsonSerializer.Deserialize(message.Json, Json.BridgeEnvelope);
        }
        catch (JsonException ex)
        {
            LogInvalidMessage(ex.Message);
            return;
        }

        if (envelope is null)
        {
            LogInvalidMessage("mensaje vacío");
            return;
        }

        switch (envelope.Kind)
        {
            case BridgeMessageKind.Response:
                CompleteCommand(envelope);
                break;
            case BridgeMessageKind.Event:
                DispatchEvent(envelope);
                break;
            default:
                LogUnexpectedCommand(envelope.Name);
                break;
        }
    }

    private void CompleteCommand(BridgeEnvelope envelope)
    {
        if (!_pending.TryGetValue(envelope.Id, out var completion))
        {
            LogUnmatchedResponse(envelope.Id, envelope.Name);
            return;
        }

        if (envelope is { Ok: true, Payload: { } payload })
        {
            completion.TrySetResult(payload);
        }
        else if (envelope is { Ok: false, Error: { } error })
        {
            completion.TrySetException(new BridgeException(error.Code, error.Message));
        }
        else
        {
            completion.TrySetException(new BridgeException(
                BridgeErrorCode.InvalidMessage,
                $"La respuesta a {envelope.Name} no tiene ni payload ni error."));
        }
    }

    private void DispatchEvent(BridgeEnvelope envelope)
    {
        // Cualquier versión puede anunciar engine.ready: así la aplicación detecta la incompatibilidad.
        if (envelope.ProtocolVersion != BridgeProtocol.Version && envelope.Name != BridgeEvents.EngineReady.Name)
        {
            LogProtocolMismatch(envelope.Name, envelope.ProtocolVersion, BridgeProtocol.Version);
            return;
        }

        if (envelope.Payload is not { } payload)
        {
            LogInvalidEventPayload(envelope.Name, "falta el payload");
            return;
        }

        if (envelope.Name == BridgeEvents.Error.Name)
        {
            LogEngineError(payload.GetRawText());
        }

        Action<JsonElement>[] handlers;
        lock (_eventHandlersLock)
        {
            handlers = _eventHandlers.TryGetValue(envelope.Name, out var list) ? [.. list] : [];
        }

        foreach (var handler in handlers)
        {
            // Un manejador que falla no debe impedir que se ejecuten los demás ni cerrar la aplicación.
#pragma warning disable CA1031
            try
            {
                handler(payload);
            }
            catch (JsonException ex)
            {
                LogInvalidEventPayload(envelope.Name, ex.Message);
            }
            catch (Exception ex)
            {
                LogHandlerFailed(ex, envelope.Name);
            }
#pragma warning restore CA1031
        }
    }

    private static JsonTypeInfo<T> TypeInfo<T>() =>
        Json.GetTypeInfo(typeof(T)) as JsonTypeInfo<T>
        ?? throw new InvalidOperationException($"{typeof(T).Name} no está en BridgeJsonContext.");

    [LoggerMessage(Level = LogLevel.Warning, Message = "Se descarta un mensaje de un origen que no es el motor: {Source}")]
    private partial void LogForeignMessage(string source);

    [LoggerMessage(Level = LogLevel.Warning, Message = "Se descarta un mensaje del motor que no se puede leer: {Reason}")]
    private partial void LogInvalidMessage(string reason);

    [LoggerMessage(Level = LogLevel.Warning, Message = "El motor envió un comando ({Name}); el motor solo puede enviar eventos y respuestas")]
    private partial void LogUnexpectedCommand(string name);

    [LoggerMessage(Level = LogLevel.Debug, Message = "Respuesta {Id} a {Name} sin comando pendiente (probablemente llegó tarde)")]
    private partial void LogUnmatchedResponse(string id, string name);

    [LoggerMessage(Level = LogLevel.Warning, Message = "Se descarta el evento {Name}: protocolo {Received}, se esperaba {Expected}")]
    private partial void LogProtocolMismatch(string name, int received, int expected);

    [LoggerMessage(Level = LogLevel.Warning, Message = "El payload del evento {Name} no es válido: {Reason}")]
    private partial void LogInvalidEventPayload(string name, string reason);

    [LoggerMessage(Level = LogLevel.Warning, Message = "El motor informa de un error: {Error}")]
    private partial void LogEngineError(string error);

    [LoggerMessage(Level = LogLevel.Error, Message = "Falló un manejador del evento {Name}")]
    private partial void LogHandlerFailed(Exception exception, string name);

    private sealed class Subscription(Action unsubscribe) : IDisposable
    {
        private Action? _unsubscribe = unsubscribe;

        public void Dispose() => Interlocked.Exchange(ref _unsubscribe, null)?.Invoke();
    }
}
