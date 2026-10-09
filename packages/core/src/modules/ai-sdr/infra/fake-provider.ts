import { toSearchKey } from '../../normalization';
import {
  AiProviderError,
  type AiErrorCode,
  type AiProvider,
  type AiStructuredRequest,
  type AiStructuredResult,
} from '../../../ports/ai';

/**
 * Provedor de IA falso e determinístico (docs/AI-SDR.md §3): desenvolvimento,
 * testes e E2E, sem custo e sem enviar dados a terceiros. Escreve a partir dos
 * mesmos prompts do provedor real, lendo os blocos <pedido> e <lead_data>.
 *
 * Marcas nas instruções do SDR simulam casos difíceis:
 * `[fake:termo-proibido]`, `[fake:telefone]`, `[fake:recusa]`,
 * `[fake:invalido]` (saída fora do schema) e `[fake:indisponivel]`.
 */
export const FAKE_MODEL = 'fake-sdr';

const tokens = (text: string) => Math.ceil(text.length / 4);

function block(input: string, tag: string): string | null {
  const match = new RegExp(`<${tag}>\\n?([\\s\\S]*?)\\n?</${tag}>`).exec(input);
  return match ? match[1]!.trim() : null;
}

function requestField(input: string, label: string): string | null {
  const pedido = block(input, 'pedido') ?? '';
  const line = pedido.split('\n').find((l) => l.startsWith(`${label}: `));
  return line ? line.slice(label.length + 2) : null;
}

interface FakeLead {
  name?: string;
  city?: string;
  origin?: string;
  referredBy?: string;
  contactFirstName?: string;
}

function outreachMessage(input: string) {
  let lead: FakeLead;
  try {
    lead = JSON.parse((block(input, 'lead_data') ?? '{}').replace(/‹/g, '<').replace(/›/g, '>'));
  } catch {
    lead = {};
  }
  const kind = requestField(input, 'Tipo de mensagem') ?? 'Primeiro contato';
  const sender = (requestField(input, 'Quem escreve') ?? 'a equipe, da Docline').replace(
    /, da Docline$/,
    '',
  );
  const optOut = /Opt-out: .*"([^"]+)"/.exec(block(input, 'pedido') ?? '')?.[1] ?? null;
  const instructions = block(input, 'sdr_instructions') ?? '';

  const greeting = lead.contactFirstName ? `Olá, ${lead.contactFirstName}!` : 'Olá, tudo bem?';
  const where = lead.city ? ` em ${lead.city}` : '';
  const how = lead.referredBy
    ? `, por indicação de ${lead.referredBy}`
    : lead.origin
      ? ` pelo ${lead.origin}`
      : '';
  const name = lead.name ?? 'o escritório';
  const bodies: Record<string, string> = {
    'Primeiro contato': `Sou ${sender}, da Docline. Encontrei ${name}${where}${how} e queria conversar sobre uma possível parceria. Faz sentido conversarmos 5 minutos esta semana?`,
    'Follow-up 1': `Sou ${sender}, da Docline, e retomo a mensagem que mandei para ${name}. Posso explicar em poucas linhas como a parceria funciona?`,
    'Follow-up 2': `Aqui é ${sender}, da Docline. Para ${name}${where}, a parceria pode simplificar o atendimento aos clientes. Quer que eu explique?`,
    'Follow-up 3': `Sou ${sender}, da Docline. Esta é minha última mensagem para ${name}; se fizer sentido no futuro, é só me chamar.`,
    'Resposta a interessado': `Que bom, ${lead.contactFirstName ?? 'obrigado pelo retorno'}! O próximo passo é uma conversa rápida. Pode ser terça às 10h ou quinta às 15h?`,
    'Resposta a objeção': `Entendo, ${lead.contactFirstName ?? 'obrigado pelo retorno'}. Faz sentido avaliar com calma; posso mandar um resumo para ${name} decidir sem pressa?`,
    Agendamento: `Combinado, ${lead.contactFirstName ?? 'obrigado'}! Fica confirmada nossa conversa com ${name}. Até lá!`,
    Reativação: `Sou ${sender}, da Docline. Faz um tempo que falei com ${name}${where}; posso apresentar a parceria de novo, agora com novidades?`,
  };
  let message = `${greeting} ${bodies[kind] ?? bodies['Primeiro contato']}`;
  if (instructions.includes('[fake:termo-proibido]')) message += ' Promoção imperdível!';
  if (instructions.includes('[fake:telefone]')) message += ' Meu número: (88) 99999-0000.';
  if (optOut) message += ` ${optOut}`;

  const personalizationPoints = [lead.name, lead.city, lead.contactFirstName].filter(
    (v): v is string => Boolean(v),
  );
  return {
    message,
    personalizationPoints,
    factsUsed: [],
    assumptions: lead.contactFirstName ? [] : ['Sem nome do responsável; usei saudação genérica.'],
    missingInfo: lead.contactFirstName ? [] : ['Nome do responsável'],
    tone: 'cordial' as const,
    confidence: personalizationPoints.length >= 2 ? ('high' as const) : ('medium' as const),
  };
}

const CLASSIFICATION_RULES: [RegExp, string, number, boolean, string][] = [
  [
    /nao me (mande|envie)|pare de|me (tire|remova)|descadastr|sair da lista|^sair$|^parar$/,
    'OPT_OUT',
    0.9,
    true,
    '',
  ],
  [
    /ferias|ausente|fora do escritorio|resposta automatica/,
    'OUT_OF_OFFICE',
    0.85,
    false,
    'Aguardar o retorno.',
  ],
  [
    /numero errado|nao e (aqui|o escritorio)|engano/,
    'WRONG_CONTACT',
    0.8,
    false,
    'Procurar outro contato.',
  ],
  [
    /nao tenho interesse|nao temos interesse|nao obrigad/,
    'NOT_INTERESTED',
    0.8,
    true,
    'Agradecer e encerrar.',
  ],
  [
    /ja temos|ja tenho|muito caro|sem tempo|agora nao/,
    'OBJECTION',
    0.7,
    false,
    'Responder a objeção com fatos.',
  ],
  [
    /interess|quero saber|pode mandar|vamos conversar|me liga/,
    'INTERESTED',
    0.85,
    false,
    'Propor uma reunião.',
  ],
];

function replyClassification(input: string) {
  const reply = toSearchKey(block(input, 'third_party_text') ?? '');
  for (const [pattern, label, confidence, possibleOptOut, next] of CLASSIFICATION_RULES) {
    if (pattern.test(reply)) {
      return {
        label,
        confidence,
        rationale: 'Classificação simulada pelo provedor de testes.',
        possibleOptOut,
        suggestedNextStep: next,
      };
    }
  }
  const question = (block(input, 'third_party_text') ?? '').includes('?');
  return {
    label: question ? 'QUESTION' : 'OTHER',
    confidence: question ? 0.7 : 0.4,
    rationale: 'Classificação simulada pelo provedor de testes.',
    possibleOptOut: false,
    suggestedNextStep: question ? 'Responder a dúvida.' : '',
  };
}

const MARKS: [string, AiErrorCode, string][] = [
  ['[fake:recusa]', 'REFUSAL', 'O modelo recusou o pedido.'],
  ['[fake:indisponivel]', 'UNAVAILABLE', 'Provedor de IA indisponível.'],
];

export class FakeAiProvider implements AiProvider {
  readonly name = 'fake';
  readonly models: { generation: string; classification: string };
  /** Pedidos recebidos (inspeção nos testes). */
  readonly requests: AiStructuredRequest<unknown>[] = [];
  private readonly model: string;

  /** `model`: nome informado como atendente (testes de custo usam um modelo com preço). */
  constructor(options: { model?: string } = {}) {
    this.model = options.model ?? FAKE_MODEL;
    this.models = { generation: this.model, classification: this.model };
  }

  async generateStructured<T>(request: AiStructuredRequest<T>): Promise<AiStructuredResult<T>> {
    this.requests.push(request as AiStructuredRequest<unknown>);
    const instructions = block(request.input, 'sdr_instructions') ?? '';
    for (const [mark, code, message] of MARKS) {
      if (instructions.includes(mark))
        throw new AiProviderError(code, message, { model: FAKE_MODEL });
    }
    const raw =
      request.task === 'outreach_message'
        ? outreachMessage(request.input)
        : replyClassification(request.input);
    const output = instructions.includes('[fake:invalido]') ? { message: 42 } : raw;
    const parsed = request.schema.safeParse(output);
    if (!parsed.success) {
      throw new AiProviderError('INVALID_OUTPUT', 'A saída da IA não seguiu o formato esperado.', {
        model: this.model,
      });
    }
    return {
      data: parsed.data,
      usage: {
        inputTokens: tokens(request.system) + tokens(request.input),
        outputTokens: tokens(JSON.stringify(output)),
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      },
      model: this.model,
      latencyMs: 1,
      stopReason: 'end_turn',
      fallbackUsed: false,
    };
  }
}
