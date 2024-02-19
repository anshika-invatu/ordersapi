module.exports = {
    'parserOptions': {
        'ecmaVersion': 2017,
        'sourceType': 'module',
        'ecmaFeatures': {
            'experimentalObjectRestSpread': true
        }
    },
    'env': {
        'es6': true,
        'node': true,
        'mocha': true
    },
    'globals': {
    },
    'extends': 'eslint:recommended',
    'rules': {
        'block-spacing': ['error'],
        'brace-style': ['error'],
        'computed-property-spacing': ['error'],
        'eqeqeq': ['error'],
        'indent': ['warn', 4, { 'SwitchCase': 1 }],
        'key-spacing': ['error'],
        'keyword-spacing': ['error'],
        'newline-per-chained-call': ['error'],
        'no-console': ['off'],
        'no-empty': ['warn'],
        'no-empty-function': ['error'],
        'no-negated-condition': ['error'],
        'no-trailing-spaces': ['error', { 'skipBlankLines': true }],
        'no-whitespace-before-property': ['error'],
        'object-curly-spacing': ['error', 'always', { 'objectsInObjects': false, 'arraysInObjects': false }],
        'quotes': ['error', 'single'],
        'semi': ['error', 'always'],
        'space-before-blocks': ['error'],
        'space-before-function-paren': ['error'],
        'space-in-parens': ['error'],
        'space-infix-ops': ['error'],
        'prefer-const': 'error',
        'prefer-arrow-callback': 'error'
    }
};
