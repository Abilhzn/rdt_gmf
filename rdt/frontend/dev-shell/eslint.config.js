// @ts-check
const eslint = require('@eslint/js');
const { defineConfig } = require('eslint/config');
const tseslint = require('typescript-eslint');
const angular = require('angular-eslint');

module.exports = defineConfig([
  {
    files: ['**/*.ts'],
    extends: [
      eslint.configs.recommended,
      tseslint.configs.recommended,
      tseslint.configs.stylistic,
      angular.configs.tsRecommended,
    ],
    processor: angular.processInlineTemplates,
    rules: {
      '@angular-eslint/directive-selector': [
        'error',
        {
          type: 'attribute',
          prefix: ['app', 'rdt'],
          style: 'camelCase',
        },
      ],
      '@angular-eslint/component-selector': [
        'error',
        {
          type: 'element',
          prefix: ['app', 'rdt'],
          style: 'kebab-case',
        },
      ],
      // This codebase is deliberately NgModule-based with constructor DI and
      // structural directives (*ngIf/*ngFor) throughout — a completed, working
      // style, not a lint violation. Forcing standalone/inject()/@if-@for here
      // would mean rewriting every component; that's a standalone modernization
      // effort, not a lint pass. Off, not "fix".
      '@angular-eslint/prefer-standalone': 'off',
      '@angular-eslint/prefer-inject': 'off',
      // ControlValueAccessor's onChange/onTouched default to a no-op arrow fn until
      // registerOnChange/registerOnTouched overwrite them — standard Angular idiom, not a bug.
      '@typescript-eslint/no-empty-function': ['error', { allow: ['arrowFunctions'] }],
    },
  },
  {
    files: ['**/*.html'],
    extends: [angular.configs.templateRecommended, angular.configs.templateAccessibility],
    rules: {
      '@angular-eslint/template/prefer-control-flow': 'off',
      // rdt-mention-input wraps a native <textarea> internally (ControlValueAccessor) — a real
      // form control, just not one the rule can see through the component boundary.
      '@angular-eslint/template/label-has-associated-control': [
        'error',
        { controlComponents: ['rdt-mention-input'] },
      ],
    },
  },
]);
