# The README hero. Record with:  vhs tapes/bootlog.tape   (from the repo root)
#
# Runs against tapes/fixtures/home, not this machine: build it first with
#   bun tapes/fixture.ts
# A live run would put real repo names and real commit subjects in a public gif,
# and would show a different day every time it was re-rendered.
#
# Terminal settings match ghostty on the machine this was shot on:
# Cascadia Code NF at 19, padding 12, swatch theme spider-verse.

Output .github/assets/bootlog.gif

Set Shell "zsh"
Set FontFamily "Cascadia Code NF"
Set FontSize 19
Set Width 1200
Set Height 560
Set Padding 12
Set TypingSpeed 55ms
Set Theme { "name": "spider-verse", "background": "#0d0a1e", "foreground": "#ece9f7", "cursor": "#ff1f6b", "selection": "#272049", "black": "#1b1638", "red": "#b01c18", "green": "#2fbf7a", "yellow": "#d99a12", "blue": "#6b4fd6", "magenta": "#d6155a", "cyan": "#00a8cc", "white": "#c9c4dd", "brightBlack": "#5c5480", "brightRed": "#ff473c", "brightGreen": "#3dffa8", "brightYellow": "#ffc93c", "brightBlue": "#8b6cff", "brightMagenta": "#ff1f6b", "brightCyan": "#00d4ff", "brightWhite": "#ece9f7" }

# HOME is redirected before bun starts, because Bun caches homedir() at process
# start and ignores a later change. Run the repo's own source, not whatever
# bootlog happens to be on PATH.
Hide
Type "BL=$PWD && export HOME=$BL/tapes/fixtures/home && bootlog() { bun $BL/bootlog.ts $@ } && export PS1='%F{5}❯%f ' && clear"
Enter
Sleep 2s
Show

Sleep 1s
Type "bootlog"
Sleep 500ms
Enter
Sleep 4s
Screenshot .github/assets/bootlog.png
Sleep 3s
