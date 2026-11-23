using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using WinVector.Core.Bridge;

namespace WinVector.Core.Shell;

/// <summary>
/// Redondear todas las esquinas de las figuras seleccionadas a la vez (issue #114): con la herramienta
/// Selección, el panel muestra el radio de las esquinas de los polígonos, polilíneas y trazados.
/// </summary>
public sealed partial class MainViewModel
{
    /// <summary>Algún objeto seleccionado tiene esquinas entre dos rectas que se pueden redondear.</summary>
    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(HasObjectCorners))]
    [NotifyCanExecuteChangedFor(nameof(RoundCornersCommand))]
    private bool _canRoundObjectCorners;

    /// <summary>Radio común de todas las esquinas de los objetos seleccionados, o NaN si son distintos.</summary>
    [ObservableProperty]
    private double _objectCornerRadius = double.NaN;

    /// <summary>
    /// El panel muestra el radio de todas las esquinas. Con la herramienta Vértices se muestra el de
    /// las esquinas seleccionadas.
    /// </summary>
    public bool HasObjectCorners => CanRoundObjectCorners && ActiveTool != ToolName.Vertex;

    /// <summary>Se pide llevar el foco al radio de las esquinas del panel (menú Trazado).</summary>
    public event EventHandler? CornerRadiusRequested;

    /// <summary>Hay esquinas que redondear: las de los objetos o las seleccionadas con Vértices.</summary>
    public bool CanRoundAnyCorners => HasObjectCorners || CanRoundCorners;

    /// <summary>Lleva al campo del radio de las esquinas del panel.</summary>
    [RelayCommand(CanExecute = nameof(CanRoundAnyCorners))]
    public void RoundCorners() => CornerRadiusRequested?.Invoke(this, EventArgs.Empty);

    /// <summary>Redondea todas las esquinas de los objetos seleccionados con el mismo radio; 0 lo quita.</summary>
    /// <returns>False si el valor no es válido, es el mismo o no hay esquinas que redondear.</returns>
    public bool SetObjectCornerRadius(double radius)
    {
        if (SelectedDocument is not { IsLoaded: true } document || !CanRoundObjectCorners
            || !double.IsFinite(radius) || radius < 0 || Math.Abs(radius - ObjectCornerRadius) < 1e-9)
        {
            OnPropertyChanged(nameof(ObjectCornerRadius));
            return false;
        }

        Enqueue(() => SendAsync(BridgeCommands.PathCornerRadius, new CornerRadiusChange(document.DocumentId, radius, All: true)));
        return true;
    }

    /// <summary>Muestra las esquinas de la selección, o ninguna con null.</summary>
    private void ShowObjectCorners(SelectionCorners? corners)
    {
        CanRoundObjectCorners = corners is not null;
        ObjectCornerRadius = corners?.Radius is { } radius ? Math.Round(radius, 2) : double.NaN;
    }

    private void NotifyCornerToolChanged()
    {
        OnPropertyChanged(nameof(HasObjectCorners));
        RoundCornersCommand.NotifyCanExecuteChanged();
    }
}
