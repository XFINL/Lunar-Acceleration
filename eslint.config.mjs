import eslint from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/coverage/**'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: [
      'apps/server/src/modules/certificate/acme.service.ts',
      'apps/server/src/modules/certificate/certificate.service.ts',
      'apps/server/src/modules/domain-resource/domain-resource.service.ts',
      'apps/server/src/modules/domain/domain.service.ts',
      'apps/server/src/shared/http/safe-http.ts',
      'apps/server/src/modules/vendor/drivers/ali.driver.ts',
      'apps/server/src/modules/vendor/vendor-write.service.ts',
      'apps/server/src/modules/vendor/vendor.service.ts',
    ],
    rules: {
      // These files adapt untyped SDK/JSON boundaries; all other TypeScript files reject explicit any.
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  {
    files: ['apps/web/src/**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
    },
  },
);
