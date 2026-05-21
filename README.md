# Assembly-Syntax-Highlighter

Assembly-Syntax-Highlighter is the Orion Visual Studio Code extension for reading and working with assembly code across several architectures. It combines TextMate syntax highlighting with a NASM-aware language server for diagnostics, symbol navigation, references, rename support, and hover information.

This is the new Orion project line with updated ownership, repository metadata, and project documentation.

## Features

- Syntax highlighting for x86, x64, ARM, AArch64, RISC-V, and MIPS-style assembly.
- Support for Intel, AT&T, NASM, MASM, GAS, and compiler-generated assembly patterns.
- Highlighting for instructions, registers, memory operands, labels, constants, directives, and comments.
- NASM-aware language intelligence through the bundled language server.
- Configurable line and block comment behavior for different assemblers.

## Supported File Types

Orion Assembly activates automatically for:

- `.asm`
- `.s`
- `.S`
- `.nasm`
- `.asmx`
- `.inc`
- `.gas`
- `.att`
- `.intel`
- `.x86`
- `.x86_64`
- `.amd64`
- `.ia32`
- `.arm`
- `.aarch64`
- `.riscv`
- `.mips`

You can also select the `x86/x64 Assembly` language mode manually from the VS Code language selector.

## Configuration

Comment behavior can be adjusted from VS Code settings:

```json
{
  "assembly.comments.lineComment": ";",
  "assembly.comments.blockComment": ["/*", "*/"]
}
```

NASM external validation is optional and disabled by default:

```json
{
  "assembly.nasm.executablePath": "nasm",
  "assembly.nasm.enableExternalValidation": false
}
```

## Development

Install dependencies and compile the extension:

```bash
npm install
npm run compile
```

Useful project files:

- `package.json` defines the VS Code extension manifest.
- `syntaxes/asm.tmLanguage.json` contains the TextMate grammar.
- `client/src/extension.ts` starts the VS Code language client.
- `server/src/server.ts` starts the language server.
- `server/src/parser/nasmParser.ts` handles NASM-oriented parsing.
- `server/src/analysis` contains diagnostics, symbol indexing, and instruction validation.

## Publishing To The VS Code Marketplace

The extension is configured for the Visual Studio Code Marketplace under the `Goku144` publisher ID. Before publishing, create or verify that publisher in the Marketplace publisher dashboard.

```bash
npm install
npm run compile
vsce package
vsce publish
```

Publishing requires a Visual Studio Marketplace Personal Access Token with Marketplace Manage permission. If you have not logged in yet, run:

```bash
vsce login Goku144
```

Then paste the token when prompted. After that, `vsce publish` uploads the extension to the VS Code Marketplace.

## License

Released under the MIT License. See `LICENSE.txt` for details.
