# Orion Assembly Project Notes

Assembly-Syntax-Highlighter is a Visual Studio Code extension named `assembly-syntax-highlighter`, version `0.1.0`, published under the Orion identity. It registers one assembly language mode, keeps broad TextMate grammar highlighting, and runs a NASM-focused language server for editor intelligence such as hovers, diagnostics, symbol navigation, references, and rename.

The project supports highlighting patterns for x86, x64, ARM/AArch64, RISC-V, and MIPS-style assembly. The deeper language-server features are currently NASM-oriented.

## Extension Manifest

The entry point is `package.json`. It defines:

- Extension metadata, repository links, publisher, icon, and license.
- Activation on `onLanguage:x86asm`.
- The client entry point at `client/out/extension.js`.
- The `x86asm` language id and supported file extensions.
- Grammar registration through `syntaxes/asm.tmLanguage.json`.
- Custom semantic token types for NASM directives, registers, and documentation tags.
- User settings for configurable comments and optional NASM validation.

## Important Files

- `package.json`: VS Code extension manifest, language registration, grammar registration, settings, and marketplace metadata.
- `language-configuration.json`: comments, brackets, folding, indentation, and editor behavior.
- `client/src/extension.ts`: VS Code LSP client.
- `server/src/server.ts`: NASM language server entry point.
- `server/src/parser/nasmParser.ts`: parser layer with an optional Tree-sitter WASM hook and a built-in semantic fallback.
- `server/src/analysis/symbolTable.ts`: workspace symbol and reference index.
- `server/src/analysis/instructionValidator.ts`: operand classification and instruction-form validation.
- `server/assets/x86_instruction_forms.json`: normalized instruction forms used for operand validation.
- `syntaxes/asm.tmLanguage.json`: TextMate grammar for syntax highlighting.
- `syntaxes/x86_instructions.json`: local x86 instruction documentation database.
- `test_highlighting.asm`: sample file that exercises x86, AT&T, ARM, RISC-V, and MIPS highlighting.
- `README.md`: user-facing README.
- `LICENSE.txt`: MIT license text.
- `images/icon.png`: extension icon.

## Build

Install dependencies, then compile the client and server:

```bash
npm install
npm run compile
```

The generated `client/out` and `server/out` folders are ignored by git, but they are required when packaging or running the compiled extension.
