function positiveNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    throw new Error(`${label} must be a positive number`);
  }
  return number;
}

function cleanNumber(value) {
  return Number(value.toFixed(2));
}

export function calculateCartonDimensions({
  bagWidthCm,
  bagLengthCm,
  thicknessMm,
  piecesPerCarton,
}) {
  const width = positiveNumber(bagWidthCm, "bagWidthCm");
  const length = positiveNumber(bagLengthCm, "bagLengthCm");
  const thickness = positiveNumber(thicknessMm, "thicknessMm");
  const quantity = positiveNumber(piecesPerCarton, "piecesPerCarton");

  const foldWidth = width > 60;
  const foldLength = length > 60;
  const foldCount = Number(foldWidth) + Number(foldLength);
  const layerCount = 2 * (2 ** foldCount);

  return {
    widthCm: cleanNumber((foldWidth ? width / 2 : width) + 2),
    lengthCm: cleanNumber((foldLength ? length / 2 : length) + 2),
    heightCm: cleanNumber((thickness / 10) * layerCount * quantity + 2),
    foldCount,
    layerCount,
  };
}

export function formatCartonDimensions(dimensions) {
  return [dimensions.widthCm, dimensions.lengthCm, dimensions.heightCm]
    .map((value) => String(value))
    .join(" × ");
}
