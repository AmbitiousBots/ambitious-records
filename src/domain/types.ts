declare const brand: unique symbol;

type Brand<Base, Name extends string> = Base & { readonly [brand]: Name };

export type NonEmptyArray<T> = readonly [T, ...T[]];

export type Result<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });

export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });

export type TypeName = Brand<string, "TypeName">;
export type TypeVersion = Brand<number, "TypeVersion">;
export type FieldName = Brand<string, "FieldName">;
export type StageName = Brand<string, "StageName">;
export type CurrencyCode = Brand<string, "CurrencyCode">;
export type RecordId = Brand<string, "RecordId">;
export type IdemKey = Brand<string, "IdemKey">;
export type Actor = Brand<string, "Actor">;
export type EventSeq = Brand<number, "EventSeq">;
export type Instant = Brand<string, "Instant">;
export type CalendarDate = Brand<string, "CalendarDate">;
export type DecimalText = Brand<string, "DecimalText">;

export const NAME_LIMIT = 64;

export const NAME_PATTERNS = {
  typeName: /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/,
  fieldName: /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/,
  stageName: /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/,
  currencyCode: /^[A-Z]{3}$/,
} as const;

export const isTypeName = (raw: string): raw is TypeName =>
  raw.length <= NAME_LIMIT && NAME_PATTERNS.typeName.test(raw);
export const isFieldName = (raw: string): raw is FieldName =>
  raw.length <= NAME_LIMIT && NAME_PATTERNS.fieldName.test(raw);
export const isStageName = (raw: string): raw is StageName =>
  raw.length <= NAME_LIMIT && NAME_PATTERNS.stageName.test(raw);
export const isCurrencyCode = (raw: string): raw is CurrencyCode => NAME_PATTERNS.currencyCode.test(raw);

export const FIELD_KINDS = [
  "string",
  "text",
  "int",
  "decimal",
  "money",
  "date",
  "datetime",
  "bool",
  "enum",
  "ref",
] as const;

export type FieldKind = (typeof FIELD_KINDS)[number];

export const UNIQUE_FIELD_KINDS = ["string", "int", "date", "datetime", "ref"] as const;

export type UniqueFieldKind = (typeof UNIQUE_FIELD_KINDS)[number];

type PlainKind = Exclude<FieldKind, "money" | "enum" | "ref">;

type Uniqueness<Kind extends FieldKind> = Kind extends UniqueFieldKind
  ? { readonly unique: boolean }
  : { readonly unique: false };

type FieldOfKind<Kind extends FieldKind, Detail = unknown> = Kind extends FieldKind
  ? { readonly kind: Kind; readonly required: boolean } & Uniqueness<Kind> & Detail
  : never;

export type Field =
  | FieldOfKind<PlainKind>
  | FieldOfKind<"money", { readonly currency: CurrencyCode }>
  | FieldOfKind<"enum", { readonly values: NonEmptyArray<string> }>
  | FieldOfKind<"ref", { readonly type: TypeName }>;

export type FieldValue =
  | { readonly kind: "string" | "text" | "enum"; readonly value: string }
  | { readonly kind: "int"; readonly value: number }
  | { readonly kind: "decimal" | "money"; readonly value: DecimalText }
  | { readonly kind: "date"; readonly value: CalendarDate }
  | { readonly kind: "datetime"; readonly value: Instant }
  | { readonly kind: "bool"; readonly value: boolean }
  | { readonly kind: "ref"; readonly value: RecordId };

export type FieldValues = ReadonlyMap<FieldName, FieldValue>;

export type FieldPatch = ReadonlyMap<FieldName, FieldValue | null>;

export type Transition = {
  readonly from: StageName;
  readonly to: StageName;
  readonly requires: ReadonlySet<FieldName>;
};

export type RecordTypeDocument = {
  readonly type: string;
  readonly version: number;
  readonly fields: Readonly<Record<string, FieldDocument>>;
  readonly stages: readonly string[];
  readonly initial: string;
  readonly transitions: readonly TransitionDocument[];
  readonly terminal: readonly string[];
};

export type FieldDocument = {
  readonly kind: FieldKind;
  readonly required?: boolean;
  readonly unique?: boolean;
  readonly currency?: string;
  readonly values?: readonly string[];
  readonly type?: string;
};

export type TransitionDocument = {
  readonly from: string | readonly string[];
  readonly to: string;
  readonly requires?: readonly string[];
};

export const DEFINITION_RULES = [
  "initial-is-a-stage",
  "terminal-are-stages",
  "transition-stages-are-stages",
  "required-fields-are-fields",
  "no-transition-out-of-terminal",
  "transition-declared-once",
] as const;

export type DefinitionRule = (typeof DEFINITION_RULES)[number];

export type DefinitionProblem =
  | { readonly rule: "initial-is-a-stage"; readonly initial: string }
  | { readonly rule: "terminal-are-stages"; readonly stage: string }
  | { readonly rule: "transition-stages-are-stages"; readonly transition: number; readonly stage: string }
  | { readonly rule: "required-fields-are-fields"; readonly transition: number; readonly field: string }
  | { readonly rule: "no-transition-out-of-terminal"; readonly transition: number; readonly from: StageName }
  | { readonly rule: "transition-declared-once"; readonly from: StageName; readonly to: StageName };

export type RecordType = Brand<
  {
    readonly type: TypeName;
    readonly version: TypeVersion;
    readonly fields: ReadonlyMap<FieldName, Field>;
    readonly stages: NonEmptyArray<StageName>;
    readonly initial: StageName;
    readonly terminal: ReadonlySet<StageName>;
    readonly transitions: readonly Transition[];
  },
  "RecordType"
>;

export type ParseRecordType = (
  document: RecordTypeDocument,
) => Result<RecordType, NonEmptyArray<DefinitionProblem>>;

export type StoredRecord = {
  readonly id: RecordId;
  readonly type: TypeName;
  readonly typeVersion: TypeVersion;
  readonly stage: StageName;
  readonly fields: FieldValues;
  readonly createdAt: Instant;
  readonly updatedAt: Instant;
};

type EventOf<Kind extends string, Detail> = {
  readonly seq: EventSeq;
  readonly recordId: RecordId;
  readonly kind: Kind;
  readonly at: Instant;
  readonly actor: Actor;
  readonly idemKey: IdemKey;
} & Detail;

export type RecordEvent =
  | EventOf<"created", { readonly type: TypeName; readonly typeVersion: TypeVersion; readonly toStage: StageName; readonly patch: FieldPatch }>
  | EventOf<"updated", { readonly patch: FieldPatch }>
  | EventOf<"moved", { readonly fromStage: StageName; readonly toStage: StageName }>;

export type RecordHistory = readonly [Extract<RecordEvent, { kind: "created" }>, ...RecordEvent[]];

export type Replay = (history: RecordHistory) => StoredRecord;

export type UniqueClaim = {
  readonly type: TypeName;
  readonly field: FieldName;
  readonly value: string;
  readonly recordId: RecordId;
};

export type NextStage = {
  readonly to: StageName;
  readonly missing: readonly FieldName[];
};

export type AllowedMoves = (type: RecordType, record: StoredRecord) => readonly NextStage[];

export type MoveRefusal =
  | { readonly reason: "terminal-stage"; readonly stage: StageName; readonly allowed: readonly [] }
  | { readonly reason: "not-declared"; readonly from: StageName; readonly to: string; readonly allowed: readonly StageName[] }
  | {
      readonly reason: "missing-required-fields";
      readonly from: StageName;
      readonly to: StageName;
      readonly missing: NonEmptyArray<FieldName>;
      readonly allowed: readonly StageName[];
    };

export type DecideMove = (
  type: RecordType,
  record: StoredRecord,
  to: string,
) => Result<Transition, MoveRefusal>;

export const MODULE_ERROR_CODES = ["E_TRANSITION", "E_INCOMPATIBLE"] as const;

export type ModuleErrorCode = (typeof MODULE_ERROR_CODES)[number];
