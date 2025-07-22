import Redis, { Redis as RedisClient } from 'ioredis';
import { CACHE_TTL, REDIS_KEYS } from '../constants';

export class RedisService {
  private client: RedisClient;
  private subscriber: RedisClient;
  private publisher: RedisClient;

  constructor(redisUrl?: string) {
    const config = {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      password: process.env.REDIS_PASSWORD || 'redispassword',
      db: parseInt(process.env.REDIS_DB || '0'),
      retryStrategy: (times: number) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
    };

    // Main client for general operations
    this.client = redisUrl ? new Redis(redisUrl) : new Redis(config);
    
    // Separate clients for pub/sub
    this.subscriber = this.client.duplicate();
    this.publisher = this.client.duplicate();

    // Error handling
    this.client.on('error', (err) => {
      console.error('Redis Client Error:', err);
    });
  }

  /**
   * Get Redis client
   */
  getClient(): RedisClient {
    return this.client;
  }

  /**
   * Basic operations
   */
  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async set(key: string, value: string, ttl?: number): Promise<void> {
    if (ttl) {
      await this.client.setex(key, ttl, value);
    } else {
      await this.client.set(key, value);
    }
  }

  async del(key: string | string[]): Promise<number> {
    return this.client.del(...(Array.isArray(key) ? key : [key]));
  }

  async exists(key: string): Promise<boolean> {
    const result = await this.client.exists(key);
    return result === 1;
  }

  async expire(key: string, seconds: number): Promise<boolean> {
    const result = await this.client.expire(key, seconds);
    return result === 1;
  }

  async ttl(key: string): Promise<number> {
    return this.client.ttl(key);
  }

  /**
   * JSON operations
   */
  async getJSON<T>(key: string): Promise<T | null> {
    const value = await this.get(key);
    if (!value) return null;
    
    try {
      return JSON.parse(value) as T;
    } catch {
      return null;
    }
  }

  async setJSON<T>(key: string, value: T, ttl?: number): Promise<void> {
    const json = JSON.stringify(value);
    await this.set(key, json, ttl);
  }

  /**
   * Hash operations
   */
  async hget(key: string, field: string): Promise<string | null> {
    return this.client.hget(key, field);
  }

  async hset(key: string, field: string, value: string): Promise<number> {
    return this.client.hset(key, field, value);
  }

  async hgetall(key: string): Promise<Record<string, string>> {
    return this.client.hgetall(key);
  }

  async hdel(key: string, ...fields: string[]): Promise<number> {
    return this.client.hdel(key, ...fields);
  }

  /**
   * Set operations
   */
  async sadd(key: string, ...members: string[]): Promise<number> {
    return this.client.sadd(key, ...members);
  }

  async srem(key: string, ...members: string[]): Promise<number> {
    return this.client.srem(key, ...members);
  }

  async smembers(key: string): Promise<string[]> {
    return this.client.smembers(key);
  }

  async sismember(key: string, member: string): Promise<boolean> {
    const result = await this.client.sismember(key, member);
    return result === 1;
  }

  /**
   * List operations
   */
  async lpush(key: string, ...values: string[]): Promise<number> {
    return this.client.lpush(key, ...values);
  }

  async rpush(key: string, ...values: string[]): Promise<number> {
    return this.client.rpush(key, ...values);
  }

  async lrange(key: string, start: number, stop: number): Promise<string[]> {
    return this.client.lrange(key, start, stop);
  }

  async llen(key: string): Promise<number> {
    return this.client.llen(key);
  }

  /**
   * Increment/Decrement operations
   */
  async incr(key: string): Promise<number> {
    return this.client.incr(key);
  }

  async incrby(key: string, increment: number): Promise<number> {
    return this.client.incrby(key, increment);
  }

  async decr(key: string): Promise<number> {
    return this.client.decr(key);
  }

  /**
   * Pattern operations
   */
  async keys(pattern: string): Promise<string[]> {
    return this.client.keys(pattern);
  }

  async scan(pattern: string, count = 100): Promise<string[]> {
    const results: string[] = [];
    const stream = this.client.scanStream({
      match: pattern,
      count,
    });

    return new Promise((resolve, reject) => {
      stream.on('data', (keys: string[]) => {
        results.push(...keys);
      });
      stream.on('end', () => resolve(results));
      stream.on('error', reject);
    });
  }

  /**
   * Pub/Sub operations
   */
  async publish(channel: string, message: string): Promise<number> {
    return this.publisher.publish(channel, message);
  }

  async subscribe(channel: string, callback: (message: string) => void): Promise<void> {
    await this.subscriber.subscribe(channel);
    this.subscriber.on('message', (ch, message) => {
      if (ch === channel) {
        callback(message);
      }
    });
  }

  async unsubscribe(channel: string): Promise<void> {
    await this.subscriber.unsubscribe(channel);
  }

  /**
   * Cache invalidation
   */
  async invalidatePattern(pattern: string): Promise<number> {
    const keys = await this.scan(pattern);
    if (keys.length === 0) return 0;
    return this.del(keys);
  }

  /**
   * Session management
   */
  async setSession(sessionId: string, data: any, ttl = CACHE_TTL.DAY): Promise<void> {
    const key = REDIS_KEYS.SESSION(sessionId);
    await this.setJSON(key, data, ttl);
  }

  async getSession<T = any>(sessionId: string): Promise<T | null> {
    const key = REDIS_KEYS.SESSION(sessionId);
    return this.getJSON<T>(key);
  }

  async deleteSession(sessionId: string): Promise<boolean> {
    const key = REDIS_KEYS.SESSION(sessionId);
    const result = await this.del(key);
    return result > 0;
  }

  /**
   * Rate limiting
   */
  async checkRateLimit(
    key: string,
    limit: number,
    window: number
  ): Promise<{ allowed: boolean; remaining: number; resetAt: number }> {
    const redisKey = REDIS_KEYS.RATE_LIMIT(key);
    const current = await this.incr(redisKey);
    
    if (current === 1) {
      await this.expire(redisKey, window);
    }
    
    const ttl = await this.ttl(redisKey);
    const resetAt = Date.now() + (ttl * 1000);
    
    return {
      allowed: current <= limit,
      remaining: Math.max(0, limit - current),
      resetAt,
    };
  }

  /**
   * Distributed lock
   */
  async acquireLock(key: string, ttl = 30): Promise<boolean> {
    const lockKey = `lock:${key}`;
    const identifier = Date.now().toString();
    
    const result = await this.client.set(
      lockKey,
      identifier,
      'EX',
      ttl,
      'NX'
    );
    
    return result === 'OK';
  }

  async releaseLock(key: string): Promise<boolean> {
    const lockKey = `lock:${key}`;
    const result = await this.del(lockKey);
    return result > 0;
  }

  /**
   * Health check
   */
  async ping(): Promise<boolean> {
    try {
      const result = await this.client.ping();
      return result === 'PONG';
    } catch {
      return false;
    }
  }

  /**
   * Disconnect
   */
  async disconnect(): Promise<void> {
    await Promise.all([
      this.client.quit(),
      this.subscriber.quit(),
      this.publisher.quit(),
    ]);
  }
}