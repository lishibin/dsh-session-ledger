const secretPatterns = [
  /\bsk-[A-Za-z0-9_-]{16,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /((?:api[_-]?key|access[_-]?token|password|passwd|secret)\s*[:=]\s*)([^\s,;]+)/gi,
]

export function redactSensitiveText(input) {
  let text = String(input)
  text = text.replace(secretPatterns[0], '[REDACTED_SECRET]')
  text = text.replace(secretPatterns[1], '[REDACTED_SECRET]')
  text = text.replace(secretPatterns[2], '[REDACTED_PRIVATE_KEY]')
  text = text.replace(secretPatterns[3], '$1[REDACTED_SECRET]')
  return text
}

export function limitText(input, maxCodePoints = 600) {
  const text = String(input ?? '').replace(/\s+/g, ' ').trim()
  return [...text].slice(0, maxCodePoints).join('')
}
