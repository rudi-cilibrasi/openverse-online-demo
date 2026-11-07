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
  shapes: {
    source: `# Classes behind an interface, overloading, and a generic function.

shape := interface:
    Area():int
    Name():string

square := class(shape):
    Side:int
    Area<override>():int = Side * Side
    Name<override>():string = "square"

rect := class(shape):
    W:int
    H:int
    Area<override>():int = W * H
    Name<override>():string = "rectangle"

# One name, chosen by the argument's type.
Describe(S:shape):string = "a {S.Name()} of area {S.Area()}"
Describe(N:int):string = "{N} shapes"

# Works for an array of any type; fails when it is empty.
Last(Items:[]t where t:type)<decides>:t = Items[Items.Length - 1]

Main():void =
    Shapes:[]shape = array{square{Side := 3}, rect{W := 2, H := 5}}
    for (S : Shapes):
        Print(Describe(S))
    Print(Describe(Shapes.Length))
    var Total:int = 0
    for (S : Shapes):
        set Total += S.Area()
    Print("total area: {Total}")
    if (L := Last[Shapes]):
        Print("the last is a {L.Name()}")
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
