using CommunityToolkit.Mvvm.ComponentModel;

namespace WinVector.Core.Shell;

/// <summary>
/// Un campo numérico de las propiedades propias de la forma seleccionada (radio de las esquinas,
/// lados de un polígono…). El panel muestra uno por campo, según el tipo de forma.
/// </summary>
public sealed partial class ShapeFieldViewModel : ObservableObject
{
    public ShapeFieldViewModel(string key, string label, double minimum = double.MinValue, double maximum = double.MaxValue, double smallChange = 1, double largeChange = 10)
    {
        Key = key;
        Label = label;
        Minimum = minimum;
        Maximum = maximum;
        SmallChange = smallChange;
        LargeChange = largeChange;
    }

    /// <summary>Identificador del campo: el nombre en el contrato ("cornerRadius") o uno calculado ("length").</summary>
    public string Key { get; }

    /// <summary>Texto de la etiqueta, ya traducido.</summary>
    public string Label { get; }

    /// <summary>AutomationId del campo en el panel: "Shape" y el identificador ("ShapeCornerRadius").</summary>
    public string AutomationId => "Shape" + char.ToUpperInvariant(Key[0]) + Key[1..];

    public double Minimum { get; }

    public double Maximum { get; }

    public double SmallChange { get; }

    public double LargeChange { get; }

    /// <summary>Valor mostrado, redondeado a dos decimales.</summary>
    [ObservableProperty]
    private double _value;

    /// <summary>Vuelve a anunciar el valor, para que el panel descarte lo escrito que no valía.</summary>
    public void Refresh() => OnPropertyChanged(nameof(Value));
}
