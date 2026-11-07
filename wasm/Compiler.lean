import OpenVerse.Front.Elab
import OpenVerse.Core.Encode

/-- First byte: 0 + OVBC on success, 4 + UTF-8 diagnostic on error.
    Arguments are one per line, matching the playground's argument editor. -/
@[export playground_compile]
def playgroundCompile (source argsText : String) : ByteArray :=
  let args := if argsText.isEmpty then [] else argsText.splitOn "\n"
  let compiled : Except String OpenVerse.Prog := do
    let (tops, imports) ← OpenVerse.Front.parseProgramImports source
    if !imports.isEmpty then
      throw "This playground accepts one source file; using{...} filesystem imports are unavailable."
    OpenVerse.Front.compileTops tops args ((source.splitOn "Args").length > 1) none
  match compiled with
  | .ok program => (ByteArray.empty.push 0) ++ program.encode
  | .error message => (ByteArray.empty.push 4) ++ message.toUTF8
