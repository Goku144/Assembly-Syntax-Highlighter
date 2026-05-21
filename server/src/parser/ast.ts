import { Range } from "vscode-languageserver/node";

export type StatementKind =
  | "empty"
  | "label"
  | "instruction"
  | "directive"
  | "data"
  | "equ"
  | "invalid";

export type RawOperand = {
  text: string;
  range: Range;
  startOffset: number;
  endOffset: number;
};

export type ParsedStatement = {
  kind: StatementKind;
  uri: string;
  text: string;
  line: number;
  range: Range;
  startOffset: number;
  endOffset: number;
  label?: string;
  mnemonic?: string;
  directive?: string;
  operands: RawOperand[];
  message?: string;
  documentation?: DocComment;
};

export type ParsedProgram = {
  uri: string;
  text: string;
  statements: ParsedStatement[];
  diagnostics: StructuralDiagnostic[];
  commentRanges: Range[];
};

export type StructuralDiagnostic = {
  message: string;
  range: Range;
  severity: "error" | "warning";
};

export type DocComment = {
  brief?: string;
  params: Array<{ name?: string; description: string }>;
  returns?: string;
  notes: string[];
  raw: string[];
};
