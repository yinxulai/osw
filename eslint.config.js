import tsParser from '@typescript-eslint/parser'
import peculiar from '@yinxulai/eslint-plugin-peculiar'

export default [
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'release/**',
    ],
  },
  ...peculiar.configs['flat/strict'],
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
    },
  },
  {
    files: ['source/render/source/components/ui/**/*.{ts,tsx}'],
    rules: {
      'peculiar/func-param-destructuring': 'off',
      'peculiar/func-param-inline-object-type': 'off',
      'peculiar/func-signature-linebreak': 'off',
    },
  },
]
