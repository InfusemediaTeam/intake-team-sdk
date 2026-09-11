// @ts-check
import eslint from '@eslint/js';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * The type-aware preset is deliberate: this package hands data across a process
 * boundary, and an unchecked `any` here is a malformed contract there.
 */
export default tseslint.config(
  { ignores: ['eslint.config.mjs', 'dist/**', 'dist-test/**'] },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  eslintPluginPrettierRecommended,
  {
    languageOptions: {
      globals: { ...globals.node },
      sourceType: 'commonjs',
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ['tests/**/*.ts'],
    rules: {
      // `describe` and `it` from `node:test` return promises the runner owns.
      // Awaiting them is wrong, and `void`-prefixing every case would be noise.
      '@typescript-eslint/no-floating-promises': 'off',
    },
  },
);
