'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api-client';
import { cn } from '@/lib/utils';

export interface MunicipalityOption {
  ibgeCode: number;
  name: string;
  uf: string;
}

/**
 * Autocompletar de município (IBGE). Escolher uma opção define cidade e UF; o
 * DDD da cidade completa telefones digitados sem DDD.
 */
export function MunicipalityPicker({
  id,
  value,
  onChange,
  invalid,
}: {
  id: string;
  value: MunicipalityOption | null;
  onChange: (value: MunicipalityOption | null) => void;
  invalid?: boolean;
}) {
  const listId = useId();
  const [text, setText] = useState(value ? `${value.name} — ${value.uf}` : '');
  const [options, setOptions] = useState<MunicipalityOption[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  function search(query: string) {
    setText(query);
    if (value) onChange(null);
    if (timer.current) clearTimeout(timer.current);
    if (query.trim().length < 2) {
      setOptions([]);
      return;
    }
    timer.current = setTimeout(async () => {
      try {
        const result = await api<{ data: MunicipalityOption[] }>(
          `/municipalities?q=${encodeURIComponent(query.trim())}`,
        );
        setOptions(result.data);
        setActive(0);
        setOpen(true);
      } catch {
        setOptions([]);
      }
    }, 200);
  }

  function choose(option: MunicipalityOption) {
    onChange(option);
    setText(`${option.name} — ${option.uf}`);
    setOpen(false);
  }

  return (
    <div className="relative">
      <Input
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-invalid={invalid || undefined}
        autoComplete="off"
        placeholder="Digite a cidade"
        value={text}
        onChange={(e) => search(e.target.value)}
        onFocus={() => options.length > 0 && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (!open || options.length === 0) return;
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, options.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === 'Enter') {
            e.preventDefault();
            choose(options[active]!);
          } else if (e.key === 'Escape') {
            setOpen(false);
          }
        }}
      />
      {open && options.length > 0 ? (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-md border bg-card py-1 text-sm shadow-md"
        >
          {options.map((option, index) => (
            <li
              key={option.ibgeCode}
              role="option"
              aria-selected={index === active}
              className={cn('cursor-pointer px-3 py-1.5', index === active && 'bg-muted')}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(option);
              }}
            >
              {option.name} <span className="text-muted-foreground">— {option.uf}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
