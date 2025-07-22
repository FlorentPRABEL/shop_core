import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { Customer, UUID } from '@shopen/types';
import { generateToken, generateSecureCode } from '@shopen/utils';
import { RedisService } from './redis.service';
import { JWT_CONFIG, CACHE_TTL } from '../constants';

export interface JwtPayload {
  sub: string; // user id
  email: string;
  tenantId: string;
  role: 'customer' | 'admin' | 'staff';
  permissions?: string[];
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface AuthUser {
  id: string;
  email: string;
  tenantId: string;
  role: string;
  permissions: string[];
}

export class AuthService {
  constructor(
    private redis: RedisService,
    private jwtSecret: string = process.env.JWT_SECRET || 'secret',
    private refreshSecret: string = process.env.REFRESH_TOKEN_SECRET || 'refresh-secret'
  ) {}

  /**
   * Hash password
   */
  async hashPassword(password: string): Promise<string> {
    const salt = await bcrypt.genSalt(10);
    return bcrypt.hash(password, salt);
  }

  /**
   * Verify password
   */
  async verifyPassword(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  }

  /**
   * Generate JWT tokens
   */
  async generateTokens(payload: JwtPayload): Promise<TokenPair> {
    const accessToken = jwt.sign(
      payload,
      this.jwtSecret,
      {
        expiresIn: JWT_CONFIG.ACCESS_TOKEN_EXPIRY,
        issuer: JWT_CONFIG.ISSUER,
        audience: JWT_CONFIG.AUDIENCE,
      }
    );

    const refreshToken = jwt.sign(
      { sub: payload.sub, tenantId: payload.tenantId },
      this.refreshSecret,
      {
        expiresIn: JWT_CONFIG.REFRESH_TOKEN_EXPIRY,
        issuer: JWT_CONFIG.ISSUER,
      }
    );

    // Store refresh token in Redis
    await this.redis.set(
      `refresh_token:${payload.sub}`,
      refreshToken,
      CACHE_TTL.WEEK
    );

    return {
      accessToken,
      refreshToken,
      expiresIn: 900, // 15 minutes in seconds
    };
  }

  /**
   * Verify access token
   */
  async verifyAccessToken(token: string): Promise<JwtPayload> {
    try {
      const payload = jwt.verify(token, this.jwtSecret, {
        issuer: JWT_CONFIG.ISSUER,
        audience: JWT_CONFIG.AUDIENCE,
      }) as JwtPayload;

      return payload;
    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) {
        throw new Error('Token expired');
      }
      if (error instanceof jwt.JsonWebTokenError) {
        throw new Error('Invalid token');
      }
      throw error;
    }
  }

  /**
   * Verify refresh token
   */
  async verifyRefreshToken(token: string): Promise<{ sub: string; tenantId: string }> {
    try {
      const payload = jwt.verify(token, this.refreshSecret, {
        issuer: JWT_CONFIG.ISSUER,
      }) as { sub: string; tenantId: string };

      // Check if token exists in Redis
      const storedToken = await this.redis.get(`refresh_token:${payload.sub}`);
      if (storedToken !== token) {
        throw new Error('Invalid refresh token');
      }

      return payload;
    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) {
        throw new Error('Refresh token expired');
      }
      if (error instanceof jwt.JsonWebTokenError) {
        throw new Error('Invalid refresh token');
      }
      throw error;
    }
  }

  /**
   * Refresh access token
   */
  async refreshAccessToken(refreshToken: string, userData: {
    email: string;
    role: string;
    permissions?: string[];
  }): Promise<TokenPair> {
    const { sub, tenantId } = await this.verifyRefreshToken(refreshToken);

    const payload: JwtPayload = {
      sub,
      email: userData.email,
      tenantId,
      role: userData.role as any,
      permissions: userData.permissions,
    };

    return this.generateTokens(payload);
  }

  /**
   * Revoke refresh token
   */
  async revokeRefreshToken(userId: string): Promise<void> {
    await this.redis.del(`refresh_token:${userId}`);
  }

  /**
   * Generate email verification token
   */
  async generateEmailVerificationToken(email: string, tenantId: string): Promise<string> {
    const token = generateToken(32);
    const key = `email_verify:${token}`;
    
    await this.redis.setJSON(
      key,
      { email, tenantId },
      CACHE_TTL.DAY // 24 hours
    );

    return token;
  }

  /**
   * Verify email token
   */
  async verifyEmailToken(token: string): Promise<{ email: string; tenantId: string } | null> {
    const key = `email_verify:${token}`;
    const data = await this.redis.getJSON<{ email: string; tenantId: string }>(key);
    
    if (data) {
      // Delete token after verification
      await this.redis.del(key);
    }
    
    return data;
  }

  /**
   * Generate password reset token
   */
  async generatePasswordResetToken(email: string, tenantId: string): Promise<string> {
    const token = generateToken(32);
    const key = `password_reset:${token}`;
    
    await this.redis.setJSON(
      key,
      { email, tenantId },
      CACHE_TTL.LONG // 1 hour
    );

    return token;
  }

  /**
   * Verify password reset token
   */
  async verifyPasswordResetToken(token: string): Promise<{ email: string; tenantId: string } | null> {
    const key = `password_reset:${token}`;
    return this.redis.getJSON<{ email: string; tenantId: string }>(key);
  }

  /**
   * Use password reset token
   */
  async usePasswordResetToken(token: string): Promise<{ email: string; tenantId: string } | null> {
    const data = await this.verifyPasswordResetToken(token);
    
    if (data) {
      // Delete token after use
      await this.redis.del(`password_reset:${token}`);
    }
    
    return data;
  }

  /**
   * Generate 2FA code
   */
  async generate2FACode(userId: string): Promise<string> {
    const code = generateSecureCode(6);
    const key = `2fa:${userId}`;
    
    await this.redis.set(
      key,
      code,
      300 // 5 minutes
    );

    return code;
  }

  /**
   * Verify 2FA code
   */
  async verify2FACode(userId: string, code: string): Promise<boolean> {
    const key = `2fa:${userId}`;
    const storedCode = await this.redis.get(key);
    
    if (storedCode === code) {
      await this.redis.del(key);
      return true;
    }
    
    return false;
  }

  /**
   * Create session
   */
  async createSession(user: AuthUser, metadata?: {
    ipAddress?: string;
    userAgent?: string;
  }): Promise<string> {
    const sessionId = generateToken(32);
    const key = `session:${sessionId}`;
    
    await this.redis.setJSON(
      key,
      {
        ...user,
        ...metadata,
        createdAt: new Date().toISOString(),
        lastActivityAt: new Date().toISOString(),
      },
      CACHE_TTL.DAY
    );

    return sessionId;
  }

  /**
   * Get session
   */
  async getSession(sessionId: string): Promise<AuthUser | null> {
    const key = `session:${sessionId}`;
    const session = await this.redis.getJSON<any>(key);
    
    if (session) {
      // Update last activity
      session.lastActivityAt = new Date().toISOString();
      await this.redis.setJSON(key, session, CACHE_TTL.DAY);
      
      return {
        id: session.id,
        email: session.email,
        tenantId: session.tenantId,
        role: session.role,
        permissions: session.permissions || [],
      };
    }
    
    return null;
  }

  /**
   * Destroy session
   */
  async destroySession(sessionId: string): Promise<void> {
    await this.redis.del(`session:${sessionId}`);
  }

  /**
   * Check permission
   */
  hasPermission(user: AuthUser, permission: string): boolean {
    // Admin has all permissions
    if (user.role === 'admin') return true;
    
    // Check specific permissions
    return user.permissions.includes(permission);
  }

  /**
   * Generate API key
   */
  async generateApiKey(tenantId: string, name: string, permissions: string[]): Promise<{
    key: string;
    secret: string;
  }> {
    const key = `ak_${generateToken(16)}`;
    const secret = generateToken(32);
    const hashedSecret = await this.hashPassword(secret);
    
    await this.redis.setJSON(
      `api_key:${key}`,
      {
        tenantId,
        name,
        permissions,
        secret: hashedSecret,
        createdAt: new Date().toISOString(),
        lastUsedAt: null,
      }
    );

    return { key, secret: `${key}.${secret}` };
  }

  /**
   * Verify API key
   */
  async verifyApiKey(apiKey: string): Promise<{
    tenantId: string;
    permissions: string[];
  } | null> {
    const [key, secret] = apiKey.split('.');
    if (!key || !secret) return null;

    const data = await this.redis.getJSON<any>(`api_key:${key}`);
    if (!data) return null;

    const valid = await this.verifyPassword(secret, data.secret);
    if (!valid) return null;

    // Update last used
    data.lastUsedAt = new Date().toISOString();
    await this.redis.setJSON(`api_key:${key}`, data);

    return {
      tenantId: data.tenantId,
      permissions: data.permissions,
    };
  }
}