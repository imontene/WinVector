using System.Collections.ObjectModel;
using WinVector.Core.Bridge;

namespace WinVector.Core.Shell;

/// <summary>Propiedades propias de la forma seleccionada (issue #59).</summary>
public sealed partial class MainViewModel
{
    private ShapeProperties? _shape;

    /// <summary>
    /// Campos de la forma seleccionada, según su tipo. Vacío si no hay una sola forma seleccionada
    /// (con varios objetos, el panel muestra solo la geometría común).
    /// </summary>
    public ObservableCollection<ShapeFieldViewModel> ShapeFields { get; } = [];

    /// <summary>Título de la sección de la forma ("Rectángulo"), o vacío.</summary>
    public string ShapeTitle => _shape is null ? string.Empty : _texts.ShapeName(_shape.Type);

    public bool HasShapeFields => ShapeFields.Count > 0;

    /// <summary>
    /// Cambia un campo de la forma en el motor, en un paso que se puede deshacer. Los porcentajes
    /// (radio interior, redondeo) y la longitud y el ángulo de una línea se traducen a sus valores.
    /// </summary>
    /// <returns>False si el valor no es válido o no cambia nada; el campo vuelve a mostrar el actual.</returns>
    public bool SetShapeField(string key, double value)
    {
        var field = ShapeFields.FirstOrDefault(f => f.Key == key);
        if (field is null || Math.Abs(value - field.Value) < 1e-9)
        {
            // El panel avisa también cuando el valor lo pone el modelo: no hay nada que hacer.
            return false;
        }

        if (_shape is not { } shape || SelectedDocument is not { IsLoaded: true } document || !double.IsFinite(value))
        {
            field.Refresh();
            return false;
        }

        var change = new ShapeChange(document.DocumentId);
        change = key switch
        {
            "x" => change with { X = value },
            "y" => change with { Y = value },
            "width" when value > 0 => change with { Width = value },
            "height" when value > 0 => change with { Height = value },
            "cornerRadius" when value >= 0 => change with { CornerRadius = value },
            "cx" => change with { Cx = value },
            "cy" => change with { Cy = value },
            "rx" when value > 0 => change with { Rx = value },
            "ry" when value > 0 => change with { Ry = value },
            "r" when value > 0 => change with { R = value },
            "x1" => change with { X1 = value },
            "y1" => change with { Y1 = value },
            "x2" => change with { X2 = value },
            "y2" => change with { Y2 = value },
            "length" when value > 0 => LineEnd(change, shape, value, LineAngle(shape)),
            "angle" => LineEnd(change, shape, LineLength(shape), value),
            "sides" when value >= 3 => change with { Sides = Math.Round(value) },
            "inner" when value is > 0 and <= 100 => change with { Inner = value / 100 },
            "rotation" => change with { Rotation = value },
            "rounding" when value is >= 0 and <= 100 => change with { Rounding = value / 100 },
            _ => change,
        };
        if (change == new ShapeChange(document.DocumentId))
        {
            field.Refresh();
            return false;
        }

        Enqueue(() => SendAsync(BridgeCommands.SelectionSetShape, change));
        return true;
    }

    private static double LineLength(ShapeProperties line) =>
        Math.Sqrt(Math.Pow((line.X2 ?? 0) - (line.X1 ?? 0), 2) + Math.Pow((line.Y2 ?? 0) - (line.Y1 ?? 0), 2));

    /// <summary>Ángulo de la línea en grados, del primer extremo al segundo (hacia abajo es positivo).</summary>
    private static double LineAngle(ShapeProperties line) =>
        Math.Atan2((line.Y2 ?? 0) - (line.Y1 ?? 0), (line.X2 ?? 0) - (line.X1 ?? 0)) * 180 / Math.PI;

    /// <summary>Mueve el segundo extremo de la línea para que tenga la longitud y el ángulo pedidos.</summary>
    private static ShapeChange LineEnd(ShapeChange change, ShapeProperties line, double length, double angle)
    {
        var radians = angle * Math.PI / 180;
        return change with
        {
            X2 = Math.Round((line.X1 ?? 0) + (length * Math.Cos(radians)), 4),
            Y2 = Math.Round((line.Y1 ?? 0) + (length * Math.Sin(radians)), 4),
        };
    }

    /// <summary>Muestra la forma seleccionada: crea los campos si cambia el tipo, o actualiza sus valores.</summary>
    private void ShowShape(ShapeProperties? shape)
    {
        var previous = _shape;
        _shape = shape;
        if (shape is null)
        {
            ShapeFields.Clear();
        }
        else if (previous?.Type != shape.Type || ShapeFields.Count == 0)
        {
            ShapeFields.Clear();
            foreach (var field in CreateFields(shape.Type))
            {
                ShapeFields.Add(field);
            }
        }

        RefreshShapeFields();
        OnPropertyChanged(nameof(ShapeTitle));
        OnPropertyChanged(nameof(HasShapeFields));
    }

    private IEnumerable<ShapeFieldViewModel> CreateFields(ShapeType type)
    {
        ShapeFieldViewModel Field(string key, double small = 1, double large = 10) => new(key, _texts.ShapeField(key), small, large);

        return type switch
        {
            ShapeType.Rect => [Field("x"), Field("y"), Field("width"), Field("height"), Field("cornerRadius")],
            ShapeType.Ellipse => [Field("cx"), Field("cy"), Field("rx"), Field("ry")],
            ShapeType.Circle => [Field("cx"), Field("cy"), Field("r")],
            ShapeType.Line => [Field("x1"), Field("y1"), Field("x2"), Field("y2"), Field("length"), Field("angle", 1, 15)],
            ShapeType.Polygon => [Field("cx"), Field("cy"), Field("r"), Field("sides", 1, 1), Field("rotation", 1, 15), Field("rounding", 5, 10)],
            _ => [Field("cx"), Field("cy"), Field("r"), Field("sides", 1, 1), Field("inner", 5, 10), Field("rotation", 1, 15), Field("rounding", 5, 10)],
        };
    }

    /// <summary>Pone en cada campo el valor de la forma.</summary>
    private void RefreshShapeFields()
    {
        if (_shape is not { } shape)
        {
            return;
        }

        foreach (var field in ShapeFields)
        {
            var value = field.Key switch
            {
                "x" => shape.X,
                "y" => shape.Y,
                "width" => shape.Width,
                "height" => shape.Height,
                "cornerRadius" => shape.CornerRadius,
                "cx" => shape.Cx,
                "cy" => shape.Cy,
                "rx" => shape.Rx,
                "ry" => shape.Ry,
                "r" => shape.R,
                "x1" => shape.X1,
                "y1" => shape.Y1,
                "x2" => shape.X2,
                "y2" => shape.Y2,
                "length" => LineLength(shape),
                "angle" => LineAngle(shape),
                "sides" => shape.Sides,
                "inner" => shape.Inner * 100,
                "rotation" => shape.Rotation,
                "rounding" => shape.Rounding * 100,
                _ => null,
            };
            field.Value = value is { } v ? Math.Round(v, 2) : double.NaN;
        }
    }
}
