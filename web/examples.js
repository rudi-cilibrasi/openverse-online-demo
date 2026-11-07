export const examples = {
  hello: {
    source: `# Your first little Verse program.
# Change the message and run it again.

Main():void =
    Print("Hello, Verse!")
    Print("A small idea, brought to life.")
`,
    args: '',
  },
  rollback: {
    source: `# A failed condition rolls back its effects.
# What happens if you change 100 to 0?

Main():void =
    var Attempts:int = 0
    if (set Attempts += 1, Attempts > 100):
        Print("We made it!")
    else:
        Print("The condition failed; the change rolled back.")
    Print("Attempts = {Attempts}")
`,
    args: '',
  },
  loops: {
    source: `# Keep just the numbers for which Half succeeds.

Half(N:int)<decides>:int =
    Mod[N, 2] = 0
    Quotient[N, 2]

Main():void =
    for (I := 1..10, H := Half[I]):
        Print("{I} / 2 = {H}")
`,
    args: '',
  },
  args: {
    source: `# Open Program arguments below and add a name.
# Each line becomes one item in Args.

Main():void =
    if (Name := Args[0]):
        Print("Hello, {Name}!")
    else:
        Print("Tell me your name in Program arguments.")
    for (Word : Args):
        Print("You said: {Word}")
`,
    args: 'Ada',
  },
};
