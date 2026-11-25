// PreToolUse hook for the read-only review subagents.
// Allows only read-only git commands through the Bash tool; everything else is blocked.
// Contract: hook JSON on stdin; exit 0 = allow, exit 2 = block (stderr is shown to the agent).

const ALLOWED = [
  /^git\s+diff(\s|$)/,
  /^git\s+log(\s|$)/,
  /^git\s+show(\s|$)/,
  /^git\s+status(\s|$)/,
  /^git\s+merge-base(\s|$)/,
  /^git\s+rev-parse(\s|$)/,
  /^git\s+ls-files(\s|$)/,
  /^git\s+blame(\s|$)/,
  /^git\s+branch\s+--show-current\s*$/,
];

// Shell control characters that could chain or redirect into a write.
const FORBIDDEN = /[;&|<>`\n\r]|\$\(/;

// Options that make otherwise read-only commands write files.
const WRITING_OPTIONS = /(^|\s)--output(=|\s)|(^|\s)-o\s/;

function block(reason) {
  process.stderr.write(`Blocked by readonly-git hook: ${reason}\n`);
  process.exit(2);
}

let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  raw += chunk;
});
process.stdin.on("end", () => {
  let command;
  try {
    const input = JSON.parse(raw);
    command = input?.tool_input?.command;
  } catch {
    block("could not parse hook input");
  }
  if (typeof command !== "string") block("no command found");

  const cmd = command.trim();
  if (FORBIDDEN.test(cmd)) block("shell operators are not allowed");
  if (WRITING_OPTIONS.test(cmd)) block("output options are not allowed");
  if (!ALLOWED.some((re) => re.test(cmd))) {
    block("only read-only git commands (diff, log, show, status, blame, ...) are allowed");
  }
  process.exit(0);
});
