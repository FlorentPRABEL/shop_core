import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PaymentGateway, PaymentIntent, PaymentStatus, CreateIntentParams, Refund } from '../types';

interface TwintConfig {
  apiKey: string;
  merchantId: string;
  environment: 'test' | 'production';
  baseUrl: string;
}

interface TwintPaymentResponse {
  paymentId: string;
  token: string;
  qrCode: string;
  status: string;
  amount: number;
  currency: string;
  expiresAt: string;
}

@Injectable()
export class TwintService implements PaymentGateway {
  private config: TwintConfig;
  
  constructor(private configService: ConfigService) {
    this.config = {
      apiKey: this.configService.get('TWINT_API_KEY') || '',
      merchantId: this.configService.get('TWINT_MERCHANT_ID') || '',
      environment: this.configService.get('TWINT_ENVIRONMENT') || 'test',
      baseUrl: this.configService.get('TWINT_ENVIRONMENT') === 'production'
        ? 'https://api.twint.ch/v2'
        : 'https://api-sandbox.twint.ch/v2'
    };
  }

  async createIntent(params: CreateIntentParams): Promise<PaymentIntent> {
    try {
      const response = await fetch(`${this.config.baseUrl}/payment`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json',
          'X-Merchant-Id': this.config.merchantId
        },
        body: JSON.stringify({
          amount: params.amount,
          currency: params.currency,
          merchantReference: params.metadata?.orderId,
          callbackUrl: `${this.configService.get('API_URL')}/api/webhooks/twint`,
          successUrl: params.returnUrl || `${this.configService.get('FRONTEND_URL')}/checkout/success`,
          cancelUrl: params.cancelUrl || `${this.configService.get('FRONTEND_URL')}/checkout/cancel`,
          description: params.description || 'Shopen Order',
          customerInfo: params.customer ? {
            email: params.customer.email,
            phone: params.customer.phone
          } : undefined
        })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(`Twint API error: ${error.message || response.statusText}`);
      }

      const data: TwintPaymentResponse = await response.json();
      
      return {
        id: data.paymentId,
        gateway: 'twint',
        amount: params.amount,
        currency: params.currency,
        status: this.mapStatus(data.status),
        clientSecret: data.token,
        qrCode: data.qrCode, // QR code for Twint payment
        expiresAt: new Date(data.expiresAt),
        metadata: {
          ...params.metadata,
          twintPaymentId: data.paymentId
        }
      };
    } catch (error) {
      console.error('Twint createIntent error:', error);
      throw new Error(`Failed to create Twint payment: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  async confirmIntent(intentId: string): Promise<PaymentIntent> {
    try {
      const response = await fetch(`${this.config.baseUrl}/payment/${intentId}`, {
        headers: {
          'Authorization': `Bearer ${this.config.apiKey}`,
          'X-Merchant-Id': this.config.merchantId
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to get Twint payment status: ${response.statusText}`);
      }

      const data: TwintPaymentResponse = await response.json();
      
      return {
        id: intentId,
        gateway: 'twint',
        status: this.mapStatus(data.status),
        amount: data.amount,
        currency: data.currency,
        metadata: {
          twintPaymentId: data.paymentId
        }
      };
    } catch (error) {
      console.error('Twint confirmIntent error:', error);
      throw new Error(`Failed to confirm Twint payment: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  async createRefund(params: {
    paymentIntentId: string;
    amount?: number;
    reason?: string;
    metadata?: Record<string, any>;
  }): Promise<Refund> {
    try {
      const response = await fetch(`${this.config.baseUrl}/refund`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json',
          'X-Merchant-Id': this.config.merchantId
        },
        body: JSON.stringify({
          paymentId: params.paymentIntentId,
          amount: params.amount,
          reason: params.reason || 'Customer requested refund',
          merchantReference: params.metadata?.orderId
        })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(`Twint refund error: ${error.message || response.statusText}`);
      }

      const data = await response.json();
      
      return {
        id: data.refundId,
        paymentIntentId: params.paymentIntentId,
        amount: data.amount,
        currency: data.currency,
        status: this.mapRefundStatus(data.status),
        reason: params.reason,
        metadata: {
          ...params.metadata,
          twintRefundId: data.refundId
        }
      };
    } catch (error) {
      console.error('Twint createRefund error:', error);
      throw new Error(`Failed to create Twint refund: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async handleWebhook(body: any, headers: Record<string, string>): Promise<{
    paymentIntentId: string;
    status: PaymentStatus;
    metadata?: Record<string, any>;
  }> {
    // Verify webhook signature
    const signature = headers['x-twint-signature'];
    if (!this.verifyWebhookSignature(body, signature)) {
      throw new Error('Invalid webhook signature');
    }

    const event = body;
    
    return {
      paymentIntentId: event.paymentId,
      status: this.mapStatus(event.status),
      metadata: {
        twintEventType: event.type,
        twintEventId: event.id,
        timestamp: event.timestamp
      }
    };
  }

  private verifyWebhookSignature(body: any, signature: string): boolean {
    // TODO: Implement proper webhook signature verification
    // This would involve using HMAC-SHA256 with the webhook secret
    return true; // Placeholder for development
  }
  
  private mapStatus(twintStatus: string): PaymentStatus {
    const statusMap: Record<string, PaymentStatus> = {
      'PENDING': 'pending',
      'IN_PROGRESS': 'processing',
      'SUCCESS': 'succeeded',
      'COMPLETED': 'succeeded',
      'FAILED': 'failed',
      'CANCELLED': 'cancelled',
      'EXPIRED': 'cancelled'
    };
    
    return statusMap[twintStatus] || 'pending';
  }

  private mapRefundStatus(twintStatus: string): 'pending' | 'succeeded' | 'failed' {
    const statusMap: Record<string, 'pending' | 'succeeded' | 'failed'> = {
      'PENDING': 'pending',
      'PROCESSING': 'pending',
      'SUCCESS': 'succeeded',
      'COMPLETED': 'succeeded',
      'FAILED': 'failed'
    };
    
    return statusMap[twintStatus] || 'pending';
  }

  // Generate QR code for in-store payments
  async generateQRCode(amount: number, reference: string): Promise<string> {
    try {
      const response = await fetch(`${this.config.baseUrl}/qr-code`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json',
          'X-Merchant-Id': this.config.merchantId
        },
        body: JSON.stringify({
          amount,
          currency: 'CHF',
          reference,
          validFor: 300 // 5 minutes
        })
      });

      if (!response.ok) {
        throw new Error(`Failed to generate QR code: ${response.statusText}`);
      }

      const data = await response.json();
      return data.qrCodeData; // Base64 encoded QR code image
    } catch (error) {
      console.error('Twint generateQRCode error:', error);
      throw new Error(`Failed to generate Twint QR code: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}