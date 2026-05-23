import { Diagnostic } from "vscode-languageserver/node";
import { ParsedProgram, ParsedStatement } from "../parser/ast";
type Bits = "16" | "32" | "64";
type ValidationContext = {
    bits: Bits;
    knownInstructions: Set<string>;
    macroNames: Set<string>;
    constantNames: Set<string>;
};
export declare function loadInstructionForms(extensionRoot: string): void;
export declare function validateInstructions(program: ParsedProgram, knownInstructions: Set<string>, macroNames: Set<string>): Diagnostic[];
export declare function validateInstruction(statement: ParsedStatement, context: ValidationContext): Diagnostic[];
export {};
