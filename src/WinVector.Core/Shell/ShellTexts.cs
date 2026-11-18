namespace WinVector.Core.Shell;

/// <summary>
/// Textos localizados que necesitan los modelos de vista. Los proporciona la interfaz para que este
/// proyecto no dependa de los recursos de Windows.
/// </summary>
/// <param name="UntitledDocument">Título de un documento nuevo a partir de su número ("Sin título 2").</param>
/// <param name="MultipleSelection">Resumen de una selección de varios objetos ("3 objetos").</param>
/// <param name="ProtocolMismatch">
/// Aviso de motor incompatible, con la versión del protocolo del motor y la de la aplicación.
/// </param>
public sealed record ShellTexts(
    Func<int, string> UntitledDocument,
    Func<int, string> MultipleSelection,
    Func<int, int, string> ProtocolMismatch);
