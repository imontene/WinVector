namespace WinVector.Core.Bridge;

/// <summary>Error al comunicarse con el motor: respuesta fallida, tiempo agotado o mensaje no válido.</summary>
public sealed class BridgeException : Exception
{
    public BridgeException()
        : this(BridgeErrorCode.Internal, "Error del puente.")
    {
    }

    public BridgeException(string message)
        : this(BridgeErrorCode.Internal, message)
    {
    }

    public BridgeException(string message, Exception innerException)
        : this(BridgeErrorCode.Internal, message, innerException)
    {
    }

    public BridgeException(BridgeErrorCode code, string message, Exception? innerException = null)
        : base(message, innerException)
    {
        Code = code;
    }

    /// <summary>Categoría del error según el contrato.</summary>
    public BridgeErrorCode Code { get; }
}
