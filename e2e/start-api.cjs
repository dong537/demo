process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.PORT = process.env.PORT || '3301';
process.env.DATABASE_URL = process.env.DATABASE_URL_TEST || process.env.DATABASE_URL;
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
process.env.APP_ENCRYPTION_KEY = process.env.APP_ENCRYPTION_KEY || '0000000000000000000000000000000000000000000000000000000000000000';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-jwt-secret';
process.env.APP_PLATFORM_CURRENCY = process.env.APP_PLATFORM_CURRENCY || 'CNY';
process.env.PAYMENT_CONFIRMATION_ENABLED = process.env.PAYMENT_CONFIRMATION_ENABLED || 'false';

require('../apps/api/dist/main.js');
