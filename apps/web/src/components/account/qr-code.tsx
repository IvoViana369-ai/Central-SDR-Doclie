import { encode } from 'uqr';

/**
 * QR code desenhado como SVG pelo React (sem HTML bruto nem imagem `data:`,
 * compatível com a CSP). Sempre preto no branco para os leitores de câmera.
 */
export function QrCode({
  value,
  label,
  size = 200,
}: {
  value: string;
  label: string;
  size?: number;
}) {
  const { data, size: modules } = encode(value, { ecc: 'M', border: 2 });
  let path = '';
  data.forEach((row, y) =>
    row.forEach((dark, x) => {
      if (dark) path += `M${x} ${y}h1v1h-1z`;
    }),
  );
  return (
    <svg
      viewBox={`0 0 ${modules} ${modules}`}
      width={size}
      height={size}
      role="img"
      aria-label={label}
      shapeRendering="crispEdges"
      className="rounded-md border"
    >
      <rect width={modules} height={modules} fill="#ffffff" />
      <path d={path} fill="#000000" />
    </svg>
  );
}
