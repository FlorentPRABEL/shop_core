import { Tenant, TenantConfig, Plan, Subscription } from '@swisscommerce/types';
import { 
  extractTenantFromHost, 
  isCustomDomain, 
  isValidTenantSlug,
  generateSchemaName 
} from '@swisscommerce/utils';
import { PrismaService } from './prisma.service';
import { RedisService } from './redis.service';
import { CACHE_TTL, REDIS_KEYS } from '../constants';

export class TenantService {
  constructor(
    public readonly prisma: PrismaService,
    private redis: RedisService
  ) {}

  /**
   * Get tenant by ID
   */
  async findById(tenantId: string): Promise<Tenant | null> {
    return this.getTenantById(tenantId);
  }

  /**
   * Get tenant by ID
   */
  async getTenantById(tenantId: string): Promise<Tenant | null> {
    // Check cache first
    const cacheKey = REDIS_KEYS.TENANT(tenantId);
    const cached = await this.redis.getJSON<Tenant>(cacheKey);
    if (cached) return cached;

    // Query database
    const tenant = await this.prisma.client.tenant.findUnique({
      where: { id: tenantId },
      include: {
        subscription: {
          include: {
            plan: true,
          },
        },
      },
    });

    if (!tenant) return null;

    // Cache the result
    await this.redis.setJSON(cacheKey, tenant, CACHE_TTL.LONG);

    return tenant as unknown as unknown as Tenant;
  }

  /**
   * Get tenant by slug
   */
  async getTenantBySlug(slug: string): Promise<Tenant | null> {
    const tenant = await this.prisma.client.tenant.findUnique({
      where: { slug },
      include: {
        subscription: {
          include: {
            plan: true,
          },
        },
      },
    });

    return tenant as unknown as Tenant | null;
  }

  /**
   * Get tenant by domain
   */
  async findByDomain(domain: string): Promise<Tenant | null> {
    return this.getTenantByDomain(domain);
  }

  /**
   * Get tenant by domain
   */
  async getTenantByDomain(domain: string): Promise<Tenant | null> {
    const tenant = await this.prisma.client.tenant.findFirst({
      where: {
        OR: [
          { domain },
          { customDomain: domain },
        ],
      },
      include: {
        subscription: {
          include: {
            plan: true,
          },
        },
      },
    });

    return tenant as unknown as Tenant | null;
  }

  /**
   * Resolve tenant from host
   */
  async resolveTenant(host: string, baseDomain: string): Promise<Tenant | null> {
    // Check if it's a custom domain
    if (isCustomDomain(host, baseDomain)) {
      return this.getTenantByDomain(host);
    }

    // Extract tenant slug from subdomain
    const slug = extractTenantFromHost(host);
    if (!slug) return null;

    return this.getTenantBySlug(slug);
  }

  /**
   * Create a new tenant
   */
  async create(data: {
    name: string;
    domain: string;
    email: string;
    phone?: string;
    address?: any;
    settings?: any;
    ownerId: string;
  }): Promise<Tenant> {
    // Use domain as slug for now
    const slug = data.domain.split('.')[0];
    return this.createTenant({
      name: data.name,
      slug,
      email: data.email,
      planId: 'default-plan-id', // TODO: Implement plan selection
    });
  }

  /**
   * Create a new tenant
   */
  async createTenant(data: {
    name: string;
    slug: string;
    email: string;
    planId: string;
    region?: string;
  }): Promise<Tenant> {
    // Validate slug
    if (!isValidTenantSlug(data.slug)) {
      throw new Error('Invalid tenant slug');
    }

    // Check if slug is already taken
    const existing = await this.getTenantBySlug(data.slug);
    if (existing) {
      throw new Error('Tenant slug already exists');
    }

    // Start transaction
    const tenant = await this.prisma.client.$transaction(async (tx: any) => {
      // Create tenant
      const newTenant = await tx.tenant.create({
        data: {
          name: data.name,
          slug: data.slug,
          domain: `${data.slug}.${process.env.BASE_DOMAIN || 'swisscommerce.ch'}`,
          region: data.region || 'CH-FR',
          settings: {
            general: {
              shopName: data.name,
              contactEmail: data.email,
              timezone: 'Europe/Zurich',
              weightUnit: 'kg',
              currency: 'CHF',
            },
            legal: {
              businessName: data.name,
              businessAddress: '',
            },
            shipping: {
              enableLocalPickup: false,
            },
            taxes: {
              taxesIncluded: true,
              taxShipping: true,
              automaticTaxCalculation: true,
            },
            features: {
              multiLanguage: true,
              customerAccounts: true,
              guestCheckout: true,
              productReviews: false,
              wishlist: false,
              compareProducts: false,
            },
          },
        },
      });

      // Create subscription
      await tx.subscription.create({
        data: {
          tenantId: newTenant.id,
          planId: data.planId,
          currentPeriodStart: new Date(),
          currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
        },
      });

      return newTenant;
    });

    // Create tenant schema
    await this.prisma.createTenantSchema(tenant.id);

    // Clear cache
    await this.redis.del(REDIS_KEYS.TENANT(tenant.id));

    return this.getTenantById(tenant.id) as Promise<Tenant>;
  }

  /**
   * Update tenant
   */
  async update(
    tenantId: string,
    data: Partial<Omit<Tenant, 'id' | 'createdAt' | 'updatedAt'>>
  ): Promise<Tenant> {
    return this.updateTenant(tenantId, data);
  }

  /**
   * Update tenant
   */
  async updateTenant(
    tenantId: string,
    data: Partial<Omit<Tenant, 'id' | 'createdAt' | 'updatedAt'>>
  ): Promise<Tenant> {
    const updated = await this.prisma.client.tenant.update({
      where: { id: tenantId },
      data: data as any,
    });

    // Clear cache
    await this.redis.del(REDIS_KEYS.TENANT(tenantId));

    return this.getTenantById(tenantId) as Promise<Tenant>;
  }

  /**
   * Check if tenant is active
   */
  async isTenantActive(tenantId: string): Promise<boolean> {
    const tenant = await this.getTenantById(tenantId);
    if (!tenant) return false;

    return tenant.status === 'active' && 
           tenant.subscription?.status === 'active';
  }

  /**
   * Get tenant config
   */
  async getTenantConfig(tenantId: string): Promise<TenantConfig> {
    const tenant = await this.getTenantById(tenantId);
    if (!tenant) {
      throw new Error('Tenant not found');
    }

    return {
      tenantId: tenant.id,
      schemaName: generateSchemaName(tenant.id),
      domain: tenant.domain,
      customDomain: tenant.customDomain,
      region: tenant.region as unknown as TenantConfig['region'],
    };
  }

  /**
   * Check tenant limits
   */
  async checkTenantLimit(
    tenantId: string,
    resource: string,
    current: number
  ): Promise<{ allowed: boolean; limit: number | 'unlimited' }> {
    const tenant = await this.getTenantById(tenantId);
    if (!tenant || !tenant.subscription?.plan) {
      return { allowed: false, limit: 0 };
    }

    const limits = tenant.subscription.plan.limits as any;
    const limit = limits[resource];

    if (limit === 'unlimited') {
      return { allowed: true, limit: 'unlimited' };
    }

    return {
      allowed: current < limit,
      limit,
    };
  }

  /**
   * Get tenant statistics
   */
  async getTenantStats(tenantId: string): Promise<{
    products: number;
    orders: number;
    customers: number;
    revenue: number;
  }> {
    // This would query tenant-specific schema
    const stats = await this.prisma.withTenant(tenantId, async (prisma) => {
      const [products, orders, customers] = await Promise.all([
        prisma.product.count(),
        prisma.order.count(),
        prisma.customer.count(),
      ]);

      const revenue = await prisma.order.aggregate({
        where: { financialStatus: 'paid' },
        _sum: { totalPrice: true },
      });

      return {
        products,
        orders,
        customers,
        revenue: Number(revenue._sum.totalPrice || 0),
      };
    });

    return stats;
  }

  /**
   * Delete tenant
   */
  async delete(tenantId: string): Promise<void> {
    // Soft delete by updating status
    await this.updateTenant(tenantId, { status: 'deleted' as any });
    
    // Clear cache
    await this.redis.del(REDIS_KEYS.TENANT(tenantId));
  }

  /**
   * List all tenants (admin only)
   */
  async listTenants(params: {
    page?: number;
    limit?: number;
    status?: string;
  }): Promise<{ tenants: Tenant[]; total: number }> {
    const page = params.page || 1;
    const limit = params.limit || 20;
    const skip = (page - 1) * limit;

    const where = params.status ? { status: params.status } : {};

    const [tenants, total] = await Promise.all([
      this.prisma.client.tenant.findMany({
        where,
        include: {
          subscription: {
            include: {
              plan: true,
            },
          },
        },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.client.tenant.count({ where }),
    ]);

    return {
      tenants: tenants as unknown as Tenant[],
      total,
    };
  }
}