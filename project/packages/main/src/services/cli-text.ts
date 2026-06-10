/**
 * Cleans raw local-CLI output before it reaches the UI, persisted messages or
 * log files.
 *
 * Even in their non-interactive modes, local CLIs occasionally emit ANSI
 * colour codes, cursor movement, OSC window-title sequences or TUI spinner
 * frames (especially on Windows, where terminal detection is unreliable).
 * None of that belongs in a chat bubble or a UTF-8 log line, and stray
 * control bytes are the main source of mojibake when mixed with Chinese text.
 *
 * The escape characters are assembled with `String.fromCharCode` so this
 * source file itself stays free of raw control bytes.
 */

const ESC = String.fromCharCode(0x1b);
const BEL = String.fromCharCode(0x07);

// CSI sequences (colours, cursor movement): ESC [ params intermediates final
const CSI_PATTERN = new RegExp(`${ESC}\\[[0-9;?]*[ -/]*[@-~]`, "g");
// OSC sequences (window title, hyperlinks): ESC ] ... terminated by BEL or ESC \
const OSC_PATTERN = new RegExp(`${ESC}\\][^${BEL}${ESC}]*(?:${BEL}|${ESC}\\\\)?`, "g");
// Remaining escape sequences: ESC + optional intermediates (0x20-0x2F) + one
// final byte. Covers charset switches like ESC ( B and keypad modes like ESC =.
// CSI/OSC are stripped first, so this generic form cannot eat their payloads.
const SIMPLE_ESC_PATTERN = new RegExp(`${ESC}[ -/]*[0-~]`, "g");
// Control characters that are not \t \n \r (BEL, backspace, vertical tab, DEL, ...)
const CONTROL_PATTERN = new RegExp(
  "[\\x00-\\x08\\x0b\\x0c\\x0e-\\x1f\\x7f]",
  "g",
);

export function sanitizeCliText(text: string): string {
  if (!text) {
    return text;
  }
  return (
    text
      .replace(OSC_PATTERN, "")
      .replace(CSI_PATTERN, "")
      .replace(SIMPLE_ESC_PATTERN, "")
      .replace(/\r\n/g, "\n")
      // A lone CR is a TUI "overwrite this line" trick (progress bars/spinners);
      // keep every frame readable by turning it into a line break instead.
      .replace(/\r/g, "\n")
      .replace(CONTROL_PATTERN, "")
  );
}
