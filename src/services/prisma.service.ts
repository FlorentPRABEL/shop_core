import { PrismaClient } from '@prisma/client';
import { generateSchemaName } from '@shopen/utils';

export class PrismaService {
  private prisma: PrismaClient;
  private currentSchema: string | null = null;

  constructor() {
    this.prisma = new PrismaClient({
      log: process.env.NODE_ENV === 'development' 
        ? ['query', 'info', 'warn', 'error'] 
        : ['error'],
    });
  }

  get client(): PrismaClient {
    return this.prisma;
  }

  /**
   * Set the current tenant schema
   */
  async setSchema(tenantId: string): Promise<void> {
    const schemaName = generateSchemaName(tenantId);
    this.currentSchema = schemaName;
    
    // Set search_path for current connection
    await this.prisma.$executeRawUnsafe(
      `SET search_path TO "${schemaName}", shared, public`
    );
  }

  /**
   * Execute a query in a specific tenant context
   */
  async withTenant<T>(
    tenantId: string,
    callback: (prisma: PrismaClient) => Promise<T>
  ): Promise<T> {
    const schemaName = generateSchemaName(tenantId);
    
    // Create a new Prisma client for this specific query
    const tenantPrisma = new PrismaClient({
      datasources: {
        db: {
          url: process.env.DATABASE_URL,
        },
      },
    });

    try {
      // Set schema for this connection
      await tenantPrisma.$executeRawUnsafe(
        `SET search_path TO "${schemaName}", shared, public`
      );
      
      // Execute the callback with tenant-specific client
      return await callback(tenantPrisma);
    } finally {
      // Always disconnect the temporary client
      await tenantPrisma.$disconnect();
    }
  }

  /**
   * Execute raw SQL with tenant context
   */
  async executeRawWithTenant<T = unknown>(
    tenantId: string,
    query: string,
    ...values: any[]
  ): Promise<T> {
    return this.withTenant(tenantId, async (prisma) => {
      return prisma.$queryRawUnsafe(query, ...values) as Promise<T>;
    });
  }

  /**
   * Create a new tenant schema
   */
  async createTenantSchema(tenantId: string): Promise<void> {
    const schemaName = generateSchemaName(tenantId);
    
    // Create schema
    await this.prisma.$executeRawUnsafe(
      `CREATE SCHEMA IF NOT EXISTS "${schemaName}"`
    );
    
    // Grant permissions
    await this.prisma.$executeRawUnsafe(
      `GRANT ALL ON SCHEMA "${schemaName}" TO CURRENT_USER`
    );
    
    // Create tables in the new schema by copying structure
    await this.migrateTenantSchema(schemaName);
  }

  /**
   * Migrate tenant schema with base tables
   */
  private async migrateTenantSchema(schemaName: string): Promise<void> {
    // This would run the tenant-specific migrations
    // For now, we'll use raw SQL to create the basic structure
    
    const queries = [
      // Products table
      `CREATE TABLE IF NOT EXISTS "${schemaName}".products (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        title JSONB NOT NULL,
        handle VARCHAR(255) UNIQUE NOT NULL,
        description JSONB,
        vendor VARCHAR(255),
        product_type VARCHAR(255),
        tags TEXT[],
        status VARCHAR(50) DEFAULT 'draft',
        published_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`,
      
      // Product variants table
      `CREATE TABLE IF NOT EXISTS "${schemaName}".product_variants (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        product_id UUID REFERENCES "${schemaName}".products(id) ON DELETE CASCADE,
        title VARCHAR(255),
        sku VARCHAR(255) UNIQUE,
        barcode VARCHAR(255),
        price DECIMAL(10,2) NOT NULL,
        compare_at_price DECIMAL(10,2),
        cost DECIMAL(10,2),
        taxable BOOLEAN DEFAULT true,
        tax_code VARCHAR(50),
        weight DECIMAL(10,3),
        weight_unit VARCHAR(10) DEFAULT 'kg',
        inventory_quantity INTEGER DEFAULT 0,
        track_inventory BOOLEAN DEFAULT true,
        requires_shipping BOOLEAN DEFAULT true,
        options JSONB DEFAULT '[]',
        position INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`,
      
      // Add more tables as needed...
      
      // Create indexes
      `CREATE INDEX IF NOT EXISTS idx_${schemaName}_products_handle ON "${schemaName}".products(handle)`,
      `CREATE INDEX IF NOT EXISTS idx_${schemaName}_products_status ON "${schemaName}".products(status)`,
      `CREATE INDEX IF NOT EXISTS idx_${schemaName}_variants_sku ON "${schemaName}".product_variants(sku)`,
    ];
    
    for (const query of queries) {
      await this.prisma.$executeRawUnsafe(query);
    }
  }

  /**
   * Delete tenant schema (use with caution!)
   */
  async deleteTenantSchema(tenantId: string): Promise<void> {
    const schemaName = generateSchemaName(tenantId);
    
    await this.prisma.$executeRawUnsafe(
      `DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`
    );
  }

  /**
   * Check if tenant schema exists
   */
  async tenantSchemaExists(tenantId: string): Promise<boolean> {
    const schemaName = generateSchemaName(tenantId);
    
    const result = await this.prisma.$queryRaw<{ exists: boolean }[]>`
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.schemata
        WHERE schema_name = ${schemaName}
      ) as exists
    `;
    
    return result[0]?.exists || false;
  }

  /**
   * Connect to database
   */
  async connect(): Promise<void> {
    await this.prisma.$connect();
  }

  /**
   * Disconnect from database
   */
  async disconnect(): Promise<void> {
    await this.prisma.$disconnect();
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<boolean> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }
}