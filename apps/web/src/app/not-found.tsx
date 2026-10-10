import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="grid min-h-dvh place-items-center px-4">
      <div className="space-y-3 text-center">
        <p className="text-sm font-medium text-primary">404</p>
        <h1 className="text-2xl font-semibold">Página não encontrada</h1>
        <Link href="/dashboard" className="text-sm text-primary hover:underline">
          Voltar ao início
        </Link>
      </div>
    </div>
  );
}
