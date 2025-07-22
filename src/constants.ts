export const CACHE_TTL = {
  SHORT: 300, // 5 minutes
  MEDIUM: 600, // 10 minutes
  LONG: 3600, // 1 hour
  DAY: 86400, // 24 hours
  WEEK: 604800, // 7 days
} as const;

export const REDIS_KEYS = {
  SESSION: (sessionId: string) => `session:${sessionId}`,
  USER: (userId: string) => `user:${userId}`,
  TENANT: (tenantId: string) => `tenant:${tenantId}`,
  PRODUCT: (tenantId: string, productId: string) => `${tenantId}:product:${productId}`,
  CART: (cartId: string) => `cart:${cartId}`,
  RATE_LIMIT: (key: string) => `rate_limit:${key}`,
} as const;

export const JWT_CONFIG = {
  ACCESS_TOKEN_EXPIRY: '15m',
  REFRESH_TOKEN_EXPIRY: '7d',
  ISSUER: 'swisscommerce',
  AUDIENCE: 'swisscommerce-api',
} as const;

export const PAGINATION = {
  DEFAULT_PAGE: 1,
  DEFAULT_LIMIT: 20,
  MAX_LIMIT: 100,
} as const;

export const ORDER_NUMBER_PREFIX = {
  LENGTH: 6,
  PREFIX_LENGTH: 3,
} as const;

export const SWISS_CONSTANTS = {
  COUNTRY_CODE: 'CH',
  DEFAULT_CURRENCY: 'CHF',
  DEFAULT_LOCALE: 'fr-CH',
  SUPPORTED_LOCALES: ['fr-CH', 'de-CH', 'it-CH', 'rm-CH'],
  VAT_RATES: {
    STANDARD: 0.077,
    REDUCED: 0.025,
    ACCOMMODATION: 0.037,
  },
} as const;

export const ERROR_CODES = {
  // Authentication
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  TOKEN_INVALID: 'TOKEN_INVALID',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  
  // Validation
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  INVALID_INPUT: 'INVALID_INPUT',
  
  // Resources
  NOT_FOUND: 'NOT_FOUND',
  ALREADY_EXISTS: 'ALREADY_EXISTS',
  
  // Business logic
  INSUFFICIENT_INVENTORY: 'INSUFFICIENT_INVENTORY',
  PRICE_MISMATCH: 'PRICE_MISMATCH',
  INVALID_DISCOUNT: 'INVALID_DISCOUNT',
  CHECKOUT_EXPIRED: 'CHECKOUT_EXPIRED',
  
  // System
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',
  
  // Tenant
  TENANT_NOT_FOUND: 'TENANT_NOT_FOUND',
  TENANT_SUSPENDED: 'TENANT_SUSPENDED',
  PLAN_LIMIT_EXCEEDED: 'PLAN_LIMIT_EXCEEDED',
} as const;

export const EVENTS = {
  // Product events
  PRODUCT_CREATED: 'product.created',
  PRODUCT_UPDATED: 'product.updated',
  PRODUCT_DELETED: 'product.deleted',
  PRODUCT_PUBLISHED: 'product.published',
  PRODUCT_UNPUBLISHED: 'product.unpublished',
  
  // Order events
  ORDER_CREATED: 'order.created',
  ORDER_UPDATED: 'order.updated',
  ORDER_CANCELLED: 'order.cancelled',
  ORDER_FULFILLED: 'order.fulfilled',
  ORDER_REFUNDED: 'order.refunded',
  
  // Customer events
  CUSTOMER_CREATED: 'customer.created',
  CUSTOMER_UPDATED: 'customer.updated',
  CUSTOMER_DELETED: 'customer.deleted',
  
  // Inventory events
  INVENTORY_UPDATED: 'inventory.updated',
  INVENTORY_LOW: 'inventory.low',
  INVENTORY_OUT_OF_STOCK: 'inventory.out_of_stock',
  
  // Cart events
  CART_CREATED: 'cart.created',
  CART_UPDATED: 'cart.updated',
  CART_ABANDONED: 'cart.abandoned',
  
  // Checkout events
  CHECKOUT_CREATED: 'checkout.created',
  CHECKOUT_COMPLETED: 'checkout.completed',
  CHECKOUT_FAILED: 'checkout.failed',
  
  // Payment events
  PAYMENT_CREATED: 'payment.created',
  PAYMENT_SUCCEEDED: 'payment.succeeded',
  PAYMENT_FAILED: 'payment.failed',
  PAYMENT_REFUNDED: 'payment.refunded',
  ORDER_PAID: 'order.paid',
} as const;

export const WEBHOOK_TOPICS = {
  ORDERS_CREATE: 'orders/create',
  ORDERS_UPDATE: 'orders/update',
  ORDERS_CANCEL: 'orders/cancel',
  ORDERS_FULFILL: 'orders/fulfill',
  PRODUCTS_CREATE: 'products/create',
  PRODUCTS_UPDATE: 'products/update',
  PRODUCTS_DELETE: 'products/delete',
  CUSTOMERS_CREATE: 'customers/create',
  CUSTOMERS_UPDATE: 'customers/update',
  INVENTORY_UPDATE: 'inventory/update',
} as const;

export const FILE_UPLOAD = {
  MAX_SIZE: 10 * 1024 * 1024, // 10MB
  ALLOWED_IMAGE_TYPES: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
  ALLOWED_DOCUMENT_TYPES: ['application/pdf'],
  IMAGE_DIMENSIONS: {
    PRODUCT: { width: 2048, height: 2048 },
    COLLECTION: { width: 1920, height: 1080 },
    THUMBNAIL: { width: 300, height: 300 },
  },
} as const;