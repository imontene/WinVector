namespace WinVector.Core.Shell;

/// <summary>
/// Petición de abrir el menú contextual del lienzo en un punto, en píxeles independientes del
/// dispositivo desde la esquina superior izquierda del lienzo.
/// </summary>
public sealed class ContextMenuRequestedEventArgs(double x, double y, bool keyboard) : EventArgs
{
    public double X { get; } = x;

    public double Y { get; } = y;

    /// <summary>True si se pidió con el teclado: el menú recibe el foco.</summary>
    public bool Keyboard { get; } = keyboard;
}
