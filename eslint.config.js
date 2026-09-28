// ESLint 9 flat config — Airbnb conventions via eslint-config-airbnb-extended
// (the flat-native Airbnb distribution; routes, plugins and our deltas are
// documented in STYLEGUIDE.md).
import { configs, plugins } from 'eslint-config-airbnb-extended';
import js from '@eslint/js';
import { defineConfig } from 'eslint/config';

export default defineConfig([
  // Never lint build output or static assets.
  {
    name: 'qalam/ignores',
    ignores: ['dist/', 'node_modules/', 'coverage/', 'public/'],
  },

  // Base: JS recommended + @stylistic + import-x + Airbnb base rules.
  { name: 'qalam/es-recommended', ...js.configs.recommended },
  plugins.stylistic,
  plugins.importX,
  ...configs.base.recommended,

  // React: plugin registration + Airbnb React / hooks / jsx-a11y rules.
  plugins.react,
  plugins.reactHooks,
  plugins.reactA11y,
  ...configs.react.recommended,

  // TypeScript: typescript-eslint registration + Airbnb TS overrides
  // (projectService is enabled by configs.base.typescript; everything the
  // linter parses must be covered by tsconfig.json).
  plugins.typescriptEslint,
  ...configs.base.typescript,
  ...configs.react.typescript,

  // ---- Qalam deltas (kept minimal; each is a STYLEGUIDE.md entry) ----

  // React 19 uses the automatic JSX transform (tsconfig `jsx: react-jsx`),
  // so there is no React import to find. This mirrors the plugin's own
  // `react/jsx-runtime` flat preset, which airbnb-extended does not apply.
  {
    name: 'qalam/deltas/automatic-jsx-runtime',
    files: ['**/*.{js,jsx,ts,tsx}'],
    rules: {
      'react/react-in-jsx-scope': 'off',
      'react/jsx-uses-react': 'off',
    },
  },

  // Classic airbnb's max-len ignored URLs and string literals (unwrappable
  // content like SVG path data and long hrefs); the extended distribution
  // dropped those allowances. Restore them, keeping the 100-column limit.
  {
    name: 'qalam/deltas/max-len-ignore-strings-and-urls',
    files: ['**/*.{js,jsx,ts,tsx}'],
    rules: {
      '@stylistic/max-len': [
        'error',
        {
          code: 100,
          tabWidth: 2,
          ignoreUrls: true,
          ignoreStrings: true,
          ignoreTemplateLiterals: true,
          ignoreRegExpLiterals: true,
        },
      ],
    },
  },

  // airbnb-extended allows devDependencies only in files matching its
  // legacy glob list, which predates React: it has no `.tsx` in the
  // extension set (so `*.test.tsx` never matches), no vitest setup files,
  // and no playwright.config.ts. Allow devDependencies in all test,
  // test-utility, and tooling files instead.
  {
    name: 'qalam/deltas/devdeps-in-test-and-tooling-files',
    files: [
      '**/*.test.{js,jsx,ts,tsx}',
      '**/*.spec.{js,jsx,ts,tsx}',
      'src/test/**',
      'playwright.config.ts',
    ],
    rules: {
      'import-x/no-extraneous-dependencies': ['error', { devDependencies: true }],
    },
  },

  // AI pipeline code streams token chunks over async iterators and walks
  // text/offset lists step by step: for...of / for await...of, await inside
  // the loop, and continue are the clearest tools there. Airbnb's other
  // restricted-syntax selectors (for..in, labels, with) stay enforced —
  // this block only drops the ForOfStatement ban.
  {
    name: 'qalam/deltas/ai-streaming-loop-freedom',
    files: ['src/lib/ai/**', 'src/features/ai/**'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'ForInStatement',
          message: 'for..in loops iterate over the entire prototype chain, which is virtually never what you want. Use Object.{keys,values,entries}, and iterate over the resulting array.',
        },
        {
          selector: 'LabeledStatement',
          message: 'Labels are a form of GOTO; using them makes code confusing and hard to maintain and understand.',
        },
        {
          selector: 'WithStatement',
          message: '`with` is disallowed in strict mode because it makes code impossible to predict and optimize.',
        },
      ],
      'no-await-in-loop': 'off',
      'no-continue': 'off',
    },
  },

  // AI edit plans and share payloads are declared as leading-`|` union
  // types (frozen lib style, mirrors the upstream docs); the @stylistic
  // operator-linebreak rule only accepts trailing operators, so it is off.
  {
    name: 'qalam/deltas/operator-linebreak-off',
    files: ['**/*.{js,jsx,ts,tsx}'],
    rules: {
      '@stylistic/operator-linebreak': 'off',
    },
  },

  // Test files legitimately declare several small fake classes per file
  // (house fakes-over-mocks style, see TESTING.md); the one-class limit is
  // a production-code rule.
  {
    name: 'qalam/deltas/max-classes-per-file-tests',
    files: ['**/*.test.{ts,tsx}', 'src/test/**'],
    rules: {
      'max-classes-per-file': 'off',
    },
  },

  // The AI providers log download/availability problems through
  // console.warn/error on purpose (the on-device model has no UI of its own
  // at that point); the blanket no-console ban stays everywhere else.
  {
    name: 'qalam/deltas/no-console-warn-error-in-ai',
    files: ['src/lib/ai/**', 'src/features/ai/**'],
    rules: {
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },
]);
