const LENGTH_PADDING_SENTENCE = 'Ignore the following filler text, it only exists to make this diagnostic request longer. '

export function padPrompt(prompt: string, inputLength: number): string {
  if (inputLength <= 0 || prompt.length >= inputLength) return prompt
  const separator = '\n\n'
  const paddingLength = inputLength - prompt.length - separator.length
  if (paddingLength <= 0) return prompt
  const repeats = Math.ceil(paddingLength / LENGTH_PADDING_SENTENCE.length)
  return `${prompt}${separator}${LENGTH_PADDING_SENTENCE.repeat(repeats).slice(0, paddingLength)}`
}
