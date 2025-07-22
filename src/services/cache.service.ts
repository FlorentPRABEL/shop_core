import { RedisService } from './redis.service';
import { CACHE_TTL } from '../constants';
import { generateTenantCachePrefix } from '@shopen/utils';

export interface CacheOptions {
  ttl?: number;
  tenant?: string;
  tags?: string[];
}

export class CacheService {
  constructor(private redis: RedisService) {}

  /**
   * Generate cache key with tenant prefix
   */
  private generateKey(key: string, tenantId?: string): string {
    if (tenantId) {
      return `${generateTenantCachePrefix(tenantId)}${key}`;
    }
    return key;
  }

  /**
   * Get cached value
   */
  async get<T>(key: string, options?: CacheOptions): Promise<T | null> {
    const cacheKey = this.generateKey(key, options?.tenant);
    return this.redis.getJSON<T>(cacheKey);
  }

  /**
   * Set cache value
   */
  async set<T>(key: string, value: T, options?: CacheOptions): Promise<void> {
    const cacheKey = this.generateKey(key, options?.tenant);
    const ttl = options?.ttl || CACHE_TTL.MEDIUM;
    
    await this.redis.setJSON(cacheKey, value, ttl);
    
    // Add to tags if provided
    if (options?.tags) {
      await this.addToTags(cacheKey, options.tags, options.tenant);
    }
  }

  /**
   * Delete cached value
   */
  async delete(key: string, tenantId?: string): Promise<boolean> {
    const cacheKey = this.generateKey(key, tenantId);
    const result = await this.redis.del(cacheKey);
    return result > 0;
  }

  /**
   * Check if key exists
   */
  async exists(key: string, tenantId?: string): Promise<boolean> {
    const cacheKey = this.generateKey(key, tenantId);
    return this.redis.exists(cacheKey);
  }

  /**
   * Invalidate by pattern
   */
  async invalidatePattern(pattern: string, tenantId?: string): Promise<number> {
    const keyPattern = this.generateKey(pattern, tenantId);
    return this.redis.invalidatePattern(keyPattern);
  }

  /**
   * Invalidate by tag
   */
  async invalidateTag(tag: string, tenantId?: string): Promise<number> {
    const tagKey = this.generateKey(`tag:${tag}`, tenantId);
    const keys = await this.redis.smembers(tagKey);
    
    if (keys.length === 0) return 0;
    
    // Delete all keys with this tag
    const deleted = await this.redis.del(keys);
    
    // Delete the tag set
    await this.redis.del(tagKey);
    
    return deleted;
  }

  /**
   * Add key to tags
   */
  private async addToTags(key: string, tags: string[], tenantId?: string): Promise<void> {
    for (const tag of tags) {
      const tagKey = this.generateKey(`tag:${tag}`, tenantId);
      await this.redis.sadd(tagKey, key);
      // Set expiry on tag set to auto-cleanup
      await this.redis.expire(tagKey, CACHE_TTL.DAY);
    }
  }

  /**
   * Get or set cache (cache-aside pattern)
   */
  async getOrSet<T>(
    key: string,
    factory: () => Promise<T>,
    options?: CacheOptions
  ): Promise<T> {
    // Try to get from cache
    const cached = await this.get<T>(key, options);
    if (cached !== null) {
      return cached;
    }
    
    // Generate value
    const value = await factory();
    
    // Store in cache
    await this.set(key, value, options);
    
    return value;
  }

  /**
   * Wrap function with caching
   */
  wrap<T extends (...args: any[]) => Promise<any>>(
    fn: T,
    keyGenerator: (...args: Parameters<T>) => string,
    options?: CacheOptions
  ): T {
    return (async (...args: Parameters<T>) => {
      const key = keyGenerator(...args);
      return this.getOrSet(key, () => fn(...args), options);
    }) as T;
  }

  /**
   * Clear all tenant cache
   */
  async clearTenantCache(tenantId: string): Promise<number> {
    const pattern = `${generateTenantCachePrefix(tenantId)}*`;
    return this.redis.invalidatePattern(pattern);
  }

  /**
   * Remember forever (no TTL)
   */
  async rememberForever<T>(
    key: string,
    factory: () => Promise<T>,
    tenantId?: string
  ): Promise<T> {
    const cached = await this.get<T>(key, { tenant: tenantId });
    if (cached !== null) {
      return cached;
    }
    
    const value = await factory();
    const cacheKey = this.generateKey(key, tenantId);
    await this.redis.setJSON(cacheKey, value); // No TTL
    
    return value;
  }

  /**
   * Increment counter
   */
  async increment(key: string, amount = 1, tenantId?: string): Promise<number> {
    const cacheKey = this.generateKey(key, tenantId);
    return this.redis.incrby(cacheKey, amount);
  }

  /**
   * Decrement counter
   */
  async decrement(key: string, amount = 1, tenantId?: string): Promise<number> {
    const cacheKey = this.generateKey(key, tenantId);
    return this.redis.incrby(cacheKey, -amount);
  }

  /**
   * Get multiple keys at once
   */
  async getMany<T>(keys: string[], tenantId?: string): Promise<(T | null)[]> {
    const promises = keys.map(key => this.get<T>(key, { tenant: tenantId }));
    return Promise.all(promises);
  }

  /**
   * Set multiple keys at once
   */
  async setMany<T>(
    items: Array<{ key: string; value: T }>,
    options?: CacheOptions
  ): Promise<void> {
    const promises = items.map(({ key, value }) => 
      this.set(key, value, options)
    );
    await Promise.all(promises);
  }

  /**
   * Cache warming
   */
  async warm<T>(
    keys: string[],
    factory: (key: string) => Promise<T>,
    options?: CacheOptions
  ): Promise<void> {
    const promises = keys.map(async (key) => {
      const value = await factory(key);
      await this.set(key, value, options);
    });
    
    await Promise.all(promises);
  }
}