import { ShieldCheck } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';

export function AccessDenied() {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
        <ShieldCheck className="size-8 text-muted-foreground" aria-hidden />
        <h1 className="text-lg font-semibold">Acesso restrito</h1>
        <p className="max-w-md text-sm text-muted-foreground">
          Seu perfil não tem permissão para esta área. Se precisar de acesso, fale com um
          administrador.
        </p>
      </CardContent>
    </Card>
  );
}
