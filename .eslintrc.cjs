/* ESLint 配置（PRD §6.3：前端 ESLint + Prettier）
   public 代码，只在 main 上改 */
module.exports = {
  root: true,
  env: {
    browser: true,
    es2022: true,
    node: true
  },
  extends: ['eslint:recommended', 'plugin:vue/vue3-recommended'],
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module'
  },
  rules: {
    'vue/multi-word-component-names': 'off',
    'vue/max-attributes-per-line': 'off',
    'vue/singleline-html-element-content-newline': 'off',
    'vue/html-self-closing': 'off',
    'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    'no-console': ['warn', { allow: ['warn', 'error'] }]
  },
  ignorePatterns: ['dist/', 'node_modules/', '*.min.js']
}
