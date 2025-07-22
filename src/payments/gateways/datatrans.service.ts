import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PaymentGateway, PaymentIntent, PaymentStatus, CreateIntentParams, Refund } from '../types';

interface DatatransConfig {
  merchantId: string;
  password: string;
  sign: string;
  environment: 'sandbox' | 'production';
  baseUrl: string;
}

interface DatatransTransaction {
  transactionId: string;
  refno: string;
  amount: number;
  currency: string;
  status: string;
  paymentMethod: string;
  alias?: string;
  expm?: string;
  expy?: string;
}

@Injectable()
export class DatatransService implements PaymentGateway {
  private config: DatatransConfig;
  
  constructor(private configService: ConfigService) {
    this.config = {
      merchantId: this.configService.get('DATATRANS_MERCHANT_ID') || '',
      password: this.configService.get('DATATRANS_PASSWORD') || '',
      sign: this.configService.get('DATATRANS_SIGN') || '',
      environment: this.configService.get('DATATRANS_ENVIRONMENT') || 'sandbox',
      baseUrl: this.configService.get('DATATRANS_ENVIRONMENT') === 'production'
        ? 'https://api.datatrans.com/v1'
        : 'https://api.sandbox.datatrans.com/v1'
    };
  }

  async createIntent(params: CreateIntentParams): Promise<PaymentIntent> {
    try {
      // Initialize transaction
      const response = await fetch(`${this.config.baseUrl}/transactions`, {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${Buffer.from(`${this.config.merchantId}:${this.config.password}`).toString('base64')}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          amount: params.amount,
          currency: params.currency,
          refno: params.metadata?.orderId || this.generateRefno(),
          paymentMethods: this.getPaymentMethods(params.paymentMethod?.gateway),
          redirect: {
            successUrl: params.returnUrl || `${this.configService.get('FRONTEND_URL') || 'http://localhost:3002'}/checkout/success`,
            cancelUrl: params.cancelUrl || `${this.configService.get('FRONTEND_URL') || 'http://localhost:3002'}/checkout/cancel`,
            errorUrl: `${this.configService.get('FRONTEND_URL') || 'http://localhost:3002'}/checkout/error`,
            method: 'GET'
          },
          option: {
            createAlias: true
          },
          theme: {
            name: 'DT2015',
            configuration: {
              brandColor: '#dc3545', // Swiss red
              logoBorderColor: '#dc3545',
              brandButton: '#dc3545'
            }
          },
          language: 'fr' // Default to French for Swiss market
        })
      });

      if (!response.ok) {
        const error = await response.json() as any;
        throw new Error(`Datatrans API error: ${error.error?.message || response.statusText}`);
      }

      const data = await response.json() as any;
      
      return {
        id: data.transactionId,
        gateway: 'datatrans',
        amount: params.amount,
        currency: params.currency,
        status: 'pending',
        clientSecret: data.transactionId,
        metadata: {
          ...params.metadata,
          datatransTransactionId: data.transactionId,
          paymentUrl: data.redirect // URL to redirect user for payment
        }
      };
    } catch (error) {
      console.error('Datatrans createIntent error:', error);
      throw new Error(`Failed to create Datatrans payment: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  async confirmIntent(intentId: string): Promise<PaymentIntent> {
    try {
      const response = await fetch(`${this.config.baseUrl}/transactions/${intentId}`, {
        headers: {
          'Authorization': `Basic ${Buffer.from(`${this.config.merchantId}:${this.config.password}`).toString('base64')}`
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to get Datatrans transaction status: ${response.statusText}`);
      }

      const data: DatatransTransaction = await response.json() as DatatransTransaction;
      
      return {
        id: intentId,
        gateway: 'datatrans',
        status: this.mapStatus(data.status),
        amount: data.amount,
        currency: data.currency,
        metadata: {
          paymentMethod: data.paymentMethod,
          alias: data.alias // Token for future payments
        }
      };
    } catch (error) {
      console.error('Datatrans confirmIntent error:', error);
      throw new Error(`Failed to confirm Datatrans payment: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  async createRefund(params: {
    paymentIntentId: string;
    amount?: number;
    reason?: string;
    metadata?: Record<string, any>;
  }): Promise<Refund> {
    try {
      // Get original transaction details
      const transaction = await this.confirmIntent(params.paymentIntentId);
      
      const response = await fetch(`${this.config.baseUrl}/transactions/${params.paymentIntentId}/refund`, {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${Buffer.from(`${this.config.merchantId}:${this.config.password}`).toString('base64')}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          amount: params.amount || transaction.amount,
          currency: transaction.currency,
          refno: this.generateRefno(),
          reason: params.reason
        })
      });

      if (!response.ok) {
        const error = await response.json() as any;
        throw new Error(`Datatrans refund error: ${error.error?.message || response.statusText}`);
      }

      const data = await response.json() as any;
      
      return {
        id: data.transactionId,
        paymentIntentId: params.paymentIntentId,
        amount: data.amount,
        currency: data.currency,
        status: this.mapRefundStatus(data.status),
        reason: params.reason,
        metadata: {
          ...params.metadata,
          datatransRefundId: data.transactionId
        }
      };
    } catch (error) {
      console.error('Datatrans createRefund error:', error);
      throw new Error(`Failed to create Datatrans refund: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async handleWebhook(body: any, headers: Record<string, string>): Promise<{
    paymentIntentId: string;
    status: PaymentStatus;
    metadata?: Record<string, any>;
  }> {
    // Verify webhook signature
    const signature = headers['datatrans-signature'];
    if (!this.verifyWebhookSignature(body, signature)) {
      throw new Error('Invalid webhook signature');
    }

    const event = body;
    
    return {
      paymentIntentId: event.transactionId,
      status: this.mapStatus(event.status),
      metadata: {
        paymentMethod: event.paymentMethod,
        datatransEventType: event.type,
        timestamp: event.timestamp
      }
    };
  }

  private getPaymentMethods(preferredMethod?: string): string[] {
    const methodMap: Record<string, string[]> = {
      'twint': ['TWI'],
      'card': ['VIS', 'ECA', 'AMX', 'DIN', 'DIS', 'JCB'],
      'postfinance': ['PFC', 'PEF'],
      'paypal': ['PAP'],
      'klarna': ['KLN'],
      'apple_pay': ['APL'],
      'google_pay': ['GOO'],
      'all': ['TWI', 'VIS', 'ECA', 'AMX', 'PFC', 'PEF', 'PAP', 'APL', 'GOO']
    };

    return methodMap[preferredMethod || 'all'] || methodMap['all'];
  }

  private verifyWebhookSignature(body: any, signature: string): boolean {
    // TODO: Implement proper webhook signature verification using HMAC
    return true; // Placeholder for development
  }
  
  private mapStatus(datatransStatus: string): PaymentStatus {
    const statusMap: Record<string, PaymentStatus> = {
      'initialized': 'pending',
      'authenticated': 'processing',
      'authorized': 'processing',
      'settled': 'succeeded',
      'completed': 'succeeded',
      'canceled': 'cancelled',
      'failed': 'failed',
      'declined': 'failed'
    };
    
    return statusMap[datatransStatus] || 'pending';
  }

  private mapRefundStatus(datatransStatus: string): 'pending' | 'succeeded' | 'failed' {
    const statusMap: Record<string, 'pending' | 'succeeded' | 'failed'> = {
      'initialized': 'pending',
      'authorized': 'pending',
      'settled': 'succeeded',
      'completed': 'succeeded',
      'failed': 'failed',
      'declined': 'failed'
    };
    
    return statusMap[datatransStatus] || 'pending';
  }

  private generateRefno(): string {
    return `SC-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }

  // Create payment page session for embedded payment form
  async createPaymentPage(params: {
    amount: number;
    currency: string;
    orderId: string;
    paymentMethods?: string[];
  }): Promise<{
    sessionId: string;
    paymentPageUrl: string;
  }> {
    try {
      const response = await fetch(`${this.config.baseUrl}/transactions`, {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${Buffer.from(`${this.config.merchantId}:${this.config.password}`).toString('base64')}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          amount: params.amount,
          currency: params.currency,
          refno: params.orderId,
          paymentMethods: params.paymentMethods || this.getPaymentMethods(),
          autoSettle: true,
          option: {
            createAlias: true
          }
        })
      });

      const data = await response.json() as any;
      
      return {
        sessionId: data.transactionId,
        paymentPageUrl: `https://pay.sandbox.datatrans.com/v1/start/${data.transactionId}`
      };
    } catch (error) {
      console.error('Datatrans createPaymentPage error:', error);
      throw new Error(`Failed to create payment page: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}