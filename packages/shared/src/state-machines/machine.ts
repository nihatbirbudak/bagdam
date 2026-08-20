// ── Durum makinesi çekirdeği ─────────────────────────────────────────────────
// Her makine (Order / Subscription / Cycle / Payment / Cancellation) aynı kalıpla tanımlanır:
//   X_TRANSITIONS: Record<State, readonly State[]>      — izinli geçişler (tek kaynak)
//   X_TRANSITION_EVENTS: { 'FROM->TO': readonly Event[] } — geçişi tetikleyen olay adları
//   xMachine = defineMachine(...)                         — canTransition / assertTransition / nextStates …
// Servisler durum yazmadan önce `assertXTransition(from, to)` çağırır; hata → 409 `INVALID_TRANSITION`.
// Doküman karşılığı: docs/state-machines.md (tablolar bu dosyalardan türetilir; ikisi aynı olmalı).

export type TransitionTable<S extends string> = Readonly<Record<S, readonly S[]>>;
export type TransitionKey<S extends string> = `${S}->${S}`;
export type TransitionEvents<S extends string, E extends string> = Readonly<Partial<Record<TransitionKey<S>, readonly E[]>>>;

/** Geçersiz geçiş — api'de 409 Conflict + `error: 'INVALID_TRANSITION'` zarfına çevrilir. */
export class InvalidTransitionError extends Error {
  readonly code = 'INVALID_TRANSITION' as const;
  constructor(
    readonly machine: string,
    readonly from: string,
    readonly to: string,
  ) {
    super(`${machine}: ${from} → ${to} geçişi geçersiz`);
    this.name = 'InvalidTransitionError';
  }
}

export interface StateMachine<S extends string, E extends string = string> {
  readonly name: string;
  readonly initial: S;
  /** Tüm durumlar (tablo anahtarları, Prisma enum sırası). */
  readonly states: readonly S[];
  readonly transitions: TransitionTable<S>;
  readonly events: TransitionEvents<S, E>;
  /** Çıkışı olmayan (terminal) durumlar. */
  readonly terminalStates: readonly S[];
  canTransition(from: S, to: S): boolean;
  /** Geçersizse InvalidTransitionError fırlatır. */
  assertTransition(from: S, to: S): void;
  nextStates(from: S): readonly S[];
  isTerminal(state: S): boolean;
  /** Geçişi tetikleyen olay adları (dokümantasyon/loglama; boş dizi = tanımsız). */
  eventsFor(from: S, to: S): readonly E[];
  /** Bir durumdan belirli bir olayla gidilebilen hedefler. */
  targetsForEvent(from: S, event: E): readonly S[];
}

export interface MachineDefinition<S extends string, E extends string> {
  name: string;
  initial: S;
  transitions: TransitionTable<S>;
  events: TransitionEvents<S, E>;
}

export function defineMachine<S extends string, E extends string = string>(def: MachineDefinition<S, E>): StateMachine<S, E> {
  const states = Object.keys(def.transitions) as S[];
  const next = (from: S): readonly S[] => def.transitions[from] ?? [];
  const canTransition = (from: S, to: S): boolean => next(from).includes(to);
  const eventsFor = (from: S, to: S): readonly E[] => def.events[`${from}->${to}` as TransitionKey<S>] ?? [];
  return {
    name: def.name,
    initial: def.initial,
    states,
    transitions: def.transitions,
    events: def.events,
    terminalStates: states.filter((s) => next(s).length === 0),
    canTransition,
    assertTransition(from, to) {
      if (!canTransition(from, to)) throw new InvalidTransitionError(def.name, from, to);
    },
    nextStates: next,
    isTerminal: (state) => next(state).length === 0,
    eventsFor,
    targetsForEvent: (from, event) => next(from).filter((to) => eventsFor(from, to).includes(event)),
  };
}

/** Testlerde/CI'da: olay tablosu ile geçiş tablosunun birbirini tam karşıladığını doğrular. */
export function findMachineInconsistencies<S extends string, E extends string>(machine: StateMachine<S, E>): string[] {
  const problems: string[] = [];
  const stateSet = new Set<string>(machine.states);
  for (const key of Object.keys(machine.events)) {
    const [from, to] = key.split('->');
    if (!from || !to || !stateSet.has(from) || !stateSet.has(to)) {
      problems.push(`${machine.name}: olay anahtarı bilinmeyen durum içeriyor: ${key}`);
      continue;
    }
    if (!machine.canTransition(from as S, to as S)) {
      problems.push(`${machine.name}: olay tanımlı ama geçiş tabloda yok: ${key}`);
    }
    if ((machine.events[key as TransitionKey<S>] ?? []).length === 0) {
      problems.push(`${machine.name}: olay listesi boş: ${key}`);
    }
  }
  for (const from of machine.states) {
    for (const to of machine.nextStates(from)) {
      if (!stateSet.has(to)) problems.push(`${machine.name}: ${from} → bilinmeyen durum ${to}`);
      if (machine.eventsFor(from, to).length === 0) problems.push(`${machine.name}: geçişin olayı yok: ${from}->${to}`);
    }
  }
  return problems;
}
