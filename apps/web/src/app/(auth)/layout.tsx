import type { ReactNode } from 'react';
import { Brand } from '@/components/layout/brand';

export default function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-dvh place-items-center bg-muted/40 px-4 py-10">
      <div className="w-full max-w-sm space-y-6">
        <Brand className="justify-center" />
        {children}
        <p className="text-center text-xs text-muted-foreground">
          Acesso restrito à equipe Docline. Uso monitorado.
        </p>
      </div>
    </div>
  );
}
