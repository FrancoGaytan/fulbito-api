module.exports = {
  root: true,
  parser: "@typescript-eslint/parser",
  plugins: ["@typescript-eslint", "import"],
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "plugin:import/typescript",
    "prettier"
  ],
  rules: {
    "import/order": [
      "warn",
      { "newlines-between": "always", "alphabetize": { "order": "asc" } }
    ],
    "@typescript-eslint/consistent-type-imports": "warn",
    "@typescript-eslint/no-misused-promises": ["error", { "checksVoidReturn": false }]
  }
};
